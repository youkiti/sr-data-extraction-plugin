// プロトコル保存パイプライン（S4）: パース済み本文を
// 「（md / docx のみ）raw_protocols/ へテキスト退避 → Protocol タブへ新 version を追記」まで進める。
// sr-query-builder と異なり本拡張には extract-protocol skill がないため LLM は呼ばず、
// framework_type / research_question 等の列は空のまま追記する（S5 の draft-schema が
// raw text を直接読む。requirements.md §3.2 のタブ流用方針）
import type { Protocol } from '../../domain/protocol';
import { uploadTextFile } from '../../lib/google/drive';
import type { GoogleApiDeps } from '../../lib/google/types';
import { nowIso8601 } from '../../utils/iso8601';
import { appendProtocol, getNextProtocolVersion } from './protocolRepository';
import type { ParsedProtocolFile } from './types';

export interface SaveProtocolParams {
  spreadsheetId: string;
  /** プロジェクトの raw_protocols/ フォルダ ID */
  rawProtocolsFolderId: string;
  parsed: ParsedProtocolFile;
  /** Protocol.created_by（ログイン中ユーザーの email） */
  createdBy: string;
}

export interface SaveProtocolDeps {
  google: GoogleApiDeps;
  now?: () => string;
}

/**
 * プロトコルを新しい version として保存し、追記した行の内容を返す。
 * 手入力は `raw_text_inline` に全文を保持し、md / docx は抽出テキストを
 * `raw_protocols/protocol_v{version}.txt` へ退避して `raw_text_ref` に Drive URL を残す
 * （sr-query-builder 準拠。requirements.md §3.4）。
 */
export async function saveProtocol(
  params: SaveProtocolParams,
  deps: SaveProtocolDeps,
): Promise<Protocol> {
  const now = deps.now ?? nowIso8601;
  const version = await getNextProtocolVersion(params.spreadsheetId, deps.google);

  let rawTextRef: string | null = null;
  let rawTextInline: string | null = null;
  if (params.parsed.sourceType === 'manual') {
    rawTextInline = params.parsed.plainText;
  } else {
    const uploaded = await uploadTextFile(
      {
        name: `protocol_v${version}.txt`,
        content: params.parsed.plainText,
        parentId: params.rawProtocolsFolderId,
      },
      deps.google,
    );
    rawTextRef = uploaded.webViewLink;
  }

  const protocol: Protocol = {
    version,
    // LLM 抽出は行わないため構造化列は空（タブ互換のため列だけ維持。domain/protocol.ts）
    frameworkType: null,
    researchQuestion: '',
    inclusionCriteria: null,
    exclusionCriteria: null,
    studyDesign: null,
    blockCount: 0,
    combinationExpression: '',
    sourceType: params.parsed.sourceType,
    sourceFilename: params.parsed.sourceFilename === '' ? null : params.parsed.sourceFilename,
    rawTextRef,
    rawTextPreview: params.parsed.preview === '' ? null : params.parsed.preview,
    rawTextInline,
    createdAt: now(),
    createdBy: params.createdBy,
  };
  await appendProtocol(params.spreadsheetId, protocol, deps.google);
  return protocol;
}
