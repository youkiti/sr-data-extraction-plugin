import { getUiLanguage, t } from '../../lib/i18n';
import { buildHelpUrl, HELP_TOPICS, isHelpTopicId, type HelpTopic } from '../../lib/help/topics';
import { availableTours, type GuideConditionValues } from '../../lib/guide/tourProgress';
import { buildTourVideoUrl, GUIDE_TOURS, type GuideTourId } from '../../lib/guide/tours';

export function positionHelpPopover(anchor: DOMRect, panel: DOMRect, width: number, height: number) {
  return {
    left: Math.max(12, Math.min(anchor.left, width - panel.width - 12)),
    top: Math.max(12, Math.min(anchor.bottom + 8, height - panel.height - 12)),
  };
}

export function createHelpPopover(doc: Document, win: Window, conditions: () => GuideConditionValues, start: (id: GuideTourId) => void) {
  let anchor: HTMLAnchorElement | null = null;
  const panel = doc.createElement('div');
  panel.id = 'help-popover';
  panel.className = 'help-popover';
  panel.setAttribute('role', 'dialog');
  function close(): void {
    panel.remove();
    anchor?.removeAttribute('aria-expanded');
    anchor = null;
  }
  function position(candidate: HTMLAnchorElement): void {
    const position = positionHelpPopover(candidate.getBoundingClientRect(), panel.getBoundingClientRect(), win.innerWidth, win.innerHeight);
    panel.style.left = `${position.left}px`;
    panel.style.top = `${position.top}px`;
  }
  function link(action: 'help' | 'video', href: string, label: string): HTMLAnchorElement {
    const item = doc.createElement('a');
    item.dataset.helpAction = action;
    item.href = href;
    item.target = '_blank';
    item.rel = 'noopener noreferrer';
    item.textContent = label;
    item.addEventListener('click', close);
    return item;
  }
  function click(event: MouseEvent): void {
    const target = event.target as Node;
    if (panel.contains(target)) return;
    const candidate = (target as Element).closest?.<HTMLAnchorElement>('a[data-help]');
    if (!candidate) { close(); return; }
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const topicId = candidate.dataset.help!;
    if (!isHelpTopicId(topicId)) return;
    const topic: HelpTopic = HELP_TOPICS[topicId];
    const tour = topic.tourId ? GUIDE_TOURS[topic.tourId] : undefined;
    const canStart = tour && availableTours(undefined, conditions()).some(item => item.id === tour.id);
    if (!tour?.videoId && !canStart) return;
    event.preventDefault();
    if (anchor === candidate) { close(); return; }
    close();
    anchor = candidate;
    panel.setAttribute('aria-label', t('help.menuLabel'));
    const help = link('help', buildHelpUrl(topicId, getUiLanguage()), t('help.readHelp'));
    panel.replaceChildren(help);
    if (tour?.videoId) panel.append(link('video', buildTourVideoUrl(tour.videoId), t('help.watchVideo')));
    if (canStart) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.dataset.helpAction = 'tour';
      button.textContent = t('help.startTour');
      button.addEventListener('click', () => { close(); start(tour.id); });
      panel.append(button);
    }
    doc.body.append(panel);
    position(anchor);
    anchor.setAttribute('aria-expanded', 'true');
    help.focus();
  }
  function escape(event: KeyboardEvent): void {
    if (event.key === 'Escape' && anchor) {
      const previous = anchor;
      close();
      previous.focus();
    }
  }
  function scroll(event: Event): void {
    if (!panel.contains(event.target as Node)) close();
  }
  doc.addEventListener('click', click);
  doc.addEventListener('keydown', escape);
  doc.addEventListener('scroll', scroll, true);
  return {
    close,
    refreshAnchor(): void {
      if (!anchor || anchor.isConnected) return;
      const replacement = doc.querySelector<HTMLAnchorElement>(`a[data-help='${anchor.dataset.help}']`);
      if (!replacement) { close(); return; }
      anchor.removeAttribute('aria-expanded');
      anchor = replacement;
      anchor.setAttribute('aria-expanded', 'true');
      position(anchor);
    },
    destroy(): void {
      close();
      panel.replaceChildren();
      doc.removeEventListener('click', click);
      doc.removeEventListener('keydown', escape);
      doc.removeEventListener('scroll', scroll, true);
    },
  };
}
