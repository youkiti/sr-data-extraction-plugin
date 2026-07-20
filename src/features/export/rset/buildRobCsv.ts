// rob.csv（issue #60 design-r-export.md §2）: 1 行 = study × RoB ドメイン。robvis 互換出力の派生元。
// RoB ドメインは AI ドラフト非対応（テンプレート挿入が唯一の入口）のため、base 行のインスタンス列挙は
// Evidence / Decisions からのデータ駆動ではなく、テンプレート定義（ROB2_DOMAINS / ROBINS_I_DOMAINS）
// からの直接列挙にする。これにより AI が抽出できていないドメインも no_data 行として必ず出現する。
// estimate 単位のオーバーライド行（issue #109 design-r-export.md §4.3）は逆に、保存データ
// （確定 annotator の ResultsData + Decisions の宣言）に存在する宣言分だけをデータ駆動で出力する:
// 未評価 estimate の行は捏造せず、評価値の解決（オーバーライド優先）は R 側の join に委ねる
import type { ResultsDataRow } from '../../../domain/annotation';
import type { Decision } from '../../../domain/decision';
import type { Evidence } from '../../../domain/evidence';
import type { SchemaField } from '../../../domain/schemaField';
import type { StudyRecord } from '../../../domain/study';
import type { ParsedEntityKey } from '../../../utils/entityKey';
import { makeRobDomainEntityKey, parseEntityKey, robEstimateScopeOf } from '../../../utils/entityKey';
import { distinctAnnotators } from './annotatorPool';
import { buildCsv } from '../csvEncode';
import { selectFinalAnnotator } from '../finalAnnotator';
import type { RSetIssue } from './issues';
import { activeRobToolFieldSets } from './robFields';
import { resolveRSetStatus, resolveRSetValue, resultsRowRawValue } from './rsetStatus';

export const ROB_HEADER = [
  'study_id',
  'study_label',
  'tool',
  'domain_id',
  'domain_label',
  'sq_id',
  'outcome_id',
  'entity_key',
  'judgement',
  'support',
  'verification_status',
  'schema_version',
] as const;

export interface RobBuildResult {
  csv: string;
  rowCount: number;
  issues: RSetIssue[];
}

/** 複合キーの区切り。NUL は entity_key・field_id 等の値に現れない（buildAuditCsv.ts と同じ規約） */
const SEP = String.fromCharCode(0);

function cellKey(entityKey: string, fieldId: string): string {
  return `${entityKey}${SEP}${fieldId}`;
}

/** estimate 単位オーバーライドの出力単位（entity_key は保存行の原文・outcome_id は正準形） */
interface RobOverrideInstance {
  entityKey: string;
  outcomeId: string;
}

