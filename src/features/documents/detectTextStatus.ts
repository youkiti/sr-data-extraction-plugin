// テキスト層の抽出状態判定（requirements.md §3.2 Documents.text_status / ※Q7）。
// ok = 全ページに実質テキストあり / partial = 一部ページのみ / no_text_layer = 全ページなし
// （スキャン PDF は text_only モードで抽出不可・アンカリング / ハイライト不可）
import type { TextStatus } from '../../domain/document';

/**
 * 「実質テキストあり」とみなすページの最小文字数（空白除去後）。
 * スキャン PDF でもページ番号や透かしだけがテキスト層に載ることがあるため、
 * 完全な 0 文字ではなく短い閾値で判定する
 */
export const MIN_SUBSTANTIVE_PAGE_CHARS = 30;

export interface TextStatusResult {
  textStatus: TextStatus;
  /** Documents.page_count */
  pageCount: number;
  /** Documents.char_count（全ページの生テキスト長合計。planRun のトークン概算の素材） */
  charCount: number;
}

export function detectTextStatus(pages: readonly { text: string }[]): TextStatusResult {
  const pageCount = pages.length;
  const charCount = pages.reduce((sum, page) => sum + page.text.length, 0);
  const substantivePages = pages.filter(
    (page) => page.text.replace(/\s+/g, '').length >= MIN_SUBSTANTIVE_PAGE_CHARS,
  ).length;

  let textStatus: TextStatus;
  if (substantivePages === 0) {
    textStatus = 'no_text_layer';
  } else if (substantivePages < pageCount) {
    textStatus = 'partial';
  } else {
    textStatus = 'ok';
  }
  return { textStatus, pageCount, charCount };
}
