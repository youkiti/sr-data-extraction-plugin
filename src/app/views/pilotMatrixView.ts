import { emptyPilotMatrix } from '../services/pilotMatrixService';
import { buildPilotMatrix, comparePilotRows, previousPilotDecisions, PILOT_SYMBOLS, sortPilotMatrix,
  type PilotMatrixRow, type PilotCellStatus } from '../../features/verification/pilotMatrix';
import { entityKeyLabel } from '../../features/verification/cells';
import { t, type MessageKey } from '../../lib/i18n';
import type { AppState } from '../store';
import { el } from '../ui/dom';
import type { ViewContext } from './types';

const statusKeys: Record<PilotCellStatus, MessageKey> = {
  accept: 'pilot.matrixAccept', edit: 'pilot.matrixEdit', reject: 'pilot.matrixReject',
  nrAccepted: 'pilot.matrixNrAccepted', nrMiss: 'pilot.matrixNrMiss', nr: 'pilot.matrixNr',
  failed: 'pilot.matrixFailed', unverified: 'pilot.matrixUnverified', empty: 'pilot.matrixNoExtraction',
};
export function pilotMatrixRows(state: AppState): PilotMatrixRow[] {
  return buildPilotMatrix(state.pilot.run?.studyIds ?? [], state.pilot.runFields ?? [],
    state.pilot.evidence ?? [], state.pilot.matrix?.decisions ?? []);
}
function labelOf(state: AppState, studyId: string): string {
  return state.documents.studies?.find((study) => study.studyId === studyId)?.studyLabel ?? studyId;
}
function ratio(row: PilotMatrixRow): string {
  return `${row.missedStudies}/${row.extractedStudies}`;
}

