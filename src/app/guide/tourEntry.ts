import { t, type MessageKey } from '../../lib/i18n';
import { availableTours, type GuideConditionValues } from '../../lib/guide/tourProgress';
import { buildTourVideoUrl, type GuideTourId } from '../../lib/guide/tours';
import { getGuideProgress } from '../../lib/storage/guideProgressStore';
import { guideButton } from './suggestBand';
import { createHelpButton } from '../ui/helpButton';

export function createTourEntry(doc: Document, anchor: HTMLElement, conditions: () => GuideConditionValues, start: (id: GuideTourId) => void) {
  const panel = doc.createElement('section');
  panel.id = 'guide-tour-list';
  panel.className = 'guide-tour-list';
  panel.setAttribute('role', 'dialog');
  anchor.setAttribute('aria-controls', panel.id);
  anchor.setAttribute('aria-expanded', 'false');
  function close(): void {
    panel.remove();
    anchor.setAttribute('aria-expanded', 'false');
  }
  function refresh(): void {
    panel.setAttribute('aria-label', t('guide.openTours'));
    panel.replaceChildren(guideButton(doc, 'close-list', t('guide.closeList'), () => { close(); anchor.focus(); }), createHelpButton('tours'));
    for (const tour of availableTours(undefined, conditions())) {
      const title = doc.createElement('h2');
      title.textContent = t(tour.titleKey as MessageKey);
      if (getGuideProgress().tours[tour.id]?.status === 'done') title.append(` — ${t('guide.done')}`);
      const description = doc.createElement('p');
      description.textContent = t(tour.descriptionKey as MessageKey);
      const button = guideButton(doc, 'start', t('guide.start'), () => { close(); start(tour.id); });
      button.dataset.guideTour = tour.id;
      panel.append(title, description, button);
      if (tour.videoId) {
        const video = doc.createElement('a');
        video.dataset.guideVideo = tour.id;
        video.href = buildTourVideoUrl(tour.videoId);
        video.target = '_blank';
        video.rel = 'noopener noreferrer';
        video.textContent = t('help.watchVideo');
        panel.append(video);
      }
    }
  }
  function toggle(): void {
    if (panel.isConnected) { close(); return; }
    refresh();
    doc.body.append(panel);
    anchor.setAttribute('aria-expanded', 'true');
    panel.querySelector<HTMLButtonElement>('button')!.focus();
  }
  function outside(event: MouseEvent): void {
    if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node)) close();
  }
  function escape(event: KeyboardEvent): void {
    if (event.key === 'Escape' && panel.isConnected) { close(); anchor.focus(); }
  }
  anchor.addEventListener('click', toggle);
  doc.addEventListener('click', outside);
  doc.addEventListener('keydown', escape);
  return { refresh, destroy(): void {
    close();
    anchor.removeEventListener('click', toggle);
    doc.removeEventListener('click', outside);
    doc.removeEventListener('keydown', escape);
  } };
}
