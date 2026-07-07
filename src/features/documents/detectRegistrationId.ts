// 抽出テキストからの試験登録番号の検出（requirements.md §4.5 v0.10）。
// 取り込み時に Studies.registration_id の初期値へ入れる純粋関数。統合候補バナー（§4.5）は
// 同一 registration_id のアクティブ study が複数あるときに出る。
// 方針: 過検出より取りこぼしが安全（誤検出は人間が弾けないため）。複数ヒット時は
// 最頻出 → 先頭出現の順で 1 件を選ぶ。1 件も無ければ null

/** 1 レジストリの検出パターン。regex はグローバル・大文字小文字無視で、capture[1] を正規化する */
interface RegistryPattern {
  regex: RegExp;
  /** マッチ本体（capture[1]）→ 正規化された登録番号（プレフィックスの表記を揃える） */
  canonical: (body: string) => string;
}

/**
 * 対応レジストリ（§4.5）: NCT / ISRCTN / UMIN / jRCT / JPRN / ChiCTR / EudraCT / ACTRN。
 * \d+ 系は語境界（\b）で挟んで部分一致を避ける。EudraCT は数値だけだと誤検出しやすいため
 * ラベル「EudraCT」を必須にする（過検出より取りこぼし優先）
 */
const REGISTRIES: readonly RegistryPattern[] = [
  { regex: /\b(NCT\d{8})\b/gi, canonical: (m) => m.toUpperCase() },
  { regex: /\b(ISRCTN\d{4,})\b/gi, canonical: (m) => m.toUpperCase() },
  { regex: /\b(UMIN\d{9})\b/gi, canonical: (m) => m.toUpperCase() },
  { regex: /\b(jRCT[a-z]?\d{7,})\b/gi, canonical: (m) => `jRCT${m.slice(4)}` },
  { regex: /\b(JPRN-\w+)\b/gi, canonical: (m) => `JPRN-${m.slice(5)}` },
  { regex: /\b(ChiCTR\d+)\b/gi, canonical: (m) => `ChiCTR${m.slice(6)}` },
  { regex: /\bEudraCT[\s:]*(\d{4}-\d{6}-\d{2})\b/gi, canonical: (m) => `EudraCT${m}` },
  { regex: /\b(ACTRN\d{14})\b/gi, canonical: (m) => m.toUpperCase() },
];

interface Hit {
  id: string;
  index: number;
}

/**
 * テキストから試験登録番号を 1 件検出する。
 * 検出候補は「出現回数が最も多いもの → 先頭出現位置が最も早いもの」の順で選ぶ。
 * 1 件も無ければ null（過検出より取りこぼし優先）
 */
export function detectRegistrationId(text: string): string | null {
  const hits: Hit[] = [];
  for (const registry of REGISTRIES) {
    for (const match of text.matchAll(registry.regex)) {
      // 各 registry の regex は capture group 1 を必ず含むため、マッチ成立時は body は非 null。
      // matchAll のマッチは index を必ず持つ
      const body = match[1] as string;
      hits.push({ id: registry.canonical(body), index: match.index as number });
    }
  }
  if (hits.length === 0) {
    return null;
  }
  // id ごとに 出現回数 と 先頭出現位置 を集計
  const stats = new Map<string, { count: number; firstIndex: number }>();
  for (const hit of hits) {
    const stat = stats.get(hit.id);
    if (stat === undefined) {
      stats.set(hit.id, { count: 1, firstIndex: hit.index });
    } else {
      stat.count += 1;
      stat.firstIndex = Math.min(stat.firstIndex, hit.index);
    }
  }
  let best: { id: string; count: number; firstIndex: number } | null = null;
  for (const [id, stat] of stats) {
    if (
      best === null ||
      stat.count > best.count ||
      (stat.count === best.count && stat.firstIndex < best.firstIndex)
    ) {
      best = { id, count: stat.count, firstIndex: stat.firstIndex };
    }
  }
  // best は hits が 1 件以上あるため必ず非 null
  return (best as { id: string }).id;
}
