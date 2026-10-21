import { formatFieldValue } from '../../../src/lib/formatFieldValue';
import { setUiLanguage } from '../../../src/lib/i18n';
import { makeField } from '../features/verification/pilotMatrixFixtures';

afterEach(() => setUiLanguage('ja'));

test.each([
  ['ja', 'TRUE', 'はい'], ['ja', 'FALSE', 'いいえ'],
  ['en', 'TRUE', 'Yes'], ['en', 'FALSE', 'No'],
  ['ja', ' true ', 'はい'], ['en', 'false', 'No'],
] as const)('boolean を %s で表示する: %s', (language, value, expected) => {
  setUiLanguage(language);
  expect(formatFieldValue(makeField({ dataType: 'boolean' }), value)).toBe(expected);
});

test.each([null, '', 'NR', 'unknown', '<FALSE>'])('boolean の空値・未報告・未知値を保持する: %s', (value) => {
  expect(formatFieldValue(makeField({ dataType: 'boolean' }), value)).toBe(value);
});

test('boolean 以外の同じ文字列は変換せず、複数選択の整形を保つ', () => {
  expect(formatFieldValue(makeField({ dataType: 'text' }), 'FALSE')).toBe('FALSE');
  expect(formatFieldValue(makeField({ dataType: 'enum', allowedValues: 'A|B',
    multiSelect: { exclusiveValues: [], freeTextValues: [] } }), 'A|B')).toBe('A | B');
});
