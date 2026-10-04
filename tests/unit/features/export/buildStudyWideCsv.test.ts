import { NOT_REPORTED_TOKEN } from '../../../../src/domain/annotation';
import type { StudyDataRow } from '../../../../src/domain/annotation';
import type { StudyRecord } from '../../../../src/domain/study';
import type { SchemaField } from '../../../../src/domain/schemaField';
import { buildStudyWideCsv } from '../../../../src/features/export/buildStudyWideCsv';
import { CSV_BOM } from '../../../../src/features/export/csvEncode';

const study = (studyId: string, studyLabel: string): StudyRecord => ({
  studyId,
  reviewSet: null,
  studyLabel,
  registrationId: null,
  createdAt: '2026-07-02T00:00:00Z',
  createdBy: 'a@example.com',
  note: null,
});

const field = (
  fieldId: string,
  fieldName: string,
  fieldIndex: number,
  entityLevel: SchemaField['entityLevel'] = 'study',
): SchemaField => ({
  maxQuotes: null,
  multiSelect: null,
  schemaVersion: 1,
  fieldId,
  fieldIndex,
  section: 'identification',
  fieldName,
  fieldLabel: fieldName,
  entityLevel,
  dataType: 'text',
  unit: null,
  allowedValues: null,
  required: true,
  extractionInstruction: '指示',
  example: null,
  aiGenerated: true,
  note: null,
});

const studyRow = (
  studyId: string,
  annotatorType: StudyDataRow['annotatorType'],
  values: Record<string, string | null>,
  annotator = annotatorType === 'ai' ? 'ai' : 'a@example.com',
): StudyDataRow => ({
  studyId,
  annotator,
  annotatorType,
  schemaVersion: 1,
  runId: annotatorType === 'ai' ? 'run-1' : null,
  updatedAt: '2026-07-02T00:00:00Z',
  values,
});

describe('buildStudyWideCsv', () => {
  test('空文字の複数選択値は選択肢列と自由記述列をすべて空欄にする', () => {
    const multi: SchemaField = {
      ...field('f', 'design', 1), dataType: 'enum', allowedValues: 'A|B|Other',
      multiSelect: { exclusiveValues: [], freeTextValues: ['Other'] },
    };
    const result = buildStudyWideCsv([study('s1', 'Study')],
      [studyRow('s1', 'consensus', { design: '' })], [multi]);
    expect(result.csv).toBe(CSV_BOM +
      'study_label,design,design__a,design__b,design__other,design__other_text\r\nStudy,,,,,\r\n');
  });

  test('複数選択の列を直後に展開し、ヘッダ全体の衝突を連番で避ける', () => {
    const multi: SchemaField = { ...field('f', 'x', 1), dataType: 'enum',
      allowedValues: 'A!|A?|Other|Other text|日本語|unclear',
      multiSelect: { exclusiveValues: ['unclear'], freeTextValues: ['Other'] } };
    const fields = [multi, field('f2', 'x__a', 2), field('f3', 'x__a_2', 3)];
    const values = [null, 'NR', 'unclear', 'A!|Other: 説明|未知', 'Other', 'Other text', ''];
    const result = buildStudyWideCsv(values.map((_, i) => study(String(i), String(i))),
      values.map((x, i) => studyRow(String(i), 'consensus', { x, x__a: 'v', x__a_2: 'w' })), fields);
    expect(result.csv).toBe(CSV_BOM + [
      'study_label,x,x__a_3,x__a_4,x__other,x__other_text,x__other_text_2,x__opt5,x__unclear,x__a,x__a_2',
      '0,,,,,,,,,v,w',
      '1,NR,,,,,,,,v,w',
      '2,unclear,0,0,0,,0,0,1,v,w',
      '3,A!|Other: 説明|未知,1,0,1,説明,0,0,0,v,w',
      '4,Other,0,0,1,,0,0,0,v,w',
      '5,Other text,0,0,0,,1,0,0,v,w',
      '6,,,,,,,,,v,w',
      '',
    ].join('\r\n'));
    expect(result.unverifiedCellCount).toBe(1);
    expect(result.studyCount).toBe(7);
  });
  test('確定 annotator 行を field_index 順の study レベル列で出力する', () => {
    const studies = [study('d1', 'Smith 2020'), study('d2', 'Tanaka, 2021')];
    const fields = [
      field('f2', 'sample_size_total', 2),
      field('f1', 'country', 1),
      field('f3', 'event_count', 3, 'outcome_result'), // study 以外は列に含めない
    ];
    const rows = [
      studyRow('d1', 'ai', { country: 'JP(ai)', sample_size_total: '99' }),
      studyRow('d1', 'human_with_ai', { country: 'JP', sample_size_total: '120' }),
      studyRow('d2', 'consensus', { country: 'US', sample_size_total: NOT_REPORTED_TOKEN }),
    ];
    const result = buildStudyWideCsv(studies, rows, fields);
    expect(result.csv).toBe(
      `${CSV_BOM}study_label,country,sample_size_total\r\n` +
        `Smith 2020,JP,120\r\n` +
        `"Tanaka, 2021",US,NR\r\n`,
    );
    expect(result.skippedStudyIds).toEqual([]);
    expect(result.unverifiedCellCount).toBe(0);
    expect(result.studyCount).toBe(2);
  });

  test('未検証セル（null / 値未設定）を数える。NR は未報告であり数えない', () => {
    const studies = [study('d1', 'Smith 2020')];
    const fields = [field('f1', 'country', 1), field('f2', 'design', 2), field('f3', 'total_n', 3)];
    const rows = [
      studyRow('d1', 'human_with_ai', { country: null, total_n: NOT_REPORTED_TOKEN }), // design はキー自体なし
    ];
    const result = buildStudyWideCsv(studies, rows, fields);
    expect(result.unverifiedCellCount).toBe(2);
    expect(result.csv).toContain('Smith 2020,,,NR');
  });

  test('確定 annotator を特定できない study は除外して study_id を報告する', () => {
    const studies = [study('d1', 'Smith 2020'), study('d2', 'Doe 2019')];
    const fields = [field('f1', 'country', 1)];
    const rows = [studyRow('d1', 'ai', { country: 'JP' })]; // d1 は ai のみ、d2 は行なし
    const result = buildStudyWideCsv(studies, rows, fields);
    expect(result.skippedStudyIds).toEqual(['d1', 'd2']);
    expect(result.csv).toBe(`${CSV_BOM}study_label,country\r\n`);
    expect(result.studyCount).toBe(0);
  });
});
