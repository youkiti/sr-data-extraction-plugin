// Evidence タブ I/O（requirements.md §3.1: 追記のみ・上書き禁止）。
// executeRun の appendEvidence 依存として注入され、バッチ単位でまとめて追記する。
// 読み出しは S8 検証画面（#/verify）が「抽出済み文献の一覧 + 表示する根拠」の素材にする。
//
// bbox 列（bbox_page/bbox_ymin/bbox_xmin/bbox_ymax/bbox_xmax。§7.4 PR3）・relocated_from 列
// （relocate-quote skill。issue #94）は既存プロジェクトに存在しないことがあるため、
// 読み書きの両方で後方互換を取る:
// - 読み出し（readEvidenceRows）: 先頭 12 列（旧ヘッダ）は厳格一致、13 列目以降は
//   「存在すれば」名前一致を要求し「欠けていれば」旧プロジェクトとして許容する
// - 書き込み（ensureEvidenceBboxColumns / ensureEvidenceRelocatedFromColumn）: ヘッダが
//   未拡張のプロジェクトへは実行前にヘッダ行をフルヘッダへ拡張する
//   （呼び出しは extractionService.ts / relocateQuoteService.ts の責務）
import type { AnchorStatus } from '../../domain/anchor';
import type { Confidence, Evidence, EvidenceBbox } from '../../domain/evidence';
import { SHEET_HEADERS } from '../../domain/sheetsSchema';
import { appendRows, getBatchValues, getSheetValues, updateRow } from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';

const EVIDENCE_TAB = 'Evidence';

/** 旧ヘッダ（bbox 列導入前）の列数。以降が bbox 5 列 */
const LEGACY_COLUMN_COUNT = 12;

/** bbox 5 列込みのヘッダ列数（relocated_from 列導入前）。以降が relocated_from 1 列 */
const BBOX_COLUMN_COUNT = LEGACY_COLUMN_COUNT + 5;

const CONFIDENCES: readonly Confidence[] = ['high', 'medium', 'low'];
const ANCHOR_STATUSES: readonly AnchorStatus[] = ['exact', 'normalized', 'fuzzy', 'failed'];

