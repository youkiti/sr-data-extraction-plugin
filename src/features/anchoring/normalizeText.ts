// quote アンカリングの共通正規化（requirements.md §5-1）。
// quote とページテキストの双方に同じ正規化を適用してから照合する。
// 実装は experiments/anchor-spike の normalizeBase を移植（スパイクで anchor 成功率 96.2% を実証。
// ダッシュ / 引用符の折り畳みを加えた拡張版は効果ゼロだったため採用しない）
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

const COMBINING_MARK_RE = /\p{M}/u;
const HYPHENATION_RE = /([A-Za-z])-\s*\n\s*([a-z])/g;

function codePointLength(codePoint: number): number {
  return codePoint > 0xffff ? 2 : 1;
}

/**
 * NFKC がリガチャ（ﬁ→fi）と全角 / 半角の統一を吸収する。
 * NFKC は「基底文字 + 後続結合記号」のチャンク単位で適用し、チャンク内で文字数が
 * 変わっても（ﬁ→fi 等）由来はチャンク全体の範囲として記録する
 */
export function normalizeTextWithMap(input: string): NormalizedTextMap {
  // 1) チャンク単位の NFKC
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  while (i < input.length) {
    let j = i + codePointLength(input.codePointAt(i) as number);
    while (j < input.length) {
      const codePoint = input.codePointAt(j) as number;
      if (!COMBINING_MARK_RE.test(String.fromCodePoint(codePoint))) {
        break;
      }
      j += codePointLength(codePoint);
    }
    const normalized = input.slice(i, j).normalize('NFKC');
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
  const kept: Array<{ char: string; start: number; end: number }> = [];
  for (let k = 0; k < chars.length; k++) {
    if (!dropped.has(k)) {
      kept.push({ char: chars[k] as string, start: starts[k] as number, end: ends[k] as number });
    }
  }

  // 3) 空白圧縮（改行含む）+ 前後 trim。空白の連続は 1 個の半角スペースへ潰し、
  //    由来は連続全体の範囲とする
  const outChars: string[] = [];
  const rawStart: number[] = [];
  const rawEnd: number[] = [];
  let k = 0;
  while (k < kept.length) {
    const entry = kept[k] as { char: string; start: number; end: number };
    if (/\s/.test(entry.char)) {
      const runStart = k;
      while (k < kept.length && /\s/.test((kept[k] as { char: string }).char)) {
        k++;
      }
      if (outChars.length === 0 || k >= kept.length) {
        continue; // 先頭・末尾の空白は trim
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
