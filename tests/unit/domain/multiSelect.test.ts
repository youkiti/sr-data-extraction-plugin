import {
  canonicalizeMultiSelectValue, formatMultiSelectValue, formatMultiSelectForDisplay, isMultiSelectField,
  parseMultiSelectValue, sanitizeFreeText, splitPipeList, toggleMultiSelectOption,
} from '../../../src/domain/multiSelect';
import type { SchemaField } from '../../../src/domain/schemaField';

const field: SchemaField = {
  schemaVersion: 1, fieldId: 'f', fieldIndex: 1, section: 'methods', fieldName: 'design',
  fieldLabel: 'デザイン', entityLevel: 'study', dataType: 'enum', unit: null,
  allowedValues: 'B|A|Other|Other: detail|NA', required: false, extractionInstruction: '選ぶ',
  example: null, aiGenerated: false, note: null, maxQuotes: null,
  multiSelect: { exclusiveValues: ['NA'], freeTextValues: ['Other', 'Other: detail'] },
};
const known = (option: string, text: string | null = null) => ({ option, text, known: true });
const unknown = (option: string) => ({ option, text: null, known: false });

test('画面表示は選択肢の間に空白を入れ、自由記述と未知の要素も表示する', () => {
  expect(formatMultiSelectForDisplay(field, 'A|Other: 説明|B|未知')).toBe('B | A | Other: 説明 | 未知');
});

test('区切り一覧を trim・空除去・初出順で重複除去する', () => {
  expect(splitPipeList(null)).toEqual([]);
  expect(splitPipeList('')).toEqual([]);
  expect(splitPipeList(' B | A ||B| ')).toEqual(['B', 'A']);
});

test.each([null, '', 'NR'])('空値と未報告を保持する: %p', (value) => {
  expect(parseMultiSelectValue(field, value)).toEqual([]);
  expect(canonicalizeMultiSelectValue(field, value)).toBe(value);
  expect(formatMultiSelectForDisplay(field, value)).toBe(value);
});

test('完全一致・最長の自由記述接頭辞・大小文字一致・未知と重複を解釈する', () => {
  const value = 'z| a |Other: detail|Other: detail: more|Other: note|B|A|Other: later|Z';
  expect(parseMultiSelectValue(field, value)).toEqual([
    known('B'), known('A'), known('Other', 'note'), known('Other: detail'), unknown('Z'), unknown('z'),
  ]);
  expect(parseMultiSelectValue(field, 'Other: detail: more')).toEqual([known('Other: detail', 'more')]);
  expect(parseMultiSelectValue(field, 'other: note')).toEqual([unknown('other: note')]);
  expect(canonicalizeMultiSelectValue(field, 'A|B|A')).toBe('B|A');
});

test('入力順を問わず正準順で整形し、自由記述以外の text は無視する', () => {
  expect(formatMultiSelectValue(field, [unknown('z'), unknown('Z'), known('A', '無視'), known('Other', ' a|b\r\nc '), known('B'), known('Other', '後続')]))
    .toBe('B|A|Other: a/b c|Z|z');
  expect(formatMultiSelectValue(field, [known('Other', '  ')])).toBe('Other');
  expect(formatMultiSelectValue(field, [])).toBeNull();
  expect(parseMultiSelectValue(field, 'z|Z')).toEqual([unknown('Z'), unknown('z')]);
  expect(parseMultiSelectValue(field, 'Z|z')).toEqual([unknown('Z'), unknown('z')]);
});

test.each([null, '', '  ', 'a|b\nc\rd\r\ne'])('自由記述を整形する: %p', (value) => {
  expect(sanitizeFreeText(value)).toBe(value?.startsWith('a') ? 'a/b c d e' : null);
});

test('付け外しは単独選択肢と未知の要素を区別する', () => {
  expect(toggleMultiSelectOption(field, [known('B'), unknown('x')], 'NA')).toEqual([known('NA')]);
  expect(toggleMultiSelectOption(field, [known('NA'), unknown('x')], 'A')).toEqual([known('A'), unknown('x')]);
  expect(toggleMultiSelectOption(field, [known('A'), known('B')], 'A')).toEqual([known('B')]);
  expect(toggleMultiSelectOption(field, [unknown('x'), known('A')], 'x')).toEqual([known('A')]);
  expect(toggleMultiSelectOption(field, [known('A')], 'unknown')).toEqual([known('A')]);
  expect(toggleMultiSelectOption(field, [known('A')], 'B')).toEqual([known('B'), known('A')]);
});

test.each([
  { ...field, dataType: 'text' as const }, { ...field, multiSelect: null },
  { ...field, allowedValues: null }, { ...field, allowedValues: ' | ' },
])('単一選択・非 enum・許容値なしは読み書き対象外', (single) => {
  expect(isMultiSelectField(single)).toBe(false);
  expect(parseMultiSelectValue(single, 'A')).toEqual([]);
  expect(formatMultiSelectValue(single, [known('A')])).toBeNull();
  expect(canonicalizeMultiSelectValue(single, 'A')).toBe('A');
  expect(formatMultiSelectForDisplay(single, 'A')).toBe('A');
  expect(toggleMultiSelectOption(single, [], 'A')).toEqual([]);
});
