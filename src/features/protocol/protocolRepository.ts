// Protocol タブの読み書き。sr-query-builder の protocolRepository をコピー流用し、
// 本拡張で持たない ProtocolBlocks 関連を除いた（requirements.md §3.2）。
// 追記型・上書き禁止（同 §3.1）: 変更は常に新しい version の行として追記する
import type { FrameworkType, Protocol, ProtocolSourceType } from '../../domain/protocol';
import { SHEET_HEADERS } from '../../domain/sheetsSchema';
import { appendRow, getSheetValues } from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';

const PROTOCOL_HEADER = SHEET_HEADERS.Protocol;

/**
 * 既存 Protocol タブから次に書き込むべき version 番号（既存最大 + 1、無ければ 1）を返す。
 */
export async function getNextProtocolVersion(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<number> {
  const rows = await getSheetValues(spreadsheetId, 'Protocol', deps);
  if (rows.length <= 1) {
    return 1;
  }
  const versionIdx = PROTOCOL_HEADER.indexOf('version');
  let max = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const cell = rows[i]?.[versionIdx];
    const n = Number.parseInt(cell ?? '', 10);
    if (Number.isFinite(n) && n > max) {
      max = n;
    }
  }
  return max + 1;
}

/**
 * Protocol タブに 1 行追記する。列順は SHEET_HEADERS.Protocol に固定。
 */
export async function appendProtocol(
  spreadsheetId: string,
  protocol: Protocol,
  deps: GoogleApiDeps,
): Promise<void> {
  await appendRow(spreadsheetId, 'Protocol', toProtocolRow(protocol), deps);
}

/**
 * Protocol タブの全行を version 降順で返す。1 件も無ければ []。
 * プロトコル画面のバージョン切替 UI が使う。
 */
export async function listProtocols(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<Protocol[]> {
  const rows = await getSheetValues(spreadsheetId, 'Protocol', deps);
  if (rows.length <= 1) {
    return [];
  }
  return rows
    .slice(1)
    .map(fromProtocolRow)
    .sort((a, b) => b.version - a.version);
}

function toProtocolRow(protocol: Protocol): (string | number | boolean | null)[] {
  const map: Record<string, string | number | boolean | null> = {
    version: protocol.version,
    framework_type: protocol.frameworkType,
    research_question: protocol.researchQuestion,
    inclusion_criteria: protocol.inclusionCriteria,
    exclusion_criteria: protocol.exclusionCriteria,
    study_design: protocol.studyDesign,
    block_count: protocol.blockCount,
    combination_expression: protocol.combinationExpression,
    source_type: protocol.sourceType,
    source_filename: protocol.sourceFilename,
    raw_text_ref: protocol.rawTextRef,
    raw_text_preview: protocol.rawTextPreview,
    raw_text_inline: protocol.rawTextInline,
    created_at: protocol.createdAt,
    created_by: protocol.createdBy,
  };
  return PROTOCOL_HEADER.map((key) => map[key] ?? null);
}

function fromProtocolRow(row: readonly string[]): Protocol {
  const cell = (key: string): string => {
    const idx = PROTOCOL_HEADER.indexOf(key);
    /* istanbul ignore if -- 呼び出しは固定キーのみ */
    if (idx < 0) return '';
    return row[idx] ?? '';
  };
  const version = Number.parseInt(cell('version'), 10);
  const blockCount = Number.parseInt(cell('block_count'), 10);
  return {
    version: Number.isFinite(version) ? version : 0,
    frameworkType: parseFrameworkType(cell('framework_type')),
    researchQuestion: cell('research_question'),
    inclusionCriteria: emptyToNull(cell('inclusion_criteria')),
    exclusionCriteria: emptyToNull(cell('exclusion_criteria')),
    studyDesign: emptyToNull(cell('study_design')),
    blockCount: Number.isFinite(blockCount) ? blockCount : 0,
    combinationExpression: cell('combination_expression'),
    sourceType: parseSourceType(cell('source_type')),
    sourceFilename: emptyToNull(cell('source_filename')),
    rawTextRef: emptyToNull(cell('raw_text_ref')),
    rawTextPreview: emptyToNull(cell('raw_text_preview')),
    rawTextInline: emptyToNull(cell('raw_text_inline')),
    createdAt: cell('created_at'),
    createdBy: cell('created_by'),
  };
}

function emptyToNull(value: string): string | null {
  return value === '' ? null : value;
}

function parseFrameworkType(value: string): FrameworkType {
  return ['pico', 'peco', 'pcc', 'spider', 'custom'].includes(value)
    ? (value as FrameworkType)
    : null;
}

function parseSourceType(value: string): ProtocolSourceType {
  return value === 'markdown' || value === 'docx' ? value : 'manual';
}
