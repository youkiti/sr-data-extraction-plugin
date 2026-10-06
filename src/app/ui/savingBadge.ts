import { getPendingWriteCount } from '../services/pendingWrites';
import { t } from '../../lib/i18n';
import { el } from './dom';

function updateBadge(badge: HTMLElement): void {
  const n = getPendingWriteCount();
  badge.textContent = t('verify.saving', { n });
  badge.hidden = n === 0;
}

export function createSavingBadge(id: string): HTMLElement {
  const badge = el('span', { id, className: 'saving-badge', attributes: { role: 'status' } });
  updateBadge(badge);
  return badge;
}

/** ストアを更新せず、接続中のバッジだけを書き換える。 */
export function updateSavingBadges(doc: Document): void {
  doc.querySelectorAll<HTMLElement>('.saving-badge').forEach(updateBadge);
}
