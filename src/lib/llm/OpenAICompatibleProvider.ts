import {
  LlmProviderError,
  toOpenAiContent,
  type ChatMessage,
  type ChatOptions,
  type ChatResponse,
  type LLMProvider,
} from './LLMProvider';
import { normalizeOpenAiCompatibleEndpoint } from '../storage/settingsStore';

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
        const json = (await res.json()) as OpenAICompatibleResponse;
        return {
          text: json.choices?.[0]?.message?.content ?? '',
          tokensIn: json.usage?.prompt_tokens ?? null,
          tokensOut: json.usage?.completion_tokens ?? null,
          raw: json,
        };
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
