// ExtractionRuns タブに対応する型（requirements.md §3.2）。AI 一括抽出の実行単位
import type { LlmProviderId } from './llmApiLog';

export type RunType = 'pilot' | 'full' | 'single_study';

/** PDF を直接 LLM へ渡すか、抽出済みテキストのみ渡すか（※Q3） */
export type InputMode = 'pdf_native' | 'text_only';

export type RunStatus = 'queued' | 'running' | 'done' | 'partial_failure';

/**
 * arm completeness チェックの警告（issue #106）。応答に `arm:n` が現れる
 * （または ArmStructures 確定済み）のに、その arm の arm レベル項目が揃っていない
 * バッチを機械検出した記録。**warning のみで run の status は partial_failure に
 * 倒さない**（正当な not_reported 等の過検出リスクとのバランス。issue #106 の設計判断）
 */
export interface ArmCompletenessRunWarning {
  kind: 'arm_completeness';
  studyId: string;
  /** section 単位分割バッチの section 名。スキーマ全項目一括なら null */
  section: string | null;
  /** チェックの基準にした arm キー（応答内の自己整合 + ArmStructures 確定分の和集合。昇順） */
  expectedArmKeys: string[];
  /** 応答に返却されなかった (arm キー × arm レベル field) の組 */
  missingItems: { armKey: string; fieldId: string }[];
  /**
   * シート保存時に missingItems を切り詰めた場合の打ち切りマーカー
   * （Sheets のセル 5 万字制限対策。runRepository の warningsToCell が付ける）
   */
  truncated?: boolean;
  /** 切り詰め前の missingItems 総件数（truncated 時のみ付く） */
  missingItemsTotal?: number;
}

/** run 単位の警告（ExtractionRuns.warnings 列に JSON で保持）。現状 arm completeness のみ */
export type RunWarning = ArmCompletenessRunWarning;

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
  /**
   * この run で対象にした field_id 群（issue #80: run 単位のフィールド選択）。
   * シート上はカンマ区切り。**null = 全項目**（後方互換規約。空配列は使わない）。
   * 空セル・列自体が無い旧プロジェクトの行を読むと null になる
   */
  fieldIds: string[] | null;
  /**
   * run 単位の警告（issue #106: arm completeness チェック）。完了行にのみ書く。
   * シート上は JSON 配列。**null = 警告なし**（空配列は使わない。
   * 空セル・列自体が無い旧プロジェクトの行を読むと null になる）
   */
  warnings: RunWarning[] | null;
}
