import { buildComparisonCells, classifyComparisonCell, summarizeComparison,
  buildComparisonSummaryCsv, buildComparisonCellsCsv, type ComparisonInput } from '../../../../src/features/verification/aiHumanComparison';
import type { StudyDataRow, ResultsDataRow } from '../../../../src/domain/annotation';
import { makeField, makeEvidence, makeRun } from './pilotMatrixFixtures';

const field = makeField();
const studyRow = (patch: Partial<StudyDataRow> = {}): StudyDataRow => ({ studyId: 'study-1',
  annotator: 'human', annotatorType: 'human_independent', schemaVersion: 1, runId: null,
  updatedAt: 't1', values: { sample_size_total: '120' }, ...patch });
const resultRow = (patch: Partial<ResultsDataRow> = {}): ResultsDataRow => ({ studyId: 'study-1',
  annotator: 'human', annotatorType: 'human_independent', schemaVersion: 1, runId: null,
  updatedAt: 't1', resultId: 'r', fieldId: 'f-arm', entityKey: 'arm:1', value: '12', notReported: false, ...patch });
const input = (patch: Partial<ComparisonInput> = {}): ComparisonInput => ({ studies: [{ studyId: 'study-1', studyLabel: '研究 1' }], fields: [field],
  studyRows: [studyRow()], resultRows: [], evidence: [makeEvidence()], runs: [makeRun()], ...patch });

describe('値を先に見る分類', () => {
  test.each([
    [null, null, false, true, 'exact', 'incomparable', 'human_unjudged', false],
    [' ', '120', false, false, 'failed', 'incomparable', 'human_unjudged', false],
    ['120', '120', false, false, 'failed', 'incomparable', 'ai_not_extracted', false],
    ['NR', 'unused', true, true, 'failed', 'match', null, false],
    ['NR', null, false, true, 'exact', 'match', null, false],
    ['NR', '  ', false, true, 'exact', 'match', null, false],
    ['NR', '120', false, true, 'exact', 'fabrication', null, false],
    ['120', 'unused', true, true, 'failed', 'omission', null, false],
    ['120', null, false, true, 'exact', 'omission', null, false],
    [' 120 ', '120', false, true, 'failed', 'match', null, true],
    ['120', '121', false, true, 'failed', 'fabrication', null, true],
    ['120', '121', false, true, 'exact', 'wrong_value', null, false],
    ['120', '120.0', false, true, null, 'wrong_value', null, false],
    ['NR', 'NR', false, true, 'exact', 'fabrication', null, false],
  ] as const)('H=%s A=%s NR=%s 対象=%s 引用=%s', (human, value, notReported, targeted, anchorStatus, category, reason, missingQuote) => {
    const evidence = makeEvidence({ value, notReported, anchorStatus });
    expect(classifyComparisonCell(field, human, { evidence, quotes: [] }, targeted))
      .toMatchObject({ category, reason, missingQuote, humanValue: human });
  });

  test('Evidence なしと複数引用の一部成功、複数選択の正準化', () => {
    expect(classifyComparisonCell(field, '120', undefined, true).category).toBe('omission');
    expect(classifyComparisonCell(field, null, undefined, true).category).toBe('incomparable');
    const evidence = makeEvidence({ anchorStatus: 'failed' });
    expect(classifyComparisonCell(field, '121', { evidence, quotes: [evidence, makeEvidence()] }, true))
      .toMatchObject({ category: 'wrong_value', missingQuote: false });
    const multi = makeField({ dataType: 'enum', allowedValues: 'a|b', multiSelect: { freeTextValues: [], exclusiveValues: [] } });
    expect(classifyComparisonCell(multi, 'b | a', { evidence: makeEvidence({ value: 'a|b' }), quotes: [] }, true).category).toBe('match');
  });
});

