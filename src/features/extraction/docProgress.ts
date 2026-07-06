// 一括抽出（S7）の document 単位進捗（ui-states.md §3 `#/extract` 実行中）。
// executeRun の進捗はバッチ単位（RunProgress）のため、計画時のバッチ数と突き合わせて
// 「待機中 / 実行中 / 完了 / 失敗」の 1 document = 1 行へ畳み込む。
// 失敗は最初のバッチ失敗を採用し、以後のバッチが成功しても上書きしない（partial_failure の根拠を残す）
import type { BatchFailure, RunProgress } from './executeRun';
import type { PlannedBatch } from './planRun';

export type ExtractDocStatus = 'queued' | 'running' | 'done' | 'failed';

/** #/extract の進捗リスト 1 行 = 1 document */
export interface ExtractDocRow {
  documentId: string;
  status: ExtractDocStatus;
  /** 処理済みバッチ数（実行中の「バッチ n/m」表示の素材。失敗バッチも数える） */
  completedBatches: number;
  /** 計画上の総バッチ数（計画から除外された document は 0） */
  totalBatches: number;
  /** failed のときの内訳（reason + detail）。それ以外は null */
  detail: string | null;
}

export interface DocProgressTracker {
  /** 現在の全行スナップショット（documentIds の指定順） */
  rows(): ExtractDocRow[];
  /** executeRun の onProgress をそのまま流し込む */
  onProgress(progress: RunProgress): void;
}

/** BatchFailure → 進捗行に併記する内訳文字列（pilotView の失敗表記と同形式） */
export function describeBatchFailure(failure: BatchFailure): string {
  const scope = failure.section === null ? '' : `${failure.section}: `;
  return `${scope}${failure.reason}（${failure.detail}）`;
}

/**
 * document 単位進捗のトラッカーを作る。
 * batches は planRun の計画（runExtraction が内部で再計画しても同一入力なら一致する）。
 * 計画に 1 バッチも現れない document（= スキップ）は最初から failed 扱いにする
 */
export function createDocProgressTracker(
  documentIds: readonly string[],
  batches: readonly PlannedBatch[],
): DocProgressTracker {
  const totals = new Map<string, number>();
  for (const documentId of documentIds) {
    totals.set(documentId, 0);
  }
  for (const batch of batches) {
    const current = totals.get(batch.documentId);
    if (current !== undefined) {
      // 追跡対象（documentIds）の分だけ数える。計画外の documentId は無視する
      totals.set(batch.documentId, current + 1);
    }
  }
  const completed = new Map<string, number>();
  const statuses = new Map<string, Pick<ExtractDocRow, 'status' | 'detail'>>();
  for (const documentId of documentIds) {
    statuses.set(
      documentId,
      totals.get(documentId) === 0
        ? {
            status: 'failed',
            detail: '抽出計画から除外されました（テキスト層がない可能性があります）',
          }
        : { status: 'queued', detail: null },
    );
  }

  return {
    rows: () =>
      documentIds.map((documentId) => ({
        documentId,
        // 追跡対象の status / 総バッチ数はコンストラクタで必ずセット済み
        ...(statuses.get(documentId) as Pick<ExtractDocRow, 'status' | 'detail'>),
        completedBatches: completed.get(documentId) ?? 0,
        totalBatches: totals.get(documentId) as number,
      })),
    onProgress(progress) {
      const row = statuses.get(progress.documentId);
      if (row === undefined) {
        return; // 計画外の document は追跡対象外（契約上は起こらない）
      }
      const done = (completed.get(progress.documentId) ?? 0) + 1;
      completed.set(progress.documentId, done);
      if (row.status === 'failed') {
        return; // 最初の失敗を保持（後続バッチの成否で上書きしない）
      }
      if (progress.failure !== null) {
        statuses.set(progress.documentId, {
          status: 'failed',
          detail: describeBatchFailure(progress.failure),
        });
        return;
      }
      statuses.set(progress.documentId, {
        // 追跡対象の総バッチ数はコンストラクタで必ずセット済み
        status: done >= (totals.get(progress.documentId) as number) ? 'done' : 'running',
        detail: null,
      });
    },
  };
}
