// Evidence の複数引用を同じセル・最新 run の束にまとめ、引用ごとのキーを扱う。
// requirements.md §3.2 Evidence の代表行と quoteSeq の規則に準拠する。
import type { Evidence } from '../../domain/evidence';
import { cellKeyOf } from './cellState';

export interface EvidenceBundle {
  evidence: Evidence;
  quotes: Evidence[];
}

/** 1 study のシート行順の根拠を、最新の代表行と同じ run の引用へ束ねる。 */
export function bundleEvidence(evidence: readonly Evidence[]): Map<string, EvidenceBundle> {
  const rows = new Map<string, Evidence[]>();
  for (const item of evidence) {
    const key = cellKeyOf(item.fieldId, item.entityKey);
    const cell = rows.get(key) ?? [];
    cell.push(item);
    rows.set(key, cell);
  }
  const bundles = new Map<string, EvidenceBundle>();
  for (const [key, cell] of rows) {
    const latest = cell[cell.length - 1] as Evidence;
    const bySeq = new Map<number, Evidence>();
    for (const item of cell) {
      if (item.runId === latest.runId && item.quoteSeq !== null) {
        bySeq.set(item.quoteSeq, item);
      }
    }
    const quotes = [...bySeq.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
    bundles.set(key, { evidence: quotes[0] ?? latest, quotes });
  }
  return bundles;
}

/** 通常セルは既存キーを維持し、複数引用は JSON の入れ子で衝突を避ける。 */
export function quoteKeyOf(evidence: Evidence): string {
  const cellKey = cellKeyOf(evidence.fieldId, evidence.entityKey);
  return evidence.quoteSeq === null ? cellKey : JSON.stringify([cellKey, evidence.quoteSeq]);
}

export function cellKeyFromQuoteKey(quoteKey: string): string {
  const [key, seq] = JSON.parse(quoteKey) as [string, string | number];
  return typeof seq === 'number' ? key : quoteKey;
}