describe('比較セルと対象者', () => {
  test('独立の人と最終値を分け、Evidence なしの対象研究を含める', () => {
    const report = buildComparisonCells(input({ studies: ['study-1', 'study-2', 'study-3'].map((studyId) => ({ studyId, studyLabel: studyId })),
      runs: [makeRun({ studyIds: ['study-1', 'study-2'] })], studyRows: [studyRow(), studyRow({ studyId: 'study-2' })] }));
    expect(report.unextractedStudyIds).toEqual(['study-3']);
    expect(report.cells.map((cell) => [cell.studyId, cell.group, cell.category])).toEqual([
      ['study-1', 'independent', 'match'], ['study-1', 'human_independent', 'match'],
      ['study-2', 'independent', 'omission'], ['study-2', 'human_independent', 'omission'],
    ]);
    expect(buildComparisonCells(input({ studyRows: [] })).noFinalStudyIds).toEqual(['study-1']);
  });

  test('複数の独立者はそれぞれ数え、consensus と AI を見た人の最終値を区別する', () => {
    const two = [studyRow(), studyRow({ annotator: 'second' })];
    const report = buildComparisonCells(input({ studyRows: two }));
    expect(report.cells).toHaveLength(2);
    expect(report.noFinalStudyIds).toHaveLength(1);
    expect(buildComparisonCells(input({ studyRows: [...two, studyRow({ annotator: 'consensus', annotatorType: 'consensus' })] }))
      .cells.map((cell) => cell.group)).toEqual(['independent', 'independent', 'consensus']);
    expect(buildComparisonCells(input({ studyRows: [studyRow({ annotatorType: 'human_with_ai' })] })).cells[0]?.group).toBe('human_with_ai');
  });

  test('項目ごとの entity_key 和集合、ResultsData の NR、study 行なし、AI 対象外', () => {
    const arm = makeField({ fieldId: 'f-arm', entityLevel: 'arm' });
    const report = buildComparisonCells(input({ fields: [field, arm, makeField({ fieldId: 'unused', entityLevel: 'arm' })],
      studyRows: [], resultRows: [resultRow(), resultRow({ entityKey: 'arm:2', notReported: true }),
        resultRow({ fieldId: 'other', entityKey: 'arm:4' })],
      evidence: [makeEvidence({ fieldId: 'f-arm', entityKey: 'arm:3' })], runs: [makeRun({ fieldIds: ['f-arm'] })] }));
    const independent = report.cells.filter((cell) => cell.group === 'independent');
    expect(independent.map((cell) => [cell.entityKey, cell.category])).toEqual([
      ['-', 'incomparable'], ['arm:1', 'omission'], ['arm:2', 'match'], ['arm:3', 'incomparable'],
    ]);
    expect(buildComparisonCells(input({ runs: [makeRun({ fieldIds: ['other'] })] })).cells[0]?.reason).toBe('ai_not_extracted');
    expect(buildComparisonCells(input({ runs: [makeRun({ fieldIds: [] })] })).cells[0]?.reason).toBeNull();
    expect(buildComparisonCells(input({ studyRows: [studyRow({ values: {} })] })).cells[0]?.reason).toBe('human_unjudged');
  });

  test('人の ResultsData の値と NR を取り出し、AI の値は S8 と同じ最新 run を使う', () => {
    const arm = makeField({ fieldId: 'f-arm', entityLevel: 'arm' });
    const report = buildComparisonCells(input({ fields: [arm], studyRows: [], resultRows: [resultRow()],
      evidence: [makeEvidence({ fieldId: 'f-arm', entityKey: 'arm:1', value: '12' })] }));
    expect(report.cells[0]?.category).toBe('match');
    const latest = buildComparisonCells(input({ evidence: [makeEvidence(), makeEvidence({ runId: 'run-2', value: '121' })],
      runs: [makeRun(), makeRun({ runId: 'run-2', startedAt: 't2' })] }));
    expect(latest.cells[0]?.category).toBe('wrong_value');
  });
});

