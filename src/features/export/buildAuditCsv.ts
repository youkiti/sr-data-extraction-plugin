// audit.csv（requirements.md §4.4 v0.6）: 判定中心デノーマライズ型。
// 1 行 = 1 判定イベント（undo 含む）に「その判定が見ていた Evidence」を横持ちで添付し、
// 判定が 0 件のセルは代表 Evidence（最新 run）+ 判定列空のプレースホルダ行で未検証を明示する
import type { Decision } from '../../domain/decision';
import type { DocumentRecord } from '../../domain/document';
import type { Evidence } from '../../domain/evidence';
import type { ExtractionRun } from '../../domain/extractionRun';
import type { SchemaField } from '../../domain/schemaField';
import { buildCsv } from './csvEncode';

export const AUDIT_HEADER = [
  'study_label',
  'document_id',
  'entity_key',
  'field_id',
  'field_name',
  'schema_version',
  'annotator',
  'annotator_type',
  'run_id',
  'evidence_id',
  'ai_value',
  'ai_not_reported',
  'quote',
  'page',
  'confidence',
  'anchor_status',
  'decision_seq',
  'action',
  'decision_value',
  'decided_by',
  'decided_at',
  'note',
] as const;

/**
 * 構造的欠損トークン（結合規則 5）。結合の結果レコード自体が存在しない列ブロックに入れる。
 * レコードはあるがセルが空（value / quote が null 等）は空文字のままとし、両者を区別する
 */
export const AUDIT_MISSING_TOKEN = '.';

/** Evidence 列 8 個。添付 Evidence がない判定行（結合規則 2）は全て構造的欠損 */
const MISSING_EVIDENCE_COLUMNS = Array.from({ length: 8 }, () => AUDIT_MISSING_TOKEN);

/** 複合キーの区切り。NUL は値（entity_key・annotator 等）に現れない */
const SEP = String.fromCharCode(0);

export interface AuditCsvResult {
  csv: string;
  /** 判定 0 件セルのプレースホルダ行数。エクスポート警告の未検証件数と突合する（§4.4） */
  undecidedCellCount: number;
  /** field_id が SchemaFields に見つからず出力から除外した行数（判定行 + プレースホルダ行） */
  droppedRowCount: number;
}

/** ソートと行内容をまとめた中間表現。sortKey は document 内で一意（結合規則 4 の並び順を単一文字列比較に落とす） */
interface AuditItem {
  sortKey: string;
  row: string[];
}

/** 数値を辞書順比較できる固定幅へ（field_index / decision_seq 用） */
const pad = (n: number): string => String(n).padStart(6, '0');

