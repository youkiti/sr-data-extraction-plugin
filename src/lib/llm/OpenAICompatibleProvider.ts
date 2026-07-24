import {
  LlmProviderError,
  toOpenAiContent,
  type ChatMessage,
  type ChatOptions,
  type ChatResponse,
  type LLMProvider,
} from './LLMProvider';
import { normalizeOpenAiCompatibleEndpoint } from '../storage/settingsStore';

/** エラー詳細（responseBody）に載せる応答ボディ抜粋の最大長（OpenRouterProvider と同じ方針） */
const ERROR_BODY_EXCERPT_CHARS = 1_000;

export interface OpenAICompatibleProviderOptions {
  apiKey: string;
  model: string;
  endpoint: string;
  fetch?: typeof fetch;
}

interface OpenAICompatibleResponse {
  choices?: Array<{
    message?: { role?: string; content?: string | null };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

type StructuredOutputMode = 'json_schema_strict' | 'json_schema' | 'json_object';

const STRUCTURED_OUTPUT_MODES: readonly StructuredOutputMode[] = [
  'json_schema_strict',
  'json_schema',
  'json_object',
];

/** 認証やモデル指定のエラーを隠さず、構造化出力の非互換だけを再試行対象にする */
function isStructuredOutputCompatibilityError(status: number, responseBody: string): boolean {
  return (
    (status === 400 || status === 422) &&
    /response[_ -]?format|json[_ -]?schema|strict|structured[_ -]?output/i.test(responseBody)
  );
}

/** OpenAI Chat Completions 互換 API 向け実装。空の API キーでは認証ヘッダーを送らない */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly providerId = 'openai_compatible' as const;
  readonly model: string;
  // OpenAI 互換の image_url をパススルーするだけなので画像対応を宣言する。
  // モデルがマルチモーダル非対応の場合は API 側が 4xx を返し、LlmProviderError として表面化する
  readonly supportsImageInput = true;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch | undefined;
  private structuredOutputMode: StructuredOutputMode = 'json_schema_strict';

  constructor(options: OpenAICompatibleProviderOptions) {
    this.apiKey = options.apiKey.trim();
    this.model = options.model;
    this.endpoint = normalizeOpenAiCompatibleEndpoint(options.endpoint);
    this.fetchImpl = options.fetch;
  }

  async chat(messages: readonly ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
    const fetchFn = this.fetchImpl ?? globalThis.fetch;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey !== '') {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    let mode: StructuredOutputMode | undefined = options.responseSchema
      ? this.structuredOutputMode
      : undefined;

    for (;;) {
      const res = await fetchFn(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(this.buildRequestBody(messages, options, mode)),
      });
      if (res.ok) {
        if (mode !== undefined) {
          this.structuredOutputMode = mode;
        }
        return this.parseSuccessResponse(res);
      }
      const text = await res.text().catch(() => '');
      const error = new LlmProviderError(
        `OpenAI compatible API failed: HTTP ${res.status}`,
        this.providerId,
        res.status,
        text,
      );
      const modeIndex = mode === undefined ? -1 : STRUCTURED_OUTPUT_MODES.indexOf(mode);
      const nextMode = STRUCTURED_OUTPUT_MODES[modeIndex + 1];
      if (
        mode === undefined ||
        nextMode === undefined ||
        !isStructuredOutputCompatibilityError(res.status, text)
      ) {
        throw error;
      }
      mode = nextMode;
    }
  }

  /**
   * res.ok（HTTP 2xx）応答の検査（issue #187 の OpenRouterProvider と同じ方針を踏襲。
   * それまでは `json.choices?.[0]?.message?.content ?? ''` で握りつぶしていたため、
   * length 打ち切りが下流で空応答 = `format_error` に化けていた）。
   * 失敗種別（LlmFailureKind）の判定順: ボディ切断（malformed）を最優先で判定し、
   * 次に finish_reason の length / content_filter を見る。content が空でも finish_reason が
   * 上記に当てはまらなければ理由不明のまま null にする（構造化出力の互換性リトライ〔上位の
   * for ループ〕は HTTP ステータスだけで判定するため、ここでの応答内容検査とは独立に働く）
   */
  private async parseSuccessResponse(res: Response): Promise<ChatResponse> {
    const bodyText = await res.text();
    let json: OpenAICompatibleResponse;
    try {
      json = JSON.parse(bodyText) as OpenAICompatibleResponse;
    } catch {
      throw new LlmProviderError(
        'OpenAI 互換応答ボディが JSON として読めません（応答が途中で切断された可能性）',
        this.providerId,
        res.status,
        bodyText.slice(-ERROR_BODY_EXCERPT_CHARS),
        null,
        true,
        'malformed',
      );
    }
    const choice = json.choices?.[0];
    const finishReason = choice?.finish_reason;
    const content = choice?.message?.content;
    if (finishReason === 'length' || finishReason === 'content_filter') {
      const reasonLabel = finishReason === 'length' ? '出力トークン上限' : 'コンテンツフィルタ';
      throw new LlmProviderError(
        `OpenAI 互換応答が${reasonLabel}で打ち切られました（finish_reason=${finishReason}）`,
        this.providerId,
        res.status,
        JSON.stringify({ finish_reason: finishReason }),
        null,
        false,
        finishReason === 'length' ? 'output_limit' : 'content_filter',
      );
    }
    if (content === undefined || content === null || content === '') {
      throw new LlmProviderError(
        `OpenAI 互換応答に本文（content）がありません（finish_reason=${finishReason ?? '不明'}）`,
        this.providerId,
        res.status,
        JSON.stringify({ finish_reason: finishReason ?? null }),
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
    options: ChatOptions,
    structuredOutputMode?: StructuredOutputMode,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((message) => ({
        role: message.role === 'model' ? 'assistant' : message.role,
        content: toOpenAiContent(message.content),
      })),
    };
    if (options.temperature !== undefined) {
      body['temperature'] = options.temperature;
    }
    if (options.maxOutputTokens !== undefined) {
      body['max_tokens'] = options.maxOutputTokens;
    }
    if (options.responseSchema) {
      if (structuredOutputMode === 'json_object') {
        body['response_format'] = { type: 'json_object' };
      } else {
        body['response_format'] = {
          type: 'json_schema',
          json_schema: {
            name: 'response',
            ...(structuredOutputMode !== 'json_schema' ? { strict: true } : {}),
            schema: options.responseSchema,
          },
        };
      }
    } else if (options.responseFormat === 'json') {
      body['response_format'] = { type: 'json_object' };
    }
    return body;
  }
}
