// 全 LLM プロバイダ共通の低レベル I/F（sr-query-builder の lib/llm/LLMProvider.ts を流用）。
// 「skill と provider を直交させる」方針に従い、ここでは `chat(messages, options) -> response`
// だけを公開する。skill 側のロジックは features/*/skills/* に持つ（architecture.md §2）
import type { LlmProviderId } from '../../domain/llmApiLog';

export interface ChatMessage {
  role: 'system' | 'user' | 'model';
  content: string;
}

export type ResponseFormat = 'text' | 'json';

/**
 * 構造化出力（structured output）に渡す JSON Schema。
 * 標準 JSON Schema 方言（`type` は小文字 / `additionalProperties` 等）で記述する。
 * 各プロバイダ実装がそのプロバイダの方言へ変換して constrained decoding に流す。
 */
export type JsonSchema = Record<string, unknown>;

export interface ChatOptions {
  temperature?: number;
  maxOutputTokens?: number;
  /** `'json'` を指定すると JSON モードを要求する。skill 側で構造化出力にしたいときに使う */
  responseFormat?: ResponseFormat;
  /**
   * JSON Schema を渡すと **構造化出力（スキーマ制約付き）** を要求する。
   * `responseFormat: 'json'` 単体は MIME ヒントに過ぎず壊れた JSON が出うるため、
   * 確実に valid な JSON が欲しい skill（extract-data 等）はこちらを使う。
   */
  responseSchema?: JsonSchema;
}

export interface ChatResponse {
  /** モデル出力テキスト（responseFormat=json でも文字列のまま） */
  text: string;
  /** プロンプト側のトークン数。プロバイダが返さなければ null */
  tokensIn: number | null;
  /** 生成側のトークン数。同上 */
  tokensOut: number | null;
  /** プロバイダ生レスポンス（apiLogger が Drive へそのまま保存する） */
  raw: unknown;
}

export interface LLMProvider {
  readonly providerId: LlmProviderId;
  readonly model: string;
  chat(messages: readonly ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
}

/** プロバイダ呼び出し時の例外（4xx/5xx を統一的に表す） */
export class LlmProviderError extends Error {
  readonly providerId: LlmProviderId;
  readonly status: number | null;
  readonly responseBody: string;
  /**
   * サーバが `Retry-After` ヘッダで提示した再送までの待ち時間（ms）。
   * 取得できない・ヘッダ無しは null。429 のバックオフで withRetry が尊重する
   * （本文の RetryInfo よりヘッダを優先する）
   */
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    providerId: LlmProviderId,
    status: number | null,
    responseBody: string,
    retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'LlmProviderError';
    this.providerId = providerId;
    this.status = status;
    this.responseBody = responseBody;
    this.retryAfterMs = retryAfterMs;
  }
}
