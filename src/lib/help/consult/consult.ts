// 履歴や共有ログを保存せず、小節の選択と回答を一度ずつ要求する。
import { LlmProviderError } from '../../llm/LLMProvider';
import { createProvider } from '../../llm/providerFactory';
import { CONSULT_MODELS, type ConsultProviderId } from './model';
import { buildAnswerMessages, buildSelectionMessages, parseSelection, SELECTION_RESPONSE_SCHEMA } from './prompt';
import type { ConsultFailureKind, ConsultResult, HelpLanguage, HelpSection } from './types';

/** ヘルプ相談は再現性優先で温度 0 に固定する */
export const HELP_CONSULT_TEMPERATURE = 0;

export function classifyConsultError(error: unknown): ConsultFailureKind {
  if (error instanceof LlmProviderError) {
    if (error.status === 429) {
      return 'rate_limited';
    }
    if (error.status === 401 || error.status === 403) {
      return 'auth';
    }
    if (error.failureKind === 'output_limit' || error.failureKind === 'content_filter' || error.failureKind === 'malformed') {
      return 'invalid_response';
    }
    if (error.failureKind === 'timeout') {
      return 'timeout';
    }
  }
  if (error instanceof TypeError) {
    return 'network';
  }
  if (error instanceof SyntaxError) {
    return 'invalid_response';
  }
  return 'unknown';
}

export interface ConsultHelpParams {
  question: string;
  lang: HelpLanguage;
  sections: readonly HelpSection[];
  providerId: ConsultProviderId | null;
  apiKey: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export async function consultHelp(params: ConsultHelpParams): Promise<ConsultResult> {
  if (!params.providerId || !params.apiKey) {
    return { status: 'failure', kind: 'no_key' };
  }
  if (params.signal?.aborted) {
    return { status: 'failure', kind: 'aborted' };
  }
  const controller = new AbortController();
  let stopped: 'aborted' | 'timeout' | null = null;
  let rejectStop: (reason: unknown) => void;
  const stopPromise = new Promise<never>((_resolve, reject) => {
    rejectStop = reject;
  });
  const stop = (kind: 'aborted' | 'timeout'): void => {
    if (stopped === null) {
      stopped = kind;
      rejectStop(new Error(kind));
      controller.abort();
    }
  };
  const onAbort = (): void => stop('aborted');
  params.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => stop('timeout'), params.timeoutMs ?? 180_000);
  try {
    const baseFetch = params.fetch ?? fetch;
    const provider = createProvider({
      provider: params.providerId,
      apiKey: params.apiKey,
      model: CONSULT_MODELS[params.providerId],
      fetch: (input, init) => baseFetch(input, { ...init, signal: controller.signal }),
    });
    // DeepSeek V4 Flash の推論が237〜2,925トークンに揺れ、2,048では回答が打ち切られたため8,192を確保する。
    const options = { temperature: HELP_CONSULT_TEMPERATURE, maxOutputTokens: 8192 };
    const selection = await Promise.race([
      provider.chat(buildSelectionMessages(params.sections, params.question), { ...options, responseSchema: SELECTION_RESPONSE_SCHEMA }),
      stopPromise,
    ]);
    const sectionIds = parseSelection(selection.text, params.sections);
    if (sectionIds.length === 0) {
      return { status: 'no_match' };
    }
    const sections = sectionIds.map((id) => params.sections.find((section) => section.id === id)!);
    const response = await Promise.race([
      provider.chat(buildAnswerMessages(sections, params.question, params.lang), options),
      stopPromise,
    ]);
    if (response.text.trim() === '') {
      return { status: 'failure', kind: 'invalid_response' };
    }
    return { status: 'success', sectionIds, answer: response.text.trim() };
  } catch (error) {
    return { status: 'failure', kind: stopped ?? classifyConsultError(error) };
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', onAbort);
  }
}
