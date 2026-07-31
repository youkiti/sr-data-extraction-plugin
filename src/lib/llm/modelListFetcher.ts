// モデル一覧の自動取得（issue #127 PR4。docs/ui-states.md §2「モデル一覧を取得」ボタン）。
//
// `LLMProvider`（chat() だけを持つ低レベル I/F）には手を加えない。モデル一覧取得は
// 「対応している接続方式だけが持つ別能力」で、chat() を実装する全 provider が持つわけではない
// （gemini / azure_openai は §4-3 の対象外。下記「対応する接続方式」参照）ため、
// 独立したモジュールとして切り出す。
//
// 対応する接続方式（issue #127 §4-3）:
//   - Anthropic: GET https://api.anthropic.com/v1/models（`data[].id` / ページングは
//     `after_id` + `has_more`）
//   - OpenAI 互換 API: GET {base}/v1/models（`data[].id`。base は保存済みの
//     chat completions URL から `deriveOpenAiCompatibleModelsUrl` で機械導出する）
//   - OpenRouter: GET https://openrouter.ai/api/v1/models（`data[].id`。公開エンドポイントで
//     認証不要）
//
// 対応しない接続方式:
//   - gemini: モデル一覧は `MODEL_PRICING`（lib/llm/pricing.ts）に静的収載済みで、
//     取得対象の API も存在しない
//   - azure_openai: 「モデル」ではなくテナント固有の「デプロイメント名」で呼び出す方式のため、
//     一般に列挙可能な「モデル一覧」に相当する概念が無い（実テナントが無く検証もできない。
//     docs/requirements.md §10 Q11）
// `isModelListFetchSupported` で呼び出し側（Options）が対応可否を判定する。
import { ANTHROPIC_VERSION, BROWSER_ACCESS_HEADER } from './AnthropicProvider';
import type { LlmProviderId } from '../../domain/llmApiLog';

/** モデル一覧の自動取得に対応する接続方式 */
export type ModelListFetchProvider = 'anthropic' | 'openrouter' | 'openai_compatible';

/** 対応する接続方式か（gemini / azure_openai は対象外。上記モジュール冒頭コメント参照） */
export function isModelListFetchSupported(
  provider: LlmProviderId,
): provider is ModelListFetchProvider {
  return provider === 'anthropic' || provider === 'openrouter' || provider === 'openai_compatible';
}

export interface ModelListFetchConfig {
  provider: ModelListFetchProvider;
  /** OpenRouter は未使用（公開エンドポイントのため空文字でよい） */
  apiKey: string;
  /** openai_compatible のみ必須: 保存済みの chat completions 完全 URL */
  chatCompletionsUrl?: string;
  /** テスト用の fetch 注入。省略時は globalThis.fetch */
  fetch?: typeof fetch;
}

const ANTHROPIC_MODELS_ENDPOINT = 'https://api.anthropic.com/v1/models';
const OPENROUTER_MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';

/**
 * Anthropic のページング（`after_id` + `has_more`）を辿る際のハードキャップ。
 * 応答不正で `has_more:true` かつ `last_id` が進まない場合の無限ループを避けるための保険で、
 * 通常のカタログ規模（本記述時点で数十件）なら 1 ページ（`page_size` 既定 20 件）で
 * 十分収まる想定。上限（10 ページ = 最大 200 件相当）に達した場合はエラーにはせず、
 * そこまでに集めたモデル ID を返して打ち切る（呼び出し側のセレクタは「取得できた分」で
 * 引き続き使えるようにするため。ui-states.md の「失敗」状態とは異なり、これは部分成功として扱う）
 */
export const ANTHROPIC_MODEL_LIST_MAX_PAGES = 10;

interface AnthropicModelsResponse {
  data?: Array<{ id?: unknown }>;
  has_more?: boolean;
  last_id?: string | null;
}

async function readErrorBody(res: Response): Promise<string> {
  return res.text().catch(() => '');
}

