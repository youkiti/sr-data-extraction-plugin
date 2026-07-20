// ma.csv / ma_status.csv（issue #60 design-r-export.md §2）: 1 行 = study × outcome × timepoint × arm。
// D-3（2026-07-12 合意）により comparison ペア展開は行わず、arm 単位の long 表として出す
// （netmeta::pairwise() / metafor::to.wide() が arm 単位 long を直接入力に取れるため、
// comparison 生成は R 側の標準機能に委ねる）。
// entity_key のインスタンス列挙は outcome_result が AI ドラフト由来のデータ駆動のため、
// 検証画面と同じ `entityInstances`（Evidence / Decisions からの集合 + ArmStructures 展開）を再利用する
import type { AnnotatorType, ResultsDataRow } from '../../../domain/annotation';
import type { ArmStructureRow, ConfirmedArmStructure } from '../../../domain/armStructure';
import type { Decision } from '../../../domain/decision';
import type { Evidence } from '../../../domain/evidence';
import type { SchemaField } from '../../../domain/schemaField';
import type { StudyRecord } from '../../../domain/study';
import type { ParsedEntityKey } from '../../../utils/entityKey';
import {
  makeOutcomeEntityKey,
  makeRobDomainEntityKey,
  parseEntityKey,
  robEstimateScopeOf,
} from '../../../utils/entityKey';
import { latestArmStructure } from '../../verification/armStructureRepository';
import { entityInstances } from '../../verification/cells';
import { distinctAnnotators } from './annotatorPool';
import { buildCsv } from '../csvEncode';
import { selectFinalAnnotator } from '../finalAnnotator';
import type { RSetIssue } from './issues';
import { applyNotApplicable } from './presetFields';
import { activeRobToolFieldSets } from './robFields';
import { resolveRSetStatus, resolveRSetValue, resultsRowRawValue, type RSetStatus } from './rsetStatus';
import { parseTimepoint } from './timepoint';

/** キー列（rob_tool / rob_overall_judgement は overall 判定の複製列 = schema_version の手前に置く。
 * 複製値は当該 outcome 行への verified オーバーライド優先・なければ study 単位の base。§4.2.2） */
const MA_KEY_HEADER = [
  'study_id',
  'study_label',
  'outcome_id',
  'outcome_label',
  'timepoint',
  'timepoint_value',
  'timepoint_unit',
  'arm_id',
  'arm_label',
  'rob_tool',
  'rob_overall_judgement',
  'schema_version',
] as const;

/** outcome_label 解決の規約項目名（v1 で新設。無ければ outcome_label は空のまま） */
const OUTCOME_NAME_FIELD_NAME = 'outcome_name';

/** rob_overall_judgement 複製列の解決に使う overall ドメイン id（base・オーバーライドで共通） */
const ROB_OVERALL_DOMAIN_ID = 'overall';

export interface MaBuildResult {
  csv: string;
  statusCsv: string;
  header: string[];
  rowCount: number;
  issues: RSetIssue[];
}

interface ResultCellLookup {
  index: Map<string, ResultsDataRow>;
  evidenceKeys: Set<string>;
}

/** 複合キーの区切り。NUL は entity_key・field_id 等の値に現れない（buildAuditCsv.ts と同じ規約） */
const SEP = String.fromCharCode(0);

function cellKey(entityKey: string, fieldId: string): string {
  return `${entityKey}${SEP}${fieldId}`;
}

function buildLookup(
  resultsRows: readonly ResultsDataRow[],
  evidences: readonly Evidence[],
  annotator: string,
  annotatorType: AnnotatorType,
): ResultCellLookup {
  const index = new Map<string, ResultsDataRow>();
  for (const row of resultsRows) {
    if (row.annotator === annotator && row.annotatorType === annotatorType) {
      index.set(cellKey(row.entityKey, row.fieldId), row);
    }
  }
  const evidenceKeys = new Set(evidences.map((evidence) => cellKey(evidence.entityKey, evidence.fieldId)));
  return { index, evidenceKeys };
}

interface MaRow {
  outcomeId: string;
  timepoint: string;
  armId: string;
  armRank: number;
  valueLine: string[];
  statusLine: string[];
}

