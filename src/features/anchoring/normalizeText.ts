// quote アンカリングの共通正規化（requirements.md §5-1）。
// quote とページテキストの双方に同じ正規化を適用してから照合する。
// 実装は experiments/anchor-spike の normalizeBase を移植（スパイクで anchor 成功率 96.2% を実証。
// 英文向けのダッシュ / 引用符の折り畳みを加えた拡張版は効果ゼロだったため採用しない）。
// 和文対応（issue #95 層 1）として次の 2 点を追加：
// - 波ダッシュ U+301C の '~' への折り畳み（NFKC は全角チルダ U+FF5E を '~' へ畳む一方
//   U+301C を変えないため、JIS 由来のテキスト層と CP932 由来の LLM 出力で不一致になる）
// - 和文文字に隣接する空白の除去（和文は行折り返しが空白を意味しないが、テキスト層は
//   hasEOL 由来の改行を含むため、圧縮後の空白が quote との exact / normalized 一致を壊す）
//
// ハイライト表示のため、正規化後の各文字が元テキストのどの範囲に由来するかの写像も
// 同時に構築する（normalizeTextWithMap）。normalizeText はその text だけを返す薄い
// ラッパで、両者の正規化結果は構造上一致する
import type { CharRange } from '../../domain/anchor';

export interface NormalizedTextMap {
  /** 正規化後テキスト（normalizeText と同一） */
  text: string;
  /** 正規化後 index → 元テキストの開始オフセット */
  rawStart: number[];
  /** 正規化後 index → 元テキストの終了オフセット（排他的） */
  rawEnd: number[];
}

/**
 * チャンクを継続する後続文字: 結合記号（\p{M}）に加え、半角の濁点 / 半濁点
 * （U+FF9E / U+FF9F。カテゴリ Lm で \p{M} に含まれない）も基底文字と同じチャンクで
 * NFKC へ渡す。分けると「ﾃﾞ → テ + 結合濁点」の未合成列になり、LLM 出力の合成済み
 * 「デ」と一致しなくなる（issue #95 層 1）
 */
const CHUNK_CONTINUATION_RE = /[\p{M}ﾞﾟ]/u;
const HYPHENATION_RE = /([A-Za-z])-\s*\n\s*([a-z])/g;
/** 波ダッシュ（U+301C）。NFKC 後に '~'（U+FF5E は NFKC が畳む）へ揃える */
const WAVE_DASH_RE = /〜/g;
/**
 * 和文文字（漢字・ひらがな・カタカナ・CJK 記号 / 句読点 U+3001-303F）。中黒 U+30FB と
 * 長音符 U+30FC は Script=Common のため明示する。NFKC 適用後の文字に対して判定する
 * （全角英数・全角スペース・半角カナは NFKC で畳まれた後なので範囲に含めない）
 */
const CJK_CHAR_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}、-〿・ー]/u;

function codePointLength(codePoint: number): number {
  return codePoint > 0xffff ? 2 : 1;
}

type KeptChar = { char: string; start: number; end: number };

/**
 * 空白連続の直前の文字（kept[index]）が和文文字か。
 * サロゲートペアの後半なら前半と合成してコードポイント単位で判定する
 */
function isCjkBefore(kept: readonly KeptChar[], index: number): boolean {
  const last = (kept[index] as KeptChar).char;
  const lastCode = last.charCodeAt(0);
  if (lastCode >= 0xdc00 && lastCode <= 0xdfff && index > 0) {
    return CJK_CHAR_RE.test((kept[index - 1] as KeptChar).char + last);
  }
  return CJK_CHAR_RE.test(last);
}

/**
 * 空白連続の直後の文字（kept[index]）が和文文字か。
 * サロゲートペアの前半なら後半と合成してコードポイント単位で判定する
 */
function isCjkAfter(kept: readonly KeptChar[], index: number): boolean {
  const first = (kept[index] as KeptChar).char;
  const firstCode = first.charCodeAt(0);
  if (firstCode >= 0xd800 && firstCode <= 0xdbff && index + 1 < kept.length) {
    return CJK_CHAR_RE.test(first + (kept[index + 1] as KeptChar).char);
  }
  return CJK_CHAR_RE.test(first);
}

