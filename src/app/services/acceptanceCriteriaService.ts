// S6 の合格基準の読込・確定・計算を扱う（issue #382）。
// 正典は docs/requirements.md §8「合格基準の事前登録」。
import { confirmCriteria, currentCriteria, emptyCriteriaDraft, evaluateCriteria, validateCriteriaDraft,
  type AcceptanceCriteria, type CriteriaDraft, type CriteriaEvaluation } from '../../features/verification/acceptanceCriteria';
import { appendAcceptanceCriteria, readAcceptanceCriteria } from '../../features/verification/acceptanceCriteriaRepository';
import { buildComparisonCells } from '../../features/verification/aiHumanComparison';
import { readDocuments } from '../../features/documents/documentRepository';
import { readStudies, resolveActiveStudies } from '../../features/documents/studyRepository';
import { readStudyDataSheet, readResultsDataRows } from '../../features/extraction/annotationRepository';
import { readEvidenceRows } from '../../features/extraction/evidenceRepository';
import { countPilotRuns, readCompletedRunMetas, readPilotRuns } from '../../features/extraction/runRepository';
import { listSchemaVersions, getSchemaFieldsByVersion } from '../../features/schema/schemaRepository';
import { getCurrentUserEmail } from '../../lib/google/identity';
import { nowIso8601 } from '../../utils/iso8601';
import { t, type MessageKey } from '../../lib/i18n';
import type { Store } from '../store';
import { withSpreadsheetWriteLock, type VerificationDeps } from './verificationService';

const VALIDATION_MESSAGES: Record<string, MessageKey> = {
  comparator: 'criteria.invalidComparator', entity_levels: 'criteria.invalidLevels', rates_required: 'criteria.ratesRequired',
  min_accuracy: 'criteria.invalidRate', max_fabrication_rate: 'criteria.invalidRate',
  max_omission_rate: 'criteria.invalidRate', max_wrong_value_rate: 'criteria.invalidRate',
  min_compared_cells: 'criteria.invalidCells',
};
const RATE_LABELS: Record<string, MessageKey> = {
  min_accuracy: 'criteria.minAccuracy', max_fabrication_rate: 'criteria.maxFabricationRate',
  max_omission_rate: 'criteria.maxOmissionRate', max_wrong_value_rate: 'criteria.maxWrongValueRate',
};

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface CriteriaState {
  versions: AcceptanceCriteria[] | null;
  ignoredCount: number;
  draft: CriteriaDraft;
  loading: boolean;
  saving: boolean;
  confirming: boolean;
  calculating: boolean;
  error: string | null;
  evaluation: CriteriaEvaluation | null;
  pilotCount: number;
}

export function emptyCriteriaState(): CriteriaState {
  return { versions: null, ignoredCount: 0, draft: emptyCriteriaDraft(), loading: false, saving: false,
    confirming: false, calculating: false, error: null, evaluation: null, pilotCount: 0 };
}

export function criteriaState(store: Store): CriteriaState {
  return store.getState().pilot.criteria ?? emptyCriteriaState();
}

function patch(store: Store, changes: Partial<CriteriaState>): void {
  store.setState({ pilot: { ...store.getState().pilot, criteria: { ...criteriaState(store), ...changes } } });
}

export function changeCriteriaDraft(store: Store, draft: CriteriaDraft): void {
  if (!criteriaState(store).saving && (store.getState().role.role ?? 'owner') === 'owner') {
    patch(store, { draft, confirming: false, error: null });
  }
}

export function cancelCriteriaConfirmation(store: Store): void {
  if (!criteriaState(store).saving) {
    patch(store, { confirming: false });
  }
}

export async function loadCriteria(store: Store, deps: VerificationDeps): Promise<void> {
  const project = store.getState().currentProject;
  if (!project || criteriaState(store).loading) {
    return;
  }
  const id = project.spreadsheetId;
  patch(store, { loading: true, error: null });
  try {
    const [data, pilotCount] = await Promise.all([readAcceptanceCriteria(id, deps.google), countPilotRuns(id, deps.google)]);
    if (store.getState().currentProject?.spreadsheetId === id) {
      patch(store, { ...data, loading: false, pilotCount, evaluation: null });
    }
  } catch (err) {
    if (store.getState().currentProject?.spreadsheetId === id) {
      patch(store, { loading: false, error: toMessage(err) });
    }
  }
}

