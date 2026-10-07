// owner の担当セットカード。割り当て操作は Home のコールバックへ委譲する。
import {
  CALIBRATION_SET_ID,
  compareReviewSetIds,
  isGroupSetId,
  type ReviewSetRow,
} from '../../domain/reviewSet';
import type { StudyRecord } from '../../domain/study';
import { resolveActiveStudies } from '../../features/documents/studyRepository';
import { currentReviewSets, reviewSetForStudy, reviewSetMismatchCount } from '../../features/review/reviewSets';
import { t } from '../../lib/i18n';
import type { AppState } from '../store';
import { el } from '../ui/dom';
import { headingWithHelp } from '../ui/helpButton';
import type { ViewContext } from './types';

function splitForm(
  studies: readonly StudyRecord[],
  sets: readonly ReviewSetRow[],
  saving: boolean,
  ctx: ViewContext,
): HTMLElement {
  const used = sets.length > 0;
  const calibration = el('input', {
    id: 'review-sets-calibration',
    attributes: { type: 'number', min: '0', step: '1', required: '' },
  }) as HTMLInputElement;
  calibration.value = String(
    studies.filter((study) => reviewSetForStudy(study, sets) === CALIBRATION_SET_ID).length,
  );
  const groups = el('input', {
    id: 'review-sets-groups',
    attributes: { type: 'number', min: '1', step: '1', required: '' },
  }) as HTMLInputElement;
  groups.value = String(Math.max(1, sets.filter((set) => isGroupSetId(set.setId)).length));
  const submit = el('button', {
    id: used ? 'review-sets-resplit' : 'review-sets-split',
    text: t(used ? 'reviewSets.resplit' : 'reviewSets.split'),
    attributes: { type: 'submit', 'data-tour': 'dual-review-split' },
  });
  calibration.disabled = groups.disabled = submit.disabled = saving;
  const form = el('form', { id: 'review-sets-split-form', className: 'reviewers__form' }, [
    el('label', { className: 'reviewers__form-field' }, [
      el('span', { text: t('reviewSets.calibrationCount') }),
      calibration,
    ]),
    el('label', { className: 'reviewers__form-field' }, [
      el('span', { text: t('reviewSets.groupCount') }),
      groups,
    ]),
    submit,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    ctx.home.onSplitReviewSets({
      calibrationCount: Number(calibration.value),
      groupCount: Number(groups.value),
    });
  });
  return form;
}

function setRow(
  set: ReviewSetRow,
  studies: readonly StudyRecord[],
  saving: boolean,
  ctx: ViewContext,
): HTMLElement {
  const reviewers = el('td');
  if (set.setId === CALIBRATION_SET_ID) reviewers.textContent = t('reviewSets.all');
  else {
    const emails = el('input', {
      className: 'review-sets__emails',
      attributes: { type: 'text', 'aria-label': t('reviewSets.emailsAria', { set: set.setId }) },
    }) as HTMLInputElement;
    emails.value = set.reviewerEmails.join(', ');
    const save = el('button', {
      className: 'review-sets__save',
      text: t('reviewSets.save'),
      attributes: { type: 'button' },
    });
    emails.disabled = save.disabled = saving;
    save.addEventListener('click', () =>
      ctx.home.onSaveReviewSetEmails(
        set.setId,
        emails.value.trim() === '' ? [] : emails.value.split(','),
      ),
    );
    reviewers.append(emails, save);
    if (set.reviewerEmails.length !== 2)
      reviewers.append(
        el('p', { className: 'review-sets__pair-note', text: t('reviewSets.pairNote') }),
      );
  }
  return el('tr', {}, [
    el('th', { text: set.setId, attributes: { scope: 'row' } }),
    el('td', { text: String(studies.filter((study) => set.studyIds?.includes(study.studyId)).length) }),
    reviewers,
  ]);
}

function unassignedStudies(
  studies: readonly StudyRecord[],
  sets: readonly ReviewSetRow[],
  saving: boolean,
  ctx: ViewContext,
): HTMLElement {
  return el('div', { id: 'review-sets-unassigned' }, [
    el('h4', { text: t('reviewSets.unassignedTitle') }),
    ...studies.map((study) => {
      const select = el('select', {
        className: 'review-sets__assign',
        attributes: { 'aria-label': t('reviewSets.assignAria', { study: study.studyLabel }) },
      }) as HTMLSelectElement;
      select.append(
        el('option', { text: t('reviewSets.unassigned'), attributes: { value: '' } }),
        ...sets.map((set) => el('option', { text: set.setId, attributes: { value: set.setId } })),
      );
      select.disabled = saving;
      select.addEventListener('change', () =>
        ctx.home.onAssignStudyReviewSet(study.studyId, select.value === '' ? null : select.value),
      );
      return el('label', { className: 'reviewers__form-field' }, [
        el('span', { text: study.studyLabel }),
        select,
      ]);
    }),
  ]);
}

