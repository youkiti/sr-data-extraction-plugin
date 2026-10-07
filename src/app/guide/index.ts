import { availableTours, shouldSuggest, suppressSuggestions } from '../../lib/guide/tourProgress';
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
  const entry = createTourEntry(doc, anchor, conditions, id => { runner.start(id); refresh(); });
  function refresh(): void {
    const existing = doc.getElementById('guide-suggest-band');
    const tour = availableTours(undefined, conditions())[0];
    const suggest = tour && shouldSuggest(getGuideProgress(), {
      screen: currentRoute() === '#/home' ? 'home' : 'other', postponedThisSession: isGuidePostponed(),
    });
    if (!suggest) { existing?.remove(); return; }
    if (existing) return;
    content!.prepend(createSuggestBand(doc, {
      start: () => { runner.start(tour.id); refresh(); },
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
      runner.resume();
      events.forEach(event => runner.handleEvent(event));
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
    runner.resume();
    refresh();
  } catch (error) {
    dispose();
    throw error;
  }
}
