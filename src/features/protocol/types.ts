// プロトコル入力（手入力 / md / docx）をパースした共通の結果型。
// sr-query-builder の features/protocol/types.ts をコピー流用（architecture.md §7-3）。
// 本拡張では plainText を LLM に渡すのは S5（draft-schema skill）の段階で、
// S4 は保存（Sheets の Protocol タブ + Drive の raw_protocols/）までを担う

export interface ParsedProtocolFile {
  sourceType: 'manual' | 'markdown' | 'docx';
  /** 手入力のときは空文字列 */
  sourceFilename: string;
  /** プロトコル本文の全文（S5 の draft-schema skill が読む） */
  plainText: string;
  /** Sheets の raw_text_preview 列に入れる先頭 500 文字 */
  preview: string;
}

/** Sheets の raw_text_preview 列に入れる文字数の上限 */
export const PREVIEW_MAX_LENGTH = 500;

/**
 * 長いテキストから Sheets 用のプレビュー（先頭 500 文字）を作る。
 * 改行は空白に畳んで 1 行にする。
 */
export function buildPreview(plainText: string): string {
  const collapsed = plainText.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= PREVIEW_MAX_LENGTH) {
    return collapsed;
  }
  return `${collapsed.slice(0, PREVIEW_MAX_LENGTH - 1)}…`;
}
