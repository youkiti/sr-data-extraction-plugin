// 論文への質問パネル（issue #264）の質問・回答処理を支える。
// 文脈は 1 study の本文とスキーマ定義だけとし、Evidence・データ行・Decisions は渡さない。
// 質問と回答の payload は保存せず、会話はセッション内のみで扱う。
import type { SchemaField } from '../../domain/schemaField';
import {
  anchorAskPaperCitations,
  estimateAskPaperCost,
  type AskPaperSourceDocument,
  type AskPaperTurn,
} from '../../features/verification/askPaper';
import {
  ASK_PAPER_PROMPT_VERSION,
  ASK_PAPER_RESPONSE_SCHEMA,
  buildAskPaperDocumentPrefix,
  buildAskPaperMessages,
  parseAskPaperResponse,
} from '../../features/verification/skills/askPaper';
import { appendLlmApiLog } from '../../lib/llm/apiLogRepository';
import { withLogging } from '../../lib/llm/apiLogger';
import { missingApiKeyMessage } from '../../lib/llm/modelCatalog';
import { resolveProviderConfig } from '../../lib/llm/providerFactory';
import { applyRateLimitPolicy, UNLIMITED_POLICY } from '../../lib/llm/rateLimitPolicy';
import { FACTORY_DEFAULT_MODEL, loadDefaultModel } from '../../lib/storage/settingsStore';
import type { RelocateQuoteDeps } from './relocateQuoteService';

export type AskPaperDeps = RelocateQuoteDeps;
export interface AskPaperParams {
  spreadsheetId: string;
  /** 呼び出し側で表示中の 1 study の文書だけを渡す。 */
  documents: readonly AskPaperSourceDocument[];
  fields: readonly SchemaField[];
  history: readonly AskPaperTurn[];
  question: string;
}
export type AskPaperOutcome =
  { status: 'answered'; turn: AskPaperTurn } | { status: 'error'; message: string };

export function estimateForQuestion(
  params: AskPaperParams,
  model: string,
): ReturnType<typeof estimateAskPaperCost> {
  return estimateAskPaperCost({
    model,
    prefixChars: buildAskPaperDocumentPrefix(params).length,
    historyChars: params.history
      .slice(-5)
      .reduce((total, turn) => total + turn.question.length + turn.answer.length, 0),
    questionChars: params.question.length,
  });
}

/** 回答はメモリ上に返すだけとし、共有ログには利用量などのメタデータのみ追記する。 */
export async function askPaper(
  params: AskPaperParams,
  deps: AskPaperDeps,
): Promise<AskPaperOutcome> {
  try {
    const model = (await (deps.loadDefaultModel ?? loadDefaultModel)()) ?? FACTORY_DEFAULT_MODEL;
    const resolution = await resolveProviderConfig(model, deps);
    if (resolution.config === null) {
      return { status: 'error', message: missingApiKeyMessage(resolution.provider) };
    }
    const policy = await (deps.resolveRateLimitPolicy ?? (async () => UNLIMITED_POLICY))();
    const provider = applyRateLimitPolicy(
      withLogging(deps.buildProvider(resolution.config), 'ask_paper', {
        omitPayload: true,
        appendLogEntry: (entry) => appendLlmApiLog(params.spreadsheetId, entry, deps.google),
        promptVersion: ASK_PAPER_PROMPT_VERSION,
        newUuid: deps.newUuid,
        now: deps.now,
      }),
      policy,
    );
    const response = await provider.chat(
      buildAskPaperMessages({
        prefix: buildAskPaperDocumentPrefix(params),
        history: params.history,
        question: params.question,
      }),
      { temperature: 0, responseSchema: ASK_PAPER_RESPONSE_SCHEMA },
    );
    const parsed = parseAskPaperResponse(response.text, params.documents.length);
    const citations = anchorAskPaperCitations(parsed.citations, params.documents);
    return {
      status: 'answered',
      turn: {
        question: params.question,
        answer: parsed.answer,
        found: parsed.found,
        citations,
        anchoredCount: citations.filter((citation) => citation.highlightable).length,
      },
    };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}
