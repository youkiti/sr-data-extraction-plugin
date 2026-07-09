import {
  buildDashboard,
  type DashboardDocumentInput,
} from '../../../../src/features/verification/dashboard';
import type { Decision } from '../../../../src/domain/decision';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';

const ME = 'me@example.com';

function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: 'doc-1',
    studyId: 'study-1',
    documentRole: 'article',
    driveFileId: 'drive-1',
    sourceFileId: 'src-1',
    filename: 'smith2020.pdf',
    pmid: null,
    doi: null,
    textRef: 'ref',
    textStatus: 'ok',
    pageCount: 2,
    charCount: 1000,
    importedAt: 't0',
    importedBy: ME,
    note: null,
    ...overrides,
  };
}

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-total',
    fieldIndex: 1,
    section: 'methods',
    fieldName: 'sample_size_total',
    fieldLabel: '総サンプルサイズ',
    entityLevel: 'study',
    dataType: 'integer',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: '総 N を抽出',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidenceId: 'ev-1',
    runId: 'run-1',
    studyId: 'study-1',
    documentId: 'doc-1',
    fieldId: 'f-total',
    entityKey: '-',
    value: '120',
    notReported: false,
    quote: 'a total of 120',
    page: 1,
    confidence: 'high',
    anchorStatus: 'exact',
    ...overrides,
  };
}

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    decidedAt: 't1',
    decidedBy: ME,
    studyId: 'study-1',
    fieldId: 'f-total',
    entityKey: '-',
    annotator: ME,
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    action: 'accept',
    value: '120',
    note: null,
    ...overrides,
  };
}

const FIELDS: SchemaField[] = [
  makeField(), // methods（study）
  makeField({ fieldId: 'f-country', fieldIndex: 2, section: 'identification', fieldName: 'country' }),
  makeField({
    fieldId: 'f-arm-n',
    fieldIndex: 3,
    section: 'outcomes',
    fieldName: 'arm_n',
    entityLevel: 'arm',
  }),
];

function makeInput(overrides: Partial<DashboardDocumentInput> = {}): DashboardDocumentInput {
  return {
    document: makeDocument(),
    studyLabel: 'Smith 2020',
    fields: FIELDS,
    evidence: [
      makeEvidence(),
      makeEvidence({ evidenceId: 'ev-2', fieldId: 'f-country', anchorStatus: 'failed' }),
      makeEvidence({
        evidenceId: 'ev-3',
        fieldId: 'f-arm-n',
        entityKey: 'arm:1',
        notReported: true,
        quote: null,
        anchorStatus: null,
      }),
    ],
    ownDecisions: [makeDecision()],
    ...overrides,
  };
}

