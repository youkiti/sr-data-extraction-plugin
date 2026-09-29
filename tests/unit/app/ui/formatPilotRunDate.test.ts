import { formatPilotRunDate } from '../../../../src/app/ui/formatPilotRunDate';
import { setUiLanguage } from '../../../../src/lib/i18n';

afterEach(() => setUiLanguage('ja'));

test.each(['ja', 'en'] as const)(
  '表示言語の日時表記に整え、未記録と不正な日時を扱う（%s）',
  (language) => {
    setUiLanguage(language);
    const timestamp = '2026-07-05T00:00:00Z';
    expect(formatPilotRunDate(timestamp)).toBe(
      new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(timestamp),
      ),
    );
    expect(formatPilotRunDate(timestamp)).not.toContain('T00:00:00Z');
    expect(formatPilotRunDate(null)).toBe(language === 'ja' ? '(日時不明)' : '(unknown time)');
    expect(formatPilotRunDate('invalid')).toBe('invalid');
  },
);
