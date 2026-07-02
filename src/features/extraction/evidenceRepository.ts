// Evidence タブ I/O（requirements.md §3.1: 追記のみ・上書き禁止）。
// executeRun の appendEvidence 依存として注入され、バッチ単位でまとめて追記する。
// 読み出しは S8 検証画面（#/verify）が「抽出済み文献の一覧 + 表示する根拠」の素材にする
import type { AnchorStatus } from '../../domain/anchor';
import type { Confidence, Evidence } from '../../domain/evidence';
import { SHEET_HEADERS } from '../../domain/sheetsSchema';
import { appendRows, getSheetValues } from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';

const EVIDENCE_TAB = 'Evidence';

const CONFIDENCES: readonly Confidence[] = ['high', 'medium', 'low'];
const ANCHOR_STATUSES: readonly AnchorStatus[] = ['exact', 'normalized', 'fuzzy', 'failed'];

/** Evidence → シート行。列順は SHEET_HEADERS.Evidence（domain/sheetsSchema.ts）に対応 */
export function evidenceToRow(evidence: Evidence): (string | number | boolean | null)[] {
  return [
    evidence.evidenceId,
    evidence.runId,
    evidence.documentId,
    evidence.fieldId,
    evidence.entityKey,
    evidence.value,
    evidence.notReported,
    evidence.quote,
    evidence.page,
    evidence.confidence,
    evidence.anchorStatus,
  ];
}

/**
 * Evidence をまとめて追記する（1 バッチ = 1 API 呼び出し）。空配列は no-op。
 * 追記のみで更新 API は提供しない（追記型タブ。変更が必要な場合は新しい run を作る）
 */
export async function appendEvidenceRows(
  spreadsheetId: string,
  evidence: readonly Evidence[],
  deps: GoogleApiDeps,
): Promise<void> {
  await appendRows(spreadsheetId, EVIDENCE_TAB, evidence.map(evidenceToRow), deps);
}

/** Sheets の values はラグ配列（末尾の空セルが落ちる）。欠けたセルは空文字として読む */
function cellAt(row: readonly string[], index: number): string {
  return row[index] ?? '';
}

function emptyToNull(value: string): string | null {
  return value === '' ? null : value;
}

/** appendRows が boolean を書くと Sheets 上は TRUE になるため、大文字小文字を無視して読む */
function parseBool(value: string): boolean {
  return /^true$/i.test(value);
}

function parseConfidence(value: string, context: string): Confidence | null {
  if (value === '') {
    return null;
  }
  if ((CONFIDENCES as readonly string[]).includes(value)) {
    return value as Confidence;
  }
  throw new Error(`${context}: confidence "${value}" が不正です`);
}

function parseAnchorStatus(value: string, context: string): AnchorStatus | null {
  if (value === '') {
    return null;
  }
  if ((ANCHOR_STATUSES as readonly string[]).includes(value)) {
    return value as AnchorStatus;
  }
  throw new Error(`${context}: anchor_status "${value}" が不正です`);
}

function parsePage(value: string, context: string): number | null {
  if (value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${context}: page "${value}" が正の整数ではありません`);
  }
  return parsed;
}

/**
 * Evidence タブの全行を読み込む（S8 検証画面の素材）。
 * シート行順のまま返す（= 追記順。同一 document 内で後ろの行ほど新しい run）
 */
export async function readEvidenceRows(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<Evidence[]> {
  const values = await getSheetValues(spreadsheetId, EVIDENCE_TAB, deps);
  const header = values[0];
  if (header === undefined) {
    throw new Error('Evidence タブにヘッダ行がありません（プロジェクト初期化が不完全です）');
  }
  SHEET_HEADERS.Evidence.forEach((name, i) => {
    if (cellAt(header, i) !== name) {
      throw new Error(
        `Evidence のヘッダ ${i + 1} 列目が "${name}" ではありません（実際: "${cellAt(header, i)}"）`,
      );
    }
  });
  return values.slice(1).map((raw, i) => {
    const context = `Evidence ${i + 2} 行目`;
    return {
      evidenceId: cellAt(raw, 0),
      runId: cellAt(raw, 1),
      documentId: cellAt(raw, 2),
      fieldId: cellAt(raw, 3),
      entityKey: cellAt(raw, 4),
      value: emptyToNull(cellAt(raw, 5)),
      notReported: parseBool(cellAt(raw, 6)),
      quote: emptyToNull(cellAt(raw, 7)),
      page: parsePage(cellAt(raw, 8), context),
      confidence: parseConfidence(cellAt(raw, 9), context),
      anchorStatus: parseAnchorStatus(cellAt(raw, 10), context),
    };
  });
}
