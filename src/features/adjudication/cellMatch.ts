// セル突き合わせ（docs/design-independent-dual-review.md §6.3）。
// 素材は StudyData / ResultsData の両 annotator 行の「現在値」（判定履歴ではない）。
// セル集合は両者の entity_key × field_id の和集合。片側にしかないセルは相手側「未入力」として
// 不一致扱いになる。一致判定は trim 後の完全文字列一致（NOT_REPORTED トークン同士も一致）。
// schema_version が両行で異なるセルは警告フラグを立てるがブロックしない（Q-d）
import { NOT_REPORTED_TOKEN, type ResultsDataRow, type StudyDataRow } from '../../domain/annotation';
import type { Decision } from '../../domain/decision';
import type { Evidence } from '../../domain/evidence';
import type { EntityLevel, SchemaField } from '../../domain/schemaField';
import { parseEntityKey, STUDY_ENTITY_KEY } from '../../utils/entityKey';
import { cellKeyOf } from '../verification/cellState';

export interface AdjudicationCell {
  cellKey: string;
  field: SchemaField;
  entityKey: string;
  /** A 側の現在値（NOT_REPORTED_TOKEN・実値・未入力 = null のいずれか） */
  valueA: string | null;
  /** B 側の現在値 */
  valueB: string | null;
  schemaVersionA: number | null;
  schemaVersionB: number | null;
  /** trim 後の完全文字列一致 */
  matches: boolean;
  /** 両行が存在し、かつ schema_version が異なる */
  schemaVersionMismatch: boolean;
  /**
   * A 側の判定履歴（Decisions）に付随する直近の note（issue #63。裁定 PDF ペインでの表示用）。
   * このセル（field_id × entity_key）への A の Decisions を decided_at 昇順で並べ、最後の 1 件
   * （action は問わない）の note を採用する。該当 Decision が無ければ null
   */
  noteA: string | null;
  /** B 側の同上 */
  noteB: string | null;
}

/** entity タブの突き合わせ順（ui-flow.md / cells.ts の TAB_ORDER と同じ並び） */
const ENTITY_LEVEL_ORDER: readonly EntityLevel[] = ['study', 'arm', 'outcome_result', 'rob_domain'];

function normalize(value: string | null): string {
  return (value ?? '').trim();
}

function resultsEffectiveValue(row: ResultsDataRow | undefined): string | null {
  if (row === undefined) {
    return null;
  }
  return row.notReported ? NOT_REPORTED_TOKEN : row.value;
}

function indexResultsRows(rows: readonly ResultsDataRow[]): Map<string, ResultsDataRow> {
  const index = new Map<string, ResultsDataRow>();
  for (const row of rows) {
    index.set(cellKeyOf(row.fieldId, row.entityKey), row);
  }
  return index;
}

/** 指定レベルの entity_key を両側の ResultsData 行から集めて和集合にする（entity_key 昇順） */
function unionEntityKeysForLevel(
  level: EntityLevel,
  resultsRowsA: readonly ResultsDataRow[],
  resultsRowsB: readonly ResultsDataRow[],
): string[] {
  const keys = new Set<string>();
  for (const row of resultsRowsA) {
    if (parseEntityKey(row.entityKey)?.level === level) {
      keys.add(row.entityKey);
    }
  }
  for (const row of resultsRowsB) {
    if (parseEntityKey(row.entityKey)?.level === level) {
      keys.add(row.entityKey);
    }
  }
  return [...keys].sort((a, b) => a.localeCompare(b));
}

/**
 * 指定セル（field_id × entity_key）への Decisions を decided_at 昇順で畳み込み、最後の 1 件
 * （action は問わない）の note を返す（issue #63）。該当 Decision が無ければ null
 */
function latestNoteFor(decisions: readonly Decision[], fieldId: string, entityKey: string): string | null {
  const relevant = decisions.filter((d) => d.fieldId === fieldId && d.entityKey === entityKey);
  if (relevant.length === 0) {
    return null;
  }
  const sorted = [...relevant].sort((a, b) => a.decidedAt.localeCompare(b.decidedAt));
  return (sorted[sorted.length - 1] as Decision).note;
}