export function buildRobCsv(
  studies: readonly StudyRecord[],
  resultsRows: readonly ResultsDataRow[],
  decisions: readonly Decision[],
  evidences: readonly Evidence[],
  fields: readonly SchemaField[],
): RobBuildResult {
  const toolSets = activeRobToolFieldSets(fields);
  const rows: string[][] = [];
  const issues: RSetIssue[] = [];

  if (toolSets.length === 0) {
    return { csv: buildCsv(ROB_HEADER, rows), rowCount: 0, issues };
  }

  for (const study of studies) {
    const studyResultsRows = resultsRows.filter((row) => row.studyId === study.studyId);
    if (studyResultsRows.length === 0) {
      continue; // rob 行がない study は正常（results_long と同じ扱い）
    }
    const final = selectFinalAnnotator(distinctAnnotators(studyResultsRows));
    if (final === null) {
      issues.push({
        issueType: 'skipped_study_no_final_annotator',
        studyId: study.studyId,
        fieldId: '',
        entityKey: '',
        detail: 'rob.csv: ResultsData の確定 annotator を一意に特定できません（human 行複数 or consensus 重複）',
      });
      continue;
    }

    const studyEvidence = evidences.filter((evidence) => evidence.studyId === study.studyId);
    const index = new Map<string, ResultsDataRow>();
    for (const row of studyResultsRows) {
      if (row.annotator === final.annotator && row.annotatorType === final.annotatorType) {
        index.set(cellKey(row.entityKey, row.fieldId), row);
      }
    }
    const evidenceKeys = new Set(studyEvidence.map((evidence) => cellKey(evidence.entityKey, evidence.fieldId)));

    // estimate 単位オーバーライドの列挙（design-r-export.md §4.3）: 確定 annotator の ResultsData と
    // Decisions（S8 の宣言イベント含む）に実在する estimate スコープキーだけを domain_id ごとに集める
    const overridesByDomain = new Map<string, RobOverrideInstance[]>();
    const seenOverrideKeys = new Set<string>();
    const collectOverride = (entityKey: string): void => {
      if (seenOverrideKeys.has(entityKey)) {
        return;
      }
      seenOverrideKeys.add(entityKey);
      const outcomeId = robEstimateScopeOf(entityKey);
      if (outcomeId === null) {
        return; // base 評価・rob_domain 以外・形式不正はオーバーライドではない
      }
      // robEstimateScopeOf が非 null の時点で rob_domain の estimate スコープキーであることは保証される
      const parsed = parseEntityKey(entityKey) as Extract<ParsedEntityKey, { level: 'rob_domain' }>;
      const list = overridesByDomain.get(parsed.domain);
      if (list === undefined) {
        overridesByDomain.set(parsed.domain, [{ entityKey, outcomeId }]);
      } else {
        list.push({ entityKey, outcomeId });
      }
    };
    for (const row of index.values()) {
      collectOverride(row.entityKey);
    }
    for (const decision of decisions) {
      if (decision.studyId === study.studyId) {
        collectOverride(decision.entityKey);
      }
    }
    for (const list of overridesByDomain.values()) {
      // ソート規則（§4.3）: outcome_id 昇順。同一 outcome_id（セグメント順の表記揺れ）は
      // entity_key 昇順のタイブレークで決定的に並べる
      list.sort((a, b) => {
        const byOutcome = a.outcomeId.localeCompare(b.outcomeId);
        return byOutcome !== 0 ? byOutcome : a.entityKey.localeCompare(b.entityKey);
      });
    }

    for (const toolSet of toolSets) {
      const judgementField = fields.find(
        (field) => field.entityLevel === 'rob_domain' && field.fieldName === toolSet.judgementFieldName,
      );
      /* istanbul ignore if -- toolSets は activeRobToolFieldSets が judgement 項目の存在で
         絞り込んだ後の集合のため実行時に到達しない防御 */
      if (judgementField === undefined) {
        continue;
      }
      const supportField = fields.find(
        (field) => field.entityLevel === 'rob_domain' && field.fieldName === toolSet.supportFieldName,
      );

      // base 行とオーバーライド行で verification_status / support / judgement の規則と
      // unverified_cell の積み上げを完全に共有する（§4.3。差は outcome_id と entity_key のみ）
      const emitRow = (entityKey: string, outcomeId: string, domainLabel: string, domainId: string): void => {
        const judgementRow = index.get(cellKey(entityKey, judgementField.fieldId));
        const judgementRaw = resultsRowRawValue(judgementRow);
        const judgementHasEvidence = evidenceKeys.has(cellKey(entityKey, judgementField.fieldId));
        const status = resolveRSetStatus(judgementRaw, judgementHasEvidence);
        const judgementValue = resolveRSetValue(judgementRaw, status);

        let supportValue = '';
        if (supportField !== undefined) {
          const supportRow = index.get(cellKey(entityKey, supportField.fieldId));
          const supportRaw = resultsRowRawValue(supportRow);
          const supportHasEvidence = evidenceKeys.has(cellKey(entityKey, supportField.fieldId));
          const supportStatus = resolveRSetStatus(supportRaw, supportHasEvidence);
          supportValue = resolveRSetValue(supportRaw, supportStatus);
        }

        const schemaVersion = judgementRow?.schemaVersion ?? null;

        rows.push([
          study.studyId,
          study.studyLabel,
          toolSet.tool,
          domainId,
          domainLabel,
          '', // sq_id（signaling question。#61 実装後）
          outcomeId, // base 行は空・オーバーライド行は参照先インスタンスキーの正準形（issue #109）
          entityKey,
          judgementValue,
          supportValue,
          status,
          schemaVersion === null ? '' : String(schemaVersion),
        ]);

        if (status === 'unverified') {
          issues.push({
            issueType: 'unverified_cell',
            studyId: study.studyId,
            fieldId: judgementField.fieldId,
            entityKey,
            detail: `rob.csv: ${toolSet.judgementFieldName} は AI 抽出のみで人間の判定が 0 件です`,
          });
        }
      };

      // ソート規則（§4.3）: study → domain（テンプレート順）→ outcome_id（base = 空が先頭、以降昇順）
      for (const domain of toolSet.domains) {
        emitRow(makeRobDomainEntityKey(domain.id), '', domain.label, domain.id);
        for (const override of overridesByDomain.get(domain.id) ?? []) {
          emitRow(override.entityKey, override.outcomeId, domain.label, domain.id);
        }
      }
    }
  }

  return { csv: buildCsv(ROB_HEADER, rows), rowCount: rows.length, issues };
}