describe('集計と CSV', () => {
  test('全区分の件数・率と引用なしを数え、集合で絞り込む', () => {
    const base = buildComparisonCells(input()).cells[0]!;
    const cells = [base, { ...base, category: 'wrong_value' as const },
      { ...base, category: 'fabrication' as const, missingQuote: true }, { ...base, category: 'omission' as const },
      { ...base, category: 'incomparable' as const, reason: 'human_unjudged' as const },
      { ...base, category: 'incomparable' as const, reason: 'ai_not_extracted' as const }];
    const summary = summarizeComparison(cells);
    expect(summary).toHaveLength(3);
    expect(summary[0]).toMatchObject({ compared: 4, match: 1, wrong_value: 1, fabrication: 1, omission: 1,
      incomparable: 2, humanUnjudged: 1, aiNotExtracted: 1, missingQuote: 1, accuracy: 0.25,
      wrongValueRate: 0.25, fabricationRate: 0.25, omissionRate: 0.25 });
    expect(summarizeComparison(cells, { studyIds: new Set() })).toEqual([]);
    expect(summarizeComparison(cells, { entityLevels: new Set(['arm']) })).toEqual([]);
    expect(summarizeComparison(cells, { studyIds: new Set(['study-1']), entityLevels: new Set(['study']) })).toEqual(summary);
    const zero = summarizeComparison([cells[4]!])[0]!;
    expect(zero).toMatchObject({ compared: 0, accuracy: null, wrongValueRate: null, fabricationRate: null, omissionRate: null });
    const report = { cells: [...cells, { ...base, humanValue: 'a,"b"\nc' }], unextractedStudyIds: ['s'], noFinalStudyIds: ['s2'] };
    expect(buildComparisonSummaryCsv(report)).toContain('unextracted_studies,no_final_studies\r\n');
    expect(buildComparisonSummaryCsv(report)).toContain(',1,1\r\n');
    expect(buildComparisonCellsCsv(report.cells)).toContain('"a,""b""\nc"');
    expect(buildComparisonCellsCsv(report.cells)).toContain('human_unjudged');
    expect(buildComparisonSummaryCsv({ ...report, cells: [cells[4]!] })).toContain(',,,,1,1\r\n');
    expect(buildComparisonCellsCsv([]).startsWith('\uFEFF')).toBe(true);
    expect(buildComparisonSummaryCsv({ ...report, cells: [] })).toContain(',1,1\r\n');
  });

  test('CSV は指定の列順と研究ラベル・項目名を持ち、率を小数点以下 4 桁で丸める', () => {
    const base = buildComparisonCells(input()).cells[0]!;
    const report = { cells: [base, { ...base, category: 'wrong_value' as const }, { ...base, category: 'omission' as const }],
      unextractedStudyIds: [], noFinalStudyIds: [] };
    const summary = buildComparisonSummaryCsv(report);
    const cells = buildComparisonCellsCsv(report.cells);
    expect(summary.split('\r\n')[0]).toBe('\uFEFFgroup,entity_level,field_id,field_name,field_label,compared,match,wrong_value,' +
      'fabrication,omission,incomparable,human_unjudged,ai_not_extracted,missing_quote,accuracy,wrong_value_rate,' +
      'fabrication_rate,omission_rate,unextracted_studies,no_final_studies');
    expect(cells.split('\r\n')[0]).toBe('\uFEFFstudy_label,study_id,field_id,field_name,field_label,entity_level,entity_key,' +
      'group,annotator,annotator_type,category,reason,ai_value,human_value,missing_quote');
    expect(cells).toContain(`研究 1,study-1,${field.fieldId},${field.fieldName},${field.fieldLabel}`);
    expect(summary).toContain(',0.3333,0.3333,0,0.3333,0,0\r\n');
    expect(summary).toContain(`,${field.fieldId},${field.fieldName},${field.fieldLabel},`);
  });
});
