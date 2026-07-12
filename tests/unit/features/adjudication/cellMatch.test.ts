import { NOT_REPORTED_TOKEN } from '../../../../src/domain/annotation';
import type { ResultsDataRow, StudyDataRow } from '../../../../src/domain/annotation';
import type { Decision } from '../../../../src/domain/decision';
import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';
import { buildAdjudicationCells, indexEvidenceByCellKey } from '../../../../src/features/adjudication/cellMatch';

function field(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-study',
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

function studyRow(overrides: Partial<StudyDataRow> = {}): StudyDataRow {
  return {
    studyId: 'study-1',
    annotator: 'a@example.com',
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    runId: null,
    updatedAt: 't0',
    values: {},
    ...overrides,
  };
}

function resultsRow(overrides: Partial<ResultsDataRow> = {}): ResultsDataRow {
  return {
    resultId: 'r-1',
    studyId: 'study-1',
    fieldId: 'f-arm',
    annotator: 'a@example.com',
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    entityKey: 'arm:1',
    runId: null,
    value: '10',
    notReported: false,
    updatedAt: 't0',
    ...overrides,
  };
}

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    decidedAt: 't1',
    decidedBy: 'a@example.com',
    studyId: 'study-1',
    fieldId: 'f-study',
    entityKey: '-',
    annotator: 'a@example.com',
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    action: 'accept',
    value: '120',
    note: null,
    ...overrides,
  };
}

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidenceId: 'ev-1',
    runId: 'run-1',
    studyId: 'study-1',
    fieldId: 'f-study',
    documentId: 'doc-1',
    entityKey: '-',
    value: '120',
    notReported: false,
    quote: '合計 120 例',
    page: 1,
    confidence: 'high',
    anchorStatus: 'exact',
    bboxPage: null,
    bbox: null,
    ...overrides,
  };
}

