// #/dashboard（S9）のサービス層（v0.10 フェーズ 3 = study 単位）。
// 検証対象の素材（verifyService.readVerifyTargetMaterials）を読み込み、
// study × section の進捗マトリクスと anchor 失敗率・not_reported 率へ畳み込む
import { buildDashboard } from '../../features/verification/dashboard';
import type { DashboardState, Store } from '../store';
import type { VerificationDeps } from './verificationService';
import { readVerifyTargetMaterials } from './verifyService';

import {
  isReviewSetsActive,
  reviewSetForStudy,
  reviewerSetProgress,
  currentReviewSets,
} from '../../features/review/reviewSets';
import {
  foldReviewerAssignments,
  readReviewerAssignments,
} from '../../features/project/reviewerRepository';
import { CALIBRATION_SET_ID } from '../../domain/reviewSet';
import { readReviewSetProgressMaterials, requireReviewSets } from './reviewSetService';
import { buildComparisonCells, buildComparisonCellsCsv, buildComparisonSummaryCsv } from '../../features/verification/aiHumanComparison';
import { readStudies, resolveActiveStudies } from '../../features/documents/studyRepository';
import { readDocuments } from '../../features/documents/documentRepository';
import { readStudyDataSheet, readResultsDataRows } from '../../features/extraction/annotationRepository';
import { readEvidenceRows } from '../../features/extraction/evidenceRepository';
import { readCompletedRunMetas } from '../../features/extraction/runRepository';
import { listSchemaVersions, getSchemaFieldsByVersion } from '../../features/schema/schemaRepository';
import { downloadTextFile } from '../ui/download';
import { nowIso8601 } from '../../utils/iso8601';
import { timestampForFilename } from './exportService';

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
  patchDashboard(store, {
    data: null,
    reviewSetProgress: null,
    loadError: null,
    comparison: { loading: false, error: null, data: null },
    usage: {
      ...store.getState().dashboard.usage,
      summary: null,
      budget: null,
      loadError: null,
    },
  });
}

/** 他の人の行を読む比較は、権限を確認してボタン操作時だけ計算する。 */
export async function loadAiHumanComparison(store: Store, deps: VerificationDeps): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const role = state.role.role ?? 'owner';
  if (!project || state.dashboard.comparison.loading ||
      (role !== 'owner' && role !== 'adjudicator')) {
    return;
  }
  patchDashboard(store, { comparison: { loading: true, error: null, data: null } });
  try {
    const id = project.spreadsheetId;
    const [studies, studySheet, resultRows, evidence, runs, versions, documents] = await Promise.all([
      readStudies(id, deps.google), readStudyDataSheet(id, deps.google), readResultsDataRows(id, deps.google),
      readEvidenceRows(id, deps.google), readCompletedRunMetas(id, deps.google), listSchemaVersions(id, deps.google),
      readDocuments(id, deps.google),
    ]);
    const latest = versions[0];
    const fields = latest === undefined ? [] : await getSchemaFieldsByVersion(id, latest.schemaVersion, deps.google);
    const activeStudies = resolveActiveStudies(studies, documents);
    const data = buildComparisonCells({ studies: activeStudies, fields,
      studyRows: studySheet.rows, resultRows, evidence, runs });
    if (store.getState().currentProject?.spreadsheetId === id) {
      patchDashboard(store, { comparison: { loading: false, error: null, data } });
    }
  } catch (err) {
    if (store.getState().currentProject?.spreadsheetId === project.spreadsheetId) {
      patchDashboard(store, { comparison: { loading: false, error: toMessage(err), data: null } });
    }
  }
}

/** 計算済みの比較を UTF-8 CSV として保存する。 */
export function downloadAiHumanComparisonCsv(
  store: Store,
  deps: Pick<VerificationDeps, 'now'>,
  kind: 'summary' | 'cells',
  download: typeof downloadTextFile = downloadTextFile,
): void {
  const state = store.getState();
  const report = state.dashboard.comparison.data;
  const role = state.role.role ?? 'owner';
  if (report === null || (role !== 'owner' && role !== 'adjudicator')) {
    return;
  }
  const timestamp = timestampForFilename((deps.now ?? nowIso8601)());
  download(`ai_human_comparison_${kind}_${timestamp}.csv`,
    kind === 'summary' ? buildComparisonSummaryCsv(report) : buildComparisonCellsCsv(report.cells), 'text/csv');
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
    const { materials, runStartedAt, annotator } = await readVerifyTargetMaterials(
      store,
      deps,
      project.spreadsheetId,
      { assignedOnly: false, force: options.force },
    );
    // 要相談の一覧（issue #424）: オーナー・裁定者には全レビュアーの印を出す。
    // レビュアーは従来どおり自分の印だけ（reviewerDecisions を渡さない）
    const role = store.getState().role.role ?? 'owner';
    const seesAllConsults = role === 'owner' || role === 'adjudicator';
    // 表示ラベルは target.study（Studies 由来。v0.10）
    const data = buildDashboard(
      materials.map((material) => ({
        studyId: material.target.study.studyId,
        studyLabel: material.target.study.studyLabel,
        fields: material.target.fields,
        evidence: material.target.evidence,
        ownDecisions: material.ownDecisions,
        armStructure: material.armStructure,
        ...(seesAllConsults && material.studyDecisions !== undefined
          ? { reviewerDecisions: material.studyDecisions, self: annotator ?? '' }
          : {}),
      })),
      runStartedAt,
    );
    let progress = null;
    let sets = store.getState().reviewSets.sets ?? [];
    if (sets.length > 0) {
      const material = await readReviewSetProgressMaterials(store, deps, options);
      if (isReviewSetsActive(material.activeStudies, sets)) {
        // 登録済みの担当者は、まだ判定を始めていなくても calibration の行に含める。
        sets = currentReviewSets(material.studies, sets);
        const calibrationIds = new Set(
          material.studies
            .filter((study) => reviewSetForStudy(study, sets) === CALIBRATION_SET_ID)
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
        const registered = foldReviewerAssignments(
          await readReviewerAssignments(project.spreadsheetId, deps.google),
        );
        for (const reviewer of registered) {
          if (reviewer.role !== 'revoked') emails.add(reviewer.email);
        }
        progress = reviewerSetProgress({ ...material, sets, reviewerEmails: [...emails].sort() });
      }
    }
    patchDashboard(store, { loading: false, data, reviewSetProgress: progress });
  } catch (err) {
    patchDashboard(store, { loading: false, loadError: toMessage(err) });
  }
}
