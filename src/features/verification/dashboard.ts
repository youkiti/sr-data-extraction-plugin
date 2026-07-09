// S9 ダッシュボードの集計（requirements.md §4.1 S9 / ui-states.md §3 `#/dashboard`）。
// document × section の検証進捗マトリクスと、anchor 失敗率・not_reported 率を組み立てる。
// 進捗はセルモデル（cells.ts）基準 = 検証画面の進捗チップと同じ数え方（自分の判定のみ）
import type { Decision } from '../../domain/decision';
import type { DocumentRecord } from '../../domain/document';
import type { Evidence } from '../../domain/evidence';
import type { ConfirmedArmStructure } from '../../domain/armStructure';
import type { SchemaField } from '../../domain/schemaField';
import { availableTabs, buildTabModel, type VerificationCell } from './cells';

/** 率の素材（分母 0 のときの「—」表示は view 側の責務） */
export interface RateCount {
  numerator: number;
  denominator: number;
}

/** マトリクス 1 セル = 1 document × 1 section の進捗 */
export interface DashboardSectionCell {
  section: string;
  decided: number;
  total: number;
  /** セルクリックのディープリンク先（セクション先頭セルの entity_key）。セル 0 件は null */
  entityKey: string | null;
}

/** マトリクス 1 行 = 1 document */
export interface DashboardRow {
  documentId: string;
  studyLabel: string;
  /** DashboardData.sections と同順。当該 document のスキーマにない section は null */
  cells: (DashboardSectionCell | null)[];
  progress: { decided: number; total: number };
  /** anchor 失敗率: 分子 = anchor_status = failed、分母 = anchor_status 非 null（アンカリング対象） */
  anchor: RateCount;
  /** not_reported 率: 分子 = not_reported = TRUE、分母 = Evidence 総数 */
  notReported: RateCount;
}

export interface DashboardData {
  /** マトリクスの列（section の和集合。タブ順 → field_index 順の登場順） */
  sections: string[];
  rows: DashboardRow[];
  totals: {
    progress: { decided: number; total: number };
    anchor: RateCount;
    notReported: RateCount;
  };
}

/** 1 document ぶんの集計素材（verifyService の検証対象と同じ束 + 自分の判定） */
export interface DashboardDocumentInput {
  document: DocumentRecord;
  /** 表示ラベル（Studies 由来。呼び出し側が document.studyId から解決する。v0.10） */
  studyLabel: string;
  fields: readonly SchemaField[];
  evidence: readonly Evidence[];
  /** 自分の annotator 行への判定のみ（cells.ts と同じ契約） */
  ownDecisions: readonly Decision[];
  /** 自分が確定した群構成。確定 arm 由来の空セルも分母へ含める */
  armStructure?: ConfirmedArmStructure | null;
}

/** 検証フォームと同じ順（タブ順 → グループ順）で全セルを連結する */
function orderedCells(input: DashboardDocumentInput): VerificationCell[] {
  return availableTabs(input.fields).flatMap(
    (tab) =>
      buildTabModel(tab, input.fields, input.evidence, input.ownDecisions, {
        armStructure: input.armStructure ?? null,
      }).cells,
  );
}

/** 当該 document のスキーマに登場する section（タブ順 → field_index 順の初出順） */
function documentSections(fields: readonly SchemaField[]): string[] {
  const sections: string[] = [];
  for (const tab of availableTabs(fields)) {
    const tabFields = fields
      .filter((field) => field.entityLevel === tab)
      .sort((a, b) => a.fieldIndex - b.fieldIndex);
    for (const field of tabFields) {
      if (!sections.includes(field.section)) {
        sections.push(field.section);
      }
    }
  }
  return sections;
}

function buildRow(input: DashboardDocumentInput, sections: readonly string[]): DashboardRow {
  const own = documentSections(input.fields);
  const bySection = new Map<string, DashboardSectionCell>(
    own.map((section) => [section, { section, decided: 0, total: 0, entityKey: null }]),
  );
  let decided = 0;
  let total = 0;
  for (const cell of orderedCells(input)) {
    // セルはスキーマ項目から作られるため、その section は必ず bySection に存在する
    const entry = bySection.get(cell.field.section) as DashboardSectionCell;
    entry.total += 1;
    entry.entityKey = entry.entityKey ?? cell.entityKey;
    total += 1;
    if (cell.state.status !== 'unverified') {
      entry.decided += 1;
      decided += 1;
    }
  }
  const anchored = input.evidence.filter((item) => item.anchorStatus !== null);
  return {
    documentId: input.document.documentId,
    studyLabel: input.studyLabel,
    cells: sections.map((section) => bySection.get(section) ?? null),
    progress: { decided, total },
    anchor: {
      numerator: anchored.filter((item) => item.anchorStatus === 'failed').length,
      denominator: anchored.length,
    },
    notReported: {
      numerator: input.evidence.filter((item) => item.notReported).length,
      denominator: input.evidence.length,
    },
  };
}

/**
 * ダッシュボードの表示データを組み立てる。
 * inputs は Evidence がある document のみ（verifyService の検証対象一覧と同じ母集団）
 */
export function buildDashboard(inputs: readonly DashboardDocumentInput[]): DashboardData {
  const sections: string[] = [];
  for (const input of inputs) {
    for (const section of documentSections(input.fields)) {
      if (!sections.includes(section)) {
        sections.push(section);
      }
    }
  }
  const rows = inputs.map((input) => buildRow(input, sections));
  const totals = {
    progress: {
      decided: rows.reduce((sum, row) => sum + row.progress.decided, 0),
      total: rows.reduce((sum, row) => sum + row.progress.total, 0),
    },
    anchor: {
      numerator: rows.reduce((sum, row) => sum + row.anchor.numerator, 0),
      denominator: rows.reduce((sum, row) => sum + row.anchor.denominator, 0),
    },
    notReported: {
      numerator: rows.reduce((sum, row) => sum + row.notReported.numerator, 0),
      denominator: rows.reduce((sum, row) => sum + row.notReported.denominator, 0),
    },
  };
  return { sections, rows, totals };
}
