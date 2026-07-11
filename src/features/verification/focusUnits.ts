// フォーカスモード（issue #38 段階A）: 検証パネルを「セル単体」ではなく
// 「検証ユニット」（論文の表の 1 ブロックに対応するカード 1 枚）単位で表示するための純ロジック層。
// 既存の TabModel（cells.ts）からタブ別にユニット列を組み立て、ユニット内・ユニット間の
// ナビゲーション（次の未判定セル・次の未判定ユニット）を提供する。
// UI（段階B）はここで定義した純関数群を消費するだけで、DOM やイベントには一切触れない。
//
// ユニットの単位（requirements.md の entity_level 設計に対応）:
// - study: section ごとに 1 ユニット。列は固定 1 つ（study は 1 document に 1 インスタンス）
// - arm: section ごとに 1 ユニット。列 = 群インスタンス（TabModel の各 group）
// - outcome_result: outcome × time の組ごとに 1 ユニット（同一 outcome・同一 time の全 arm を
//   横結合）。列 = arm。arm セグメントを持たないキー（arm=null）は「群なし」列として扱う
// - rob_domain: インスタンス（rob:ドメイン）ごとに 1 ユニット。列は固定 1 つ
import { NOT_REPORTED_TOKEN } from '../../domain/annotation';
import type { ConfirmedArmStructure } from '../../domain/armStructure';
import type { EntityLevel, SchemaField } from '../../domain/schemaField';
import { makeOutcomeEntityKey, parseEntityKey, STUDY_ENTITY_KEY } from '../../utils/entityKey';
import type { CellGroup, TabModel, VerificationCell } from './cells';

/** ユニット内の 1 列（study / rob_domain は固定 1 列、arm / outcome_result は群） */
export interface FocusUnitColumn {
  entityKey: string;
  label: string;
}

/** ユニット内の 1 行（1 フィールド × 列数ぶんのセル）。列に対応するセルが無ければ null */
export interface FocusUnitRow {
  field: SchemaField;
  cells: (VerificationCell | null)[];
}

/** 検証ユニット = 論文の表の 1 ブロックに対応するカード 1 枚ぶんのデータ */
export interface FocusUnit {
  /** タブ内で一意（例: 'study|基本情報' / 'outcome:pain|time:8w'） */
  unitKey: string;
  /** カード見出し */
  heading: string;
  columns: FocusUnitColumn[];
  rows: FocusUnitRow[];
  /** outcome_result のプリセット要約（連続 / 二値）。認識できないフィールド構成は null */
  summary: string | null;
}

export interface BuildFocusUnitsOptions {
  /** 人間が確定した arm 集合。列ラベルの解決に使う（cells.ts の TabModelOptions と同じ役割） */
  armStructure?: ConfirmedArmStructure | null;
}

/** study ユニットの唯一の列に付けるラベル */
const STUDY_COLUMN_LABEL = 'Study';
/** rob_domain ユニットの唯一の列に付けるラベル（区別対象が無いため固定の一般名。段階Bで裁量変更可） */
const ROB_COLUMN_LABEL = 'RoB';
/** arm セグメントを持たない outcome_result 列のラベル */
const NO_ARM_COLUMN_LABEL = '群なし';

/** 連続アウトカムのプリセット要約に必要なフィールド名（schema/presets/outcomeTemplates.ts の連続テンプレート） */
const CONTINUOUS_SUMMARY_FIELDS = ['outcome_mean', 'outcome_sd', 'outcome_n'] as const;
/** 二値アウトカムのプリセット要約に必要なフィールド名（同・二値テンプレート） */
const BINARY_SUMMARY_FIELDS = ['outcome_events', 'outcome_total'] as const;

/**
 * TabModel からタブ別にユニット列を構築する。options.armStructure は arm / outcome_result の
 * 列ラベル解決に使う（cells.ts が既に model 構築時に参照済みのものと同じ値を渡すこと）
 */
export function buildFocusUnits(
  tab: EntityLevel,
  model: TabModel,
  options: BuildFocusUnitsOptions = {},
): FocusUnit[] {
  const armStructure = options.armStructure ?? null;
  switch (tab) {
    case 'study':
      return buildStudyUnits(model);
    case 'arm':
      return buildArmUnits(model, armStructure);
    case 'outcome_result':
      return buildOutcomeUnits(model, armStructure);
    case 'rob_domain':
      return buildRobUnits(model);
  }
}