/** 確認の前にもパイロットを再読込し、確定時の版番号と実績数を保存する。 */
export async function saveCriteria(store: Store, deps: VerificationDeps, confirmed = false): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const form = criteriaState(store);
  if (!project || (state.role.role ?? 'owner') !== 'owner' || form.saving || form.loading ||
      (confirmed && !form.confirming)) {
    return;
  }
  const errors = validateCriteriaDraft(form.draft);
  if (errors.length > 0) {
    const fields = errors.map((error) => t(VALIDATION_MESSAGES[error]!, {
      field: t(RATE_LABELS[error] ?? 'criteria.title'),
    })).join(' ');
    patch(store, { error: t('criteria.invalid', { fields }), confirming: false });
    return;
  }
  const id = project.spreadsheetId;
  patch(store, { saving: true, error: null });
  try {
    await withSpreadsheetWriteLock(id, async () => {
      const [data, pilotCount] = await Promise.all([readAcceptanceCriteria(id, deps.google), countPilotRuns(id, deps.google)]);
      if (store.getState().currentProject?.spreadsheetId !== id) {
        return;
      }
      if (!confirmed) {
        patch(store, { ...data, pilotCount, confirming: true });
        return;
      }
      if ((store.getState().role.role ?? 'owner') !== 'owner') {
        return;
      }
      const email = await getCurrentUserEmail(deps.profile);
      const criteria = confirmCriteria(form.draft, data.versions, email ?? '', (deps.now ?? nowIso8601)(), pilotCount);
      await appendAcceptanceCriteria(id, criteria, deps.google);
      if (store.getState().currentProject?.spreadsheetId === id) {
        patch(store, { versions: [criteria, ...data.versions], ignoredCount: data.ignoredCount,
          confirming: false, evaluation: null, pilotCount });
        store.setState({ export: { ...store.getState().export, built: null } });
      }
    });
  } catch (err) {
    if (store.getState().currentProject?.spreadsheetId === id) {
      patch(store, { error: toMessage(err) });
    }
  } finally {
    if (store.getState().currentProject?.spreadsheetId === id) {
      patch(store, { saving: false });
    }
  }
}

/** 全行の比較は利用者がボタンを押したときにだけ読む。 */
export async function calculateCriteria(store: Store, deps: VerificationDeps): Promise<void> {
  const project = store.getState().currentProject;
  if (!project || criteriaState(store).calculating || criteriaState(store).saving) {
    return;
  }
  const id = project.spreadsheetId;
  patch(store, { calculating: true, error: null, evaluation: null });
  try {
    const [criteria, studies, documents, studySheet, resultRows, evidence, runs, pilots, versions, pilotCount] = await Promise.all([
      readAcceptanceCriteria(id, deps.google), readStudies(id, deps.google), readDocuments(id, deps.google),
      readStudyDataSheet(id, deps.google), readResultsDataRows(id, deps.google), readEvidenceRows(id, deps.google),
      readCompletedRunMetas(id, deps.google), readPilotRuns(id, deps.google), listSchemaVersions(id, deps.google), countPilotRuns(id, deps.google),
    ]);
    const latest = versions[0];
    const fields = latest === undefined ? [] : await getSchemaFieldsByVersion(id, latest.schemaVersion, deps.google);
    const active = resolveActiveStudies(studies, documents);
    const cells = buildComparisonCells({ studies: active, fields, studyRows: studySheet.rows, resultRows, evidence, runs }).cells;
    const current = currentCriteria(criteria.versions);
    const evaluation = current === null ? null : evaluateCriteria(current, cells, pilots, new Set(active.map((study) => study.studyId)));
    if (store.getState().currentProject?.spreadsheetId === id) {
      patch(store, { ...criteria, evaluation, calculating: false, pilotCount });
    }
  } catch (err) {
    if (store.getState().currentProject?.spreadsheetId === id) {
      patch(store, { calculating: false, error: toMessage(err) });
    }
  }
}