describe('buildAdjudicationCells', () => {
  test('study レベルは全項目を無条件で 1 セルとして比較する（両側とも行が無ければ両方 null = 一致）', () => {
    const cells = buildAdjudicationCells([field()], null, null, [], []);
    expect(cells).toEqual([
      {
        cellKey: expect.any(String),
        field: field(),
        entityKey: '-',
        valueA: null,
        valueB: null,
        schemaVersionA: null,
        schemaVersionB: null,
        matches: true,
        schemaVersionMismatch: false,
        noteA: null,
        noteB: null,
      },
    ]);
  });

  test('study レベルの値が trim 後に一致すれば matches=true', () => {
    const cells = buildAdjudicationCells(
      [field()],
      studyRow({ values: { sample_size: ' 120 ' } }),
      studyRow({ values: { sample_size: '120' } }),
      [],
      [],
    );
    expect(cells[0]?.matches).toBe(true);
  });

  test('study レベルの値が異なれば matches=false', () => {
    const cells = buildAdjudicationCells(
      [field()],
      studyRow({ values: { sample_size: '120' } }),
      studyRow({ values: { sample_size: '130' } }),
      [],
      [],
    );
    expect(cells[0]?.matches).toBe(false);
  });

  test('NOT_REPORTED_TOKEN 同士は一致扱い', () => {
    const cells = buildAdjudicationCells(
      [field()],
      studyRow({ values: { sample_size: NOT_REPORTED_TOKEN } }),
      studyRow({ values: { sample_size: NOT_REPORTED_TOKEN } }),
      [],
      [],
    );
    expect(cells[0]?.matches).toBe(true);
  });

  test('study 行の schema_version が食い違えば schemaVersionMismatch=true（値は一致でもよい）', () => {
    const cells = buildAdjudicationCells(
      [field()],
      studyRow({ schemaVersion: 1, values: { sample_size: '120' } }),
      studyRow({ schemaVersion: 2, values: { sample_size: '120' } }),
      [],
      [],
    );
    expect(cells[0]?.schemaVersionMismatch).toBe(true);
    expect(cells[0]?.matches).toBe(true);
  });

  test('片側にしか無い study 行は相手側「未入力」として不一致扱い', () => {
    const cells = buildAdjudicationCells(
      [field()],
      studyRow({ values: { sample_size: '120' } }),
      null,
      [],
      [],
    );
    expect(cells[0]).toMatchObject({ valueA: '120', valueB: null, matches: false });
  });

  test('arm レベル: 両側の entity_key の和集合 × 項目でセルを作る（片側にしか無い entity_key は不一致）', () => {
    const armField = field({ fieldId: 'f-arm', fieldName: 'arm_name', entityLevel: 'arm', fieldIndex: 1 });
    const cells = buildAdjudicationCells(
      [armField],
      null,
      null,
      [resultsRow({ fieldId: 'f-arm', entityKey: 'arm:1', value: '介入群' })],
      [resultsRow({ fieldId: 'f-arm', entityKey: 'arm:2', value: '対照群' })],
    );
    expect(cells).toHaveLength(2);
    const arm1 = cells.find((cell) => cell.entityKey === 'arm:1');
    const arm2 = cells.find((cell) => cell.entityKey === 'arm:2');
    expect(arm1).toMatchObject({ valueA: '介入群', valueB: null, matches: false });
    expect(arm2).toMatchObject({ valueA: null, valueB: '対照群', matches: false });
  });

  test('arm レベルで両側が同じ entity_key × field に一致する値を持てば matches=true', () => {
    const armField = field({ fieldId: 'f-arm', fieldName: 'arm_name', entityLevel: 'arm', fieldIndex: 1 });
    const cells = buildAdjudicationCells(
      [armField],
      null,
      null,
      [resultsRow({ fieldId: 'f-arm', entityKey: 'arm:1', value: '介入群' })],
      [resultsRow({ fieldId: 'f-arm', entityKey: 'arm:1', value: '介入群' })],
    );
    expect(cells).toEqual([
      expect.objectContaining({
        entityKey: 'arm:1',
        valueA: '介入群',
        valueB: '介入群',
        matches: true,
        noteA: null,
        noteB: null,
      }),
    ]);
  });

  test('not_reported 行は NOT_REPORTED_TOKEN として比較する', () => {
    const armField = field({ fieldId: 'f-arm', fieldName: 'arm_name', entityLevel: 'arm', fieldIndex: 1 });
    const cells = buildAdjudicationCells(
      [armField],
      null,
      null,
      [resultsRow({ fieldId: 'f-arm', entityKey: 'arm:1', value: null, notReported: true })],
      [resultsRow({ fieldId: 'f-arm', entityKey: 'arm:1', value: null, notReported: true })],
    );
    expect(cells[0]).toMatchObject({ valueA: NOT_REPORTED_TOKEN, valueB: NOT_REPORTED_TOKEN, matches: true });
  });

  test('ResultsData 行の schema_version 差も検出する', () => {
    const armField = field({ fieldId: 'f-arm', fieldName: 'arm_name', entityLevel: 'arm', fieldIndex: 1 });
    const cells = buildAdjudicationCells(
      [armField],
      null,
      null,
      [resultsRow({ fieldId: 'f-arm', entityKey: 'arm:1', value: '介入群', schemaVersion: 1 })],
      [resultsRow({ fieldId: 'f-arm', entityKey: 'arm:1', value: '介入群', schemaVersion: 2 })],
    );
    expect(cells[0]?.schemaVersionMismatch).toBe(true);
  });

  test('同一レベルの複数項目は field_index 昇順で並べる', () => {
    const second = field({ fieldId: 'f-second', fieldName: 'second', fieldIndex: 2 });
    const first = field({ fieldId: 'f-first', fieldName: 'first', fieldIndex: 1 });
    // 入力順を fieldIndex と逆にしてソートが効いていることを確認する
    const cells = buildAdjudicationCells([second, first], null, null, [], []);
    expect(cells.map((cell) => cell.field.fieldId)).toEqual(['f-first', 'f-second']);
  });

  test('entity_level に該当項目が無いレベルはスキップする（rob_domain 未使用時など）', () => {
    const cells = buildAdjudicationCells([field()], studyRow(), studyRow(), [], []);
    // study のみ 1 セル。arm / outcome_result / rob_domain の項目が無いのでそれ以上増えない
    expect(cells).toHaveLength(1);
  });

  test('outcome_result / rob_domain レベルも同様に和集合で突き合わせる', () => {
    const outcomeField = field({
      fieldId: 'f-outcome',
      fieldName: 'value',
      entityLevel: 'outcome_result',
      fieldIndex: 1,
    });
    const robField = field({ fieldId: 'f-rob', fieldName: 'judgement', entityLevel: 'rob_domain', fieldIndex: 1 });
    const cells = buildAdjudicationCells(
      [outcomeField, robField],
      null,
      null,
      [
        resultsRow({ fieldId: 'f-outcome', entityKey: 'outcome:mortality|arm:1', value: '5' }),
        resultsRow({ fieldId: 'f-rob', entityKey: 'rob:d1', value: 'low' }),
      ],
      [
        resultsRow({ fieldId: 'f-outcome', entityKey: 'outcome:mortality|arm:1', value: '5' }),
        resultsRow({ fieldId: 'f-rob', entityKey: 'rob:d1', value: 'high' }),
      ],
    );
    expect(cells).toHaveLength(2);
    const outcomeCell = cells.find((cell) => cell.entityKey === 'outcome:mortality|arm:1');
    const robCell = cells.find((cell) => cell.entityKey === 'rob:d1');
    expect(outcomeCell?.matches).toBe(true);
    expect(robCell?.matches).toBe(false);
  });

  describe('noteA / noteB（issue #63: 各 annotator の Decisions の直近 note を畳み込む）', () => {
    test('decisionsA / decisionsB 省略時は両方 null', () => {
      const cells = buildAdjudicationCells([field()], studyRow(), studyRow(), [], []);
      expect(cells[0]?.noteA).toBeNull();
      expect(cells[0]?.noteB).toBeNull();
    });

    test('該当セル（field_id × entity_key）の Decisions から note を採用する', () => {
      const cells = buildAdjudicationCells(
        [field()],
        studyRow(),
        studyRow(),
        [],
        [],
        [decision({ note: 'A のメモ' })],
        [decision({ note: 'B のメモ' })],
      );
      expect(cells[0]?.noteA).toBe('A のメモ');
      expect(cells[0]?.noteB).toBe('B のメモ');
    });

    test('複数の Decisions がある場合は decided_at が最後（最新）の 1 件の note を採用する', () => {
      const cells = buildAdjudicationCells(
        [field()],
        studyRow(),
        studyRow(),
        [],
        [],
        [
          decision({ decidedAt: 't1', note: '古いメモ' }),
          decision({ decidedAt: 't3', note: '最新メモ' }),
          decision({ decidedAt: 't2', note: '中間メモ' }),
        ],
        [],
      );
      expect(cells[0]?.noteA).toBe('最新メモ');
    });

    test('最新の Decision の note が null なら null を採用する（note が消えたことを表す）', () => {
      const cells = buildAdjudicationCells(
        [field()],
        studyRow(),
        studyRow(),
        [],
        [],
        [
          decision({ decidedAt: 't1', note: '古いメモ' }),
          decision({ decidedAt: 't2', note: null }),
        ],
        [],
      );
      expect(cells[0]?.noteA).toBeNull();
    });

    test('他セル（field_id・entity_key が異なる）の note は混入しない', () => {
      const armField = field({ fieldId: 'f-arm', fieldName: 'arm_name', entityLevel: 'arm', fieldIndex: 1 });
      const cells = buildAdjudicationCells(
        [field(), armField],
        studyRow(),
        studyRow(),
        [resultsRow({ fieldId: 'f-arm', entityKey: 'arm:1', value: '介入群' })],
        [resultsRow({ fieldId: 'f-arm', entityKey: 'arm:1', value: '介入群' })],
        [decision({ fieldId: 'f-arm', entityKey: 'arm:1', note: 'arm のメモ' })],
        [],
      );
      const studyCell = cells.find((c) => c.field.fieldId === 'f-study');
      const armCell = cells.find((c) => c.field.fieldId === 'f-arm');
      expect(studyCell?.noteA).toBeNull();
      expect(armCell?.noteA).toBe('arm のメモ');
    });
  });
});

describe('indexEvidenceByCellKey（issue #63: 裁定 PDF ペインの根拠ハイライト用の索引）', () => {
  test('Evidence を field_id × entity_key で引けるようにする', () => {
    const index = indexEvidenceByCellKey([evidence({ fieldId: 'f-1', entityKey: '-' })]);
    expect(index.get(JSON.stringify(['f-1', '-']))?.evidenceId).toBe('ev-1');
  });

  test('空配列は空の索引', () => {
    expect(indexEvidenceByCellKey([]).size).toBe(0);
  });

  test('同一セルに複数 Evidence があれば配列の後勝ち（追記順 = 新しいものを優先）', () => {
    const index = indexEvidenceByCellKey([
      evidence({ evidenceId: 'ev-old' }),
      evidence({ evidenceId: 'ev-new' }),
    ]);
    expect(index.get(JSON.stringify(['f-study', '-']))?.evidenceId).toBe('ev-new');
  });
});