/**
 * group の cells から代表 1 件の entityKey を取り出す（同一 group 内の cells は全て同じ
 * entityKey を持つ。buildTabModel の構築規則による）。対象レベルにフィールドが 0 件で
 * cells が空の group では取り出せないため空文字を返す（呼び出し側で表示に使われない設計）
 */
function groupEntityKey(group: CellGroup): string {
  return group.cells[0]?.entityKey ?? '';
}

/** field_id 一致のセルを group から探す。無ければ null（FocusUnitRow.cells の「存在しないセル」契約） */
function findCell(group: CellGroup, fieldId: string): VerificationCell | null {
  return group.cells.find((cell) => cell.field.fieldId === fieldId) ?? null;
}

/** group 群からフィールド一覧を復元する（同一タブの全 group は同じフィールド集合・順序を持つ） */
function fieldsOf(groups: readonly CellGroup[]): SchemaField[] {
  return groups[0]?.cells.map((cell) => cell.field) ?? [];
}

interface FieldSection {
  section: string;
  fields: SchemaField[];
}

/**
 * フィールド一覧を section の初出順で連続グルーピングする
 * （buildTabModel の study タブ実装と同じ規則。cells.ts は非公開のためここで再実装する）
 */
function sectionsOf(fields: readonly SchemaField[]): FieldSection[] {
  const sections: FieldSection[] = [];
  for (const field of fields) {
    const last = sections[sections.length - 1];
    if (last !== undefined && last.section === field.section) {
      last.fields.push(field);
    } else {
      sections.push({ section: field.section, fields: [field] });
    }
  }
  return sections;
}

/** study タブ: TabModel の section グループ 1 つ = ユニット 1 つ（列は固定 1 つ） */
function buildStudyUnits(model: TabModel): FocusUnit[] {
  const columns: FocusUnitColumn[] = [{ entityKey: STUDY_ENTITY_KEY, label: STUDY_COLUMN_LABEL }];
  return model.groups.map((group) => ({
    unitKey: `study|${group.heading}`,
    heading: group.heading,
    columns,
    rows: group.cells.map((cell) => ({ field: cell.field, cells: [cell] })),
    summary: null,
  }));
}

/** arm タブ: section ごとに 1 ユニット。列 = 群インスタンス（TabModel の各 group） */
function buildArmUnits(model: TabModel, armStructure: ConfirmedArmStructure | null): FocusUnit[] {
  const fields = fieldsOf(model.groups);
  const columns = model.groups.map((group) => armColumn(group, armStructure));
  return sectionsOf(fields).map((section) => ({
    unitKey: `arm|${section.section}`,
    heading: section.section,
    columns,
    rows: section.fields.map((field) => ({
      field,
      cells: model.groups.map((group) => findCell(group, field.fieldId)),
    })),
    summary: null,
  }));
}

/** arm 列のラベル。armStructure に確定名があればそれ、無ければ entityKeyLabel 由来の group.heading */
function armColumn(group: CellGroup, armStructure: ConfirmedArmStructure | null): FocusUnitColumn {
  const entityKey = groupEntityKey(group);
  const armName = armStructure?.arms.find((arm) => arm.armKey === entityKey)?.armName;
  return { entityKey, label: armName ?? group.heading };
}

/** outcome_result の 1 列の元になる group と、その所属 (outcome, time) から復元した arm 値 */
interface OutcomeColumnSource {
  group: CellGroup;
  entityKey: string;
  /** entity_key の arm セグメント。無ければ null（「群なし」列） */
  arm: string | null;
}

interface OutcomeBucket {
  outcome: string;
  time: string | null;
  sources: OutcomeColumnSource[];
}

/**
 * outcome_result タブ: outcome × time の組ごとに 1 ユニット（同一 outcome・同一 time の
 * 全 arm を横結合）。ユニット順は entity_key 昇順（= TabModel の group 出現順）から
 * (outcome, time) の初出順を導出する
 */
