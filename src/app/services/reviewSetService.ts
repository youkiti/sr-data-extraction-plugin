// 担当セットのロード・owner の割り当て操作・進捗素材の読み込み。
// 非 owner はロード失敗時に処理を止め、担当外の研究を表示・許可しない。
import type { ConfirmedArmStructure } from '../../domain/armStructure';
import type { DocumentRecord } from '../../domain/document';
import { CALIBRATION_SET_ID, groupSetId, type ReviewSetRow } from '../../domain/reviewSet';
import type { StudyRecord } from '../../domain/study';
import { readDocuments } from '../../features/documents/documentRepository';
import {
  readStudies,
  resolveActiveStudies,
  updateStudyReviewSets,
} from '../../features/documents/studyRepository';
import {
  appendReviewSetRows,
  foldReviewSets,
  readReviewSetRows,
} from '../../features/project/reviewSetRepository';
import { loadProjectMeta } from '../../features/project/selectProject';
import {
  generateSeed,
  isReviewSetsActive,
  splitIntoReviewSets,
  visibleStudyIdsForReviewer,
} from '../../features/review/reviewSets';
import {
  getSchemaFieldsByVersion,
  listSchemaVersions,
} from '../../features/schema/schemaRepository';
import {
  latestArmStructure,
  readAllArmStructures,
} from '../../features/verification/armStructureRepository';
import { readAllDecisions } from '../../features/verification/decisionRepository';
import { getCurrentUserEmail, type ProfileDeps } from '../../lib/google/identity';
import type { GoogleApiDeps } from '../../lib/google/types';
import { t } from '../../lib/i18n';
import { nowIso8601 } from '../../utils/iso8601';
import type { ReviewSetsState, Store } from '../store';
import { showToast } from '../ui/toast';

export interface ReviewSetServiceDeps {
  google: GoogleApiDeps;
  profile: ProfileDeps;
  now?: () => string;
}