export function renderPilotMatrix(state: AppState, ctx: ViewContext): HTMLElement {
  const { run, evidence } = state.pilot;
  const matrix = state.pilot.matrix ?? emptyPilotMatrix();
  const section = el('section', { id: 'pilot-matrix' }, [el('h3', { text: t('pilot.matrixTitle') })]);
  if (matrix.error !== null) {
    const retry = el('button', { id: 'pilot-matrix-retry', text: t('common.retry'), attributes: { type: 'button' } });
    retry.addEventListener('click', () => ctx.pilot.onRetryMatrix?.());
    section.append(el('p', { id: 'pilot-matrix-error', text: matrix.error, attributes: { role: 'alert' } }), retry);
    return section;
  }
  if (matrix.loading || run === null || matrix.runId !== run.runId) {
    section.append(el('p', { id: 'pilot-matrix-loading', text: t('common.loading') }));
    return section;
  }
  if (matrix.compareError !== null) {
    section.append(el('p', { id: 'pilot-matrix-compare-error', text: t('pilot.matrixCompareError', { reason: matrix.compareError }), attributes: { role: 'alert' } }));
  }
  if (evidence === null || evidence.length === 0) {
    section.append(el('p', { id: 'pilot-matrix-empty', text: t('pilot.matrixEmpty') }));
    return section;
  }
  const previous = matrix.previous;
  const previousRows = previous === null ? [] : buildPilotMatrix(previous.studyIds,
    state.pilot.runFields ?? [], matrix.previousEvidence,
    previousPilotDecisions(run, previous, matrix.decisions))
    .filter((row) => row.extractedStudies > 0);
  if (previous !== null && (new Set(previous.studyIds).size !== new Set(run.studyIds).size
      || previous.studyIds.some((id) => !run.studyIds.includes(id)))) {
    section.append(el('p', { id: 'pilot-matrix-compare-note', text: t('pilot.matrixCompareNote') }));
  }
  const sort = el('button', { id: 'pilot-matrix-sort',
    text: t(matrix.sortByMisses ? 'pilot.matrixSortSchema' : 'pilot.matrixSortMisses'),
    attributes: { type: 'button', 'aria-pressed': String(matrix.sortByMisses) } });
  sort.addEventListener('click', () => ctx.pilot.onSortMatrix?.());
  section.append(sort);
  const table = (rows: PilotMatrixRow[]): HTMLElement => {
    const heads = [t('pilot.matrixField'), ...run.studyIds.map((id) => labelOf(state, id)),
      t('pilot.matrixMisses'), t('pilot.matrixStudies'), ...(previous === null ? [] : [t('pilot.matrixPrevious')])];
    return el('table', { className: 'pilot__matrix-table' }, [
      el('thead', {}, [el('tr', {}, heads.map((text) => el('th', { text, attributes: { scope: 'col' } })))]),
      el('tbody', {}, rows.map((row) => {
        const cells = row.cells.map((cell) => {
          const text = row.field.entityLevel === 'study' ? PILOT_SYMBOLS[cell.status]
            : cell.entities.length === 0 ? '' : `${cell.misses}/${cell.entities.length}`;
          return el('td', { text, attributes: { 'aria-label': row.field.entityLevel === 'study'
            ? t(statusKeys[cell.status]) : t('pilot.matrixEntityRatio', { misses: cell.misses, total: cell.entities.length }) } });
        });
        if (previous !== null) {
          const before = previousRows.find((item) => item.field.fieldId === row.field.fieldId);
          const comparison = matrix.compareError === null ? comparePilotRows(row, before) : 'unavailable';
          const symbols = { improved: '↓', worsened: '↑', unchanged: '=', unavailable: '—' };
          const keys: Record<typeof comparison, MessageKey> = { improved: 'pilot.matrixImproved', worsened: 'pilot.matrixWorsened', unchanged: 'pilot.matrixUnchanged', unavailable: 'pilot.matrixUnavailable' };
          const comparisonCell = !matrix.compareLoaded && matrix.compareError === null
            ? el('td', { text: t('common.loading') })
            : el('td', { text: `${symbols[comparison]} ${t('pilot.matrixComparison', { before: before === undefined ? '0/0' : ratio(before), current: ratio(row) })}`,
              attributes: { 'aria-label': `${t(keys[comparison])}: ${before === undefined ? '0/0' : ratio(before)} → ${ratio(row)}` } });
          cells.push(el('td', { text: String(row.misses) }), el('td', { text: ratio(row) }), comparisonCell);
        } else {
          cells.push(el('td', { text: String(row.misses) }), el('td', { text: ratio(row) }));
        }
        return el('tr', {}, [el('th', { attributes: { scope: 'row' } }, [el('a', {
          text: row.field.fieldLabel, attributes: { href: `#/schema?field=${encodeURIComponent(row.field.fieldId)}` },
        })]), ...cells]);
      })),
    ]);
  };
  const rows = pilotMatrixRows(state);
  if (matrix.sortByMisses) section.append(table(sortPilotMatrix(rows)));
  else {
    const groups = new Map<string, PilotMatrixRow[]>();
    for (const row of rows) groups.set(row.field.section, [...(groups.get(row.field.section) ?? []), row]);
    for (const [heading, group] of groups) {
      const details = el('details', {}, [el('summary', { text: heading }), table(group)]);
      details.open = true;
      section.append(details);
    }
  }
  section.append(el('p', { className: 'pilot__matrix-legend', text: Object.entries(PILOT_SYMBOLS)
    .map(([status, symbol]) => `${symbol || '∅'}: ${t(statusKeys[status as PilotCellStatus])}`).join(' / ') }));
  return section;
}

/** 読み込み済みの素材だけで、指定項目の外れを編集欄の参考情報へ変換する。 */
export function renderSchemaPilotMisses(state: AppState, fieldId: string): HTMLElement | null {
  if (!state.pilot.run || state.pilot.matrix?.runId !== state.pilot.run.runId || state.pilot.matrix.error !== null) return null;
  const row = pilotMatrixRows(state).find((item) => item.field.fieldId === fieldId);
  const items = row?.cells.flatMap((cell) => cell.entities.filter((item) => item.miss).map((item) => {
    const after = item.status === 'edit' ? item.decision?.value ?? ''
      : item.status === 'nrMiss' ? t('pilot.matrixNotReported') : t(statusKeys[item.status]);
    const entity = row.field.entityLevel === 'study' ? '' : ` / ${entityKeyLabel(item.evidence.entityKey)}`;
    return el('li', { text: `${labelOf(state, cell.studyId)}${entity}: ${item.evidence.value ?? t('pilot.matrixNr')} → ${after}${item.decision?.note ? ` (${item.decision.note})` : ''}` });
  })) ?? [];
  return items.length === 0 ? null : el('div', { className: 'schema__pilot-misses' }, [
    el('p', { text: t('pilot.matrixReference') }), el('ul', {}, items),
  ]);
}