function buildOutcomeUnits(model: TabModel, armStructure: ConfirmedArmStructure | null): FocusUnit[] {
  const fields = fieldsOf(model.groups);
  if (fields.length === 0) {
    // フィールドが 0 件だと entity_key を復元できる group があっても表示すべき行が無い
    return [];
  }
  const buckets: OutcomeBucket[] = [];
  for (const group of model.groups) {
    const entityKey = groupEntityKey(group);
    const parsed = parseEntityKey(entityKey);
    if (parsed === null || parsed.level !== 'outcome_result') {
      // 防御: entity_key を復元できない group（cells が空 = 対象外レベル混入等）はユニット化しない
      continue;
    }
    let bucket = buckets.find((b) => b.outcome === parsed.outcome && b.time === parsed.time);
    if (bucket === undefined) {
      bucket = { outcome: parsed.outcome, time: parsed.time, sources: [] };
      buckets.push(bucket);
    }
    bucket.sources.push({ group, entityKey, arm: parsed.arm });
  }
  const armOrder = new Map(
    (armStructure?.arms ?? []).map((arm, index) => [arm.armKey, index] as const),
  );
  return buckets.map((bucket) => {
    const sortedSources = [...bucket.sources].sort((a, b) => compareOutcomeColumns(a, b, armOrder));
    return {
      unitKey: makeOutcomeEntityKey({ outcome: bucket.outcome, time: bucket.time ?? undefined }),
      heading: bucket.time === null ? bucket.outcome : `${bucket.outcome} ／ 時点: ${bucket.time}`,
      columns: sortedSources.map((source) => outcomeColumn(source, armStructure)),
      rows: fields.map((field) => ({
        field,
        cells: sortedSources.map((source) => findCell(source.group, field.fieldId)),
      })),
      summary: buildOutcomeSummary(fields, sortedSources),
    };
  });
}

/** outcome_result 列のラベル。「群なし」/ armStructure の確定名 / `群 X` フォールバックの順 */
function outcomeColumn(
  source: OutcomeColumnSource,
  armStructure: ConfirmedArmStructure | null,
): FocusUnitColumn {
  if (source.arm === null) {
    return { entityKey: source.entityKey, label: NO_ARM_COLUMN_LABEL };
  }
  const armKey = `arm:${source.arm}`;
  const armName = armStructure?.arms.find((arm) => arm.armKey === armKey)?.armName;
  return { entityKey: source.entityKey, label: armName ?? `群 ${source.arm}` };
}

/** armStructure 内での順位。「群なし」列（arm=null）や未登録 arm は undefined */
function outcomeColumnRank(
  source: OutcomeColumnSource,
  armOrder: ReadonlyMap<string, number>,
): number | undefined {
  return source.arm === null ? undefined : armOrder.get(`arm:${source.arm}`);
}

/**
 * outcome_result の列順: armStructure の並び → それ以外は entity_key の昇順
 * （armStructure に無い arm・「群なし」列は互いに entity_key 昇順で並ぶ）
 */
function compareOutcomeColumns(
  a: OutcomeColumnSource,
  b: OutcomeColumnSource,
  armOrder: ReadonlyMap<string, number>,
): number {
  const rankA = outcomeColumnRank(a, armOrder);
  const rankB = outcomeColumnRank(b, armOrder);
  if (rankA !== undefined && rankB !== undefined) {
    return rankA - rankB;
  }
  if (rankA !== undefined) {
    return -1;
  }
  if (rankB !== undefined) {
    return 1;
  }
  return a.entityKey.localeCompare(b.entityKey);
}

/** names の各 field_name を持つ SchemaField を fields から順番どおりに探す。1 つでも無ければ null */
function findFieldsByName(fields: readonly SchemaField[], names: readonly string[]): SchemaField[] | null {
  const found = names.map((name) => fields.find((field) => field.fieldName === name));
  if (!found.every((field): field is SchemaField => field !== undefined)) {
    return null;
  }
  return found;
}

/**
 * outcome_result ユニットのプリセット要約。連続（mean ± sd (n=N)）/ 二値（events/total）の
 * フィールド構成を認識できたときだけ列ごとの文字列を ` vs ` で連結する。それ以外は null
 */
function buildOutcomeSummary(
  fields: readonly SchemaField[],
  sources: readonly OutcomeColumnSource[],
): string | null {
  const continuousFields = findFieldsByName(fields, CONTINUOUS_SUMMARY_FIELDS);
  if (continuousFields !== null) {
    const [meanField, sdField, nField] = continuousFields as [SchemaField, SchemaField, SchemaField];
    return sources
      .map((source) => {
        const mean = resolvedCellValue(findCell(source.group, meanField.fieldId));
        const sd = resolvedCellValue(findCell(source.group, sdField.fieldId));
        const n = resolvedCellValue(findCell(source.group, nField.fieldId));
        return `${mean} ± ${sd} (n=${n})`;
      })
      .join(' vs ');
  }
  const binaryFields = findFieldsByName(fields, BINARY_SUMMARY_FIELDS);
  if (binaryFields !== null) {
    const [eventsField, totalField] = binaryFields as [SchemaField, SchemaField];
    return sources
      .map((source) => {
        const events = resolvedCellValue(findCell(source.group, eventsField.fieldId));
        const total = resolvedCellValue(findCell(source.group, totalField.fieldId));
        return `${events}/${total}`;
      })
      .join(' vs ');
  }
  return null;
}

