// planRun（一括抽出の実行計画）の単体テスト
// - バッチ分割: スキーマ全項目 1 バッチ ⇔ トークン予算超過時の section 単位分割
// - トークン概算: 文字数 ÷ 4 の目安、char_count 欠損時のフォールバック、entity_level 別の応答要素数
// - コスト概算: lib/llm/pricing の単価表との結線、未知モデルは null + 警告
import type { DocumentRecord } from '../../../../src/domain/document';
import type { SchemaField } from '../../../../src/domain/schemaField';
import {
  APPROX_CHARS_PER_TOKEN,
  DEFAULT_RUN_TOKEN_BUDGET,
  ENTITY_INSTANCE_ESTIMATE,
  FALLBACK_CHARS_PER_PAGE,
  FALLBACK_DOCUMENT_CHARS,
  FIELD_PROMPT_OVERHEAD_CHARS,
  OUTPUT_CHARS_PER_ITEM,
  PROMPT_SCAFFOLD_CHARS,
  planRun,
} from '../../../../src/features/extraction/planRun';
import { estimateCostUsd } from '../../../../src/lib/llm/pricing';

function makeField(
  overrides: Pick<SchemaField, 'fieldId' | 'fieldName'> & Partial<SchemaField>,
): SchemaField {
  return {
    schemaVersion: 1,
    fieldIndex: 0,
    section: 'methods',
    fieldLabel: overrides.fieldName,
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: '',
    example: null,
    aiGenerated: true,
    note: null,
    ...overrides,
  };
}

function makeDocument(overrides: Partial<DocumentRecord> & { documentId: string }): DocumentRecord {
  return {
    // 既定は 1 文書 = 1 study（study_id は document_id と同値）
    studyId: overrides.documentId,
    documentRole: 'article',
    driveFileId: 'drive-1',
    sourceFileId: 'source-1',
    filename: 'smith2020.pdf',
    pmid: null,
    doi: null,
    textRef: 'https://drive.example/text.txt',
    textStatus: 'ok',
    pageCount: 8,
    charCount: 4_000,
    importedAt: '2026-07-01T00:00:00Z',
    importedBy: 'tester@example.com',
    note: null,
    ...overrides,
  };
}

// fieldId 'f_design'（8 文字）+ fieldName 'study_design'（12 文字）。補助情報なし
const STUDY_FIELD = makeField({ fieldId: 'f_design', fieldName: 'study_design' });

/** テスト側で期待値を組み立てるための最小ミラー（1 バッチの入力トークン） */
function expectedTokensIn(docChars: number, fieldChars: number, protocolChars = 0): number {
  return Math.ceil(
    (PROMPT_SCAFFOLD_CHARS + protocolChars + fieldChars + docChars) / APPROX_CHARS_PER_TOKEN,
  );
}

const STUDY_FIELD_CHARS = FIELD_PROMPT_OVERHEAD_CHARS + 'f_design'.length + 'study_design'.length;
/** study 1 項目ぶんの出力トークン（1 要素 × 300 文字 ÷ 4） */
const STUDY_TOKENS_OUT = Math.ceil(OUTPUT_CHARS_PER_ITEM / APPROX_CHARS_PER_TOKEN);

describe('planRun の入力検証', () => {
  it('抽出項目が空なら投げる', () => {
    expect(() =>
      planRun({ documents: [makeDocument({ documentId: 'd1' })], fields: [], model: 'gemini-2.5-pro' }),
    ).toThrow('抽出項目が 1 件も');
  });

  it('対象文献が空なら投げる', () => {
    expect(() => planRun({ documents: [], fields: [STUDY_FIELD], model: 'gemini-2.5-pro' })).toThrow(
      '対象文献が 1 件も',
    );
  });

  it('schema_version が混在していたら投げる', () => {
    const v2Field = makeField({ fieldId: 'f_other', fieldName: 'other', schemaVersion: 2 });
    expect(() =>
      planRun({
        documents: [makeDocument({ documentId: 'd1' })],
        fields: [STUDY_FIELD, v2Field],
        model: 'gemini-2.5-pro',
      }),
    ).toThrow('schema_version の項目が混在');
  });
});

