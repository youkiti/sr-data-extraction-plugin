// Anthropic Messages API（api.anthropic.com）向け実装（issue #127 PR1）。
// GeminiProvider / OpenAICompatibleProvider と同じ構造・エラー処理・fetch 注入パターンに倣う。
//
// - 認証は固定 3 ヘッダー方式（BYOK。requirements.md §2.1）: `x-api-key` / `anthropic-version` /
//   `content-type`。エンドポイントは `https://api.anthropic.com/v1/messages` 固定で利用者入力は無い
// - `system` ロールのメッセージはトップレベルの独立フィールド `system` へ写す（messages 配列には
//   入れない）。`role:'model'` は `'assistant'` へ写す
// - 画像パートは `{type:'image', source:{type:'base64', media_type, data}}`
//   （`toOpenAiContent` とは別の方言のため共有しない。§LLMProvider.ts の toOpenAiContent 参照）
// - `responseSchema` を渡すと `output_config.format = {type:'json_schema', schema}` で
//   構造化出力を要求する。標準 JSON Schema は Anthropic 方言と食い違う点があるため
//   `toAnthropicSchema` で変換する（このファイルの中核。制約は公式ドキュメントで確認済み）
// - fetch を注入できるので network 無しでテスト可能
import {
  LlmProviderError,
  type ChatMessage,
  type ChatOptions,
  type ChatResponse,
  type JsonSchema,
  type LLMProvider,
} from './LLMProvider';
import { parseRetryAfterMs } from './retry';

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * `ChatOptions.maxOutputTokens` 未指定時に使う既定の「本文」トークン予算。
 * Gemini / OpenRouter / OpenAI 互換の他 provider と共通の契約どおり「応答本文に使いたい
 * トークン数」を表す値であり、Anthropic の `max_tokens`（thinking + 本文の合計に対する上限。
 * 必須パラメータ）そのものではない。実際に送る `max_tokens` は `resolveMaxTokens` が
 * この値（または呼び出し側の `maxOutputTokens`）へ `THINKING_HEADROOM_TOKENS` を上乗せして
 * 組み立てる（下記）。本文予算そのものにも公式ドキュメントで確認済みの推奨（16000 以上）を
 * 確保しておく
 */
const DEFAULT_MAX_TOKENS = 16000;

/**
 * `max_tokens`（= thinking + 応答本文の合計）を組み立てる際に、呼び出し側の「本文」予算
 * （`maxOutputTokens` 未指定時は `DEFAULT_MAX_TOKENS`）へ上乗せする thinking の取り分。
 *
 * 背景: `ChatOptions.maxOutputTokens` は他 3 provider（Gemini / OpenRouter / OpenAI 互換）
 * では素直に「応答本文のトークン数」だが、Anthropic では `max_tokens` が thinking を含む
 * 合計の上限として働く。claude-opus-5 / claude-sonnet-5 は thinking が既定 ON のため、
 * 呼び出し側が小さい値（例: Options 接続テストの `maxOutputTokens: 64`）をそのまま
 * `max_tokens` に渡すと thinking だけで使い切り、本文が `stop_reason:'max_tokens'` で
 * 打ち切られる。呼び出し側の契約（「本文トークン数」の意味）は他 provider と共通のため
 * 変更せず、provider 境界のこちらで吸収する。
 *
 * 4,000 という値は「64 トークンの本文要求でも thinking に数千トークンの実用的な余地が残る」
 * ことを狙った数値（`effort:'low'` で thinking の消費は抑えられるが、ゼロにはならないため
 * 数百〜低千トークン規模の余地は必要）。`resolveMaxTokens` で `MAX_TOKENS_CEILING` へ
 * クランプするため、この値を大きめに倒しても実害は無い
 */
const THINKING_HEADROOM_TOKENS = 4_000;