/**
 * NFKC がリガチャ（ﬁ→fi）と全角 / 半角の統一を吸収する。
 * NFKC は「基底文字 + 後続結合記号」のチャンク単位で適用し、チャンク内で文字数が
 * 変わっても（ﬁ→fi 等）由来はチャンク全体の範囲として記録する
 */
export function normalizeTextWithMap(input: string): NormalizedTextMap {
  // 1) チャンク単位の NFKC + 波ダッシュの折り畳み（1 文字 → 1 文字なので写像は不変）
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  while (i < input.length) {
    let j = i + codePointLength(input.codePointAt(i) as number);
    while (j < input.length) {
      const codePoint = input.codePointAt(j) as number;
      if (!CHUNK_CONTINUATION_RE.test(String.fromCodePoint(codePoint))) {
        break;
      }
      j += codePointLength(codePoint);
    }
    const normalized = input.slice(i, j).normalize('NFKC').replace(WAVE_DASH_RE, '~');
    for (let k = 0; k < normalized.length; k++) {
      chars.push(normalized.charAt(k));
      starts.push(i);
      ends.push(j);
    }
    i = j;
  }

  // 2) 行末ハイフネーション結合: exam-\nple → example（英字に挟まれた行末ハイフンのみ。
  //    マッチ中央の「- 改行 空白」だけを取り除き、前後の英字は残す）
  const joined = chars.join('');
  const dropped = new Set<number>();
  let match: RegExpExecArray | null;
  while ((match = HYPHENATION_RE.exec(joined)) !== null) {
    const matchText = match[0] as string;
    for (let k = match.index + 1; k < match.index + matchText.length - 1; k++) {
      dropped.add(k);
    }
  }
  const kept: KeptChar[] = [];
  for (let k = 0; k < chars.length; k++) {
    if (!dropped.has(k)) {
      kept.push({ char: chars[k] as string, start: starts[k] as number, end: ends[k] as number });
    }
  }

  // 3) 空白圧縮（改行含む）+ 前後 trim。空白の連続は 1 個の半角スペースへ潰し、
  //    由来は連続全体の範囲とする。ただし前後どちらかが和文文字なら行折り返し由来の
  //    ノイズとみなして空白ごと落とす（和文は語間空白を持たないため。issue #95 層 1）
  const outChars: string[] = [];
  const rawStart: number[] = [];
  const rawEnd: number[] = [];
  let k = 0;
  while (k < kept.length) {
    const entry = kept[k] as KeptChar;
    if (/\s/.test(entry.char)) {
      const runStart = k;
      while (k < kept.length && /\s/.test((kept[k] as { char: string }).char)) {
        k++;
      }
      if (outChars.length === 0 || k >= kept.length) {
        continue; // 先頭・末尾の空白は trim
      }
      if (isCjkBefore(kept, runStart - 1) || isCjkAfter(kept, k)) {
        continue; // 和文文字に隣接する空白は改行由来として除去
      }
      outChars.push(' ');
      rawStart.push((kept[runStart] as { start: number }).start);
      rawEnd.push((kept[k - 1] as { end: number }).end);
    } else {
      outChars.push(entry.char);
      rawStart.push(entry.start);
      rawEnd.push(entry.end);
      k++;
    }
  }
  return { text: outChars.join(''), rawStart, rawEnd };
}

export function normalizeText(input: string): string {
  return normalizeTextWithMap(input).text;
}

/** 正規化テキスト上の範囲 [start, end) を元テキストの範囲へ写像する。範囲不正は null */
export function toRawRange(map: NormalizedTextMap, range: CharRange): CharRange | null {
  if (range.start < 0 || range.end > map.rawStart.length || range.start >= range.end) {
    return null;
  }
  return {
    start: map.rawStart[range.start] as number,
    end: map.rawEnd[range.end - 1] as number,
  };
}
