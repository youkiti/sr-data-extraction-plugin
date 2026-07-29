// LLMApiLog タブに対応する型。sr-query-builder のスキーマを流用し、
// purpose enum のみ本拡張の用途に置き換える（requirements.md §3.2）

/**
 * LLMApiLog / ExtractionRuns に記録する接続方式。
 * `anthropic`（issue #127 PR1）: Anthropic ネイティブ（Messages API）。追記型のシートに
 * 新しい値を書き足すだけなので既存行への影響はない。この PR は UI 配線を持たないため、
 * 実際にこの値がシートへ書かれるのはプロバイダ層を直接呼ぶコード（テスト等）のみ
 */
export type LlmProviderId = 'gemini' | 'openrouter' | 'openai_compatible' | 'anthropic';

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
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number | null;
  costEstimateUsd: number | null;
  error: string | null;
}
