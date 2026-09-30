// #/dashboard（S9）のサービス層（v0.10 フェーズ 3 = study 単位）。
// 検証対象の素材（verifyService.readVerifyTargetMaterials）を読み込み、
// study × section の進捗マトリクスと anchor 失敗率・not_reported 率へ畳み込む
import { buildDashboard } from '../../features/verification/dashboard';
import type { DashboardState, Store } from '../store';
import type { VerificationDeps } from './verificationService';
import { readVerifyTargetMaterials } from './verifyService';

import { isReviewSetsActive, reviewerSetProgress } from '../../features/review/reviewSets';
import { CALIBRATION_SET_ID } from '../../domain/reviewSet';
import { readReviewSetProgressMaterials, requireReviewSets } from './reviewSetService';

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** dashboard スライスだけを差し替える setState ヘルパ（他スライスは維持） */
function patchDashboard(store: Store, patch: Partial<DashboardState>): void {
  store.setState({ dashboard: { ...store.getState().dashboard, ...patch } });
}

/**
 * dashboard スライスの読込済みキャッシュを無効化する（抽出完了処理から呼ぶ。PR #190 の
 * レビュー対応。verifyService.invalidateVerifyTargets の S9 版）。抽出前に対象 0 件のまま
 * キャッシュされた集計が、抽出完了後も再読込されず残ってしまう問題への対処。
 * `loading` は触らない
 */
export function invalidateDashboard(store: Store): void {
  patchDashboard(store, { data: null, reviewSetProgress: null, loadError: null });
}

/**
 * ダッシュボードの集計を読み込む（初回表示時。読込済みなら no-op、force で強制再取得）。
 * 集計はセルモデル基準（検証画面の進捗チップと同じ数え方）
 */
export async function loadDashboard(
  store: Store,
  deps: VerificationDeps,
  options: { force?: boolean } = {},
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.dashboard.loading) {
    return;
  }
  if (state.dashboard.data !== null && options.force !== true) {
    return;
  }
  patchDashboard(store, { loading: true, loadError: null });
  try {
    await requireReviewSets(store, deps);
    const { materials, runStartedAt } = await readVerifyTargetMaterials(
      store,
      deps,
      project.spreadsheetId,
      { assignedOnly: false },
    );
    // 表示ラベルは target.study（Studies 由来。v0.10）
    const data = buildDashboard(
      materials.map((material) => ({
        studyId: material.target.study.studyId,
        studyLabel: material.target.study.studyLabel,
        fields: material.target.fields,
        evidence: material.target.evidence,
        ownDecisions: material.ownDecisions,
        armStructure: material.armStructure,
      })),
      runStartedAt,
    );
    let progress = null;
    const sets = store.getState().reviewSets.sets ?? [];
    if (sets.length > 0) {
      const material = await readReviewSetProgressMaterials(store, deps);
      if (isReviewSetsActive(material.studies, sets)) {
        // グループの担当者に加え、calibration で実際に判定した human annotator を行にする。
        const calibrationIds = new Set(
          material.studies
            .filter((study) => study.reviewSet === CALIBRATION_SET_ID)
            .map((study) => study.studyId),
        );
        const emails = new Set(
          sets
            .filter((set) => set.setId !== CALIBRATION_SET_ID)
            .flatMap((set) => set.reviewerEmails),
        );
        for (const decision of material.decisions) {
          if (
            calibrationIds.has(decision.studyId) &&
            (decision.annotatorType === 'human_with_ai' ||
              decision.annotatorType === 'human_independent')
          )
            emails.add(decision.annotator);
        }
        progress = reviewerSetProgress({ ...material, sets, reviewerEmails: [...emails].sort() });
      }
    }
    patchDashboard(store, { loading: false, data, reviewSetProgress: progress });
  } catch (err) {
    patchDashboard(store, { loading: false, loadError: toMessage(err) });
  }
}