function patch(store: Store, values: Partial<ReviewSetsState>): void {
  store.setState({ reviewSets: { ...store.getState().reviewSets, ...values } });
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
const pendingLoads = new WeakMap<Store, Promise<void>>();

/** 全ロールで読み込む。同じ store の並行ローダーは同じ完了を待つ */
export async function loadReviewSets(
  store: Store,
  deps: Pick<ReviewSetServiceDeps, 'google'>,
  options: { force?: boolean } = {},
): Promise<void> {
  const pending = pendingLoads.get(store);
  if (pending !== undefined) return pending;
  const state = store.getState();
  const project = state.currentProject;
  if (
    !project ||
    state.reviewSets.loading ||
    ((state.reviewSets.sets !== null || state.reviewSets.error !== null) && !options.force)
  )
    return;
  patch(store, { loading: true, error: null });
  const load = (async () => {
    try {
      const [rows, meta] = await Promise.all([
        readReviewSetRows(project.spreadsheetId, deps.google),
        loadProjectMeta(project.spreadsheetId, deps.google),
      ]);
      const folded = foldReviewSets(rows, meta.createdBy);
      // キャッシュ済みなら冒頭で終了する。実際に再取得した成功結果は派生値を更新する。
      invalidateAssignments(store);
      // 並行した文献再読込が新しい Studies を反映済みなら、その結果は保持する。
      if (store.getState().documents.studies === state.documents.studies) {
        store.setState({ documents: { ...store.getState().documents, studies: null } });
      }
      patch(store, { ...folded, loading: false });
    } catch (error) {
      invalidateAssignments(store);
      patch(store, { sets: null, loading: false, error: message(error) });
    }
  })();
  pendingLoads.set(store, load);
  await load;
  pendingLoads.delete(store);
}

/** 実セッションのロール解決後に使う。owner は失敗を未有効化扱いに縮退する */
export async function requireReviewSets(
  store: Store,
  deps: Pick<ReviewSetServiceDeps, 'google'>,
): Promise<void> {
  if (store.getState().role.role === null) return;
  await loadReviewSets(store, deps);
  const state = store.getState();
  if (
    state.role.role !== 'owner' &&
    (state.reviewSets.sets === null || state.reviewSets.error !== null)
  ) {
    throw new Error(state.reviewSets.error ?? t('reviewSets.notLoaded'));
  }
}

/** 絞り込みに必要な Studies を確保する。タブが空なら追加 I/O は不要 */
export async function reviewSetStudies(
  store: Store,
  deps: Pick<ReviewSetServiceDeps, 'google'>,
  options: { force?: boolean } = {},
): Promise<StudyRecord[]> {
  const state = store.getState();
  if (state.documents.studies !== null && !options.force) return state.documents.studies;
  const project = state.currentProject;
  if (
    !project ||
    (!options.force && (state.reviewSets.sets === null || state.reviewSets.sets.length === 0))
  )
    return [];
  const studies = await readStudies(project.spreadsheetId, deps.google);
  store.setState({ documents: { ...store.getState().documents, studies } });
  return studies;
}

/** 非 owner は絞り込みの直前にもロード状態を確認する */
export function reviewSetsForFiltering(store: Store, assignedOnly: boolean): ReviewSetRow[] {
  const state = store.getState();
  if (
    assignedOnly &&
    state.role.role !== null &&
    state.role.role !== 'owner' &&
    (state.reviewSets.sets === null || state.reviewSets.error !== null)
  ) {
    throw new Error(state.reviewSets.error ?? t('reviewSets.notLoaded'));
  }
  return state.reviewSets.error === null ? (state.reviewSets.sets ?? []) : [];
}

/** 担当対象を返す。非有効化プロジェクトは従来の全件を維持する */
export function filterReviewSetStudies(
  store: Store,
  studies: readonly StudyRecord[],
  documents: readonly DocumentRecord[],
  email: string,
  assignedOnly: boolean,
): StudyRecord[] {
  const sets = reviewSetsForFiltering(store, assignedOnly);
  const active = resolveActiveStudies(studies, documents);
  if (!assignedOnly || !isReviewSetsActive(active, sets)) return [...studies];
  const visible = new Set(visibleStudyIdsForReviewer(email, active, sets));
  return studies.filter((study) => visible.has(study.studyId));
}

/** Home と dashboard が共有する、AI 抽出の有無に依存しない判定進捗の素材 */
export async function readReviewSetProgressMaterials(
  store: Store,
  deps: Pick<ReviewSetServiceDeps, 'google'>,
  options: { force?: boolean } = {},
) {
  const project = store.getState().currentProject;
  if (!project) throw new Error(t('reviewSets.notLoaded'));
  const documents = options.force
    ? await readDocuments(project.spreadsheetId, deps.google)
    : (store.getState().documents.records ??
      (await readDocuments(project.spreadsheetId, deps.google)));
  const studies = await reviewSetStudies(store, deps, options);
  const active = resolveActiveStudies(studies, documents);
  const versions = await listSchemaVersions(project.spreadsheetId, deps.google);
  const fields =
    versions[0] === undefined
      ? []
      : await getSchemaFieldsByVersion(
          project.spreadsheetId,
          versions[0].schemaVersion,
          deps.google,
        );
  const decisions = await readAllDecisions(project.spreadsheetId, deps.google);
  const armRows = await readAllArmStructures(project.spreadsheetId, deps.google);
  const armStructures = new Map<string, ReadonlyMap<string, ConfirmedArmStructure>>();
  for (const studyId of new Set(armRows.map((row) => row.studyId))) {
    const rows = armRows.filter((row) => row.studyId === studyId);
    armStructures.set(
      studyId,
      new Map(
        [...new Set(rows.map((row) => row.annotator))].map((email) => [
          email,
          latestArmStructure(rows, email) as ConfirmedArmStructure,
        ]),
      ),
    );
  }
  return { studies: active, fields, decisions, armStructures };
}

/** 割り当てが変わったとき、対象一覧と派生集計のキャッシュを破棄する */
function invalidateAssignments(store: Store): void {
  const state = store.getState();
  void state.verify.verification?.disposePdf?.();
  void state.adjudicate.working?.disposePdf();
  store.setState({
    verify: {
      ...state.verify,
      targets: null,
      selectedStudyId: null,
      verification: null,
      loadError: null,
      verifyError: null,
      studyValues: null,
      studyRowUpdatedAt: null,
      resultsRowUpdatedAt: {},
      conflictMessage: null,
    },
    home: { ...state.home, assignedProgress: null, assignedProgressError: null },
    dashboard: { ...state.dashboard, data: null, reviewSetProgress: null },
    adjudicate: {
      ...state.adjudicate,
      rows: null,
      selectedStudyId: null,
      working: null,
      workingError: null,
      pairSelections: {},
      agreement: null,
      calibrationAgreement: null,
      agreementOutsideCount: 0,
    },
  });
}

async function save(
  store: Store,
  deps: ReviewSetServiceDeps,
  action: (spreadsheetId: string, email: string) => Promise<void | boolean>,
): Promise<void> {
  const state = store.getState();
  if (!state.currentProject || state.role.role !== 'owner' || state.reviewSets.saving) return;
  patch(store, { saving: true, saveError: null });
  try {
    await requireReviewSets(store, deps);
    const loaded = store.getState().reviewSets;
    if (loaded.sets === null || loaded.error !== null)
      throw new Error(loaded.error ?? t('reviewSets.notLoaded'));
    const email = await getCurrentUserEmail(deps.profile);
    if (!email) throw new Error(t('reviewSets.emailRequired'));
    const saved = await action(state.currentProject.spreadsheetId, email);
    patch(store, { saving: false });
    if (saved !== false) invalidateAssignments(store);
  } catch (error) {
    patch(store, { saving: false, saveError: message(error) });
    showToast(t('home.toastSaveFailed', { reason: message(error) }));
  }
}

async function executeSplit(
  store: Store,
  deps: ReviewSetServiceDeps,
  input: { calibrationCount: number; groupCount: number },
  confirmed = false,
): Promise<void> {
  await save(store, deps, async (spreadsheetId, email) => {
    const documents =
      store.getState().documents.records ?? (await readDocuments(spreadsheetId, deps.google));
    const studies =
      store.getState().documents.studies ?? (await readStudies(spreadsheetId, deps.google));
    const active = resolveActiveStudies(studies, documents);
    if (!confirmed && isReviewSetsActive(active, store.getState().reviewSets.sets!)) {
      patch(store, { confirmingResplit: input });
      return false;
    }
    const seed = generateSeed();
    const assignments = splitIntoReviewSets(
      active.map((study) => study.studyId),
      { ...input, seed },
    );
    const existing = store.getState().reviewSets.sets!;
    const ids = [
      CALIBRATION_SET_ID,
      ...Array.from({ length: input.groupCount }, (_, i) => groupSetId(i + 1)),
    ];
    const updatedAt = (deps.now ?? nowIso8601)();
    const rows = [...new Set([...ids, ...existing.map((set) => set.setId)])].map(
      (setId): ReviewSetRow => ({
        setId,
        reviewerEmails: existing.find((set) => set.setId === setId)?.reviewerEmails ?? [],
        seed: ids.includes(setId) ? seed : null,
        studyIds: [...assignments].filter(([, assigned]) => assigned === setId).map(([id]) => id),
        updatedBy: email,
        updatedAt,
      }),
    );
    try {
      await appendReviewSetRows(spreadsheetId, rows, deps.google);
      // updateStudyReviewSets がヘッダー移行を済ませてから全対象を一括更新する。
      await updateStudyReviewSets(
        spreadsheetId,
        [...assignments].map(([studyId, reviewSet]) => ({ studyId, reviewSet })),
        deps.google,
      );
    } catch (error) {
      // 片方だけ保存できた場合も、シートの実値へ戻してから元の保存エラーを表示する。
      await loadReviewSets(store, deps, { force: true });
      store.setState({ documents: { ...store.getState().documents, studies: null } });
      try {
        await reviewSetStudies(store, deps, { force: true });
      } catch (reloadError) {
        store.setState({
          documents: { ...store.getState().documents, loadError: message(reloadError) },
        });
      }
      throw error;
    }
    store.setState({
      documents: {
        ...store.getState().documents,
        records: documents,
        studies: studies.map((study) =>
          assignments.has(study.studyId)
            ? { ...study, reviewSet: assignments.get(study.studyId) as string }
            : study,
        ),
      },
    });
    patch(store, {
      sets: foldReviewSets([...existing, ...rows], email).sets,
      confirmingResplit: null,
    });
  });
}

export async function splitReviewSets(
  store: Store,
  deps: ReviewSetServiceDeps,
  input: { calibrationCount: number; groupCount: number },
): Promise<void> {
  await executeSplit(store, deps, input);
}
export async function confirmResplit(store: Store, deps: ReviewSetServiceDeps): Promise<void> {
  const input = store.getState().reviewSets.confirmingResplit;
  if (input !== null) await executeSplit(store, deps, input, true);
}
export function cancelResplit(store: Store): void {
  patch(store, { confirmingResplit: null });
}

export async function saveReviewSetEmails(
  store: Store,
  deps: ReviewSetServiceDeps,
  setId: string,
  emails: string[],
): Promise<void> {
  await save(store, deps, async (spreadsheetId, email) => {
    const normalized = emails.map((value) => value.trim());
    if (normalized.some((value) => !/^[^\s@]+@[^\s@]+$/.test(value)))
      throw new Error(t('reviewSets.emailInvalid'));
    const sets = store.getState().reviewSets.sets!;
    if (!sets.some((set) => set.setId === setId)) throw new Error(t('reviewSets.unknownSet'));
    const row = {
      setId,
      reviewerEmails: [...new Set(normalized)],
      seed: null,
      studyIds: null,
      updatedBy: email,
      updatedAt: (deps.now ?? nowIso8601)(),
    };
    await appendReviewSetRows(spreadsheetId, [row], deps.google);
    patch(store, { sets: foldReviewSets([...sets, row], email).sets });
  });
}
export async function assignStudyReviewSet(
  store: Store,
  deps: ReviewSetServiceDeps,
  studyId: string,
  setId: string | null,
): Promise<void> {
  await save(store, deps, async (spreadsheetId, email) => {
    const sets = store.getState().reviewSets.sets!;
    if (setId !== null && !sets.some((set) => set.setId === setId))
      throw new Error(t('reviewSets.unknownSet'));
    const studies =
      store.getState().documents.studies ?? (await readStudies(spreadsheetId, deps.google));
    if (!studies.some((study) => study.studyId === studyId))
      throw new Error(t('reviewSets.unknownStudy'));
    await replaceReviewSetStudies(store, deps, [studyId], studyId, setId, email);
    await updateStudyReviewSets(spreadsheetId, [{ studyId, reviewSet: setId }], deps.google);
    store.setState({
      documents: {
        ...store.getState().documents,
        studies: studies.map((study) =>
          study.studyId === studyId ? { ...study, reviewSet: setId } : study,
        ),
      },
    });
  });
}

/** 統合・個別割当で影響するセットの所属を追記し、派生値を破棄する */
export async function replaceReviewSetStudies(
  store: Store,
  deps: Pick<ReviewSetServiceDeps, 'google' | 'now'>,
  sourceIds: readonly string[],
  studyId: string,
  setId: string | null,
  email: string,
): Promise<void> {
  const state = store.getState();
  const sets = state.reviewSets.sets ?? [];
  const rows = sets
    .filter((set) => set.setId === setId || set.studyIds?.some((id) => sourceIds.includes(id)))
    .map((set): ReviewSetRow => ({
      ...set,
      seed: null,
      studyIds: [
        ...(set.studyIds ?? []).filter((id) => !sourceIds.includes(id)),
        ...(set.setId === setId ? [studyId] : []),
      ],
      updatedBy: email,
      updatedAt: (deps.now ?? nowIso8601)(),
    }));
  await appendReviewSetRows(state.currentProject!.spreadsheetId, rows, deps.google);
  patch(store, { sets: foldReviewSets([...sets, ...rows], sets[0]?.updatedBy ?? email).sets });
  invalidateAssignments(store);
}
