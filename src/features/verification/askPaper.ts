// 論文への質問パネル（issue #264）の質問・回答処理を支える。
// 文脈は 1 study の本文とスキーマ定義だけとし、Evidence・データ行・Decisions は渡さない。
// 質問と回答の payload は保存せず、会話はセッション内のみで扱う。
import type { AnchorStatus } from '../../domain/anchor';
import { estimateCostUsd } from '../../lib/llm/pricing';
import { anchorQuote } from '../anchoring/anchorQuote';
import { normalizeText } from '../anchoring/normalizeText';
import { APPROX_CHARS_PER_TOKEN } from '../extraction/planRun';
import {
  ASK_PAPER_SYSTEM_PROMPT,
  type AskPaperCitation,
  type AskPaperDocument,
} from './skills/askPaper';

export interface AskPaperSourceDocument extends AskPaperDocument {
  documentId: string;
}

export interface AnchoredCitation {
  /** プロンプトと同じ 1 始まりの文書番号 */
  documentIndex: number;
  documentId: string;
  quote: string;
  page: number | null;
  anchorStatus: AnchorStatus;
  anchoredPage: number | null;
  highlightable: boolean;
}

export interface AskPaperTurn {
  question: string;
  answer: string;
  found: boolean;
  citations: AnchoredCitation[];
  anchoredCount: number;
}

export function anchorAskPaperCitations(
  citations: readonly AskPaperCitation[],
  documents: readonly AskPaperSourceDocument[],
): AnchoredCitation[] {
  return citations.flatMap((citation) => {
    const document = documents[citation.document_index - 1];
    if (!Number.isInteger(citation.document_index) || document === undefined) return [];
    const pages = document.pages.map(({ page, text }) => ({ page, text: normalizeText(text) }));
    const anchor = anchorQuote(normalizeText(citation.quote), pages, citation.page);
    return [
      {
        documentIndex: citation.document_index,
        documentId: document.documentId,
        quote: citation.quote,
        page: citation.page,
        anchorStatus: anchor.status,
        anchoredPage: anchor.page,
        highlightable: anchor.status !== 'failed',
      },
    ];
  });
}

/** 短い回答と引用数件を想定した出力トークン数。課金実績ではなく送信前の概算用。 */
export const ASK_PAPER_ESTIMATED_OUTPUT_TOKENS = 600;

export function estimateAskPaperCost(input: {
  model: string;
  prefixChars: number;
  historyChars: number;
  questionChars: number;
}): { tokensIn: number; costUsd: number | null } {
  const tokensIn = Math.ceil(
    (ASK_PAPER_SYSTEM_PROMPT.length +
      input.prefixChars +
      input.historyChars +
      input.questionChars) /
      APPROX_CHARS_PER_TOKEN,
  );
  return {
    tokensIn,
    costUsd: estimateCostUsd(input.model, tokensIn, ASK_PAPER_ESTIMATED_OUTPUT_TOKENS),
  };
}