function resplitConfirm(saving: boolean, ctx: ViewContext): HTMLElement {
  const ok = el('button', {
    id: 'review-sets-resplit-ok',
    text: t('reviewSets.resplit'),
    attributes: { type: 'button' },
  });
  const cancel = el('button', {
    id: 'review-sets-resplit-cancel',
    text: t('common.cancel'),
    attributes: { type: 'button' },
  });
  ok.disabled = cancel.disabled = saving;
  ok.addEventListener('click', () => ctx.home.onConfirmResplit());
  cancel.addEventListener('click', () => ctx.home.onCancelResplit());
  return el(
    'div',
    {
      id: 'review-sets-resplit-confirm',
      className: 'reviewers__confirm',
      attributes: {
        role: 'alertdialog',
        'aria-labelledby': 'review-sets-resplit-title',
        'aria-describedby': 'review-sets-resplit-body',
      },
    },
    [
      el('h4', { id: 'review-sets-resplit-title', text: t('reviewSets.confirmTitle') }),
      el('p', { id: 'review-sets-resplit-body', text: t('reviewSets.confirmBody') }),
      el('div', { className: 'reviewers__confirm-actions' }, [ok, cancel]),
    ],
  );
}

export function renderReviewSetsCard(state: AppState, ctx: ViewContext): HTMLElement {
  const { reviewSets, documents } = state;
  const children: HTMLElement[] = [headingWithHelp('h3', t('reviewSets.title'), 'review-sets')];
  const card = () =>
    el('section', { id: 'home-review-sets', className: 'home__reviewers' }, children);
  if (reviewSets.ignoredCount > 0)
    children.push(
      el('p', {
        id: 'review-sets-tampered',
        className: 'view__notice',
        attributes: { role: 'alert' },
        text: t('reviewSets.tampered', { n: reviewSets.ignoredCount }),
      }),
    );
  const error = reviewSets.error ?? documents.loadError ?? reviewSets.saveError;
  if (error !== null) {
    const reload = el('button', {
      id: 'review-sets-reload',
      text: t('common.retry'),
      attributes: { type: 'button' },
    });
    reload.disabled = reviewSets.saving;
    reload.addEventListener('click', () => ctx.home.onReloadReviewSets());
    children.push(
      el('p', {
        id: 'review-sets-error',
        className: 'home__error',
        attributes: { role: 'alert' },
        text: error,
      }),
      reload,
    );
    if (reviewSets.error !== null || documents.loadError !== null) return card();
  }
  if (
    reviewSets.loading ||
    documents.loading ||
    reviewSets.sets === null ||
    documents.studies === null ||
    documents.records === null
  ) {
    children.push(
      el('p', {
        id: 'review-sets-loading',
        attributes: { role: 'status' },
        text: t('reviewSets.loading'),
      }),
    );
    return card();
  }
  const studies = resolveActiveStudies(documents.studies, documents.records);
  const mismatchCount = reviewSetMismatchCount(studies, reviewSets.sets);
  if (mismatchCount > 0)
    children.push(
      el('p', {
        id: 'review-sets-mismatch',
        className: 'view__notice',
        attributes: { role: 'alert' },
        text: t('reviewSets.mismatch', { n: mismatchCount }),
      }),
    );
  const sets = currentReviewSets(studies, reviewSets.sets).sort((a, b) =>
    compareReviewSetIds(a.setId, b.setId),
  );
  if (sets.length > 0) {
    const seed = sets.find((set) => set.seed !== null)?.seed ?? '—';
    children.push(
      el('p', { id: 'review-sets-seed', text: t('reviewSets.seed', { seed }) }),
      el('table', { id: 'review-sets-list', className: 'reviewers__table' }, [
        el('thead', {}, [
          el(
            'tr',
            {},
            ['reviewSets.headSet', 'reviewSets.headStudies', 'reviewSets.headReviewers'].map(
              (key) =>
                el('th', {
                  text: t(
                    key as
                      'reviewSets.headSet' | 'reviewSets.headStudies' | 'reviewSets.headReviewers',
                  ),
                  attributes: { scope: 'col' },
                }),
            ),
          ),
        ]),
        el(
          'tbody',
          {},
          sets.map((set) => setRow(set, studies, reviewSets.saving, ctx)),
        ),
      ]),
    );
    const unassigned = studies.filter(
      (study) => reviewSetForStudy(study, sets) === null,
    );
    if (unassigned.length > 0)
      children.push(unassignedStudies(unassigned, sets, reviewSets.saving, ctx));
  } else children.push(el('p', { text: t('reviewSets.lead') }));
  if (studies.length === 0)
    children.push(el('p', { id: 'review-sets-empty', text: t('reviewSets.noStudies') }));
  else children.push(splitForm(studies, sets, reviewSets.saving, ctx));
  if (reviewSets.confirmingResplit !== null) children.push(resplitConfirm(reviewSets.saving, ctx));
  return card();
}