/**
 * `max_tokens` の送信上限。claude-haiku-4-5 の最大出力トークン数は 64,000
 * （claude-opus-5 / claude-sonnet-5 の 128,000 より小さい）で、出荷対象 3 モデルに
 * 共通して安全な値としてこれを採用する（モデルごとに上限を出し分けない — モデルセレクタの
 * 「その他（直接入力）」で未知モデルを指定できるため、実測の無いモデルの上限を推測しない
 * 設計に合わせる）。モデルの出力上限を超えて `max_tokens` を送ること自体が単体で
 * HTTP 400 になるため、このクランプが無いと `THINKING_HEADROOM_TOKENS` の上乗せが
 * かえって大きな `maxOutputTokens` 指定時に新たな 400 を生む
 */
const MAX_TOKENS_CEILING = 64_000;

/**
 * 呼び出し側の「本文」トークン予算（`maxOutputTokens`。未指定は `DEFAULT_MAX_TOKENS`）へ
 * thinking の取り分を上乗せしたうえで `MAX_TOKENS_CEILING` へクランプし、実際に送る
 * `max_tokens`（thinking + 本文の合計）を組み立てる
 */
function resolveMaxTokens(maxOutputTokens: number | undefined): number {
  const bodyBudget = maxOutputTokens ?? DEFAULT_MAX_TOKENS;
  return Math.min(bodyBudget + THINKING_HEADROOM_TOKENS, MAX_TOKENS_CEILING);
}

/**
 * `output_config.effort` の既定値（この PR では provider 内の定数。Options から設定可能にするのは
 * PR5 の仕事）。`thinking` は既定のまま明示的に disabled にしない — 理由は 2 点:
 * ① 公式に `<thinking>` タグが応答へ漏れる既知の問題がある
 * ② `thinking:{type:'disabled'}` は `effort` が `xhigh`/`max` と併用されると 400 になる制約がある
 * effort を下げることで thinking の消費を抑えつつ、上記の落とし穴を回避する
 */
const DEFAULT_EFFORT = 'low';

/**
 * `output_config.effort` が非サポートで送ると 400 になるモデルの明示的な deny list。
 * 現状わかっているのは claude-haiku-4-5 のみ（thinking が既定 ON という DEFAULT_EFFORT の
 * 前提自体が Haiku 4.5 には当てはまらない — thinking budget を明示しない限り思考しないモデルのため、
 * そもそも effort で緩和すべき問題が無い）。
 *
 * allowlist ではなく deny list にしているのは、モデルセレクタの「その他（直接入力）」で
 * 利用者が任意のモデル ID（例: 将来の claude-opus-4-8 等）を直接入力できるため。
 * allowlist にすると、実際には effort をサポートするモデルでも一覧に無ければ
 * 黙って effort を落としてしまう
 */
