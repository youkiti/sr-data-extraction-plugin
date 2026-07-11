// Gemini API（generativelanguage.googleapis.com）向け実装
// （sr-query-builder の lib/llm/GeminiProvider.ts を流用）。
//
// - 認証は API キー方式（クエリパラメータ `?key=`）。BYOK（requirements.md §2）
// - `system` ロールは `systemInstruction` フィールドに分離
// - `responseFormat: 'json'` で `responseMimeType: application/json` を要求
// - `responseSchema` を渡すと `generationConfig.responseSchema` で
//   **構造化出力（constrained decoding）** を要求し、壊れた JSON を防ぐ（§4.3）
// - fetch を注入できるので OAuth / network 無しでテスト可能
import {
  LlmProviderError,
  type ChatMessage,
  type ChatOptions,
  type ChatResponse,
  type JsonSchema,
  type LLMProvider,
} from './LLMProvider';
import { parseRetryAfterMs } from './retry';

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
}

/**
 * model 未指定時のフォールバック。抽出用の既定モデルはベンチマークで確定するまで
 * 固定しない（requirements.md Q8）ため、アプリ側は常に model を明示して渡すこと
 */
const FALLBACK_MODEL = 'gemini-3.5-flash';
const ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }>; role?: string };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export class GeminiProvider implements LLMProvider {
  readonly providerId = 'gemini' as const;
  readonly model: string;
  /** Gemini はネイティブに画像入力（inlineData）へ対応する */
  readonly supportsImageInput = true;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(options: GeminiProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? FALLBACK_MODEL;
    this.fetchImpl = options.fetch;
  }

  async chat(messages: readonly ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
    const url = `${ENDPOINT_BASE}/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(
      this.apiKey,
    )}`;
    const body = this.buildRequestBody(messages, options);
    const fetchFn = this.fetchImpl ?? globalThis.fetch;
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new LlmProviderError(
        `Gemini API failed: HTTP ${res.status}`,
        this.providerId,
        res.status,
        text,
        parseRetryAfterMs(res.headers.get('retry-after')),
      );
    }
    const json = (await res.json()) as GeminiResponse;
    const text = extractText(json);
    return {
      text,
      tokensIn: json.usageMetadata?.promptTokenCount ?? null,
      tokensOut: json.usageMetadata?.candidatesTokenCount ?? null,
      raw: json,
    };
  }

  private buildRequestBody(
    messages: readonly ChatMessage[],
    options: ChatOptions,
  ): Record<string, unknown> {
    const systemTexts = messages
      .filter((m) => m.role === 'system')
      .map((m) => systemMessageText(m.content));
    const conversational = messages.filter((m) => m.role !== 'system');

    const contents = conversational.map((m) => ({
      role: m.role === 'model' ? 'model' : 'user',
      parts: toGeminiParts(m.content),
    }));

    const generationConfig: Record<string, unknown> = {};
    if (options.temperature !== undefined) {
      generationConfig['temperature'] = options.temperature;
    }
    if (options.maxOutputTokens !== undefined) {
      generationConfig['maxOutputTokens'] = options.maxOutputTokens;
    }
    // responseSchema を渡すと構造化出力（スキーマ制約付き）になる。
    // responseSchema は必ず application/json を伴う必要がある。
    if (options.responseSchema) {
      generationConfig['responseMimeType'] = 'application/json';
      generationConfig['responseSchema'] = toGeminiSchema(options.responseSchema);
    } else if (options.responseFormat === 'json') {
      generationConfig['responseMimeType'] = 'application/json';
    }

    const body: Record<string, unknown> = { contents };
    if (systemTexts.length > 0) {
      body['systemInstruction'] = { parts: systemTexts.map((t) => ({ text: t })) };
    }
    if (Object.keys(generationConfig).length > 0) {
      body['generationConfig'] = generationConfig;
    }
    return body;
  }
}

/**
 * `systemInstruction` はテキスト専用の欄のため、system メッセージの content が
 * パート配列でも text パートだけを拾って連結する（image パートは無視）。
 * `chatContentToText` を使うと image パートが `[image ...]` のプレースホルダ文字列として
 * 混ざってしまい、それをそのまま API へ送ることになるため、ここでは直接パートを絞り込む。
 */
function systemMessageText(content: ChatMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

/**
 * 会話メッセージの content を Gemini の `parts` へ写す。
 * 文字列は従来どおり単一の `{ text }`、パート配列は text → `{ text }` /
 * image → `{ inlineData: { mimeType, data } }`（実測済みの Gemini 方言。
 * experiments/multimodal-bbox-spike/src/run-bbox.ts のスパイクで動作確認済み）へ写す。
 */
function toGeminiParts(content: ChatMessage['content']): Array<Record<string, unknown>> {
  if (typeof content === 'string') {
    return [{ text: content }];
  }
  return content.map((part) =>
    part.type === 'text'
      ? { text: part.text }
      : { inlineData: { mimeType: part.mimeType, data: part.dataBase64 } },
  );
}

function extractText(json: GeminiResponse): string {
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((p) => p.text ?? '')
    .filter((t) => t.length > 0)
    .join('');
}

/** 標準 JSON Schema の `type`（小文字）を Gemini Schema の Type enum（大文字）へ写す。 */
const GEMINI_TYPE_MAP: Record<string, string> = {
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  array: 'ARRAY',
  object: 'OBJECT',
};

/**
 * 標準 JSON Schema を Gemini の `responseSchema`（OpenAPI 3.0 サブセット）方言へ変換する。
 *
 * - `type` を大文字 enum へ写す（protobuf JSON は小文字を受け付けないため）
 * - nullable union（`type: ['string', 'null']` / `enum: [..., null]`。extract-data の
 *   応答スキーマが使う）は Gemini 方言の `nullable: true` へ写す（移植元からの拡張）
 * - Gemini Schema が知らないキー（`additionalProperties` / `$schema` / `strict` 等）は落とす
 *   （未知キーを送ると 400 になる）
 * - `properties` / `items` は再帰的に変換する
 */
export function toGeminiSchema(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    switch (key) {
      case 'type': {
        if (typeof value === 'string') {
          const mapped = GEMINI_TYPE_MAP[value.toLowerCase()];
          if (mapped !== undefined) {
            out['type'] = mapped;
          }
          break;
        }
        if (Array.isArray(value)) {
          const nonNull = value.filter((t) => t !== 'null');
          const first = nonNull[0];
          const mapped =
            nonNull.length === 1 && typeof first === 'string'
              ? GEMINI_TYPE_MAP[first.toLowerCase()]
              : undefined;
          if (mapped !== undefined) {
            out['type'] = mapped;
            if (nonNull.length < value.length) {
              out['nullable'] = true;
            }
          }
        }
        break;
      }
      case 'enum': {
        if (Array.isArray(value) && value.includes(null)) {
          out['enum'] = value.filter((v) => v !== null);
          out['nullable'] = true;
        } else {
          out['enum'] = value;
        }
        break;
      }
      case 'properties': {
        const props = value as Record<string, JsonSchema>;
        out['properties'] = Object.fromEntries(
          Object.entries(props).map(([k, v]) => [k, toGeminiSchema(v)]),
        );
        break;
      }
      case 'items':
        out['items'] = toGeminiSchema(value as JsonSchema);
        break;
      // Gemini Schema がそのまま受け付けるキーだけ通す
      case 'description':
      case 'required':
      case 'format':
      case 'nullable':
      case 'minItems':
      case 'maxItems':
        out[key] = value;
        break;
      // additionalProperties / $schema / strict 等の未知キーは落とす
      default:
        break;
    }
  }
  return out;
}
