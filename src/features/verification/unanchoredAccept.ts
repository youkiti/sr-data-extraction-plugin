// 照合できなかった引用のセルを accept する前の警告（issue #381）。
// 引用が PDF の本文で見つかっていないセル（anchor_status = failed）と、スキャン PDF のため
// 本文と照合していないセル（引用はあるが anchor_status が null）では、1 回目の accept で確定せず
// 注意を出し、もう一度 accept したときだけ確定する。警告を経た accept は Decisions.note に印を付ける。
// fuzzy は「おおむね一致」のため対象外（バッジの色で注意を促すだけ）
import type { AnchorStatus } from '../../domain/anchor';

/** 警告を経た accept を監査証跡で識別する印（質問後の印 `[chat-assist]` と同じ付け方） */
export const UNANCHORED_ACCEPT_NOTE_MARKER = '[unanchored-accept]';

/** failed = 本文で見つからない / unchecked = スキャン PDF のため照合していない */
export type UnanchoredReason = 'failed' | 'unchecked';

/** 判定対象の引用 1 件ぶん（Evidence と CellQuote の共通部分） */
export interface AnchorCheckQuote {
  quote: string | null;
  anchorStatus: AnchorStatus | null;
}

/**
 * セルに表示している引用のうち、本文で確かめられていないものがあればその理由を返す。
 * failed が 1 件でもあれば failed を優先し、無ければ照合していない引用の有無で unchecked を返す。
 * 引用文が無い行（AI が未報告とした行など）は対象外
 */
export function unanchoredReasonOf(quotes: readonly AnchorCheckQuote[]): UnanchoredReason | null {
  const withQuote = quotes.filter((item) => item.quote !== null && item.quote.trim() !== '');
  if (withQuote.some((item) => item.anchorStatus === 'failed')) {
    return 'failed';
  }
  return withQuote.some((item) => item.anchorStatus === null) ? 'unchecked' : null;
}