function extractIds(entries: Array<{ id?: unknown }> | undefined): string[] {
  return (entries ?? [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === 'string');
}

/**
 * Anthropic のモデル一覧を取得する。`GET /v1/models` は `/v1/messages` と同じ実 API 制約
 * （AnthropicProvider.ts の BROWSER_ACCESS_HEADER の JSDoc 参照: Origin ヘッダ付きリクエストは
 * `anthropic-dangerous-direct-browser-access: true` が無いと HTTP 401 になる）を受けるため、
 * 同じヘッダ定数をそのまま再利用する（手元での再定義は禁止 — 値がずれると実機でだけ 401 になる）。
 *
 * ページングは `has_more` が true の間 `after_id=last_id` で次ページを辿るが、
 * `ANTHROPIC_MODEL_LIST_MAX_PAGES` に達したら（または `last_id` が取れず継続不能なら）
 * そこで打ち切り、集められた ID だけを返す（上記コメント参照）
 */
export async function fetchAnthropicModelIds(
  apiKey: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<string[]> {
  const ids: string[] = [];
  let afterId: string | undefined;
  for (let page = 0; page < ANTHROPIC_MODEL_LIST_MAX_PAGES; page += 1) {
    const url = new URL(ANTHROPIC_MODELS_ENDPOINT);
    if (afterId !== undefined) {
      url.searchParams.set('after_id', afterId);
    }
    const res = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        [BROWSER_ACCESS_HEADER]: 'true',
      },
    });
    if (!res.ok) {
      const body = await readErrorBody(res);
      throw new Error(
        `Anthropic モデル一覧の取得に失敗しました: HTTP ${res.status}${body ? ` ${body}` : ''}`,
      );
    }
    const json = (await res.json()) as AnthropicModelsResponse;
    ids.push(...extractIds(json.data));
    if (json.has_more !== true) {
      break;
    }
    if (!json.last_id) {
      // has_more:true なのに次ページを指す last_id が無い（応答不正）。継続不能のため打ち切る
      break;
    }
    afterId = json.last_id;
  }
  return ids;
}

/** OpenRouter のモデル一覧を取得する（公開エンドポイント。認証ヘッダーは送らない） */
export async function fetchOpenRouterModelIds(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<string[]> {
  const res = await fetchImpl(OPENROUTER_MODELS_ENDPOINT, { method: 'GET' });
  if (!res.ok) {
    const body = await readErrorBody(res);
    throw new Error(
      `OpenRouter モデル一覧の取得に失敗しました: HTTP ${res.status}${body ? ` ${body}` : ''}`,
    );
  }
  const json = (await res.json()) as { data?: Array<{ id?: unknown }> };
  return extractIds(json.data);
}

/** 末尾がこのパスの chat completions URL だけ `/models` への機械導出を許す */
const CHAT_COMPLETIONS_PATH_SUFFIX = '/chat/completions';

/**
 * 保存済みの OpenAI 互換 chat completions 完全 URL から、モデル一覧エンドポイントの URL を導出する。
 *
 * 導出ルールは 1 つだけ: パスの末尾が `/chat/completions` のときに限り、その部分を `/models` へ
 * 置き換える（クエリ文字列があれば維持する）。この形に一致しない URL（末尾が違う・パスに
 * `/chat/completions` を含まない自己ホスト実装等）は **推測せず** エラーにする —
 * 誤った推測は他人の私設エンドポイントへ意図しない 404 を送りかねないため（issue #127 ブリーフ）。
 */
export function deriveOpenAiCompatibleModelsUrl(chatCompletionsUrl: string): string {
  const url = new URL(chatCompletionsUrl);
  if (!url.pathname.endsWith(CHAT_COMPLETIONS_PATH_SUFFIX)) {
    throw new Error(
      `保存済みのエンドポイント URL（${chatCompletionsUrl}）はパスの末尾が「/chat/completions」ではないため、モデル一覧の URL を推測できません`,
    );
  }
  url.pathname =
    url.pathname.slice(0, -CHAT_COMPLETIONS_PATH_SUFFIX.length) + '/models';
  return url.toString();
}

/**
 * OpenAI 互換 API のモデル一覧を取得する。`chatCompletionsUrl` は保存済みの完全 URL
 * （`settings.openAiCompatibleEndpoint`）をそのまま渡す — URL 導出は
 * `deriveOpenAiCompatibleModelsUrl` に一元化する（呼び出し側で推測しない）
 */
export async function fetchOpenAiCompatibleModelIds(
  chatCompletionsUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<string[]> {
  const url = deriveOpenAiCompatibleModelsUrl(chatCompletionsUrl);
  const headers: Record<string, string> = {};
  if (apiKey !== '') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  const res = await fetchImpl(url, { method: 'GET', headers });
  if (!res.ok) {
    const body = await readErrorBody(res);
    throw new Error(
      `OpenAI 互換 API のモデル一覧の取得に失敗しました: HTTP ${res.status}${body ? ` ${body}` : ''}`,
    );
  }
  const json = (await res.json()) as { data?: Array<{ id?: unknown }> };
  return extractIds(json.data);
}

/** 接続方式に応じたモデル一覧取得の窓口（Options の「モデル一覧を取得」ボタンから呼ぶ） */
export async function fetchModelIds(config: ModelListFetchConfig): Promise<string[]> {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (config.provider === 'anthropic') {
    return fetchAnthropicModelIds(config.apiKey, fetchImpl);
  }
  if (config.provider === 'openrouter') {
    return fetchOpenRouterModelIds(fetchImpl);
  }
  if (config.chatCompletionsUrl === undefined) {
    throw new Error('OpenAI 互換 API のエンドポイント URL が未設定です');
  }
  return fetchOpenAiCompatibleModelIds(config.chatCompletionsUrl, config.apiKey, fetchImpl);
}
