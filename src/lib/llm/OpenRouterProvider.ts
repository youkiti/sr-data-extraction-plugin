import {
  LlmProviderError,
  toOpenAiContent,
  type ChatMessage,
  type ChatOptions,
  type ChatResponse,
  type LLMProvider,
} from './LLMProvider';
import { parseRetryAfterMs } from './retry';

/**
 * OpenRouter（OpenAI 互換 REST API）向け実装
 * （sr-query-builder の lib/llm/OpenRouterProvider.ts を流用。ロジックは無改変）。
 *
 * - 認証は `Authorization: Bearer {apiKey}` ヘッダ。
 * - 本拡張の `model` ロールは OpenAI 互換の `assistant` ロールへ変換する。
 *   `system` / `user` はそのまま。
 * - `responseSchema` を渡すと `response_format: { type: 'json_schema', ... }` で
 *   **構造化出力** を要求する。スキーマ無しで `responseFormat: 'json'` のときは
 *   `response_format: { type: 'json_object' }`（JSON モード）にフォールバックする。
 * - Gemini（GeminiProvider）と違い方言変換は不要: extract-data / draft-schema の
 *   応答スキーマは `additionalProperties: false` + 全プロパティ required 済みで、
 *   nullable union（`type: ['string','null']` 等）も OpenAI 互換方言でそのまま有効なため、
 *   標準 JSON Schema をパススルーできる。
 * - fetch を注入できるので network 無しでテスト可能。
 */

export interface OpenRouterProviderOptions {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

interface OpenRouterChoice {
  message?: { role?: string; content?: string | null };
  finish_reason?: string;
  native_finish_reason?: string;
  /** プロバイダ側エラーで choice が終わった場合に載る（OpenRouter 仕様） */
  error?: unknown;
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** エラー詳細（responseBody）に載せる応答ボディ抜粋の最大長 */
const ERROR_BODY_EXCERPT_CHARS = 1_000;

/**
 * content が返らなかった・打ち切られたときのエラー詳細。finish_reason と choice の
 * error を残す（フル応答は withLogging が Drive に保存するため、ここは一次手掛かり）
 */
function describeChoice(choice: OpenRouterChoice | undefined): string {
  return JSON.stringify({
    finish_reason: choice?.finish_reason ?? null,
    native_finish_reason: choice?.native_finish_reason ?? null,
    error: choice?.error ?? null,
  });
}

export class OpenRouterProvider implements LLMProvider {
  readonly providerId = 'openrouter' as const;
  readonly model: string;
  // OpenAI 互換の image_url をパススルーするだけなので画像対応を宣言する。
  // モデルがマルチモーダル非対応の場合は API 側が 4xx を返し、LlmProviderError として表面化する
  readonly supportsImageInput = true;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(options: OpenRouterProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetch;
  }

  async chat(messages: readonly ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
    const body = this.buildRequestBody(messages, options);
    const fetchFn = this.fetchImpl ?? globalThis.fetch;
    const res = await fetchFn(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://github.com/youkiti/sr-data-extraction-plugin',
        'X-Title': 'sr-data-extraction-plugin',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new LlmProviderError(
        `OpenRouter API failed: HTTP ${res.status}`,
        this.providerId,
        res.status,
        text,
        parseRetryAfterMs(res.headers.get('retry-after'))
      );
    }
    // 応答ボディの検査（issue #187）: 実プロジェクトで「HTTP 200 なのにボディが途切れて
    // JSON として読めない」「choice がプロバイダ側エラー/打ち切りで content が空」が
    // 頻発したため、裸の SyntaxError や空文字を返さず、原因（finish_reason / error）を
    // 載せた LlmProviderError にする。長時間生成の切断は一時的な可能性があるため retryable
    const bodyText = await res.text();
    let json: OpenRouterResponse;
    try {
      json = JSON.parse(bodyText) as OpenRouterResponse;
    } catch {
      throw new LlmProviderError(
        'OpenRouter 応答ボディが JSON として読めません（応答が途中で切断された可能性）',
        this.providerId,
        res.status,
        bodyText.slice(-ERROR_BODY_EXCERPT_CHARS),
        null,
        true,
      );
    }
    const choice = json.choices?.[0];
    const finishReason = choice?.finish_reason;
    const content = choice?.message?.content;
    if (choice?.error !== undefined || finishReason === 'error') {
      throw new LlmProviderError(
        `OpenRouter がプロバイダ側エラーを返しました（finish_reason=${finishReason ?? '不明'}）`,
        this.providerId,
        res.status,
        describeChoice(choice),
        null,
        true, // 上流プロバイダの一時障害の可能性があるため再試行対象
      );
    }
    if (content === undefined || content === null || content === '') {
      throw new LlmProviderError(
        `OpenRouter 応答に本文（content）がありません（finish_reason=${finishReason ?? '不明'}）`,
        this.providerId,
        res.status,
        describeChoice(choice),
      );
    }
    if (finishReason === 'length' || finishReason === 'content_filter') {
      const reasonLabel = finishReason === 'length' ? '出力トークン上限' : 'コンテンツフィルタ';
      throw new LlmProviderError(
        `OpenRouter 応答が${reasonLabel}で打ち切られました（finish_reason=${finishReason}）`,
        this.providerId,
        res.status,
        describeChoice(choice),
      );
    }
    return {
      text: content,
      tokensIn: json.usage?.prompt_tokens ?? null,
      tokensOut: json.usage?.completion_tokens ?? null,
      raw: json,
    };
  }

  private buildRequestBody(
    messages: readonly ChatMessage[],
    options: ChatOptions
  ): Record<string, unknown> {
    const mapped = messages.map((m) => ({
      role: m.role === 'model' ? 'assistant' : m.role,
      content: toOpenAiContent(m.content),
    }));

    const body: Record<string, unknown> = {
      model: this.model,
      messages: mapped,
    };
    if (options.temperature !== undefined) {
      body['temperature'] = options.temperature;
    }
    if (options.maxOutputTokens !== undefined) {
      body['max_tokens'] = options.maxOutputTokens;
    }
    if (options.responseSchema) {
      // OpenAI 互換の構造化出力。strict:true は additionalProperties:false と
      // 全プロパティ required を要求するため、schema 側でそれを満たしている前提。
      body['response_format'] = {
        type: 'json_schema',
        json_schema: {
          name: 'response',
          strict: true,
          schema: options.responseSchema,
        },
      };
    } else if (options.responseFormat === 'json') {
      body['response_format'] = { type: 'json_object' };
    }
    return body;
  }
}