describe('planRun のバッチ分割', () => {
  it('予算内なら 1 document = スキーマ全項目の 1 バッチ（section: null）', () => {
    const plan = planRun({
      documents: [makeDocument({ documentId: 'd1' })],
      fields: [STUDY_FIELD],
      model: 'gemini-2.5-pro',
    });
    expect(plan.schemaVersion).toBe(1);
    expect(plan.model).toBe('gemini-2.5-pro');
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]).toEqual({
      documentId: 'd1',
      studyId: 'd1',
      section: null,
      fieldIds: ['f_design'],
      tokensInEstimate: expectedTokensIn(4_000, STUDY_FIELD_CHARS),
      tokensOutEstimate: STUDY_TOKENS_OUT,
      overBudget: false,
    });
    expect(plan.skippedDocuments).toHaveLength(0);
    expect(plan.warnings).toHaveLength(0);
  });

  it('全項目バッチの fieldIds は fieldIndex 昇順に並ぶ', () => {
    const second = makeField({ fieldId: 'f_b', fieldName: 'field_b', fieldIndex: 2 });
    const first = makeField({ fieldId: 'f_a', fieldName: 'field_a', fieldIndex: 1 });
    const plan = planRun({
      documents: [makeDocument({ documentId: 'd1' })],
      fields: [second, first],
      model: 'gemini-2.5-pro',
    });
    expect(plan.batches[0]?.fieldIds).toEqual(['f_a', 'f_b']);
  });

  it('出力予算を超えると section 単位に分割する（section は fieldIndex の出現順）', () => {
    const m1 = makeField({ fieldId: 'f_m1', fieldName: 'm1', fieldIndex: 1, section: 'methods' });
    const o1 = makeField({ fieldId: 'f_o1', fieldName: 'o1', fieldIndex: 2, section: 'outcomes' });
    const m2 = makeField({ fieldId: 'f_m2', fieldName: 'm2', fieldIndex: 3, section: 'methods' });
    const plan = planRun({
      documents: [makeDocument({ documentId: 'd1' })],
      fields: [o1, m2, m1],
      model: 'gemini-2.5-pro',
      // 全項目一括（3 要素 = 225 トークン）は超過、section 単位（150 / 75）は収まる予算
      budget: { maxOutputTokensPerCall: 200 },
    });
    expect(plan.batches).toHaveLength(2);
    expect(plan.batches[0]).toMatchObject({
      documentId: 'd1',
      section: 'methods',
      fieldIds: ['f_m1', 'f_m2'],
      overBudget: false,
    });
    expect(plan.batches[1]).toMatchObject({
      documentId: 'd1',
      section: 'outcomes',
      fieldIds: ['f_o1'],
      overBudget: false,
    });
    expect(plan.warnings).toHaveLength(0);
  });

  it('section 分割後も予算超過なら overBudget を立てて警告する', () => {
    const m1 = makeField({ fieldId: 'f_m1', fieldName: 'm1', fieldIndex: 1, section: 'methods' });
    const m2 = makeField({ fieldId: 'f_m2', fieldName: 'm2', fieldIndex: 2, section: 'methods' });
    const o1 = makeField({ fieldId: 'f_o1', fieldName: 'o1', fieldIndex: 3, section: 'outcomes' });
    const plan = planRun({
      documents: [makeDocument({ documentId: 'd1' })],
      fields: [m1, m2, o1],
      model: 'gemini-2.5-pro',
      // methods（150 トークン）は超過のまま、outcomes（75 トークン）は収まる予算
      budget: { maxOutputTokensPerCall: 100 },
    });
    expect(plan.batches).toHaveLength(2);
    expect(plan.batches[0]?.overBudget).toBe(true);
    expect(plan.batches[1]?.overBudget).toBe(false);
    expect(plan.warnings).toEqual([
      'section 分割後もトークン予算を超えるバッチが 1 件あります（応答の欠落・打ち切りに注意）',
    ]);
  });

  it('入力トークンが予算を超えても section 分割にフォールバックする', () => {
    // 既定予算 200,000 トークン（= 800,000 文字）を大きく超える本文
    const hugeDoc = makeDocument({ documentId: 'd1', charCount: 10_000_000 });
    const m1 = makeField({ fieldId: 'f_m1', fieldName: 'm1', fieldIndex: 1, section: 'methods' });
    const o1 = makeField({ fieldId: 'f_o1', fieldName: 'o1', fieldIndex: 2, section: 'outcomes' });
    const plan = planRun({
      documents: [hugeDoc],
      fields: [m1, o1],
      model: 'gemini-2.5-pro',
    });
    // 本文は各バッチへ重複投入されるため、どの section も入力超過のまま
    expect(plan.batches).toHaveLength(2);
    expect(plan.batches.every((batch) => batch.overBudget)).toBe(true);
    expect(plan.warnings).toEqual([
      'section 分割後もトークン予算を超えるバッチが 2 件あります（応答の欠落・打ち切りに注意）',
    ]);
  });
});

