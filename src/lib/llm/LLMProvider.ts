// 全 LLM プロバイダ共通の低レベル I/F（sr-query-builder の lib/llm/LLMProvider.ts を流用）。
// 「skill と provider を直交させる」方針に従い、ここでは `chat(messages, options) -> response`
// だけを公開する。skill 側のロジックは features/*/skills/* に持つ（architecture.md §2）
//
// マルチモーダル対応（handoff-scanned-pdf-native-highlight.md §7.4 PR1）: `content` は
// 文字列（従来どおり）に加えて「テキスト + 画像パート」の配列も受け付ける。この PR は
// 型の土台と各プロバイダの写像だけを整備し、UI からはまだ画像パートを送らない。
import type { LlmProviderId } from '../../domain/llmApiLog';

/** テキスト + 画像を混在させられる `ChatMessage.content` の 1 パート */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; dataBase64: string };

export interface ChatMessage {
  role: 'system' | 'user' | 'model';
  /**
   * 文字列（従来どおり）か、テキスト/画像パートの配列。
   * 配列を渡すのは画像を含めたいときのみ想定し、文字列パスの既存挙動は変えない。
   */
  content: string | readonly ChatContentPart[];
}

/**
 * `ChatMessage.content` をテキストへ平坦化する（apiLogger のプレビュー等、
 * テキストとしての要約が欲しい箇所で使う共有ヘルパ）。
 * 文字列はそのまま、配列は text パートを連結し、image パートは
 * `[image ${mimeType}]` というプレースホルダ文字列として埋め込む（base64 本体は含めない）。
 */
export function chatContentToText(content: ChatMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .map((part) => (part.type === 'text' ? part.text : `[image ${part.mimeType}]`))
    .join('');
}

/** メッセージ列のいずれかに画像パートが含まれるか（後続 PR で provider 可否判定に使う） */
export function hasImagePart(messages: readonly ChatMessage[]): boolean {
  return messages.some(
    (m) => Array.isArray(m.content) && m.content.some((part) => part.type === 'image'),
  );
}

/**
 * OpenAI 互換 API（OpenRouter / OpenAICompatibleProvider）向けの `content` 写像。
 * 文字列はそのまま通し（現状の body 形を 1 バイトも変えない）、配列は
 * `{ type: 'text' }` / `{ type: 'image_url', image_url: { url: data URL } }` へ写す。
 * 2 プロバイダで重複させないよう、ここに 1 箇所だけ定義する。
 */
export function toOpenAiContent(content: ChatMessage['content']): unknown {
  if (typeof content === 'string') {
    return content;
  }
  return content.map((part) =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : { type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${part.dataBase64}` } },
  );
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
  /**
   * 画像パート（`ChatContentPart` の `type: 'image'`）を送れるか。
   * 必須フィールドにしているのは意図的: withRetry / withThrottle / withLogging 等の
   * ラッパが LLMProvider を新しく組み立てる箇所で、このフィールドの伝播漏れを
   * コンパイルエラーとして検出させるため（実行時まで気付かないと画像対応 provider を
   * ラップした瞬間に非対応扱いへ後退してしまう）
   */
  readonly supportsImageInput: boolean;
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