/**
 * セルの表示値を解決する: 判定確定値（state.value）＞ AI 抽出値（evidence.value）＞ `?`。
 * NOT_REPORTED_TOKEN・null は `?` として扱う（プリセット要約に生の NR トークンを出さないため）
 */
function resolvedCellValue(cell: VerificationCell | null): string {
  if (cell === null) {
    return '?';
  }
  const raw = cell.state.value ?? cell.evidence?.value ?? null;
  if (raw === null || raw === NOT_REPORTED_TOKEN) {
    return '?';
  }
  return raw;
}

/** rob_domain タブ: インスタンス（rob:ドメイン）ごとに 1 ユニット（列は固定 1 つ） */
function buildRobUnits(model: TabModel): FocusUnit[] {
  return model.groups.map((group) => {
    const entityKey = groupEntityKey(group);
    return {
      // entityKey が復元できない（フィールド 0 件）場合のみ heading ベースへフォールバック
      unitKey: entityKey === '' ? `rob|${group.heading}` : entityKey,
      heading: group.heading,
      columns: [{ entityKey, label: ROB_COLUMN_LABEL }],
      rows: group.cells.map((cell) => ({ field: cell.field, cells: [cell] })),
      summary: null,
    };
  });
}

/** cellKey を持つセルが属するユニットを探す。無ければ null */
export function unitOfCell(units: readonly FocusUnit[], cellKey: string): FocusUnit | null {
  for (const unit of units) {
    for (const row of unit.rows) {
      for (const cell of row.cells) {
        if (cell !== null && cell.cellKey === cellKey) {
          return unit;
        }
      }
    }
  }
  return null;
}

/**
 * ユニット内で fromCellKey の次にある未判定セルの cellKey を返す（行優先: 行内を左→右、
 * 次の行へ）。fromCellKey が null、またはユニット内に見つからない場合は先頭から探索する。
 * 末尾まで見つからなければ折り返さず null
 */
export function nextPendingCellInUnit(unit: FocusUnit, fromCellKey: string | null): string | null {
  const flat = unit.rows.flatMap((row) =>
    row.cells.filter((cell): cell is VerificationCell => cell !== null),
  );
  const fromIndex = fromCellKey === null ? -1 : flat.findIndex((cell) => cell.cellKey === fromCellKey);
  const next = flat.slice(fromIndex + 1).find((cell) => cell.state.status === 'unverified');
  return next?.cellKey ?? null;
}

/** ユニットが 1 つ以上の未判定セルを含むか */
function hasPendingCell(unit: FocusUnit): boolean {
  return unit.rows.some((row) =>
    row.cells.some((cell) => cell !== null && cell.state.status === 'unverified'),
  );
}

/**
 * fromUnitKey の次以降で、未判定セルを 1 つ以上含む最初のユニットを返す（先頭へ回り込む）。
 * fromUnitKey が null、またはユニット一覧に見つからない場合は先頭から探索する。
 * 該当ユニットが無ければ null
 */
export function nextPendingUnit(units: readonly FocusUnit[], fromUnitKey: string | null): FocusUnit | null {
  const fromIndex = fromUnitKey === null ? -1 : units.findIndex((unit) => unit.unitKey === fromUnitKey);
  const baseIndex = fromIndex + 1;
  const rotated = [...units.slice(baseIndex), ...units.slice(0, baseIndex)];
  return rotated.find(hasPendingCell) ?? null;
}

/** ユニットの判定進捗（null セルは分母に数えない） */
export function unitProgress(unit: FocusUnit): { decided: number; total: number } {
  let decided = 0;
  let total = 0;
  for (const row of unit.rows) {
    for (const cell of row.cells) {
      if (cell === null) {
        continue;
      }
      total += 1;
      if (cell.state.status !== 'unverified') {
        decided += 1;
      }
    }
  }
  return { decided, total };
}
