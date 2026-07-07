// ExtractionRuns タブに対応する型（requirements.md §3.2）。AI 一括抽出の実行単位
import type { LlmProviderId } from './llmApiLog';

export type RunType = 'pilot' | 'full' | 'single_study';

/** PDF を直接 LLM へ渡すか、抽出済みテキストのみ渡すか（※Q3） */
export type InputMode = 'pdf_native' | 'text_only';

export type RunStatus = 'queued' | 'running' | 'done' | 'partial_failure';

/**
 * audit.csv の Evidence 結合（buildAuditCsv）と runRepository.readRunAuditInfos が共有する
 * run の最小情報。schema_version の突合と started_at の新旧比較にだけ使う
 */
export type RunAuditInfo = Pick<ExtractionRun, 'runId' | 'schemaVersion' | 'startedAt'>;

export interface ExtractionRun {
  runId: string;
  runType: RunType;
  schemaVersion: number;
  /** シート上はカンマ区切りで保持する。抽出単位 = study（v0.10 で document_ids から改名） */
  studyIds: string[];
  provider: LlmProviderId;
  requestedModel: string;
  /** API 応答から記録する実モデル版 */
  modelVersion: string | null;
  inputMode: InputMode;
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  /** 実行前にコスト概算を UI 表示する */
  costEstimate: number | null;
}
