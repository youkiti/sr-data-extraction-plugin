import { t, type MessageKey } from '../../lib/i18n';
import { GUIDE_TOURS, type GuideTourId, type GuideEventName, type TourDefinition } from '../../lib/guide/tours';
import {
  completeTour, dismissTour, nextStepIndex, setActiveStep, decideProgressSync,
  isTourUnavailable, shouldAdvance, startTour, visibleStepPosition, type GuideConditionValues,
} from '../../lib/guide/tourProgress';
import { getGuideProgress, subscribeGuideProgressChange, updateGuideProgress } from '../../lib/storage/guideProgressStore';
import { computeTourCardPosition, intersectsViewport } from './placement';
import { guideButton } from './suggestBand';
import { isSatisfiedByRoute } from './guideEvents';

export interface TourRunnerHost {
  computeConditions: () => GuideConditionValues;
  currentRoute: () => string;
  navigate: (hash: string) => void;
}

/** 保存値の読込後に生成する。stop は表示だけを片づけ、再開位置を保持する。 */
export function createTourRunner(host: TourRunnerHost, { doc, win }: { doc: Document; win: Window } = { doc: document, win: window }) {
  let running: { tour: TourDefinition; index: number; followed: boolean } | null = null;
  let cleanup = (): void => {};

  function stop(): void { cleanup(); running = null; }

  function show(tour: TourDefinition, index: number, followed: boolean, focus = true): void {
    stop();
    running = { tour, index, followed };
    const step = tour.steps[index]!;
    let needsScroll = focus;
    const card = doc.createElement('section');
    card.className = 'guide-tour-card';
    card.dataset.guideStep = step.id;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', t(tour.titleKey as MessageKey));
    const title = doc.createElement('h2');
    title.textContent = t(tour.titleKey as MessageKey);
    const text = doc.createElement('p');
    text.textContent = t(step.textKey as MessageKey);
    const progress = doc.createElement('p');
    const waiting = doc.createElement('p');
    waiting.textContent = t('guide.waiting');
    waiting.setAttribute('role', 'status');
    const goRoute = guideButton(doc, 'go-route', t('guide.goRoute'), () => host.navigate(step.route!));
    const next = guideButton(doc, step.advance.type === 'next' ? 'next' : 'skip', '', advance);
    next.hidden = step.advance.type === 'events' && !step.advance.optional;
    const end = guideButton(doc, 'end', t('guide.end'), () => {
      updateGuideProgress(current => dismissTour(current, tour.id, new Date().toISOString()));
      stop();
    });
    card.append(title, text, progress, waiting, goRoute, next, end);
    const highlight = doc.createElement('div');
    highlight.className = 'guide-tour-highlight';
    const block = doc.createElement('div');
    block.className = 'guide-tour-block';
    doc.body.append(highlight, block, card);

    function reposition(): void {
      const viewport = { width: win.innerWidth, height: win.innerHeight };
      const target = Array.from(doc.querySelectorAll<HTMLElement>(`[data-tour="${step.target}"]`))
        .find(element => element.getClientRects().length > 0 && win.getComputedStyle(element).visibility !== 'hidden');
      if (target && needsScroll) {
        needsScroll = false;
        const rect = target.getBoundingClientRect();
        const fullyVisible = rect.top >= 0 && rect.bottom <= viewport.height && rect.left >= 0 && rect.right <= viewport.width;
        if (step.scroll !== 'if-hidden' || !fullyVisible) {
          target.scrollIntoView({ block: step.scroll === 'start' || rect.height > viewport.height * 0.6 ? 'start' : 'center', inline: 'nearest' });
        }
      }
      const rect = target?.getBoundingClientRect();
      const visible = rect !== undefined && intersectsViewport(rect, viewport);
      highlight.hidden = !visible;
      block.hidden = !visible || !step.blockTarget;
      waiting.hidden = visible;
      goRoute.hidden = visible || step.route === undefined || step.route === host.currentRoute();
      card.dataset.guideWaiting = String(!visible);
      if (visible) {
        for (const element of [highlight, block]) {
          Object.assign(element.style, { left: `${rect.left - 3}px`, top: `${rect.top - 3}px`, width: `${rect.width + 6}px`, height: `${rect.height + 6}px` });
        }
      }
      const conditions = host.computeConditions();
      const position = visibleStepPosition(tour, index, conditions);
      progress.textContent = `${position.position} / ${position.total}`;
      next.textContent = t(step.advance.type === 'events' ? 'guide.skip' : nextStepIndex(tour, index + 1, conditions) === null ? 'guide.complete' : 'guide.next');
      const point = computeTourCardPosition({ viewport, card: card.getBoundingClientRect(), target: visible ? rect : null, margin: 12, gap: 8, pad: 3 });
      card.style.left = `${point.left}px`;
      card.style.top = `${point.top}px`;
    }
    const observer = new MutationObserver(records => {
      if (records.some(record => ![card, highlight, block].some(element => element.contains(record.target)))) reposition();
    });
    observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'data-tour'] });
    const timer = win.setInterval(reposition, 400);
    win.addEventListener('resize', reposition);
    win.addEventListener('scroll', reposition, true);
    const onTargetClick = (event: MouseEvent): void => {
      if (isSatisfiedByRoute(step, host.currentRoute()) && event.target instanceof Element &&
          event.target.closest(`[data-tour="${step.target}"]`)) advance();
    };
    doc.addEventListener('click', onTargetClick);
    const unsubscribe = subscribeGuideProgressChange(() => {
      const action = decideProgressSync(getGuideProgress().active, { tourId: tour.id, stepIndex: index });
      if (action.type === 'close') stop();
      else if (action.type === 'switch') show(tour, action.stepIndex, true);
    });
    cleanup = () => {
      observer.disconnect();
      win.clearInterval(timer);
      win.removeEventListener('resize', reposition);
      win.removeEventListener('scroll', reposition, true);
      doc.removeEventListener('click', onTargetClick);
      unsubscribe();
      card.remove(); highlight.remove(); block.remove();
    };
    reposition();
    if (focus) (next.hidden ? end : next).focus({ preventScroll: true });
  }

  function rerender(): void {
    if (running) show(running.tour, running.index, running.followed, false);
  }

  function goTo(tour: TourDefinition, index: number | null): void {
    if (index === null) {
      updateGuideProgress(current => completeTour(current, tour.id, new Date().toISOString()));
      stop();
    } else {
      updateGuideProgress(current => setActiveStep(current, index));
      show(tour, index, false);
    }
  }
  function nextLocalStepIndex(tour: TourDefinition, from: number): number | null {
    const conditions = host.computeConditions();
    const route = host.currentRoute();
    let index = nextStepIndex(tour, from, conditions);
    while (index !== null && isSatisfiedByRoute(tour.steps[index]!, route)) {
      index = nextStepIndex(tour, index + 1, conditions);
    }
    return index;
  }
  function advance(): void {
    if (running) goTo(running.tour, nextLocalStepIndex(running.tour, running.index + 1));
  }
  function start(tourId: GuideTourId, fromStepId?: string): void {
    const tour = GUIDE_TOURS[tourId];
    if (tour.draft || isTourUnavailable(tour, host.computeConditions())) return;
    const from = fromStepId === undefined ? 0 : Math.max(0, tour.steps.findIndex(step => step.id === fromStepId));
    const index = nextLocalStepIndex(tour, from);
    if (index === null) { goTo(tour, index); return; }
    updateGuideProgress(current => startTour(current, tourId, index));
    show(tour, index, false);
  }
  function resume(): void {
    const active = getGuideProgress().active;
    if (!active || running) return;
    const tour = GUIDE_TOURS[active.tourId];
    if (tour.draft || isTourUnavailable(tour, host.computeConditions())) return;
    const index = nextLocalStepIndex(tour, active.stepIndex);
    if (index === active.stepIndex) show(tour, index, false);
    else goTo(tour, index);
  }
  function handleEvent(name: GuideEventName): void {
    if (!running) return;
    const { tour, index, followed } = running;
    if (shouldAdvance(tour.steps[index]!, name)) { advance(); return; }
    if (followed) return;
    const next = nextLocalStepIndex(tour, index);
    if (next !== index) goTo(tour, next);
  }
  return { start, resume, handleEvent, stop, rerender };
}
