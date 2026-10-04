import type { Decision } from '../../domain/decision';
import type { Evidence } from '../../domain/evidence';
import type { ExtractionRun } from '../../domain/extractionRun';
import { readEvidenceRows } from '../../features/extraction/evidenceRepository';
import { readAllDecisions } from '../../features/verification/decisionRepository';
import { getCurrentUserEmail } from '../../lib/google/identity';
import type { Store } from '../store';
import type { VerificationDeps } from './verificationService';

export interface PilotMatrixState {
  runId: string | null;
  loading: boolean;
  error: string | null;
  decisions: Decision[];
  previous: ExtractionRun | null;
  previousEvidence: Evidence[];
  compareError: string | null;
  compareLoaded: boolean;
  sortByMisses: boolean;
}
export function emptyPilotMatrix(): PilotMatrixState {
  return { runId: null, loading: false, error: null, decisions: [], previous: null,
    previousEvidence: [], compareError: null, compareLoaded: false, sortByMisses: false };
}

/** 検証束の全判定を再利用する。再試行だけは Decisions を 1 回読み直す。 */
export async function loadPilotMatrix(
  store: Store, deps: VerificationDeps,
  materials?: { decisions: Decision[]; annotator: string; evidence?: Evidence[] },
): Promise<void> {
  const { currentProject, pilot } = store.getState();
  if (!currentProject || !pilot.run) return;
  const run = pilot.run;
  const patch = (value: Partial<PilotMatrixState>): void => {
    const latest = store.getState();
    if (latest.currentProject?.spreadsheetId === currentProject.spreadsheetId && latest.pilot.run?.runId === run.runId) {
      store.setState({ pilot: { ...latest.pilot, matrix: { ...(latest.pilot.matrix ?? emptyPilotMatrix()), ...value } } });
    }
  };
  const history = pilot.history ?? [];
  const index = history.findIndex((item) => item.runId === run.runId);
  const previous = index < 0 ? null : history[index + 1] ?? null;
  const matrix = pilot.matrix ?? emptyPilotMatrix();
  const sameRun = matrix.runId === run.runId;
  patch({ ...emptyPilotMatrix(), runId: run.runId, loading: true, previous,
    decisions: sameRun ? matrix.decisions : [], sortByMisses: sameRun && matrix.sortByMisses });
  if (run.studyIds.length === 0) {
    patch({ loading: false });
    return;
  }
  try {
    const all = materials?.decisions ?? await readAllDecisions(currentProject.spreadsheetId, deps.google);
    const annotator = materials?.annotator ?? (await getCurrentUserEmail(deps.profile)) ?? '';
    // Sheets は追記型。手元でキュー退避済みの判定も保持し、取得済み行との重複を除く。
    const local = store.getState().pilot.matrix;
    const decisions = new Map([...all, ...(local?.runId === run.runId ? local.decisions : [])]
      .filter((item) => item.annotator === annotator).map((item) => [JSON.stringify(item), item]));
    patch({ decisions: [...decisions.values()], loading: false });
  } catch (error) {
    patch({ loading: false, error: String(error) });
    return;
  }
  if (previous !== null) {
    try {
      const cached = sameRun && matrix.previous?.runId === previous.runId && matrix.compareLoaded;
      const all = materials?.evidence ?? (cached ? matrix.previousEvidence
        : await readEvidenceRows(currentProject.spreadsheetId, deps.google));
      patch({ previousEvidence: all.filter((item) => item.runId === previous.runId), compareLoaded: true });
    } catch (error) {
      patch({ compareError: String(error) });
    }
  }
}
