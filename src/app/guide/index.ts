import { availableTours, hasRemainingSteps, shouldSuggest, suppressSuggestions } from '../../lib/guide/tourProgress';
import type { GuideTourId } from '../../lib/guide/tours';
import { getGuideProgress, loadGuideProgress, isGuidePostponed, postponeGuideSuggestions, subscribeGuideProgressChange, updateGuideProgress } from '../../lib/storage/guideProgressStore';
import { normalizeHash } from '../router';
import type { Store } from '../store';
import { computeGuideConditions } from './tourConditions';
import { createTourRunner } from './tourRunner';
import { createTourEntry } from './tourEntry';
import { createSuggestBand } from './suggestBand';
import { guideEvents, routeGuideEvent } from './guideEvents';
import { onUiLanguageChange } from '../../lib/i18n';

export async function initGuide({ store, win, doc }: { store: Store; win: Window; doc: Document }): Promise<void> {
  const anchor = doc.getElementById('app-open-tours');
  const content = doc.getElementById('app-content');
  if (!anchor || !content) return;
  await loadGuideProgress();
  const conditions = (): ReturnType<typeof computeGuideConditions> => computeGuideConditions(store.getState());
  const currentRoute = (): ReturnType<typeof normalizeHash> => normalizeHash(win.location.hash);
  const runner = createTourRunner({ computeConditions: conditions, currentRoute, navigate: hash => { win.location.hash = hash; } }, { doc, win });
  let pendingStart: GuideTourId | null = null;
  const countsReady = (): boolean => {
    const { home } = store.getState();
    return home.countsLoaded && home.countsError === null;
  };
  const reviewerReady = (): boolean => {
    const { role } = store.getState();
    // reviewer は進捗件数を読み込まないため、役割確定後は各ツアーの利用条件で判定する。
    return role.role !== null && role.role !== 'owner' && !role.resolving && role.error === null;
  };
  function settleStart(): void {
    const { home } = store.getState();
    if (pendingStart !== null) {
      if (!countsReady() && home.countsError === null && !reviewerReady()) return;
      const id = pendingStart;
      pendingStart = null;
      runner.start(id);
    } else if (home.countsError === null && (countsReady() || reviewerReady())) {
      runner.resume();
    }
  }
  function start(id: GuideTourId): void {
    pendingStart = id;
    settleStart();
    refresh();
  }
  const entry = createTourEntry(doc, anchor, conditions, start);
  function refresh(): void {
    const existing = doc.getElementById('guide-suggest-band');
    const currentConditions = conditions();
    const tour = availableTours(undefined, currentConditions).find(item => item.id === 'getting-started');
    const suggest = countsReady() && tour && hasRemainingSteps(tour, currentConditions) && shouldSuggest(getGuideProgress(), {
      screen: currentRoute() === '#/home' ? 'home' : 'other', postponedThisSession: isGuidePostponed(),
    });
    if (!suggest) { existing?.remove(); return; }
    if (existing) return;
    content!.prepend(createSuggestBand(doc, {
      start: () => start(tour.id),
      postpone: () => { postponeGuideSuggestions(); refresh(); },
      suppress: () => { updateGuideProgress(suppressSuggestions); refresh(); },
    }));
  }
  let previous = conditions();
  let route = currentRoute();
  const onRoute = (): void => {
    const next = currentRoute();
    if (route !== next) { route = next; runner.handleEvent(routeGuideEvent(next)); }
    refresh();
  };
  const cleanups: Array<() => void> = [() => runner.stop(), () => entry.destroy()];
  const dispose = (): void => {
    cleanups.splice(0).reverse().forEach(cleanup => cleanup());
  };
  try {
    const unsubscribeStore = store.subscribe(() => {
      const next = conditions();
      const events = guideEvents(previous, next);
      previous = next;
      runner.syncAvailability();
      events.forEach(event => runner.handleEvent(event));
      settleStart();
      entry.refresh();
      refresh();
    });
    cleanups.push(unsubscribeStore);
    win.addEventListener('hashchange', onRoute);
    cleanups.push(() => win.removeEventListener('hashchange', onRoute));
    const unsubscribeProgress = subscribeGuideProgressChange(() => { entry.refresh(); refresh(); });
    cleanups.push(unsubscribeProgress);
    cleanups.push(onUiLanguageChange(() => {
      runner.rerender();
      doc.getElementById('guide-suggest-band')?.remove();
      refresh();
      entry.refresh();
    }));
    // ルートの replaceChildren 後に帯を戻す。自分の挿入では重複させない。
    const observer = new MutationObserver(refresh);
    cleanups.push(() => observer.disconnect());
    observer.observe(content, { childList: true });
    win.addEventListener('pagehide', dispose);
    cleanups.push(() => win.removeEventListener('pagehide', dispose));
    settleStart();
    refresh();
  } catch (error) {
    dispose();
    throw error;
  }
}
