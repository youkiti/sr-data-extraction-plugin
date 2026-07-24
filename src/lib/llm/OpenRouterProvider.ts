import {
  LlmProviderError,
  toOpenAiContent,
  type ChatMessage,
  type ChatOptions,
  type ChatResponse,
  type LLMProvider,
  type LlmFailureKind,
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

/**
 * HTTP エラー応答（`!res.ok`）からの失敗種別判定（実データ抽出の失敗ヒント）。
 * 現状わかっているのは HTTP 404 の画像入力非対応エラーだけ（実物:
 * `{"error":{"message":"No endpoints found that support image input","code":404}}`）。
 * `bodyText` を JSON としてパースし、`error.message` フィールドの内容だけを見る
 * （表示用に切り詰められる `responseBody` や `detail` の部分一致とは違い、ここは切り詰め前の
 * フルボディを構造化フィールド越しに見ているため、任意の上流エラーを誤検出しない）。
 * 404 以外・JSON として読めない・該当メッセージが無いときは null（不明）。
 *
 * この判定だけは `LlmFailureKind`（LLMProvider.ts）の「エラー本文の部分一致では判定しない」
 * 方針の唯一の例外: OpenRouter の 404 応答には `error.message` の人間向け文言以外に
 * 構造化シグナルが実在しないため、明記した best-effort 判定として `/image input/i` への
 * 部分一致を許容する。OpenRouter 側の文言が変わった場合は誤分類（他の理由を image_unsupported と
 * 誤検出する）ではなく null（ヒント非表示）に倒れる fail-open な設計にしてある
 * （メッセージが一致しなくなるだけで、上の分岐がそのまま null を返す）
 */
function classifyHttpErrorFailureKind(status: number, bodyText: string): LlmFailureKind | null {
  if (status !== 404) {
    return null;
  }
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: unknown } };
    const message = parsed.error?.message;
    if (typeof message === 'string' && /image input/i.test(message)) {
      return 'image_unsupported';
    }
  } catch {
    // JSON として読めなければ判定不能（不明のまま null で返す）
  }
  return null;
}

/**
 * `choice.error`（プロバイダ側エラーで choice が終わった場合。OpenRouter 仕様）からの
 * 失敗種別判定。具体的なシグナル（`metadata.error_type` / HTTP 相当の `code`）を先に見る。
 * `finish_reason=error` 自体は timeout に限らず任意の上流エラーを含みうる汎用フォールバックのため、
 * 該当しなければ null（理由不明）のまま返し、timeout と誤分類しない
 */
function classifyChoiceErrorFailureKind(choice: OpenRouterChoice | undefined): LlmFailureKind | null {
  const error = choice?.error;
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const metadata = (error as { metadata?: unknown }).metadata;
  const errorType =
    typeof metadata === 'object' && metadata !== null
      ? (metadata as { error_type?: unknown }).error_type
      : undefined;
  const code = (error as { code?: unknown }).code;
  if (errorType === 'timeout' || code === 504) {
    return 'timeout';
  }
  return null;
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
        parseRetryAfterMs(res.headers.get('retry-after')),
        false,
        // HTTP 404 の画像入力非対応エラー（実測済み）だけを判別する。それ以外は不明のまま
        classifyHttpErrorFailureKind(res.status, text),
      );
    }
    // 応答ボディの検査（issue #187）: 実プロジェクトで「HTTP 200 なのにボディが途切れて
    // JSON として読めない」「choice がプロバイダ側エラー/打ち切りで content が空」が
    // 頻発したため、裸の SyntaxError や空文字を返さず、原因（finish_reason / error）を
    // 載せた LlmProviderError にする。長時間生成の切断は一時的な可能性があるため retryable。
    // 失敗種別（LlmFailureKind）の判定順: 具体的なシグナル（choice.error の error_type/code、
    // finish_reason の length/content_filter）を先に見る。finish_reason の length/content_filter は
    // content が null（空本文）で終わる応答が一般的なため、空 content チェックより前に判定する
    // （レビュー指摘: 順序が逆だと content:null + finish_reason=content_filter が理由不明のまま
    // 空本文エラーに落ちてしまう）。finish_reason=error のような汎用フォールバックは
    // 「理由不明」（null）に倒す（error は timeout に限らず任意の上流エラーを含みうるため、
    // 安易に timeout と決め打ちしない）
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
        'malformed',
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
        classifyChoiceErrorFailureKind(choice),
      );
    }
    if (finishReason === 'length' || finishReason === 'content_filter') {
      const reasonLabel = finishReason === 'length' ? '出力トークン上限' : 'コンテンツフィルタ';
      throw new LlmProviderError(
        `OpenRouter 応答が${reasonLabel}で打ち切られました（finish_reason=${finishReason}）`,
        this.providerId,
        res.status,
        describeChoice(choice),
        null,
        false,
        finishReason === 'length' ? 'output_limit' : 'content_filter',
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
