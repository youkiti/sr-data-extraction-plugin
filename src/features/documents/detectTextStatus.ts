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

/**
 * 定型行（ヘッダ / フッタ / 複写スタンプ）検出を有効にする最小ページ数。
 * これ未満では「全ページに繰り返し」の判定が信頼できないため、生テキストのまま数える。
 */
export const BOILERPLATE_MIN_PAGES = 3;

/**
 * ある行を定型行とみなすページ出現割合。この割合以上のページに現れる同一行は、
 * 本文とはみなさず実質文字数の集計から除外する。
 * スキャン論文 PDF は全ページ上下に複写スタンプ
 * （例: "Reproduced with permission of the copyright owner..."）が
 * 本物のテキストとして載ることがあり、これが閾値 30 字を超えて no_text_layer を
 * ok に化けさせる。走りヘッダ / フッタも同様に除外され、本文のある PDF は影響を受けない。
 */
export const BOILERPLATE_PAGE_FRACTION = 0.5;

export interface TextStatusResult {
  textStatus: TextStatus;
  /** Documents.page_count */
  pageCount: number;
  /** Documents.char_count（全ページの生テキスト長合計。planRun のトークン概算の素材） */
  charCount: number;
}

/** 行の照合キー（前後空白除去 + 内部空白の畳み込み）。ページ間の微差を吸収する */
function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/g, ' ');
}

/**
 * 全ページの過半数（BOILERPLATE_PAGE_FRACTION 以上）に繰り返し現れる行を、
 * 定型行（複写スタンプ / 走りヘッダ・フッタ）として正規化キーの集合で返す。
 * ページ数が少ないうちは検出しない（空集合）。
 */
function boilerplateLines(pages: readonly { text: string }[]): Set<string> {
  if (pages.length < BOILERPLATE_MIN_PAGES) {
    return new Set();
  }
  const pagesWithLine = new Map<string, number>();
  for (const page of pages) {
    // 同一ページ内の重複は 1 ページとして数える（上下に同じスタンプがある場合など）
    const seen = new Set<string>();
    for (const raw of page.text.split('\n')) {
      const line = normalizeLine(raw);
      if (line === '' || seen.has(line)) {
        continue;
      }
      seen.add(line);
      pagesWithLine.set(line, (pagesWithLine.get(line) ?? 0) + 1);
    }
  }
  const threshold = Math.ceil(pages.length * BOILERPLATE_PAGE_FRACTION);
  const boilerplate = new Set<string>();
  for (const [line, count] of pagesWithLine) {
    if (count >= threshold) {
      boilerplate.add(line);
    }
  }
  return boilerplate;
}

/** 定型行を除いたページ本文の実質文字数（空白除去後） */
function substantiveCharCount(text: string, boilerplate: Set<string>): number {
  return text
    .split('\n')
    .filter((raw) => !boilerplate.has(normalizeLine(raw)))
    .join('')
    .replace(/\s+/g, '').length;
}

export function detectTextStatus(pages: readonly { text: string }[]): TextStatusResult {
  const pageCount = pages.length;
  const charCount = pages.reduce((sum, page) => sum + page.text.length, 0);
  // 全ページに繰り返す定型行（複写スタンプ等）を除いてから実質テキストの有無を数える
  const boilerplate = boilerplateLines(pages);
  const substantivePages = pages.filter(
    (page) => substantiveCharCount(page.text, boilerplate) >= MIN_SUBSTANTIVE_PAGE_CHARS,
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