function armRankOf(armId: string, confirmedArms: ConfirmedArmStructure | null): number {
  if (armId === '') {
    return -1;
  }
  if (confirmedArms === null) {
    return Number.MAX_SAFE_INTEGER;
  }
  const index = confirmedArms.arms.findIndex((arm) => arm.armKey === `arm:${armId}`);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function armLabelOf(armId: string, confirmedArms: ConfirmedArmStructure | null): string {
  if (armId === '') {
    return '';
  }
  return confirmedArms?.arms.find((arm) => arm.armKey === `arm:${armId}`)?.armName ?? '';
}

export function buildMaCsv(
  studies: readonly StudyRecord[],
  resultsRows: readonly ResultsDataRow[],
  decisions: readonly Decision[],
  evidences: readonly Evidence[],
  armStructureRows: readonly ArmStructureRow[],
  fields: readonly SchemaField[],
): MaBuildResult {
  const outcomeFields = fields
    .filter((field) => field.entityLevel === 'outcome_result')
    .sort((a, b) => a.fieldIndex - b.fieldIndex);
  const header = [...MA_KEY_HEADER, ...outcomeFields.map((field) => field.fieldName)];
  const robToolSets = activeRobToolFieldSets(fields);
  // v1 の割り切り: 複数ツール同時挿入時は先頭（rob2 優先）のみを ma.csv の複製列に使う（robFields.ts 参照）
  const robToolSet = robToolSets[0] ?? null;
  const robJudgementField =
    robToolSet === null
      ? null
      : // activeRobToolFieldSets が同じ条件で存在確認済みのため .find() は必ず見つかる
        // （?? null は noUncheckedIndexedAccess を満たすための型上の保険で実行時には到達しない）
        /* istanbul ignore next */
        (fields.find(
          (field) => field.entityLevel === 'rob_domain' && field.fieldName === robToolSet.judgementFieldName,
        ) ?? null);

  const rows: MaRow[] = [];
  const issues: RSetIssue[] = [];

  for (const study of studies) {
    const studyResultsRows = resultsRows.filter((row) => row.studyId === study.studyId);
    if (studyResultsRows.length === 0) {
      continue; // ma 行がない study は正常（results_long と同じ扱い）
    }
    const final = selectFinalAnnotator(distinctAnnotators(studyResultsRows));
    if (final === null) {
      issues.push({
        issueType: 'skipped_study_no_final_annotator',
        studyId: study.studyId,
        fieldId: '',
        entityKey: '',
        detail: 'ma.csv: ResultsData の確定 annotator を一意に特定できません（human 行複数 or consensus 重複）',
      });
      continue;
    }

    const studyEvidence = evidences.filter((evidence) => evidence.studyId === study.studyId);
    const studyDecisions = decisions.filter((decision) => decision.studyId === study.studyId);
    const lookup = buildLookup(studyResultsRows, studyEvidence, final.annotator, final.annotatorType);
    const armRows = armStructureRows.filter((row) => row.studyId === study.studyId);
    const confirmedArms = latestArmStructure(armRows, final.annotator);

    const outcomeEvidence = studyEvidence.filter(
      (evidence) => parseEntityKey(evidence.entityKey)?.level === 'outcome_result',
    );
    const outcomeDecisions = studyDecisions.filter(
      (decision) => parseEntityKey(decision.entityKey)?.level === 'outcome_result',
    );
    // entityInstances は検証画面と同じ Evidence / Decisions 駆動の集合（ArmStructures 展開込み）。
    // それだけに頼ると「ResultsData 行はあるが対応する Evidence / Decision が無い」レアケース
    // （データ不整合・移行時の欠落等）でインスタンスごと ma.csv から黙って消えうるため、
    // 確定 annotator の ResultsData に実在する entity_key を必ず合流させる（要望 6 の防御）
    const instanceSet = new Set(
      entityInstances('outcome_result', outcomeEvidence, outcomeDecisions, { armStructure: confirmedArms }),
    );
    for (const key of lookup.index.keys()) {
      const [rowEntityKey] = key.split(SEP);
      if (rowEntityKey !== undefined && parseEntityKey(rowEntityKey)?.level === 'outcome_result') {
        instanceSet.add(rowEntityKey);
      }
    }
    const instances = [...instanceSet].sort((a, b) => a.localeCompare(b));

    // rob:overall の複製 2 列（study 単位の base を 1 回だけ計算し、全 outcome 行へ複製する）
    let robOverallStatus: RSetStatus | null = null;
    let robOverallValue = '';
    // estimate 単位オーバーライドの解決材料（issue #109 design-r-export.md §4.2.2）:
    // 確定 annotator の ResultsData から overall のオーバーライド行を集め、verified のものだけを
    // 「参照先 estimate の正準形キー → 判定値」で引けるようにする（未 verified は base へフォールバック）
    const robOverallOverrides = new Map<string, string>();
    if (robToolSet !== null && robJudgementField !== null) {
      const overallKey = makeRobDomainEntityKey(ROB_OVERALL_DOMAIN_ID);
      const row = lookup.index.get(cellKey(overallKey, robJudgementField.fieldId));
      const raw = resultsRowRawValue(row);
      const hasEvidence = lookup.evidenceKeys.has(cellKey(overallKey, robJudgementField.fieldId));
      robOverallStatus = resolveRSetStatus(raw, hasEvidence);
      robOverallValue = resolveRSetValue(raw, robOverallStatus);
      if (robOverallStatus === 'unverified') {
        issues.push({
          issueType: 'unverified_cell',
          studyId: study.studyId,
          fieldId: robJudgementField.fieldId,
          entityKey: overallKey,
          detail: 'ma.csv: rob_overall_judgement は AI 抽出のみで人間の判定が 0 件です',
        });
      }

      for (const resultsRow of lookup.index.values()) {
        if (resultsRow.fieldId !== robJudgementField.fieldId) {
          continue;
        }
        const scope = robEstimateScopeOf(resultsRow.entityKey);
        if (scope === null) {
          continue; // base 評価（rob:<domain_id> 単独）や rob_domain 以外のキーはオーバーライドではない
        }
        // robEstimateScopeOf が非 null の時点で rob_domain の estimate スコープキーであることは保証される
        const parsed = parseEntityKey(resultsRow.entityKey) as Extract<ParsedEntityKey, { level: 'rob_domain' }>;
        if (parsed.domain !== ROB_OVERALL_DOMAIN_ID) {
          continue; // overall 以外のドメインのオーバーライドは ma.csv の複製列に関与しない
        }
        const overrideRaw = resultsRowRawValue(resultsRow);
        const overrideStatus = resolveRSetStatus(
          overrideRaw,
          lookup.evidenceKeys.has(cellKey(resultsRow.entityKey, resultsRow.fieldId)),
        );
        if (overrideStatus !== 'verified') {
          continue;
        }
        // セグメント順の表記揺れで同一 estimate を指す重複キーは先勝ちで決定的に解決する
        if (!robOverallOverrides.has(scope)) {
          robOverallOverrides.set(scope, resolveRSetValue(overrideRaw, overrideStatus));
        }
      }
    }

    const studyRows: MaRow[] = [];
    for (const entityKey of instances) {
      const parsed = parseEntityKey(entityKey);
      /* istanbul ignore if -- instances は entityInstances と自前の union のいずれも
         level==='outcome_result' を条件に絞り込んだ後の集合のため実行時に到達しない防御 */
      if (parsed === null || parsed.level !== 'outcome_result') {
        continue;
      }
      const armId = parsed.arm ?? '';
      const { value: timepointValue, unit: timepointUnit } = parseTimepoint(parsed.time);

      // オーバーライドの照合は正準形（robEstimateScopeOf と同じ outcome → arm → time 順）同士で行う。
      // instances には Evidence / ResultsData 由来のセグメント順が異なるキーも混在しうるため
      const canonicalInstanceKey = makeOutcomeEntityKey({
        outcome: parsed.outcome,
        arm: parsed.arm ?? undefined,
        time: parsed.time ?? undefined,
      });
      // 当該 outcome 行への verified オーバーライドがあればそれを優先し、なければ base（§4.2.2）。
      // ma_status.csv 側の verification_status も採用した側のものを出す
      const overrideJudgement = robOverallOverrides.get(canonicalInstanceKey);
      const rowRobOverallValue = overrideJudgement ?? robOverallValue;
      const rowRobOverallStatus: string = overrideJudgement === undefined ? (robOverallStatus ?? '') : 'verified';

      // 1 パス目: 各 field の生値・基底ステータス（no_data / unverified / not_reported / verified）を
      // field 配列と同じ並びで作る（2 パス目は配列を直接なめるため、存在しないキーの `?? 既定値` が
      // 不要になる。baseStatuses は 2 パス目で「対岸」プリセット項目の状態を引くためだけに残す）
      const baseStatuses = new Map<string, RSetStatus>();
      const fieldCells = outcomeFields.map((field) => {
        const row = lookup.index.get(cellKey(entityKey, field.fieldId));
        const raw = resultsRowRawValue(row);
        const hasEvidence = lookup.evidenceKeys.has(cellKey(entityKey, field.fieldId));
        const baseStatus = resolveRSetStatus(raw, hasEvidence);
        baseStatuses.set(field.fieldName, baseStatus);
        return { field, raw, baseStatus, schemaVersion: row?.schemaVersion ?? null };
      });

      // 2 パス目: not_applicable の格上げ（二値 ⇔ 連続プリセットの対岸判定）。
      // outcome_name フィールドがあれば同じパスで outcome_label（複製列）も確定する
      let schemaVersionCandidate = 0;
      let outcomeLabel = '';
      const valueLine: string[] = [];
      const statusLine: string[] = [];
      for (const cell of fieldCells) {
        const status = applyNotApplicable(cell.field.fieldName, cell.baseStatus, baseStatuses);
        valueLine.push(resolveRSetValue(cell.raw, status));
        statusLine.push(status);
        if (status === 'unverified') {
          issues.push({
            issueType: 'unverified_cell',
            studyId: study.studyId,
            fieldId: cell.field.fieldId,
            entityKey,
            detail: `ma.csv: ${cell.field.fieldName} は AI 抽出のみで人間の判定が 0 件です`,
          });
        }
        if (cell.field.fieldName === OUTCOME_NAME_FIELD_NAME) {
          outcomeLabel = resolveRSetValue(cell.raw, status);
        }
        if (cell.schemaVersion !== null) {
          schemaVersionCandidate = Math.max(schemaVersionCandidate, cell.schemaVersion);
        }
      }

      const keyValues = [
        study.studyId,
        study.studyLabel,
        parsed.outcome,
        outcomeLabel,
        parsed.time ?? '',
        timepointValue,
        timepointUnit,
        armId,
        armLabelOf(armId, confirmedArms),
        robToolSet?.tool ?? '',
        rowRobOverallValue,
        schemaVersionCandidate > 0 ? String(schemaVersionCandidate) : '',
      ];
      const statusKeyValues = [
        study.studyId,
        study.studyLabel,
        parsed.outcome,
        outcomeLabel,
        parsed.time ?? '',
        timepointValue,
        timepointUnit,
        armId,
        armLabelOf(armId, confirmedArms),
        robToolSet?.tool ?? '',
        rowRobOverallStatus,
        schemaVersionCandidate > 0 ? String(schemaVersionCandidate) : '',
      ];

      studyRows.push({
        outcomeId: parsed.outcome,
        timepoint: parsed.time ?? '',
        armId,
        armRank: armRankOf(armId, confirmedArms),
        valueLine: [...keyValues, ...valueLine],
        statusLine: [...statusKeyValues, ...statusLine],
      });
    }

    // study 内は outcome → timepoint → arm の決定的順序（要望どおり）。study 間は入力順を維持する
    studyRows.sort((a, b) => {
      if (a.outcomeId !== b.outcomeId) {
        return a.outcomeId.localeCompare(b.outcomeId);
      }
      if (a.timepoint !== b.timepoint) {
        return a.timepoint.localeCompare(b.timepoint);
      }
      if (a.armRank !== b.armRank) {
        return a.armRank - b.armRank;
      }
      return a.armId.localeCompare(b.armId);
    });
    rows.push(...studyRows);
  }

  return {
    csv: buildCsv(header, rows.map((row) => row.valueLine)),
    statusCsv: buildCsv(header, rows.map((row) => row.statusLine)),
    header,
    rowCount: rows.length,
    issues,
  };
}
