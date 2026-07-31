import type { LlmProviderId } from '../../domain/llmApiLog';
import {
  LlmProviderError,
  toOpenAiContent,
  type ChatMessage,
  type ChatOptions,
  type ChatResponse,
  type LLMProvider,
  type ReasoningEffort,
} from './LLMProvider';
import { normalizeOpenAiCompatibleEndpoint } from '../storage/settingsStore';

/** エラー詳細（responseBody）に載せる応答ボディ抜粋の最大長（OpenRouterProvider と同じ方針） */
const ERROR_BODY_EXCERPT_CHARS = 1_000;

/**
 * 認証ヘッダー方式。既定は `bearer`（`Authorization: Bearer <key>`。従来の OpenAI 互換 API）。
 * `azure_api_key` は Azure OpenAI 用（`api-key: <key>`。issue #127 PR3）。
 * 利用者が自由入力するヘッダー名ではなく、接続方式（provider）に紐づく固定値として
 * `createProvider`（providerFactory.ts）が選ぶ。任意ヘッダー入力 UI は導入しない
 * （docs/ui-states.md §2・requirements.md §10 Q11 の不採用宣言を参照）
 */
export type OpenAiCompatibleAuthMode = 'bearer' | 'azure_api_key';

export interface OpenAICompatibleProviderOptions {
  apiKey: string;
  model: string;
  endpoint: string;
  fetch?: typeof fetch;
  /** 省略時は 'bearer'（従来どおり）。Azure OpenAI は 'azure_api_key' を渡す */
  authMode?: OpenAiCompatibleAuthMode;
  /**
   * construction 時点の既定 reasoning effort（Options `settings.defaultReasoningEffort` から
   * `providerFactory.createProvider` が注入する。issue #127 PR5。Azure OpenAI 経由も含む）。
   * 未指定（null / undefined）なら `reasoning_effort` を一切送らない従来どおりの挙動を維持する
   */
  reasoningEffort?: ReasoningEffort | null;
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

/**
 * 認証やモデル指定のエラーを隠さず、構造化出力の非互換だけを再試行対象にする。
 *
 * **`reasoning_effort` 非対応の 400/422 はここではカバーしない**: 判定は応答本文が
 * `response_format` / `json_schema` / `strict` / `structured_output` のいずれかを含む場合に
 * 限られ、`reasoning_effort` という語はこの正規表現にマッチしない。issue #127 §4-4 は
 * 「400 は既存の非互換フォールバックで縮退させる」ことを要求していたが、この関数だけでは
 * その要求を満たせないと判明した（PR5 の実装レビューで確認）。そのため
 * `reasoning_effort` 拒否は本関数とは完全に別枠の判定・縮退（`isReasoningEffortRejection` +
 * `chat()` 内の `reasoningEffortDropped` 一度きりフォールバック）を新設して対応した
 * （下記 `isReasoningEffortRejection` の JSDoc・`chat()` 本体のコメント参照）。
 */
function isStructuredOutputCompatibilityError(status: number, responseBody: string): boolean {
  return (
    (status === 400 || status === 422) &&
    /response[_ -]?format|json[_ -]?schema|strict|structured[_ -]?output/i.test(responseBody)
  );
}

/**
 * `reasoning_effort` パラメータ自体が非対応で拒否されたことを示す 400/422 か
 * （issue #127 PR5 レビュー対応。requirements.md §10 Q11）。
 * `isStructuredOutputCompatibilityError` と同じ「応答本文の部分一致」方式だが、見る語が違う
 * （パラメータ名そのもの）ため独立した関数にする。構造化出力の互換性判定とは無関係に、
 * 任意の利用者指定エンドポイント（localhost の llama.cpp / LM Studio / Ollama 等、厳格な
 * パラメータ検証をしがちなサーバを含む）が `reasoning_effort` を知らずに 400/422 を返す
 * ケースだけを拾う。
 */
function isReasoningEffortRejection(status: number, responseBody: string): boolean {
  return (status === 400 || status === 422) && /reasoning[_ -]?effort/i.test(responseBody);
}

/**
 * OpenAI Chat Completions 互換 API 向け実装。空の API キーでは認証ヘッダーを送らない。
 * Azure OpenAI（issue #127 PR3）もこのクラスを流用する — リクエストボディは OpenAI 互換のままで、
 * 差分は (a) URL がクエリ文字列付き（`normalizeOpenAiCompatibleEndpoint` 側で許可済み）、
 * (b) 認証ヘッダーが `api-key:` である点だけのため、新規 provider クラスは作らない
 * （requirements.md §10 Q11・docs/ui-states.md §2）
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly providerId: LlmProviderId;
  readonly model: string;
  // OpenAI 互換の image_url をパススルーするだけなので画像対応を宣言する。
  // モデルがマルチモーダル非対応の場合は API 側が 4xx を返し、LlmProviderError として表面化する
  readonly supportsImageInput = true;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly authMode: OpenAiCompatibleAuthMode;
  private readonly fetchImpl: typeof fetch | undefined;
  private structuredOutputMode: StructuredOutputMode = 'json_schema_strict';
  private readonly reasoningEffort: ReasoningEffort | null;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.apiKey = options.apiKey.trim();
    this.model = options.model;
    this.endpoint = normalizeOpenAiCompatibleEndpoint(options.endpoint);
    this.fetchImpl = options.fetch;
    this.authMode = options.authMode ?? 'bearer';
    this.reasoningEffort = options.reasoningEffort ?? null;
    // LLMApiLog.provider へ書く値を認証方式に連動させる（Azure 分の run を openai_compatible の
    // ログ・コスト集計へ紛れ込ませない）
    this.providerId = this.authMode === 'azure_api_key' ? 'azure_openai' : 'openai_compatible';
  }

  async chat(messages: readonly ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
    const fetchFn = this.fetchImpl ?? globalThis.fetch;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey !== '') {
      if (this.authMode === 'azure_api_key') {
        headers['api-key'] = this.apiKey;
      } else {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }
    }
    let mode: StructuredOutputMode | undefined = options.responseSchema
      ? this.structuredOutputMode
      : undefined;
    // reasoning_effort 拒否の一度きりの縮退フラグ（issue #127 PR5 レビュー対応。
    // requirements.md §10 Q11）。**構造化出力の `mode` カスケードとは完全に独立させる**:
    // - このフラグを立てても `mode` には一切触れない（＝構造化出力側の再試行余地を消費しない）
    // - `mode` が進んでも本フラグはリセットしない（＝一度落とした reasoning_effort を
    //   「もう一度送ってみる」ことはしない）
    // 両者が同じ `for` ループ・同じ HTTP エラー分岐を共有するのは実装上の都合だが、
    // 1 回のエラーに対して「どちらか一方だけ」を 1 段階進める設計にしてあるため、
    // 両者が互いを再度トリガーし合う（ping-pong する）ことは構造的に起こらない
    // （`reasoningEffortDropped` は false→true の一方向のみ、`mode` も配列を前進するだけで
    // 後退しない。どちらも有限回で尽きるため、最終的に必ず throw で終わる）
    let reasoningEffortDropped = false;

    for (;;) {
      const sendReasoningEffort = !reasoningEffortDropped;
      const res = await fetchFn(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(
          this.buildRequestBody(messages, options, mode, !sendReasoningEffort),
        ),
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

      // reasoning_effort 拒否の判定を構造化出力の判定より先に見る（このリクエストで実際に
      // reasoning_effort を送っていて、かつまだ縮退していないときだけ）。1 回だけ落として
      // 同じ mode のまま再送する（continue。mode は動かさない）
      const effectiveReasoningEffort = options.reasoningEffort ?? this.reasoningEffort;
      if (
        sendReasoningEffort &&
        effectiveReasoningEffort !== null &&
        effectiveReasoningEffort !== undefined &&
        isReasoningEffortRejection(res.status, text)
      ) {
        reasoningEffortDropped = true;
        continue;
      }

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
    structuredOutputMode: StructuredOutputMode | undefined,
    dropReasoningEffort: boolean,
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
    // reasoning effort（issue #127 PR5）。呼び出し 1 回ぶんの ChatOptions.reasoningEffort を
    // construction 時点の既定より優先する。両方とも未指定なら `reasoning_effort` を一切送らない
    // （＝既存ユーザーの body は 1 バイトも変わらない）。`dropReasoningEffort`（chat() の
    // 一度きりフォールバックが立てる）が true のときは、設定の有無に関係なく強制的に省く
    if (!dropReasoningEffort) {
      const reasoningEffort = options.reasoningEffort ?? this.reasoningEffort;
      if (reasoningEffort !== null && reasoningEffort !== undefined) {
        body['reasoning_effort'] = reasoningEffort;
      }
    }
    return body;
  }
}