describe('planRun のトークン概算', () => {
  it('entity_level ごとの応答要素数の目安を出力トークンに反映する', () => {
    const fields = [
      makeField({ fieldId: 'f_s', fieldName: 's', fieldIndex: 1, entityLevel: 'study' }),
      makeField({ fieldId: 'f_a', fieldName: 'a', fieldIndex: 2, entityLevel: 'arm' }),
      makeField({ fieldId: 'f_o', fieldName: 'o', fieldIndex: 3, entityLevel: 'outcome_result' }),
      makeField({ fieldId: 'f_r', fieldName: 'r', fieldIndex: 4, entityLevel: 'rob_domain' }),
    ];
    const plan = planRun({
      documents: [makeDocument({ documentId: 'd1' })],
      fields,
      model: 'gemini-2.5-pro',
    });
    const items =
      ENTITY_INSTANCE_ESTIMATE.study +
      ENTITY_INSTANCE_ESTIMATE.arm +
      ENTITY_INSTANCE_ESTIMATE.outcome_result +
      ENTITY_INSTANCE_ESTIMATE.rob_domain;
    expect(plan.batches[0]?.tokensOutEstimate).toBe(
      Math.ceil((items * OUTPUT_CHARS_PER_ITEM) / APPROX_CHARS_PER_TOKEN),
    );
  });

  it('unit / allowed_values / instruction / example の文字数を入力トークンに反映する', () => {
    const richField = makeField({
      fieldId: 'f_dose',
      fieldName: 'dose',
      unit: 'mg/day',
      allowedValues: 'low|high',
      extractionInstruction: 'Extract the daily dose.',
      example: '50 mg/day',
    });
    const richChars =
      FIELD_PROMPT_OVERHEAD_CHARS +
      'f_dose'.length +
      'dose'.length +
      'mg/day'.length +
      'low|high'.length +
      'Extract the daily dose.'.length +
      '50 mg/day'.length;
    const plan = planRun({
      documents: [makeDocument({ documentId: 'd1' })],
      fields: [richField],
      model: 'gemini-2.5-pro',
    });
    expect(plan.batches[0]?.tokensInEstimate).toBe(expectedTokensIn(4_000, richChars));
  });

  it('protocolContext の文字数を入力トークンに加算する', () => {
    const protocolContext = 'x'.repeat(400);
    const plan = planRun({
      documents: [makeDocument({ documentId: 'd1' })],
      fields: [STUDY_FIELD],
      model: 'gemini-2.5-pro',
      protocolContext,
    });
    expect(plan.batches[0]?.tokensInEstimate).toBe(expectedTokensIn(4_000, STUDY_FIELD_CHARS, 400));
  });

  it('char_count 欠損時は page_count × 目安文字数で概算し、警告を出す', () => {
    const doc = makeDocument({ documentId: 'd1', charCount: null, pageCount: 5 });
    const plan = planRun({ documents: [doc], fields: [STUDY_FIELD], model: 'gemini-2.5-pro' });
    expect(plan.batches[0]?.tokensInEstimate).toBe(
      expectedTokensIn(5 * FALLBACK_CHARS_PER_PAGE, STUDY_FIELD_CHARS),
    );
    expect(plan.warnings).toEqual(['文字数が未取得の文献 1 件は既定値で概算しています']);
  });

  it('char_count / page_count とも欠損時は既定文字数で概算する', () => {
    const doc = makeDocument({ documentId: 'd1', charCount: null, pageCount: null });
    const plan = planRun({ documents: [doc], fields: [STUDY_FIELD], model: 'gemini-2.5-pro' });
    expect(plan.batches[0]?.tokensInEstimate).toBe(
      expectedTokensIn(FALLBACK_DOCUMENT_CHARS, STUDY_FIELD_CHARS),
    );
  });

  it('複数文献のトークン概算はバッチ合計になる', () => {
    const plan = planRun({
      documents: [
        makeDocument({ documentId: 'd1', charCount: 4_000 }),
        makeDocument({ documentId: 'd2', charCount: 8_000 }),
      ],
      fields: [STUDY_FIELD],
      model: 'gemini-2.5-pro',
    });
    expect(plan.tokensInEstimate).toBe(
      expectedTokensIn(4_000, STUDY_FIELD_CHARS) + expectedTokensIn(8_000, STUDY_FIELD_CHARS),
    );
    expect(plan.tokensOutEstimate).toBe(STUDY_TOKENS_OUT * 2);
  });
});

