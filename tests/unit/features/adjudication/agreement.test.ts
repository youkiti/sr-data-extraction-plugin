import { NOT_REPORTED_TOKEN } from '../../../../src/domain/annotation';
import type { SchemaField } from '../../../../src/domain/schemaField';
import {
  buildAgreementDisagreementsCsv,
  buildAgreementReport,
  buildAgreementSummaryCsv,
  type AgreementReport,
  type AgreementStudyInput,
} from '../../../../src/features/adjudication/agreement';
import type { AdjudicationCell } from '../../../../src/features/adjudication/cellMatch';
import { CSV_BOM } from '../../../../src/features/export/csvEncode';
import { STUDY_ENTITY_KEY } from '../../../../src/utils/entityKey';

function field(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-1',
    fieldIndex: 1,
    section: 'population',
    fieldName: 'sample_size',
    fieldLabel: '総サンプルサイズ',
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: false,
    extractionInstruction: '',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

/** AdjudicationCell を手組みするテスト用ヘルパ。matches は cellMatch と同じ trim 完全一致で算出する */
function cell(input: {
  field: SchemaField;
  entityKey?: string;
  valueA: string | null;
  valueB: string | null;
}): AdjudicationCell {
  const entityKey = input.entityKey ?? STUDY_ENTITY_KEY;
  const matches = (input.valueA ?? '').trim() === (input.valueB ?? '').trim();
  return {
    cellKey: `${input.field.fieldId}::${entityKey}`,
    field: input.field,
    entityKey,
    valueA: input.valueA,
    valueB: input.valueB,
    schemaVersionA: 1,
    schemaVersionB: 1,
    matches,
    schemaVersionMismatch: false,
    noteA: null,
    noteB: null,
  };
}

function study(overrides: Partial<AgreementStudyInput> & { cells: readonly AdjudicationCell[] }): AgreementStudyInput {
  return {
    studyId: 'study-1',
    studyLabel: 'Smith 2020',
    ...overrides,
  };
}

describe('buildAgreementReport', () => {
  test('手計算検証: po=0.8・pe=0.5 → κ=0.6（2 カテゴリ・4 vs 1 vs 1 vs 4 の分割表）', () => {
    // a=(yes,yes)×4, b=(yes,no)×1, c=(no,yes)×1, d=(no,no)×4
    // pA(yes)=5/10=0.5, pB(yes)=5/10=0.5 → pe = 0.5*0.5 + 0.5*0.5 = 0.5
    // po = (4+4)/10 = 0.8 → κ = (0.8-0.5)/(1-0.5) = 0.6
    const f = field();
    const cells: AdjudicationCell[] = [
      ...Array.from({ length: 4 }, (_, i) => cell({ field: f, entityKey: `a${i}`, valueA: 'yes', valueB: 'yes' })),
      cell({ field: f, entityKey: 'b', valueA: 'yes', valueB: 'no' }),
      cell({ field: f, entityKey: 'c', valueA: 'no', valueB: 'yes' }),
      ...Array.from({ length: 4 }, (_, i) => cell({ field: f, entityKey: `d${i}`, valueA: 'no', valueB: 'no' })),
    ];
    const report = buildAgreementReport([f], [study({ cells })]);
    expect(report.fields).toHaveLength(1);
    expect(report.fields[0]).toEqual(
      expect.objectContaining({ pairCount: 10, agreementCount: 8, agreementRate: 0.8, kappa: expect.closeTo(0.6, 10) }),
    );
    expect(report.overall).toEqual(
      expect.objectContaining({ pairCount: 10, agreementCount: 8, agreementRate: 0.8, kappa: expect.closeTo(0.6, 10) }),
    );
  });

  test('手計算検証: 偶然以下の一致 → κ が負になる（1 vs 4 vs 4 vs 1 の分割表）', () => {
    // a=(yes,yes)×1, b=(yes,no)×4, c=(no,yes)×4, d=(no,no)×1
    // pA(yes)=5/10=0.5, pB(yes)=5/10=0.5 → pe = 0.5
    // po = (1+1)/10 = 0.2 → κ = (0.2-0.5)/(1-0.5) = -0.6
    const f = field();
    const cells: AdjudicationCell[] = [
      cell({ field: f, entityKey: 'a', valueA: 'yes', valueB: 'yes' }),
      ...Array.from({ length: 4 }, (_, i) => cell({ field: f, entityKey: `b${i}`, valueA: 'yes', valueB: 'no' })),
      ...Array.from({ length: 4 }, (_, i) => cell({ field: f, entityKey: `c${i}`, valueA: 'no', valueB: 'yes' })),
      cell({ field: f, entityKey: 'd', valueA: 'no', valueB: 'no' }),
    ];
    const report = buildAgreementReport([f], [study({ cells })]);
    expect(report.fields[0]?.agreementRate).toBeCloseTo(0.2, 10);
    expect(report.fields[0]?.kappa).toBeCloseTo(-0.6, 10);
  });

  test('κ = null: 両者が単一カテゴリのみ（pe=1 で 1-pe=0）でも一致率は計算できる', () => {
    const f = field();
    const cells: AdjudicationCell[] = [
      cell({ field: f, entityKey: 'a', valueA: 'x', valueB: 'x' }),
      cell({ field: f, entityKey: 'b', valueA: 'x', valueB: 'x' }),
      cell({ field: f, entityKey: 'c', valueA: 'x', valueB: 'x' }),
    ];
    const report = buildAgreementReport([f], [study({ cells })]);
    expect(report.fields[0]).toEqual(
      expect.objectContaining({ pairCount: 3, agreementCount: 3, agreementRate: 1, kappa: null }),
    );
  });

  test('κ = null: pairCount が 0（両者とも未入力のセルしかない）', () => {
    const f = field();
    const cells: AdjudicationCell[] = [cell({ field: f, valueA: null, valueB: null })];
    const report = buildAgreementReport([f], [study({ cells })]);
    expect(report.fields[0]).toEqual(
      expect.objectContaining({ pairCount: 0, agreementCount: 0, agreementRate: null, kappa: null }),
    );
  });

  test('NOT_REPORTED_TOKEN 同士は一致・NOT_REPORTED_TOKEN vs 実値は不一致として扱う', () => {
    const f = field();
    const cells: AdjudicationCell[] = [
      cell({ field: f, entityKey: 'a', valueA: NOT_REPORTED_TOKEN, valueB: NOT_REPORTED_TOKEN }),
      cell({ field: f, entityKey: 'b', valueA: NOT_REPORTED_TOKEN, valueB: '12' }),
    ];
    const report = buildAgreementReport([f], [study({ cells })]);
    expect(report.fields[0]).toEqual(
      expect.objectContaining({ pairCount: 2, agreementCount: 1, agreementRate: 0.5 }),
    );
    expect(report.disagreements).toHaveLength(1);
    expect(report.disagreements[0]).toEqual(
      expect.objectContaining({ entityKey: 'b', valueA: NOT_REPORTED_TOKEN, valueB: '12' }),
    );
  });

  test('片側未入力のセルは統計の分母から除外されるが、不一致一覧には含まれる', () => {
    const f = field();
    const cells: AdjudicationCell[] = [
      cell({ field: f, entityKey: 'a', valueA: '12', valueB: '12' }),
      cell({ field: f, entityKey: 'b', valueA: '5', valueB: null }),
      cell({ field: f, entityKey: 'c', valueA: null, valueB: '7' }),
    ];
    const report = buildAgreementReport([f], [study({ cells })]);
    // 分母は valueA・valueB とも非 null の 1 セルのみ
    expect(report.fields[0]).toEqual(
      expect.objectContaining({ pairCount: 1, agreementCount: 1, agreementRate: 1 }),
    );
    // 不一致一覧には片側未入力の 2 件も含めて 2 件（一致セルは含まない）
    expect(report.disagreements).toHaveLength(2);
    expect(report.disagreements.map((d) => d.entityKey)).toEqual(['b', 'c']);
    expect(report.disagreements[0]).toEqual(expect.objectContaining({ valueA: '5', valueB: null }));
    expect(report.disagreements[1]).toEqual(expect.objectContaining({ valueA: null, valueB: '7' }));
  });

  test('複数 study をプールして項目単位に集計する', () => {
    const f = field();
    const studyA = study({
      studyId: 'study-1',
      studyLabel: 'Smith 2020',
      cells: [cell({ field: f, entityKey: 'a', valueA: '1', valueB: '1' })],
    });
    const studyB = study({
      studyId: 'study-2',
      studyLabel: 'Jones 2021',
      cells: [cell({ field: f, entityKey: 'a', valueA: '2', valueB: '3' })],
    });
    const report = buildAgreementReport([f], [studyA, studyB]);
    expect(report.studyCount).toBe(2);
    expect(report.fields[0]).toEqual(
      expect.objectContaining({ pairCount: 2, agreementCount: 1, agreementRate: 0.5 }),
    );
    expect(report.disagreements).toHaveLength(1);
    expect(report.disagreements[0]).toEqual(
      expect.objectContaining({ studyId: 'study-2', studyLabel: 'Jones 2021' }),
    );
  });

  test('fields は最新確定スキーマの項目順（fieldIndex 昇順）で並ぶ（入力順はバラバラでもよい）', () => {
    const fieldB = field({ fieldId: 'f-b', fieldIndex: 2, fieldName: 'mean_age' });
    const fieldA = field({ fieldId: 'f-a', fieldIndex: 1, fieldName: 'sample_size' });
    const cells: AdjudicationCell[] = [
      cell({ field: fieldA, valueA: '10', valueB: '10' }),
      cell({ field: fieldB, valueA: '40', valueB: '40' }),
    ];
    // 入力の fields 配列は index 降順（fieldB → fieldA）のわざと崩した順で渡す
    const report = buildAgreementReport([fieldB, fieldA], [study({ cells })]);
    expect(report.fields.map((f) => f.fieldId)).toEqual(['f-a', 'f-b']);
  });

  test('pairCount 0 の項目は rate / κ ともに null（対象セルが無い項目も一覧に出す）', () => {
    const f1 = field({ fieldId: 'f-1', fieldIndex: 1 });
    const f2 = field({ fieldId: 'f-2', fieldIndex: 2, fieldName: 'unused' });
    const cells: AdjudicationCell[] = [cell({ field: f1, valueA: '1', valueB: '1' })];
    const report = buildAgreementReport([f1, f2], [study({ cells })]);
    expect(report.fields).toHaveLength(2);
    expect(report.fields[1]).toEqual(
      expect.objectContaining({ fieldId: 'f-2', pairCount: 0, agreementCount: 0, agreementRate: null, kappa: null }),
    );
  });

  test('study・fields が空でも空の（対象なしを表す）レポートを返す', () => {
    const report = buildAgreementReport([], []);
    expect(report).toEqual({
      studyCount: 0,
      fields: [],
      overall: { pairCount: 0, agreementCount: 0, agreementRate: null, kappa: null },
      disagreements: [],
    });
  });

  test('不一致セル一覧は study → セル出現順（study の並びを保ったまま）', () => {
    const f = field();
    const studyA = study({
      studyId: 'study-1',
      studyLabel: 'A',
      cells: [
        cell({ field: f, entityKey: 'a1', valueA: '1', valueB: '2' }),
        cell({ field: f, entityKey: 'a2', valueA: '3', valueB: '4' }),
      ],
    });
    const studyB = study({
      studyId: 'study-2',
      studyLabel: 'B',
      cells: [cell({ field: f, entityKey: 'b1', valueA: '5', valueB: '6' })],
    });
    const report = buildAgreementReport([f], [studyA, studyB]);
    expect(report.disagreements.map((d) => `${d.studyId}:${d.entityKey}`)).toEqual([
      'study-1:a1',
      'study-1:a2',
      'study-2:b1',
    ]);
  });
});

describe('buildAgreementSummaryCsv', () => {
  function makeReport(overrides: Partial<AgreementReport> = {}): AgreementReport {
    return {
      studyCount: 1,
      fields: [
        {
          fieldId: 'f-1',
          fieldName: 'sample_size',
          fieldLabel: '総サンプルサイズ',
          pairCount: 10,
          agreementCount: 8,
          agreementRate: 0.8,
          kappa: 0.6,
        },
      ],
      overall: { pairCount: 10, agreementCount: 8, agreementRate: 0.8, kappa: 0.6 },
      disagreements: [],
      ...overrides,
    };
  }

  test('ヘッダ + 項目行 + overall 行を出力する', () => {
    const csv = buildAgreementSummaryCsv(makeReport());
    const lines = csv.replace(CSV_BOM, '').split('\r\n').filter((line) => line.length > 0);
    expect(lines[0]).toBe('field_id,field_name,field_label,pair_count,agreement_count,agreement_rate,kappa');
    expect(lines[1]).toBe('f-1,sample_size,総サンプルサイズ,10,8,0.8,0.6');
    expect(lines[2]).toBe('(overall),,(overall),10,8,0.8,0.6');
  });

  test('rate / kappa が null のときは空セルになる', () => {
    const csv = buildAgreementSummaryCsv(
      makeReport({
        fields: [
          {
            fieldId: 'f-1',
            fieldName: 'sample_size',
            fieldLabel: '総サンプルサイズ',
            pairCount: 0,
            agreementCount: 0,
            agreementRate: null,
            kappa: null,
          },
        ],
        overall: { pairCount: 0, agreementCount: 0, agreementRate: null, kappa: null },
      }),
    );
    const lines = csv.replace(CSV_BOM, '').split('\r\n').filter((line) => line.length > 0);
    expect(lines[1]).toBe('f-1,sample_size,総サンプルサイズ,0,0,,');
    expect(lines[2]).toBe('(overall),,(overall),0,0,,');
  });

  test('カンマ・引用符・改行を含む値は RFC 4180 でエスケープされる', () => {
    const csv = buildAgreementSummaryCsv(
      makeReport({
        fields: [
          {
            fieldId: 'f-1',
            fieldName: 'weird_field',
            fieldLabel: '項目名, "特殊"\n文字',
            pairCount: 1,
            agreementCount: 1,
            agreementRate: 1,
            kappa: null,
          },
        ],
      }),
    );
    expect(csv).toContain('"項目名, ""特殊""\n文字"');
  });

  test('数値は小数 4 桁に丸められる（浮動小数の桁化け対策）', () => {
    const csv = buildAgreementSummaryCsv(
      makeReport({
        fields: [
          {
            fieldId: 'f-1',
            fieldName: 'sample_size',
            fieldLabel: '総サンプルサイズ',
            pairCount: 3,
            agreementCount: 2,
            agreementRate: 2 / 3,
            kappa: 4 / 7,
          },
        ],
      }),
    );
    const lines = csv.replace(CSV_BOM, '').split('\r\n').filter((line) => line.length > 0);
    expect(lines[1]).toBe('f-1,sample_size,総サンプルサイズ,3,2,0.6667,0.5714');
  });
});

describe('buildAgreementDisagreementsCsv', () => {
  test('ヘッダ + 不一致セル行を出力する（未入力は空セル）', () => {
    const report: AgreementReport = {
      studyCount: 1,
      fields: [],
      overall: { pairCount: 0, agreementCount: 0, agreementRate: null, kappa: null },
      disagreements: [
        {
          studyId: 'study-1',
          studyLabel: 'Smith 2020',
          entityKey: '-',
          fieldId: 'f-1',
          fieldLabel: '平均年齢',
          valueA: '45',
          valueB: '50',
        },
        {
          studyId: 'study-1',
          studyLabel: 'Smith 2020',
          entityKey: 'arm:1',
          fieldId: 'f-2',
          fieldLabel: '群名',
          valueA: null,
          valueB: '介入群',
        },
      ],
    };
    const csv = buildAgreementDisagreementsCsv(report);
    const lines = csv.replace(CSV_BOM, '').split('\r\n').filter((line) => line.length > 0);
    expect(lines[0]).toBe('study_id,study_label,entity_key,field_id,field_label,value_a,value_b');
    expect(lines[1]).toBe('study-1,Smith 2020,-,f-1,平均年齢,45,50');
    expect(lines[2]).toBe('study-1,Smith 2020,arm:1,f-2,群名,,介入群');
  });

  test('カンマ・引用符を含む値はエスケープされる', () => {
    const report: AgreementReport = {
      studyCount: 1,
      fields: [],
      overall: { pairCount: 0, agreementCount: 0, agreementRate: null, kappa: null },
      disagreements: [
        {
          studyId: 'study-1',
          studyLabel: 'Smith, 2020',
          entityKey: '-',
          fieldId: 'f-1',
          fieldLabel: '備考',
          valueA: '"引用"あり',
          valueB: null,
        },
      ],
    };
    const csv = buildAgreementDisagreementsCsv(report);
    expect(csv).toContain('"Smith, 2020"');
    expect(csv).toContain('"""引用""あり"');
  });
});