const MODELS_WITHOUT_EFFORT_SUPPORT: ReadonlySet<string> = new Set(['claude-haiku-4-5']);

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicStopDetails {
  type?: string;
  category?: string | null;
  explanation?: string | null;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
  stop_details?: AnthropicStopDetails | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

/** エラー詳細（responseBody）に載せる応答ボディ抜粋の最大長（他 provider と同じ方針） */
const ERROR_BODY_EXCERPT_CHARS = 1_000;

export class AnthropicProvider implements LLMProvider {
  readonly providerId = 'anthropic' as const;
  readonly model: string;
  /** Anthropic はネイティブに画像入力（base64）へ対応する */
  readonly supportsImageInput = true;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(options: AnthropicProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetch;
  }

  async chat(messages: readonly ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
    const fetchFn = this.fetchImpl ?? globalThis.fetch;
    const res = await fetchFn(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(this.buildRequestBody(messages, options)),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new LlmProviderError(
        `Anthropic API failed: HTTP ${res.status}`,
        this.providerId,
        res.status,
        text,
        parseRetryAfterMs(res.headers.get('retry-after')),
        // HTTP 529（overloaded_error）は retry.ts の RETRYABLE_STATUSES（429/500/502/503/504）に
        // 含まれないため、既存 provider の 5xx / retryable 扱いに合わせてここで明示する。
        // 429 はサーバ提示の retry-after を retryAfterMs 経路へ渡す（failureKind は null のまま）
        res.status === 529,
        null,
      );
    }
    return this.parseSuccessResponse(res);
  }

  /**
   * res.ok（HTTP 2xx）応答の検査。他 provider と同じく、まずボディが JSON として読めるかを
   * 確認する（読めなければ malformed）。次に `stop_reason` で分岐する（`stop_details` では
   * 分岐しない — refusal でも `stop_details` が null になり得るため）。
   * 安全分類器による拒否は HTTP 200 + `content` 配列が空で返ることがあるため、
   * `content[0]` を無条件に読まず、`stop_reason === 'refusal'` を先に判定してから本文を読む
   */
  private async parseSuccessResponse(res: Response): Promise<ChatResponse> {
    const bodyText = await res.text();
    let json: AnthropicResponse;
    try {
      json = JSON.parse(bodyText) as AnthropicResponse;
    } catch {
      throw new LlmProviderError(
        'Anthropic 応答ボディが JSON として読めません（応答が途中で切断された可能性）',
        this.providerId,
        res.status,
        bodyText.slice(-ERROR_BODY_EXCERPT_CHARS),
        null,
        true,
        'malformed',
      );
    }
    const stopReason = json.stop_reason;
    const diagnostics = JSON.stringify({
      stop_reason: stopReason ?? null,
      stop_details: json.stop_details ?? null,
    });
    if (stopReason === 'refusal') {
      throw new LlmProviderError(
        `Anthropic 応答が拒否されました（stop_reason=refusal）`,
        this.providerId,
        res.status,
        diagnostics,
        null,
        false,
        'content_filter',
      );
    }
    if (stopReason === 'max_tokens') {
      throw new LlmProviderError(
        `Anthropic 応答が出力トークン上限で打ち切られました（stop_reason=max_tokens）`,
        this.providerId,
        res.status,
        diagnostics,
        null,
        false,
        'output_limit',
      );
    }
    const text = extractText(json);
    if (text === '') {
      throw new LlmProviderError(
        `Anthropic 応答に本文がありません（stop_reason=${stopReason ?? '不明'}）`,
        this.providerId,
        res.status,
        diagnostics,
      );
    }
    return {
      text,
      tokensIn: json.usage?.input_tokens ?? null,
      tokensOut: json.usage?.output_tokens ?? null,
      raw: json,
    };
  }

  private buildRequestBody(
    messages: readonly ChatMessage[],
    options: ChatOptions,
  ): Record<string, unknown> {
    const systemText = messages
      .filter((m) => m.role === 'system')
      .map((m) => systemMessageText(m.content))
      .join('\n\n');
    const conversational = messages.filter((m) => m.role !== 'system');

    const outputConfig: Record<string, unknown> = {};
    if (!MODELS_WITHOUT_EFFORT_SUPPORT.has(this.model)) {
      outputConfig['effort'] = DEFAULT_EFFORT;
    }
    if (options.responseSchema) {
      outputConfig['format'] = {
        type: 'json_schema',
        schema: toAnthropicSchema(options.responseSchema),
      };
    }

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: resolveMaxTokens(options.maxOutputTokens),
      messages: conversational.map((m) => ({
        role: m.role === 'model' ? 'assistant' : m.role,
        content: toAnthropicContent(m.content),
      })),
    };
    if (systemText !== '') {
      body['system'] = systemText;
    }
    if (Object.keys(outputConfig).length > 0) {
      body['output_config'] = outputConfig;
    }
    // temperature / top_p / top_k はサンプリングパラメータで、claude-opus-5 / claude-sonnet-5
    // をはじめとする現行モデル群では非サポートのため送ると HTTP 400 になる（公式ドキュメントで
    // 確認済み）。ChatOptions.temperature は Gemini / OpenRouter / OpenAI 互換の各 provider が
    // 使う共通フィールドだが、Anthropic 向けにはあえて無視する（provider 境界での意図的な黙殺。
    // 呼び出し側〔executeRun.ts 等〕は他 provider と共用のため変更しない）。挙動の制御は
    // プロンプト側（system メッセージ）で行う
    return body;
  }
}

/**
 * `system` はトップレベルの独立フィールドのため、system メッセージの content が
 * パート配列でも text パートだけを拾って連結する（image パートは無視。GeminiProvider の
 * systemMessageText と同じ理由 — chatContentToText の `[image ...]` プレースホルダを
 * そのまま API へ送ってしまわないため）
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
 * 会話メッセージの content を Anthropic の `content` へ写す。
 * 文字列はそのまま通し、パート配列は text → `{type:'text', text}` /
 * image → `{type:'image', source:{type:'base64', media_type, data}}`（公式ドキュメントで
 * 確認済みの方言）へ写す。`toOpenAiContent`（LLMProvider.ts）とは別に定義する
 */