describe('planRun のコスト概算と対象外文献', () => {
  it('単価表にあるモデルは合計トークンからコストを概算する', () => {
    const plan = planRun({
      documents: [makeDocument({ documentId: 'd1' })],
      fields: [STUDY_FIELD],
      model: 'gemini-2.5-pro',
    });
    expect(plan.costEstimateUsd).toBe(
      estimateCostUsd('gemini-2.5-pro', plan.tokensInEstimate, plan.tokensOutEstimate),
    );
    expect(plan.costEstimateUsd).toBeGreaterThan(0);
  });

  it('単価表に無いモデルはコスト null + 警告', () => {
    const plan = planRun({
      documents: [makeDocument({ documentId: 'd1' })],
      fields: [STUDY_FIELD],
      model: 'unknown-model',
    });
    expect(plan.costEstimateUsd).toBeNull();
    expect(plan.warnings).toEqual(['モデル「unknown-model」は単価表に無いためコストを概算できません']);
  });

  it('テキスト層がない文献は skippedDocuments に回して警告する', () => {
    const plan = planRun({
      documents: [
        makeDocument({ documentId: 'd1' }),
        makeDocument({ documentId: 'd2', textStatus: 'no_text_layer', textRef: null }),
      ],
      fields: [STUDY_FIELD],
      model: 'gemini-2.5-pro',
    });
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]?.documentId).toBe('d1');
    expect(plan.skippedDocuments).toEqual([{ documentId: 'd2', reason: 'no_text_layer' }]);
    expect(plan.warnings).toEqual([
      'テキスト層がない文献 1 件は今回の抽出対象外です（text_only モードでは抽出できません）',
    ]);
  });

  it('全文献が対象外ならバッチ 0 件・トークン 0 で返す', () => {
    const plan = planRun({
      documents: [makeDocument({ documentId: 'd1', textStatus: 'no_text_layer', textRef: null })],
      fields: [STUDY_FIELD],
      model: 'gemini-2.5-pro',
    });
    expect(plan.batches).toHaveLength(0);
    expect(plan.tokensInEstimate).toBe(0);
    expect(plan.tokensOutEstimate).toBe(0);
    expect(plan.costEstimateUsd).toBe(0);
  });
});

describe('既定トークン予算', () => {
  it('入力 200,000 / 出力 8,000 トークンを既定とする', () => {
    expect(DEFAULT_RUN_TOKEN_BUDGET).toEqual({
      maxInputTokensPerCall: 200_000,
      maxOutputTokensPerCall: 8_000,
    });
  });
});
