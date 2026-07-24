import {
  buildDashboard,
  type DashboardStudyInput,
} from '../../../../src/features/verification/dashboard';
import type { Decision } from '../../../../src/domain/decision';
import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';

const ME = 'me@example.com';

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
    bboxPage: null,
    bbox: null,
    relocatedFrom: null,
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

function makeInput(overrides: Partial<DashboardStudyInput> = {}): DashboardStudyInput {
  return {
    studyId: 'study-1',
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

// 既定の runStartedAt。「run_id が map に無い」フォールバック（isAiAccuracyEligible）と同じ挙動
// になるため、run timing 自体を検証しないテストはこれを渡せば従来どおり常に算入される
const EMPTY_RUN_STARTED_AT = new Map<string, string | null>();

describe('buildDashboard', () => {
  test('空入力は空のマトリクスと 0 分母の totals を返す', () => {
    const data = buildDashboard([], EMPTY_RUN_STARTED_AT);
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
    const data = buildDashboard([makeInput()], EMPTY_RUN_STARTED_AT);
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
    ], EMPTY_RUN_STARTED_AT);
    expect(data.sections).toEqual(['methods']);
    expect(data.rows[0]?.cells[0]).toMatchObject({ section: 'methods', total: 2 });
  });

  test('セルは判定済み / 総セルを数え、先頭セルの entity_key をディープリンク先に持つ', () => {
    const data = buildDashboard([makeInput()], EMPTY_RUN_STARTED_AT);
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
    const data = buildDashboard([makeInput()], EMPTY_RUN_STARTED_AT);
    const row = data.rows[0];
    // ev-1 = exact / ev-2 = failed / ev-3 = null（アンカリング対象外）
    expect(row?.anchor).toEqual({ numerator: 1, denominator: 2 });
    expect(row?.notReported).toEqual({ numerator: 1, denominator: 3 });
  });

  test('arm インスタンスが無い section はセル 0 件（entity_key = null）になる', () => {
    const data = buildDashboard(
      [makeInput({ evidence: [makeEvidence()], ownDecisions: [] })],
      EMPTY_RUN_STARTED_AT,
    );
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
    ], EMPTY_RUN_STARTED_AT);
    expect(data.rows[0]?.cells[2]).toEqual({
      section: 'outcomes',
      decided: 0,
      total: 1,
      entityKey: 'arm:1',
    });
    expect(data.totals.progress).toEqual({ decided: 0, total: 3 });
  });

  test('AI 精度は判定済みセルを人の判定種別で分類する（undo 反映後の現在状態基準）', () => {
    const data = buildDashboard(
      [
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
      ],
      EMPTY_RUN_STARTED_AT,
    );
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

  test('AI 抽出結果なし（Evidence 0 件）の study は進捗マトリクスに含めるが、AI 精度内訳には加算しない（新ルールでも同じ結果になることの回帰確認）', () => {
    const data = buildDashboard(
      [
        makeInput({
          evidence: [], // 抽出結果なし = Evidence 0 件 → 全セルの cell.evidence が null になる
          ownDecisions: [
            makeDecision(), // f-total を手入力で accept 相当に確定
            makeDecision({ fieldId: 'f-country', action: 'edit', value: 'Japan' }),
          ],
        }),
      ],
      EMPTY_RUN_STARTED_AT,
    );
    // 進捗マトリクス（decided/total）には通常どおり算入する（evidence が空 + armStructure 未指定
    // のため outcomes〔arm〕セクションは 0 セル。study 項目 2 件のみが対象になる）
    expect(data.rows[0]?.progress).toEqual({ decided: 2, total: 2 });
    expect(data.totals.progress).toEqual({ decided: 2, total: 2 });
    // AI 根拠が無い手入力を「AI を修正した」と数えない = AI 精度内訳は 0 のまま
    expect(data.rows[0]?.accuracy).toEqual({
      accept: 0,
      edit: 0,
      reject: 0,
      notReported: 0,
      decided: 0,
    });
    expect(data.totals.accuracy).toEqual({
      accept: 0,
      edit: 0,
      reject: 0,
      notReported: 0,
      decided: 0,
    });
  });

  test('undo で取り消したセルは AI 精度の母数から外れる', () => {
    const data = buildDashboard(
      [
        makeInput({
          ownDecisions: [
            makeDecision({ decidedAt: 't1', action: 'reject', value: null }),
            makeDecision({ decidedAt: 't2', action: 'undo', value: null }),
          ],
        }),
      ],
      EMPTY_RUN_STARTED_AT,
    );
    expect(data.rows[0]?.accuracy).toEqual({
      accept: 0,
      edit: 0,
      reject: 0,
      notReported: 0,
      decided: 0,
    });
  });

  describe('run started_at に基づくセル単位の AI 精度算入判定（PR #190 レビュー対応）', () => {
    test('判定の decidedAt が表示 run の started_at 以前 → 進捗には数えるが AI 精度には算入しない', () => {
      // no_result（Evidence 0 件）の間に手入力した判定を想定: decidedAt が再抽出成功後の
      // run（started_at='2026-07-20T00:00:00Z'）より前
      const data = buildDashboard(
        [
          makeInput({
            ownDecisions: [makeDecision({ decidedAt: '2026-07-19T00:00:00Z' })],
          }),
        ],
        new Map([['run-1', '2026-07-20T00:00:00Z']]),
      );
      expect(data.rows[0]?.progress).toEqual({ decided: 1, total: 3 });
      expect(data.rows[0]?.accuracy).toEqual({
        accept: 0,
        edit: 0,
        reject: 0,
        notReported: 0,
        decided: 0,
      });
    });

    test('判定の decidedAt が表示 run の started_at より後 → AI 精度にも算入する', () => {
      const data = buildDashboard(
        [
          makeInput({
            ownDecisions: [makeDecision({ decidedAt: '2026-07-21T00:00:00Z' })],
          }),
        ],
        new Map([['run-1', '2026-07-20T00:00:00Z']]),
      );
      expect(data.rows[0]?.accuracy).toEqual({
        accept: 1,
        edit: 0,
        reject: 0,
        notReported: 0,
        decided: 1,
      });
    });

    test('started_at が null の run（旧プロトコル）は「最古」扱いで常に算入する', () => {
      const data = buildDashboard(
        [
          makeInput({
            ownDecisions: [makeDecision({ decidedAt: '2000-01-01T00:00:00Z' })], // どんなに古い判定でも
          }),
        ],
        new Map([['run-1', null]]),
      );
      expect(data.rows[0]?.accuracy).toEqual({
        accept: 1,
        edit: 0,
        reject: 0,
        notReported: 0,
        decided: 1,
      });
    });

    test('Evidence が無いセルへの判定（手入力）は run timing に関わらず AI 精度から除外する', () => {
      const data = buildDashboard(
        [
          makeInput({
            evidence: [], // 全セル evidence なし
            ownDecisions: [makeDecision({ decidedAt: '2099-01-01T00:00:00Z' })], // 十分後の判定でも
          }),
        ],
        new Map([['run-1', '2026-07-20T00:00:00Z']]),
      );
      expect(data.rows[0]?.accuracy).toEqual({
        accept: 0,
        edit: 0,
        reject: 0,
        notReported: 0,
        decided: 0,
      });
    });

    test('Evidence の runId が runStartedAt map に無い場合も従来どおり算入する（防御的フォールバック）', () => {
      const data = buildDashboard(
        [
          makeInput({
            ownDecisions: [makeDecision({ decidedAt: '2000-01-01T00:00:00Z' })],
          }),
        ],
        new Map([['run-other', '2026-07-20T00:00:00Z']]), // 'run-1'（Evidence の runId）は map に無い
      );
      expect(data.rows[0]?.accuracy).toEqual({
        accept: 1,
        edit: 0,
        reject: 0,
        notReported: 0,
        decided: 1,
      });
    });
  });

  test('スキーマが異なる study 間では section の和集合を取り、無い section は null', () => {
    const doc2 = makeInput({
      studyId: 'study-2',
      studyLabel: 'Jones 2021',
      fields: [
        makeField({ fieldId: 'f-design', section: 'design', fieldName: 'design' }),
        makeField({ fieldId: 'f-country', fieldIndex: 2, section: 'identification', fieldName: 'country' }),
      ],
      evidence: [makeEvidence({ documentId: 'doc-2', fieldId: 'f-design' })],
      ownDecisions: [],
    });
    const data = buildDashboard([makeInput(), doc2], EMPTY_RUN_STARTED_AT);
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
