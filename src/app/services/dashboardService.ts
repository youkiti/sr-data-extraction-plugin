// #/dashboard（S9）のサービス層。
// 検証対象の素材（verifyService.readVerifyTargetMaterials）を読み込み、
// document × section の進捗マトリクスと anchor 失敗率・not_reported 率へ畳み込む
import { readStudies, studyLabelMap } from '../../features/documents/studyRepository';
import { buildDashboard } from '../../features/verification/dashboard';
import type { DashboardState, Store } from '../store';
import type { VerificationDeps } from './verificationService';
import { readVerifyTargetMaterials } from './verifyService';

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** dashboard スライスだけを差し替える setState ヘルパ（他スライスは維持） */
function patchDashboard(store: Store, patch: Partial<DashboardState>): void {
  store.setState({ dashboard: { ...store.getState().dashboard, ...patch } });
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
    const materials = await readVerifyTargetMaterials(store, deps, project.spreadsheetId);
    // 表示ラベルは Studies 由来（v0.10）。document.study_id から引き当てる
    const labels = studyLabelMap(await readStudies(project.spreadsheetId, deps.google));
    const data = buildDashboard(
      materials.map((material) => ({
        document: material.target.document,
        studyLabel: labels.get(material.target.document.studyId) ?? material.target.document.studyId,
        fields: material.target.fields,
        evidence: material.target.evidence,
        ownDecisions: material.ownDecisions,
        armStructure: material.armStructure,
      })),
    );
    patchDashboard(store, { loading: false, data });
  } catch (err) {
    patchDashboard(store, { loading: false, loadError: toMessage(err) });
  }
}
