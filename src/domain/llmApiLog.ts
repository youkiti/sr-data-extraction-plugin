// LLMApiLog タブに対応する型。sr-query-builder のスキーマを流用し、
// purpose enum のみ本拡張の用途に置き換える（requirements.md §3.2）

/**
 * LLMApiLog / ExtractionRuns に記録する接続方式。
 * `anthropic`（issue #127 PR1・PR2 で Options 配線済み）: Anthropic ネイティブ（Messages API）。
 * `azure_openai`（issue #127 PR3）: Azure OpenAI。`OpenAICompatibleProvider` を認証方式だけ
 * 切り替えて流用する（新規 provider クラスは作らない。requirements.md §10 Q11）。
 * いずれも追記型のシートに新しい値を書き足すだけなので既存行への影響はない
 */
export type LlmProviderId = 'gemini' | 'openrouter' | 'openai_compatible' | 'anthropic' | 'azure_openai';

export type LlmPurpose =
  | 'draft_schema'
  | 'suggest_study_label'
  | 'extract_study'
  | 'relocate_quote'
  | 'other';

export interface LlmApiLogEntry {
  logId: string;
  timestamp: string;
  provider: LlmProviderId;
  model: string;
  purpose: LlmPurpose;
  /** フル payload は Drive の logs/llm/{log_id}.json。シートには URL のみ */
  promptRef: string;
  responseRef: string;
  promptSummary: string | null;
  /** プロンプト側の総トークン数（キャッシュヒット分を含む。ChatResponse.tokensIn と同契約） */
  tokensIn: number | null;
  tokensOut: number | null;
  /**
   * tokensIn のうちプロンプトキャッシュから読まれた分（内数）。
   * null = プロバイダがキャッシュ情報を返さなかった（不明）、0 = 返したがヒット 0 件。
   * ヒット率の実測（キャッシュが効かなくなった退行の検出）に使う
   */
  cachedTokensIn: number | null;
  latencyMs: number | null;
  costEstimateUsd: number | null;
  error: string | null;
}