function makeCell(
  field: SchemaField,
  entityKey: string,
  valueA: string | null,
  valueB: string | null,
  schemaVersionA: number | null,
  schemaVersionB: number | null,
  decisionsA: readonly Decision[],
  decisionsB: readonly Decision[],
): AdjudicationCell {
  return {
    cellKey: cellKeyOf(field.fieldId, entityKey),
    field,
    entityKey,
    valueA,
    valueB,
    schemaVersionA,
    schemaVersionB,
    matches: normalize(valueA) === normalize(valueB),
    schemaVersionMismatch:
      schemaVersionA !== null && schemaVersionB !== null && schemaVersionA !== schemaVersionB,
    noteA: latestNoteFor(decisionsA, field.fieldId, entityKey),
    noteB: latestNoteFor(decisionsB, field.fieldId, entityKey),
  };
}

/**
 * study の全セル（study レベル + arm / outcome_result / rob_domain レベル）を突き合わせる。
 * study レベルは全項目を無条件で 1 セル（entity_key = STUDY_ENTITY_KEY）として比較し、
 * 他レベルは両側の ResultsData 行から集めた entity_key の和集合 × 当該レベルの項目で比較する。
 *
 * decisionsA / decisionsB（省略可・既定 []）は該当 annotator の Decisions 全量を渡すと、
 * 各セルの noteA / noteB（issue #63: 裁定 PDF ペインでのメモ表示用）を畳み込む。
 * 呼び出し元は study 単位に絞った Decisions を渡すこと（絞り込みはこの関数の責務ではない）
 */
export function buildAdjudicationCells(
  fields: readonly SchemaField[],
  studyDataRowA: StudyDataRow | null,
  studyDataRowB: StudyDataRow | null,
  resultsRowsA: readonly ResultsDataRow[],
  resultsRowsB: readonly ResultsDataRow[],
  decisionsA: readonly Decision[] = [],
  decisionsB: readonly Decision[] = [],
): AdjudicationCell[] {
  const cells: AdjudicationCell[] = [];
  const indexA = indexResultsRows(resultsRowsA);
  const indexB = indexResultsRows(resultsRowsB);

  for (const level of ENTITY_LEVEL_ORDER) {
    const levelFields = fields
      .filter((field) => field.entityLevel === level)
      .sort((a, b) => a.fieldIndex - b.fieldIndex);
    if (levelFields.length === 0) {
      continue;
    }
    if (level === 'study') {
      for (const field of levelFields) {
        cells.push(
          makeCell(
            field,
            STUDY_ENTITY_KEY,
            studyDataRowA?.values[field.fieldName] ?? null,
            studyDataRowB?.values[field.fieldName] ?? null,
            studyDataRowA?.schemaVersion ?? null,
            studyDataRowB?.schemaVersion ?? null,
            decisionsA,
            decisionsB,
          ),
        );
      }
      continue;
    }
    const entityKeys = unionEntityKeysForLevel(level, resultsRowsA, resultsRowsB);
    for (const entityKey of entityKeys) {
      for (const field of levelFields) {
        const key = cellKeyOf(field.fieldId, entityKey);
        const rowA = indexA.get(key);
        const rowB = indexB.get(key);
        cells.push(
          makeCell(
            field,
            entityKey,
            resultsEffectiveValue(rowA),
            resultsEffectiveValue(rowB),
            rowA?.schemaVersion ?? null,
            rowB?.schemaVersion ?? null,
            decisionsA,
            decisionsB,
          ),
        );
      }
    }
  }
  return cells;
}

/**
 * study の Evidence（AI 根拠）を cellKey（field_id × entity_key）で引けるようにする
 * （issue #63: 裁定 PDF ペインの根拠ハイライト用）。1 run 内で同一セルへの Evidence は
 * 高々 1 件の想定（executeRun が field_id × entity_key ごとに 1 行を生成するため）。
 * 複数見つかった場合はシート行順で後勝ち（追記順 = 新しいものを優先）
 */
export function indexEvidenceByCellKey(evidence: readonly Evidence[]): Map<string, Evidence> {
  const index = new Map<string, Evidence>();
  for (const item of evidence) {
    index.set(cellKeyOf(item.fieldId, item.entityKey), item);
  }
  return index;
}
