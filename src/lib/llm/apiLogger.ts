// 任意の LLMProvider をラップして、各 chat() 呼び出し時に
// full prompt / full response を Drive（logs/llm/）へ保存し、
// Sheets の `LLMApiLog` タブにメタ情報を 1 行追記する
// （sr-query-builder の lib/llm/apiLogger.ts を流用。requirements.md §3.2 / §6 の監査性に対応）。
//
// 移植元からの拡張: skill のプロンプト版数（EXTRACT_DATA_PROMPT_VERSION 等）を
// Drive 保存する prompt payload に含めて記録する（§4.3「プロンプト版数を LLMApiLog に残す」）
import type { LlmApiLogEntry, LlmPurpose } from '../../domain/llmApiLog';
import { nowIso8601 } from '../../utils/iso8601';
import { generateUuid } from '../../utils/uuid';
import {
  LlmProviderError,
  chatContentToText,
  type ChatMessage,
  type ChatOptions,
  type ChatResponse,
  type LLMProvider,
} from './LLMProvider';
import { estimateCostUsd } from './pricing';

export interface ApiLoggerDeps {
  /** Drive に JSON ファイルをアップロードして webViewLink を返す */
  uploadJson: (params: {
    filename: string;
    content: string;
  }) => Promise<{ webViewLink: string }>;
  /** Sheets の LLMApiLog タブに 1 行追記する */
  appendLogEntry: (entry: LlmApiLogEntry) => Promise<void>;
  /** 呼び出し元 skill のプロンプト版数。prompt payload に記録する */
  promptVersion?: number;
  /** テスト時に差し替え可能な UUID 発番 */
  newUuid?: () => string;
  /** テスト時に差し替え可能な現在時刻 */
  now?: () => string;
}

/** プロンプト先頭 500 文字をプレビューとして抜粋 */
const PROMPT_SUMMARY_LENGTH = 500;

export function buildPromptSummary(messages: readonly ChatMessage[]): string {
  const text = messages
    .map((m) => `[${m.role}] ${chatContentToText(m.content)}`)
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= PROMPT_SUMMARY_LENGTH) {
    return text;
  }
  return `${text.slice(0, PROMPT_SUMMARY_LENGTH - 1)}…`;
}

/**
 * Drive へ保存する prompt payload 用に、画像パートの base64 本体を伏字へ置き換えたメッセージ列を作る。
 * 1 リクエストで画像を複数枚送ると payload が数 MB に膨らみログ肥大の原因になるため、
 * base64 文字列は 1 文字も残さず長さだけを記録する（handoff-scanned-pdf-native-highlight.md §7.4 PR1-4）。
 * 文字列 content・text パートは無改変。
 */
export function redactMessagesForLog(messages: readonly ChatMessage[]): unknown {
  return messages.map((m) => ({
    ...m,
    content:
      typeof m.content === 'string'
        ? m.content
        : m.content.map((part) =>
            part.type === 'image'
              ? {
                  type: 'image' as const,
                  mimeType: part.mimeType,
                  dataBase64: `<image ${part.mimeType} ${part.dataBase64.length} chars redacted>`,
                }
              : part,
          ),
  }));
}

/**
 * LLMProvider を「呼ぶたびに監査ログを残す」ラッパで包む。
 * skill ごとに `purpose` を指定し、`LLMApiLog.purpose` 列で識別できるようにする。
 */
export function withLogging(
  provider: LLMProvider,
  purpose: LlmPurpose,
  deps: ApiLoggerDeps,
): LLMProvider {
  const uuid = deps.newUuid ?? generateUuid;
  const now = deps.now ?? nowIso8601;

  return {
    providerId: provider.providerId,
    model: provider.model,
    supportsImageInput: provider.supportsImageInput,
    chat: async (messages: readonly ChatMessage[], options?: ChatOptions) => {
      const logId = uuid();
      const startedAt = now();
      const startMs = Date.now();
      let response: ChatResponse | null = null;
      let errorMessage: string | null = null;
      try {
        response = await provider.chat(messages, options);
        return response;
      } catch (err) {
        errorMessage = formatError(err);
        throw err;
      } finally {
        const latencyMs = Date.now() - startMs;
        const promptUpload = await deps.uploadJson({
          filename: `${logId}.prompt.json`,
          content: JSON.stringify(
            {
              promptVersion: deps.promptVersion ?? null,
              messages: redactMessagesForLog(messages),
              options,
            },
            null,
            2,
          ),
        });
        const responseUpload = await deps.uploadJson({
          filename: `${logId}.response.json`,
          content: JSON.stringify(
            response !== null ? response.raw : { error: errorMessage },
            null,
            2,
          ),
        });
        const entry: LlmApiLogEntry = {
          logId,
          timestamp: startedAt,
          provider: provider.providerId,
          model: provider.model,
          purpose,
          promptRef: promptUpload.webViewLink,
          responseRef: responseUpload.webViewLink,
          promptSummary: buildPromptSummary(messages),
          tokensIn: response?.tokensIn ?? null,
          tokensOut: response?.tokensOut ?? null,
          latencyMs,
          // モデル単価表（pricing.ts）から概算コストを算出。未知モデルは null。
          costEstimateUsd: estimateCostUsd(
            provider.model,
            response?.tokensIn ?? null,
            response?.tokensOut ?? null,
          ),
          error: errorMessage,
        };
        await deps.appendLogEntry(entry);
      }
    },
  };
}

function formatError(err: unknown): string {
  if (err instanceof LlmProviderError) {
    // 監査ログには責め切らずプロバイダ応答本文を丸ごと残す（400 の具体的理由の一次資料）
    const base = `${err.message} (status=${err.status ?? 'n/a'})`;
    const body = err.responseBody.trim();
    return body.length > 0 ? `${base}: ${body}` : base;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