export function buildAuditCsv(
  documents: readonly DocumentRecord[],
  decisions: readonly Decision[],
  evidences: readonly Evidence[],
  runs: readonly ExtractionRun[],
  fields: readonly SchemaField[],
): AuditCsvResult {
  const fieldById = new Map(fields.map((field) => [field.fieldId, field]));
  const runById = new Map(runs.map((run) => [run.runId, run]));
  // run の新旧比較キー。run 不明 / started_at 未記録は最古扱い（'' は ISO8601 より常に小さい）
  const startedAtOf = (runId: string): string => runById.get(runId)?.startedAt ?? '';
  const latestEvidence = (candidates: readonly Evidence[]): Evidence | null => {
    let best: Evidence | null = null;
    for (const candidate of candidates) {
      if (best === null || startedAtOf(candidate.runId) > startedAtOf(best.runId)) {
        best = candidate;
      }
    }
    return best;
  };
  const evidenceColumns = (evidence: Evidence): string[] => [
    evidence.runId,
    evidence.evidenceId,
    evidence.value ?? '',
    String(evidence.notReported),
    evidence.quote ?? '',
    evidence.page === null ? '' : String(evidence.page),
    evidence.confidence ?? '',
    evidence.anchorStatus ?? '',
  ];
  const cellKey = (fieldId: string, entityKey: string): string => `${fieldId}${SEP}${entityKey}`;

  const csvRows: string[][] = [];
  let undecidedCellCount = 0;
  let droppedRowCount = 0;

  for (const doc of documents) {
    const evidenceByCell = new Map<string, Evidence[]>();
    for (const evidence of evidences) {
      if (evidence.documentId !== doc.documentId) {
        continue;
      }
      const key = cellKey(evidence.fieldId, evidence.entityKey);
      const cell = evidenceByCell.get(key);
      if (cell === undefined) {
        evidenceByCell.set(key, [evidence]);
      } else {
        cell.push(evidence);
      }
    }

    // 判定行: セル × annotator ごとに decided_at 昇順で decision_seq を振る（undo も 1 行 = 1 番）
    const decidedCells = new Set<string>();
    const byCellAnnotator = new Map<string, Decision[]>();
    for (const decision of decisions) {
      if (decision.documentId !== doc.documentId) {
        continue;
      }
      const cell = cellKey(decision.fieldId, decision.entityKey);
      decidedCells.add(cell);
      const key = `${cell}${SEP}${decision.annotator}${SEP}${decision.annotatorType}`;
      const group = byCellAnnotator.get(key);
      if (group === undefined) {
        byCellAnnotator.set(key, [decision]);
      } else {
        group.push(decision);
      }
    }

    const items: AuditItem[] = [];
    for (const group of byCellAnnotator.values()) {
      // Array.prototype.sort は stable なので、decided_at 同時刻はシート追記順を保つ
      group.sort((a, b) => (a.decidedAt === b.decidedAt ? 0 : a.decidedAt < b.decidedAt ? -1 : 1));
      group.forEach((decision, index) => {
        const field = fieldById.get(decision.fieldId);
        if (field === undefined) {
          droppedRowCount++;
          return;
        }
        // 結合規則 1: decision.schema_version と一致する run の Evidence のうち最新を添える
        const candidates = (
          evidenceByCell.get(cellKey(decision.fieldId, decision.entityKey)) ?? []
        ).filter((evidence) => runById.get(evidence.runId)?.schemaVersion === decision.schemaVersion);
        const attached = latestEvidence(candidates);
        const seq = index + 1;
        items.push({
          // entity_key → field_index → annotator（annotator_type・seq で一意化）
          sortKey: `${decision.entityKey}${SEP}${pad(field.fieldIndex)}${SEP}${decision.annotator}${SEP}${decision.annotatorType}${SEP}${pad(seq)}`,
          row: [
            doc.studyLabel,
            doc.documentId,
            decision.entityKey,
            decision.fieldId,
            field.fieldName,
            String(decision.schemaVersion),
            decision.annotator,
            decision.annotatorType,
            ...(attached === null ? MISSING_EVIDENCE_COLUMNS : evidenceColumns(attached)),
            String(seq),
            decision.action,
            decision.value ?? '',
            decision.decidedBy,
            decision.decidedAt,
            decision.note ?? '',
          ],
        });
      });
    }

    // プレースホルダ行（結合規則 3）: 判定 0 件のセルは最新 run の代表 Evidence を 1 行出す
    for (const [key, cellEvidences] of evidenceByCell) {
      if (decidedCells.has(key)) {
        continue;
      }
      const representative = latestEvidence(cellEvidences) as Evidence; // セルは 1 件以上で構築される
      const field = fieldById.get(representative.fieldId);
      if (field === undefined) {
        droppedRowCount++;
        continue;
      }
      const run = runById.get(representative.runId);
      undecidedCellCount++;
      items.push({
        // プレースホルダ（sortKey の annotator 部は空）は同一セルの判定行より前に並ぶ（判定行とはセルが重ならないため実害なし）
        sortKey: `${representative.entityKey}${SEP}${pad(field.fieldIndex)}${SEP}${SEP}${SEP}${pad(0)}`,
        row: [
          doc.studyLabel,
          doc.documentId,
          representative.entityKey,
          representative.fieldId,
          field.fieldName,
          run === undefined ? AUDIT_MISSING_TOKEN : String(run.schemaVersion),
          AUDIT_MISSING_TOKEN,
          AUDIT_MISSING_TOKEN,
          ...evidenceColumns(representative),
          AUDIT_MISSING_TOKEN,
          AUDIT_MISSING_TOKEN,
          AUDIT_MISSING_TOKEN,
          AUDIT_MISSING_TOKEN,
          AUDIT_MISSING_TOKEN,
          AUDIT_MISSING_TOKEN,
        ],
      });
    }

    // 結合規則 4: entity_key → field_index → annotator → decision_seq の順（document は取り込み順のまま）
    // sortKey は document 内で一意なので等値分岐は不要
    items.sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
    for (const item of items) {
      csvRows.push(item.row);
    }
  }
  return { csv: buildCsv(AUDIT_HEADER, csvRows), undecidedCellCount, droppedRowCount };
}
