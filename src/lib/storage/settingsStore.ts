// アプリ設定（秘密情報でない値）の保存・読み出し。
// 秘密情報（API キー等）は lib/storage/secretsStore に置き、こちらへは足さない
import { getLocal, removeLocal, setLocal } from './chromeStorage';
import type { LlmProviderId } from '../../domain/llmApiLog';

const DEFAULT_MODEL_STORAGE_KEY = 'settings.defaultModel';
const LLM_PROVIDER_STORAGE_KEY = 'settings.llmProvider';
const OPENAI_COMPATIBLE_ENDPOINT_STORAGE_KEY = 'settings.openAiCompatibleEndpoint';
const HTTP_LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface LlmConnectionSettings {
  /** null は既存環境。モデル ID による従来判定へフォールバックする */
  provider: LlmProviderId | null;
  openAiCompatibleEndpoint: string | null;
}

const LLM_PROVIDERS: ReadonlySet<string> = new Set([
  'gemini',
  'openrouter',
  'openai_compatible',
]);

/**
 * 工場出荷の既定モデル。ユーザーが Options で既定モデルを未設定のとき、S5 スキーマ画面の
 * 初期値として使う（下流の S6 パイロット / S7 一括抽出も S5 のモデルを引き継ぐ）。
 * 実データ抽出ベンチマーク（experiments/extraction-benchmark-real/REPORT.md, 2026-07-06）で
 * gemini-3.5-flash が最良の項目正確度（成功 run 72%）だったため採用。
 * これは注入側（schemaService）で使う定数で、loadDefaultModel は未設定時 null のまま
 * （Options UI が「保存済み / 未設定」を区別できるようにするため）。
 */
export const FACTORY_DEFAULT_MODEL = 'gemini-3.5-flash';

/** 既定モデル設定を読み出す（未設定は null） */
export async function loadDefaultModel(): Promise<string | null> {
  return (await getLocal<string>(DEFAULT_MODEL_STORAGE_KEY)) ?? null;
}

/**
 * trim して保存する。空文字は「未設定に戻す」として削除する
 * （API キーと違い空での解除を許す。docs/ui-states.md §2「既定モデル」）
 */
export async function saveDefaultModel(model: string): Promise<void> {
  const trimmed = model.trim();
  if (trimmed === '') {
    await removeLocal(DEFAULT_MODEL_STORAGE_KEY);
    return;
  }
  await setLocal(DEFAULT_MODEL_STORAGE_KEY, trimmed);
}

/** OpenAI 互換 Chat Completions の完全 URL を検証・正規化する */
export function normalizeOpenAiCompatibleEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('有効な API エンドポイント URL を入力してください');
  }
  const isLoopbackHttp = url.protocol === 'http:' && HTTP_LOOPBACK_HOSTNAMES.has(url.hostname);
  if (url.protocol !== 'https:' && !isLoopbackHttp) {
    throw new Error(
      'API エンドポイントは HTTPS、または localhost / 127.0.0.1 / [::1] の HTTP で指定してください',
    );
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('API エンドポイントに認証情報を含めないでください');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error('API エンドポイントにクエリ文字列やフラグメントを含めないでください');
  }
  return url.toString();
}

/** 認証なし HTTP を許可できる、完全一致の loopback URL か */
export function isLoopbackEndpoint(endpoint: string): boolean {
  const url = new URL(normalizeOpenAiCompatibleEndpoint(endpoint));
  return url.protocol === 'http:' && HTTP_LOOPBACK_HOSTNAMES.has(url.hostname);
}

/** 接続方式と OpenAI 互換 API の URL を読み出す */
export async function loadLlmConnectionSettings(): Promise<LlmConnectionSettings> {
  const rawProvider = await getLocal<string>(LLM_PROVIDER_STORAGE_KEY);
  const provider =
    rawProvider !== undefined && LLM_PROVIDERS.has(rawProvider)
      ? (rawProvider as LlmProviderId)
      : null;
  const endpoint = await getLocal<string>(OPENAI_COMPATIBLE_ENDPOINT_STORAGE_KEY);
  return {
    provider,
    openAiCompatibleEndpoint: endpoint?.trim() ? endpoint : null,
  };
}

/** 接続方式を保存する。OpenAI 互換 API では検証済みの完全 URL も必須 */
export async function saveLlmConnectionSettings(settings: {
  provider: LlmProviderId;
  openAiCompatibleEndpoint?: string | null;
}): Promise<void> {
  if (!LLM_PROVIDERS.has(settings.provider)) {
    throw new Error('未対応の LLM 接続方式です');
  }
  const endpoint =
    settings.provider === 'openai_compatible'
      ? normalizeOpenAiCompatibleEndpoint(settings.openAiCompatibleEndpoint ?? '')
      : null;
  await setLocal(LLM_PROVIDER_STORAGE_KEY, settings.provider);
  if (endpoint !== null) {
    await setLocal(OPENAI_COMPATIBLE_ENDPOINT_STORAGE_KEY, endpoint);
  } else {
    await removeLocal(OPENAI_COMPATIBLE_ENDPOINT_STORAGE_KEY);
  }
}
