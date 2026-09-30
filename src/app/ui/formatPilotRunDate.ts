// パイロット履歴と改訂案の出所で共通の日時表示を使う。
// UI 言語と閲覧環境のタイムゾーンに合わせ、未記録の日時は案内文に置き換える。
import { getUiLanguage, t } from '../../lib/i18n';

export function formatPilotRunDate(timestamp: string | null): string {
  if (timestamp === null) return t('pilot.whenUnknown');
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat(getUiLanguage(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
