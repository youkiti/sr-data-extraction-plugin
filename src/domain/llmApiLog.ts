// LLMApiLog タブに対応する型。sr-query-builder のスキーマを流用し、
// purpose enum のみ本拡張の用途に置き換える（requirements.md §3.2）

/** LLMApiLog / ExtractionRuns に記録する接続方式 */
export type LlmProviderId = 'gemini' | 'openrouter' | 'openai_compatible';

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