/** Evidence → シート行。列順は SHEET_HEADERS.Evidence（domain/sheetsSchema.ts）に対応 */
export function evidenceToRow(evidence: Evidence): (string | number | boolean | null)[] {
  return [
    evidence.evidenceId,
    evidence.runId,
    evidence.studyId,
    evidence.fieldId,
    evidence.documentId,
    evidence.entityKey,
    evidence.value,
    evidence.notReported,
    evidence.quote,
    evidence.page,
    evidence.confidence,
    evidence.anchorStatus,
    evidence.bboxPage,
    evidence.bbox?.ymin ?? null,
    evidence.bbox?.xmin ?? null,
    evidence.bbox?.ymax ?? null,
    evidence.bbox?.xmax ?? null,
    evidence.relocatedFrom,
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

/**
 * Evidence タブのヘッダ行を bbox 5 列込みの 17 列へ拡張する（既存プロジェクトの後方互換移行）。
 * - 先頭 12 列（旧ヘッダ）が SHEET_HEADERS.Evidence と食い違う場合は throw
 *   （想定外のタブ・壊れたプロジェクトへの書き込み事故を防ぐ）
 * - 既に 13 列以上（= 拡張済み）なら no-op
 * - それ以外（旧 12 列のまま）はヘッダ行を SHEET_HEADERS.Evidence のフル 17 列で上書きする
 *
 * runExtraction が running 行の追記より前に毎回呼ぶ（extractionService.ts）。
 * ヘッダ行だけを読むため getBatchValues で `Evidence!1:1` のみ取得する（全行 GET は避ける）
 */
export async function ensureEvidenceBboxColumns(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<void> {
  const [headerRows] = await getBatchValues(spreadsheetId, [`${EVIDENCE_TAB}!1:1`], deps);
  const header = headerRows?.[0] ?? [];
  SHEET_HEADERS.Evidence.slice(0, LEGACY_COLUMN_COUNT).forEach((name, i) => {
    if (cellAt(header, i) !== name) {
      throw new Error(
        `Evidence のヘッダ ${i + 1} 列目が "${name}" ではありません（実際: "${cellAt(header, i)}"）。bbox 列の移行を中止します`,
      );
    }
  });
  if (header.length > LEGACY_COLUMN_COUNT) {
    // 既に拡張済み（17 列以上）。no-op
    return;
  }
  await updateRow(spreadsheetId, EVIDENCE_TAB, 1, [...SHEET_HEADERS.Evidence], deps);
}

/**
 * Evidence タブのヘッダ行を relocated_from 列込みの 18 列へ拡張する（既存プロジェクトの後方互換
 * 移行。relocate-quote skill。issue #94）。
 * - 先頭 12 列（旧ヘッダ）が SHEET_HEADERS.Evidence と食い違う場合は throw
 * - 13 列目以降（bbox 5 列。存在すれば）も名前一致を要求する（欠けていれば旧プロジェクトとして
 *   許容し、12 列のプロジェクトも 18 列へ一気に拡張できる）
 * - 既に 18 列（= 拡張済み）なら no-op
 *
 * relocateQuoteService が Evidence 追記より前に毎回呼ぶ。ヘッダ行だけを読む
 * （getBatchValues で `Evidence!1:1` のみ取得。全行 GET は避ける）
 */
export async function ensureEvidenceRelocatedFromColumn(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<void> {
  const [headerRows] = await getBatchValues(spreadsheetId, [`${EVIDENCE_TAB}!1:1`], deps);
  const header = headerRows?.[0] ?? [];
  SHEET_HEADERS.Evidence.slice(0, LEGACY_COLUMN_COUNT).forEach((name, i) => {
    if (cellAt(header, i) !== name) {
      throw new Error(
        `Evidence のヘッダ ${i + 1} 列目が "${name}" ではありません（実際: "${cellAt(header, i)}"）。relocated_from 列の移行を中止します`,
      );
    }
  });
  validateExtendedHeaderColumns(header, 'Evidence のヘッダ');
  if (header.length > BBOX_COLUMN_COUNT) {
    // 既に拡張済み（18 列）。no-op
    return;
  }
  await updateRow(spreadsheetId, EVIDENCE_TAB, 1, [...SHEET_HEADERS.Evidence], deps);
}

/** Sheets の values はラグ配列（末尾の空セルが落ちる）。欠けたセルは空文字として読む */
function cellAt(row: readonly string[], index: number): string {
  return row[index] ?? '';
}

/**
 * 拡張列（13 列目以降 = bbox 5 列 + relocated_from。§7.4 PR3 / issue #94）のうち、
 * 実際にヘッダへ存在する分だけを検証する（無ければ許容 = 旧プロジェクト、有れば名前一致を
 * 要求する）。呼び出し時点でヘッダが 12 / 17 / 18 列のいずれであっても安全に検証できる
 * （「header.length > LEGACY_COLUMN_COUNT ならフルヘッダ全列を検証する」という以前の実装は、
 * bbox 拡張済み・relocated_from 未拡張（17 列）のプロジェクトで存在しない 18 列目まで検証しようと
 * throw してしまう回帰があったため、存在する列数だけに限定するよう修正した）
 */
function validateExtendedHeaderColumns(header: readonly string[], context: string): void {
  const presentCount = Math.max(
    0,
    Math.min(header.length, SHEET_HEADERS.Evidence.length) - LEGACY_COLUMN_COUNT,
  );
  for (let i = 0; i < presentCount; i++) {
    const idx = LEGACY_COLUMN_COUNT + i;
    const name = SHEET_HEADERS.Evidence[idx] as string;
    if (cellAt(header, idx) !== name) {
      throw new Error(
        `${context} ${idx + 1} 列目が "${name}" ではありません（実際: "${cellAt(header, idx)}"）`,
      );
    }
  }
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

/** 正の整数（bbox_page 用）。page と同じ規則だが列名をエラーメッセージに出す */
function parsePositiveInt(value: string, columnName: string, context: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${context}: ${columnName} "${value}" が正の整数ではありません`);
  }
  return parsed;
}

/** 0–1000 の整数（bbox 座標 4 値用） */
function parseBboxCoordinate(value: string, columnName: string, context: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1000) {
    throw new Error(`${context}: ${columnName} "${value}" が 0-1000 の整数ではありません`);
  }
  return parsed;
}

/**
 * bbox 5 セル（bbox_page + 4 座標）を読む。
 * - 5 セルすべて空 → 両方 null（bbox なしの Evidence。旧ヘッダ行もこの分岐に落ちる）
 * - 5 セルすべて揃って妥当（整数・0–1000・ymin<=ymax・xmin<=xmax） → 値
 * - それ以外（部分的に埋まっている・不正値） → throw（page と同じ厳格度・同じエラー文体）
 */
function parseBboxCells(
  rawPage: string,
  rawYmin: string,
  rawXmin: string,
  rawYmax: string,
  rawXmax: string,
  context: string,
): { bboxPage: number | null; bbox: EvidenceBbox | null } {
  const cells = [rawPage, rawYmin, rawXmin, rawYmax, rawXmax];
  if (cells.every((cell) => cell === '')) {
    return { bboxPage: null, bbox: null };
  }
  if (cells.some((cell) => cell === '')) {
    throw new Error(
      `${context}: bbox 列（bbox_page/bbox_ymin/bbox_xmin/bbox_ymax/bbox_xmax）が一部だけ埋まっています（全列とも空か、全列とも値が必要です）`,
    );
  }
  const bboxPage = parsePositiveInt(rawPage, 'bbox_page', context);
  const ymin = parseBboxCoordinate(rawYmin, 'bbox_ymin', context);
  const xmin = parseBboxCoordinate(rawXmin, 'bbox_xmin', context);
  const ymax = parseBboxCoordinate(rawYmax, 'bbox_ymax', context);
  const xmax = parseBboxCoordinate(rawXmax, 'bbox_xmax', context);
  if (ymin > ymax || xmin > xmax) {
    throw new Error(`${context}: bbox の座標順序が不正です（ymin<=ymax かつ xmin<=xmax が必要です）`);
  }
  return { bboxPage, bbox: { ymin, xmin, ymax, xmax } };
}

/**
 * Evidence タブの全行を読み込む（S8 検証画面の素材）。
 * シート行順のまま返す（= 追記順。同一セル〔study_id × field_id × entity_key〕内で
 * 後ろの行ほど新しい run、または relocate-quote による再特定行。cells.ts が後勝ちで畳み込む）。
 *
 * ヘッダ検証: 先頭 12 列（旧ヘッダ）は厳格一致。13 列目以降（bbox 5 列 + relocated_from）は
 * 存在すれば名前一致を要求し、欠けていれば（= 旧プロジェクト）許容する
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
  SHEET_HEADERS.Evidence.slice(0, LEGACY_COLUMN_COUNT).forEach((name, i) => {
    if (cellAt(header, i) !== name) {
      throw new Error(
        `Evidence のヘッダ ${i + 1} 列目が "${name}" ではありません（実際: "${cellAt(header, i)}"）`,
      );
    }
  });
  validateExtendedHeaderColumns(header, 'Evidence のヘッダ');
  return values.slice(1).map((raw, i) => {
    const context = `Evidence ${i + 2} 行目`;
    const { bboxPage, bbox } = parseBboxCells(
      cellAt(raw, 12),
      cellAt(raw, 13),
      cellAt(raw, 14),
      cellAt(raw, 15),
      cellAt(raw, 16),
      context,
    );
    return {
      evidenceId: cellAt(raw, 0),
      runId: cellAt(raw, 1),
      studyId: cellAt(raw, 2),
      fieldId: cellAt(raw, 3),
      documentId: cellAt(raw, 4),
      entityKey: cellAt(raw, 5),
      value: emptyToNull(cellAt(raw, 6)),
      notReported: parseBool(cellAt(raw, 7)),
      quote: emptyToNull(cellAt(raw, 8)),
      page: parsePage(cellAt(raw, 9), context),
      confidence: parseConfidence(cellAt(raw, 10), context),
      anchorStatus: parseAnchorStatus(cellAt(raw, 11), context),
      relocatedFrom: emptyToNull(cellAt(raw, 17)),
      bboxPage,
      bbox,
    };
  });
}