function toAnthropicContent(content: ChatMessage['content']): unknown {
  if (typeof content === 'string') {
    return content;
  }
  return content.map((part) =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : {
          type: 'image',
          source: { type: 'base64', media_type: part.mimeType, data: part.dataBase64 },
        },
  );
}

function extractText(json: AnthropicResponse): string {
  const blocks = json.content ?? [];
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
}

/**
 * 標準 JSON Schema を Anthropic の `output_config.format` 方言へ変換する
 * （GeminiProvider.toGeminiSchema と同じ位置づけ。公式ドキュメントで確認済みの制約に基づく
 * 機械変換 — 推測しない）。
 *
 * - 型の配列（`type: ['string','null']`）は非サポートのため `anyOf` へ変換する。
 *   `enum` が同居する場合（`enum` に複合型を含められないため）は `null` を除いた enum を
 *   非 null 側の枝へ付け替える
 * - `maxItems` は一切サポートされないため常に削除する
 * - `minItems` は 0 と 1 のみサポートされるため、それ以外の値（例: 4）は削除する
 * - `additionalProperties: false` はそのまま維持する（サポート対象）
 * - ルートの `type:'array'`（配列ではなく文字列としての 'array'）はそのままパススルーする
 *   （ラップしない。公式は明示的に禁じていない — 実 API 確認の未決事項として記録済み）
 * - `properties` / `items` は再帰的に変換する
 */
export function toAnthropicSchema(schema: JsonSchema): Record<string, unknown> {
  const typeValue = schema['type'];
  if (Array.isArray(typeValue)) {
    return convertTypeArraySchema(schema, typeValue);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    switch (key) {
      case 'properties': {
        const props = value as Record<string, JsonSchema>;
        out['properties'] = Object.fromEntries(
          Object.entries(props).map(([k, v]) => [k, toAnthropicSchema(v)]),
        );
        break;
      }
      case 'items':
        out['items'] = toAnthropicSchema(value as JsonSchema);
        break;
      // maxItems は一切非サポートのため常に削除する
      case 'maxItems':
        break;
      // minItems は 0 / 1 のみサポート。それ以外（例: 4）は削除する
      case 'minItems':
        if (value === 0 || value === 1) {
          out['minItems'] = value;
        }
        break;
      // additionalProperties / description / required / enum / format 等は
      // Anthropic 方言でもそのまま有効なため無変換で通す
      default:
        out[key] = value;
        break;
    }
  }
  return out;
}

/**
 * `type` が配列（型の union）のスキーマを `anyOf` へ変換する。
 * `null` 以外の型ごとに 1 枝を作り、`enum` があれば（複合型を含められないため）
 * `null` を除いたうえで非 null 側の枝へ付け替える。`null` を含む場合は末尾に `{type:'null'}` を足す。
 * 各枝は再帰的に `toAnthropicSchema` へ通す（`items` / `minItems` / `maxItems` 等の
 * 同居キーがその枝にも正しく適用されるようにするため）
 */
function convertTypeArraySchema(
  schema: JsonSchema,
  types: readonly unknown[],
): Record<string, unknown> {
  const enumValue = schema['enum'];
  const rest: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key !== 'type' && key !== 'enum') {
      rest[key] = value;
    }
  }
  const nonNullTypes = types.filter((t): t is string => typeof t === 'string' && t !== 'null');
  const hasNull = types.includes('null');
  const branches: Array<Record<string, unknown>> = nonNullTypes.map((t) => {
    const branchSchema: JsonSchema = { type: t, ...rest };
    if (Array.isArray(enumValue)) {
      branchSchema['enum'] = enumValue.filter((v) => v !== null);
    }
    return toAnthropicSchema(branchSchema);
  });
  if (hasNull) {
    branches.push({ type: 'null' });
  }
  return { anyOf: branches };
}
