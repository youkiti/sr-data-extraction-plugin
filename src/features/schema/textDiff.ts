export interface TextDiffPart {
  kind: 'equal' | 'del' | 'ins';
  text: string;
}

/** 計算量の上限を超えたときは全文並記を呼び出し側へ委ねる。 */
export function diffText(before: string, after: string): TextDiffPart[] | null {
  const a = before.match(/\s+|[a-zA-Z0-9]+|[^\s]/gu) ?? [];
  const b = after.match(/\s+|[a-zA-Z0-9]+|[^\s]/gu) ?? [];
  if (a.length * b.length > 250_000) return null;
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const parts: TextDiffPart[] = [];
  // 同じ種類が続くトークンは 1 つの部分へまとめる（1 語ずつ別要素にすると読み上げが細切れになる）
  const push = (kind: TextDiffPart['kind'], text: string) => {
    const last = parts[parts.length - 1];
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push('equal', a[i++]!);
      j++;
    } else if (i < a.length && (j === b.length || table[i + 1]![j]! >= table[i]![j + 1]!)) {
      push('del', a[i++]!);
    } else {
      push('ins', b[j++]!);
    }
  }
  return parts;
}

export function removedInstructionSentences(before: string, after: string): string[] {
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  const next = normalize(after);
  return before
    // "." は後ろが空白か末尾のときだけ文末とみなす（小数点で割らない）。
    // 1 文字の語の直後の "."（"e.g." の 2 つ目・"i.e."）も文末にしない
    .split(/(?:[。!?！？;；\r\n]|(?<!(?:^|[\s.(])[A-Za-z])\.(?=\s|$))+/)
    .map(normalize)
    .filter((sentence) => sentence !== '' && !next.includes(sentence));
}
