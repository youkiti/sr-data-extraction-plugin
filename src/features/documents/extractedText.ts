// extracted_texts/{document_id}.txt の保存形式（ここが正典）。
// - ページ区切りは form feed（U+000C）。pdftotext と同じ慣行で、ページ番号は出現順に 1..N
// - ページ本文に form feed が紛れた場合は同じ幅の空白 1 文字へ置換して格納する
//   （文字オフセットを保存するため。アンカリング〔§5〕は正規化後に照合するので影響しない）
// - テキストが 1 文字もないページも空区画として保持し、ページ番号がずれないようにする
import type { ExtractDataPage } from '../extraction/skills/extractData';

/** ページ区切り文字（form feed） */
export const PAGE_SEPARATOR = '\f';

/**
 * ページ別テキスト → extracted_texts の本文。
 * pages は 1 始まりの連番であること（PDF 由来なら常に成立。崩れていたら呼び出しバグ）
 */
export function serializeExtractedText(pages: readonly ExtractDataPage[]): string {
  if (pages.length === 0) {
    throw new Error('serializeExtractedText にページが 1 件も渡されていません');
  }
  return pages
    .map((page, i) => {
      if (page.page !== i + 1) {
        throw new Error(
          `ページ番号が連番ではありません（${i + 1} 番目のページが page=${page.page}）`,
        );
      }
      return page.text.replaceAll(PAGE_SEPARATOR, ' ');
    })
    .join(PAGE_SEPARATOR);
}

/**
 * extracted_texts の本文 → ページ別テキスト。空文字列は「ページなし」として [] を返す
 * （呼び出し側の executeRun が 0 件を load_failed として扱う）
 */
export function parseExtractedText(content: string): ExtractDataPage[] {
  if (content === '') {
    return [];
  }
  return content.split(PAGE_SEPARATOR).map((text, i) => ({ page: i + 1, text }));
}
