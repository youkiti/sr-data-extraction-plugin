// 一括抽出（S7）の study 単位進捗（ui-states.md §3 `#/extract` 実行中）。
// executeRun の進捗はバッチ単位（RunProgress。1 バッチ = 1 study）のため、計画時のバッチ数と
// 突き合わせて「待機中 / 実行中 / 完了 / 失敗」の 1 study = 1 行へ畳み込む。
// 失敗は最初のバッチ失敗を採用し、以後のバッチが成功しても上書きしない（partial_failure の根拠を残す）
import type { LlmFailureKind } from '../../lib/llm/LLMProvider';
import type { BatchFailure, RunProgress } from './executeRun';
import type { PlannedBatch } from './planRun';

export type ExtractStudyStatus = 'queued' | 'running' | 'done' | 'failed';

/** #/extract の進捗リスト 1 行 = 1 study */
export interface ExtractStudyRow {
  studyId: string;
  status: ExtractStudyStatus;
  /** 処理済みバッチ数（実行中の「バッチ n/m」表示の素材。失敗バッチも数える） */
  completedBatches: number;
  /** 計画上の総バッチ数（計画から除外された study は 0） */
  totalBatches: number;
  /** failed のときの内訳（reason + detail）。それ以外は null */
  detail: string | null;
  /**
   * failed のときの失敗種別コード（S7 の失敗行ヒント表示の素材）。
   * 翻訳済み文字列ではなくコードを持たせる（言語切替に追従させるため、翻訳は View 側で行う）。
   * 種別が不明・failed 以外は null
   */
  failureKind: LlmFailureKind | null;
}

export interface StudyProgressTracker {
  /** 現在の全行スナップショット（studyIds の指定順） */
  rows(): ExtractStudyRow[];
  /** executeRun の onProgress をそのまま流し込む */
  onProgress(progress: RunProgress): void;
}

/** BatchFailure → 進捗行に併記する内訳文字列（pilotView の失敗表記と同形式） */
export function describeBatchFailure(failure: BatchFailure): string {
  const scope = failure.section === null ? '' : `${failure.section}: `;
  return `${scope}${failure.reason}（${failure.detail}）`;
}

/**
 * study 単位進捗のトラッカーを作る。
 * batches は planRun の計画（runExtraction が内部で再計画しても同一入力なら一致する）。
 * 計画に 1 バッチも現れない study（= 全文書テキスト層なしで除外）は最初から failed 扱いにする
 */
export function createStudyProgressTracker(
  studyIds: readonly string[],
  batches: readonly PlannedBatch[],
): StudyProgressTracker {
  const totals = new Map<string, number>();
  for (const studyId of studyIds) {
    totals.set(studyId, 0);
  }
  for (const batch of batches) {
    const current = totals.get(batch.studyId);
    if (current !== undefined) {
      // 追跡対象（studyIds）の分だけ数える。計画外の studyId は無視する
      totals.set(batch.studyId, current + 1);
    }
  }
  const completed = new Map<string, number>();
  const statuses = new Map<string, Pick<ExtractStudyRow, 'status' | 'detail' | 'failureKind'>>();
  for (const studyId of studyIds) {
    statuses.set(
      studyId,
      totals.get(studyId) === 0
        ? {
            status: 'failed',
            detail: '抽出計画から除外されました（テキスト層のある文書がありません）',
            failureKind: null,
          }
        : { status: 'queued', detail: null, failureKind: null },
    );
  }

  return {
    rows: () =>
      studyIds.map((studyId) => ({
        studyId,
        // 追跡対象の status / 総バッチ数はコンストラクタで必ずセット済み
        ...(statuses.get(studyId) as Pick<ExtractStudyRow, 'status' | 'detail' | 'failureKind'>),
        completedBatches: completed.get(studyId) ?? 0,
        totalBatches: totals.get(studyId) as number,
      })),
    onProgress(progress) {
      const row = statuses.get(progress.studyId);
      if (row === undefined) {
        return; // 計画外の study は追跡対象外（契約上は起こらない）
      }
      const done = (completed.get(progress.studyId) ?? 0) + 1;
      completed.set(progress.studyId, done);
      if (row.status === 'failed') {
        return; // 最初の失敗を保持（後続バッチの成否で上書きしない）
      }
      if (progress.failure !== null) {
        statuses.set(progress.studyId, {
          status: 'failed',
          detail: describeBatchFailure(progress.failure),
          // BatchFailure.failureKind は必須 + `| null`（不明時は null）のためそのまま使える
          failureKind: progress.failure.failureKind,
        });
        return;
      }
      statuses.set(progress.studyId, {
        // 追跡対象の総バッチ数はコンストラクタで必ずセット済み
        status: done >= (totals.get(progress.studyId) as number) ? 'done' : 'running',
        detail: null,
        failureKind: null,
      });
    },
  };
}
