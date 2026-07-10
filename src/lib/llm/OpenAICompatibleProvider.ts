import {
  LlmProviderError,
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

/** Bearer 認証 + OpenAI Chat Completions 互換 API 向け実装 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly providerId = 'openai_compatible' as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.endpoint = normalizeOpenAiCompatibleEndpoint(options.endpoint);
    this.fetchImpl = options.fetch;
  }

  async chat(messages: readonly ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
    const fetchFn = this.fetchImpl ?? globalThis.fetch;
    const res = await fetchFn(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(this.buildRequestBody(messages, options)),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new LlmProviderError(
        `OpenAI compatible API failed: HTTP ${res.status}`,
        this.providerId,
        res.status,
        text,
      );
    }
    const json = (await res.json()) as OpenAICompatibleResponse;
    return {
      text: json.choices?.[0]?.message?.content ?? '',
      tokensIn: json.usage?.prompt_tokens ?? null,
      tokensOut: json.usage?.completion_tokens ?? null,
      raw: json,
    };
  }

  private buildRequestBody(
    messages: readonly ChatMessage[],
    options: ChatOptions,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((message) => ({
        role: message.role === 'model' ? 'assistant' : message.role,
        content: message.content,
      })),
    };
    if (options.temperature !== undefined) {
      body['temperature'] = options.temperature;
    }
    if (options.maxOutputTokens !== undefined) {
      body['max_tokens'] = options.maxOutputTokens;
    }
    if (options.responseSchema) {
      body['response_format'] = {
        type: 'json_schema',
        json_schema: { name: 'response', strict: true, schema: options.responseSchema },
      };
    } else if (options.responseFormat === 'json') {
      body['response_format'] = { type: 'json_object' };
    }
    return body;
  }
}