describe('buildDashboard', () => {
  test('空入力は空のマトリクスと 0 分母の totals を返す', () => {
    const data = buildDashboard([]);
    expect(data.sections).toEqual([]);
    expect(data.rows).toEqual([]);
    expect(data.totals).toEqual({
      progress: { decided: 0, total: 0 },
      accuracy: { accept: 0, edit: 0, reject: 0, notReported: 0, decided: 0 },
      anchor: { numerator: 0, denominator: 0 },
      notReported: { numerator: 0, denominator: 0 },
    });
  });

  test('section 列はタブ順 → field_index 順の初出順（arm タブの section は study の後）', () => {
    const data = buildDashboard([makeInput()]);
    expect(data.sections).toEqual(['methods', 'identification', 'outcomes']);
  });

  test('同一 document 内の重複 section は 1 列にまとめる', () => {
    const data = buildDashboard([
      makeInput({
        fields: [
          makeField(),
          makeField({ fieldId: 'f-design', fieldIndex: 4, fieldName: 'design' }), // 同じ methods
        ],
        evidence: [makeEvidence()],
        ownDecisions: [],
      }),
    ]);
    expect(data.sections).toEqual(['methods']);
    expect(data.rows[0]?.cells[0]).toMatchObject({ section: 'methods', total: 2 });
  });

  test('セルは判定済み / 総セルを数え、先頭セルの entity_key をディープリンク先に持つ', () => {
    const data = buildDashboard([makeInput()]);
    const row = data.rows[0];
    expect(row?.studyLabel).toBe('Smith 2020');
    expect(row?.cells).toEqual([
      { section: 'methods', decided: 1, total: 1, entityKey: '-' },
      { section: 'identification', decided: 0, total: 1, entityKey: '-' },
      { section: 'outcomes', decided: 0, total: 1, entityKey: 'arm:1' },
    ]);
    expect(row?.progress).toEqual({ decided: 1, total: 3 });
  });

  test('anchor 失敗率の分母は anchor_status 非 null、not_reported 率の分母は Evidence 総数', () => {
    const data = buildDashboard([makeInput()]);
    const row = data.rows[0];
    // ev-1 = exact / ev-2 = failed / ev-3 = null（アンカリング対象外）
    expect(row?.anchor).toEqual({ numerator: 1, denominator: 2 });
    expect(row?.notReported).toEqual({ numerator: 1, denominator: 3 });
  });

  test('arm インスタンスが無い section はセル 0 件（entity_key = null）になる', () => {
    const data = buildDashboard([
      makeInput({ evidence: [makeEvidence()], ownDecisions: [] }),
    ]);
    expect(data.rows[0]?.cells[2]).toEqual({
      section: 'outcomes',
      decided: 0,
      total: 0,
      entityKey: null,
    });
  });

  test('armStructure があれば Evidence なし arm も section の分母に含める', () => {
    const data = buildDashboard([
      makeInput({
        evidence: [makeEvidence()],
        ownDecisions: [],
        armStructure: { version: 1, arms: [{ armKey: 'arm:1', armName: '介入群' }] },
      }),
    ]);
    expect(data.rows[0]?.cells[2]).toEqual({
      section: 'outcomes',
      decided: 0,
      total: 1,
      entityKey: 'arm:1',
    });
    expect(data.totals.progress).toEqual({ decided: 0, total: 3 });
  });

  test('AI 精度は判定済みセルを人の判定種別で分類する（undo 反映後の現在状態基準）', () => {
    const data = buildDashboard([
      makeInput({
        ownDecisions: [
          makeDecision(), // f-total を accept
          makeDecision({ fieldId: 'f-country', action: 'edit', value: 'Japan' }),
          makeDecision({
            fieldId: 'f-arm-n',
            entityKey: 'arm:1',
            action: 'not_reported',
            value: null,
          }),
        ],
      }),
    ]);
    expect(data.rows[0]?.accuracy).toEqual({
      accept: 1,
      edit: 1,
      reject: 0,
      notReported: 1,
      decided: 3,
    });
    expect(data.totals.accuracy).toEqual({
      accept: 1,
      edit: 1,
      reject: 0,
      notReported: 1,
      decided: 3,
    });
  });

  test('undo で取り消したセルは AI 精度の母数から外れる', () => {
    const data = buildDashboard([
      makeInput({
        ownDecisions: [
          makeDecision({ decidedAt: 't1', action: 'reject', value: null }),
          makeDecision({ decidedAt: 't2', action: 'undo', value: null }),
        ],
      }),
    ]);
    expect(data.rows[0]?.accuracy).toEqual({
      accept: 0,
      edit: 0,
      reject: 0,
      notReported: 0,
      decided: 0,
    });
  });

  test('スキーマが異なる document 間では section の和集合を取り、無い section は null', () => {
    const doc2 = makeInput({
      document: makeDocument({ documentId: 'doc-2', studyId: 'study-2' }),
      studyLabel: 'Jones 2021',
      fields: [
        makeField({ fieldId: 'f-design', section: 'design', fieldName: 'design' }),
        makeField({ fieldId: 'f-country', fieldIndex: 2, section: 'identification', fieldName: 'country' }),
      ],
      evidence: [makeEvidence({ documentId: 'doc-2', fieldId: 'f-design' })],
      ownDecisions: [],
    });
    const data = buildDashboard([makeInput(), doc2]);
    expect(data.sections).toEqual(['methods', 'identification', 'outcomes', 'design']);
    const row2 = data.rows[1];
    expect(row2?.cells[0]).toBeNull(); // methods は doc-2 のスキーマに無い
    expect(row2?.cells[2]).toBeNull(); // outcomes も無い
    expect(row2?.cells[3]).toMatchObject({ section: 'design', total: 1 });
    expect(data.totals.progress).toEqual({ decided: 1, total: 5 });
    expect(data.totals.anchor).toEqual({ numerator: 1, denominator: 3 });
    expect(data.totals.notReported).toEqual({ numerator: 1, denominator: 4 });
  });
});
