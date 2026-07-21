// planRun（一括抽出の実行計画）の単体テスト
// - バッチ分割: スキーマ全項目 1 バッチ ⇔ トークン予算超過時の section 単位分割
// - トークン概算: 文字数 ÷ 4 の目安、char_count 欠損時のフォールバック、entity_level 別の応答要素数
// - コスト概算: lib/llm/pricing の単価表との結線、未知モデルは null + 警告
// - pdf_native（handoff-scanned-pdf-native-highlight.md §7.4 PR2）: no_text_layer 文書は除外せず
//   画像入力（imageDocumentIds）としてバッチへ含める。トークン概算はテキスト文書ぶん（文字数 ÷ 4）と
//   画像文書ぶん（ページ数 × 画像トークン単価）を別建てで計算してから合算する
import type { DocumentRecord } from '../../../../src/domain/document';
import type { SchemaField } from '../../../../src/domain/schemaField';
import {
  APPROX_CHARS_PER_TOKEN,
  DEFAULT_RUN_TOKEN_BUDGET,
  DOCUMENT_SEPARATOR_CHARS,
  ENTITY_INSTANCE_ESTIMATE,
  FALLBACK_CHARS_PER_PAGE,
  FALLBACK_DOCUMENT_CHARS,
  FALLBACK_DOCUMENT_PAGES,
  FIELD_PROMPT_OVERHEAD_CHARS,
  OUTPUT_CHARS_PER_ITEM,
  PROMPT_SCAFFOLD_CHARS,
  planRun,
} from '../../../../src/features/extraction/planRun';
import { APPROX_IMAGE_TOKENS_PER_PAGE, estimateCostUsd } from '../../../../src/lib/llm/pricing';
import { EXTRACT_DATA_ARM_COMPLETENESS_RULE } from '../../../../src/features/extraction/skills/extractData';

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

/**
 * テスト側で期待値を組み立てるための最小ミラー（1 バッチの入力トークン。テキスト文書ぶん）。
 * v0.10: 連結する各文書に見出し（DOCUMENT_SEPARATOR_CHARS）が付く。docChars は文書別の本文文字数の配列。
 * 画像文書ぶんは expectedImageTokens で別建てに計算し、この関数の戻り値へ加算する。
 * extraChars は arm レベル項目を含むバッチの completeness 強調ぶん（issue #97）等の追加文字数
 */
function expectedTokensIn(
  docCharsList: number | number[],
  fieldChars: number,
  protocolChars = 0,
  extraChars = 0,
): number {
  const list = Array.isArray(docCharsList) ? docCharsList : [docCharsList];
  const bodyChars = list.reduce((sum, chars) => sum + DOCUMENT_SEPARATOR_CHARS + chars, 0);
  return Math.ceil(
    (PROMPT_SCAFFOLD_CHARS + protocolChars + fieldChars + bodyChars + extraChars) /
      APPROX_CHARS_PER_TOKEN,
  );
}

/** 画像文書 1 件ぶんの入力トークン期待値（pdf_native）: ページ数 × 単価 + 見出しぶん */
function expectedImageTokens(pages: number): number {
  return pages * APPROX_IMAGE_TOKENS_PER_PAGE + DOCUMENT_SEPARATOR_CHARS / APPROX_CHARS_PER_TOKEN;
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
      studyId: 'd1',
      documentIds: ['d1'],
      imageDocumentIds: [],
      augmentedImageDocumentIds: [],
      section: null,
      fieldIds: ['f_design'],
      tokensInEstimate: expectedTokensIn(4_000, STUDY_FIELD_CHARS),
      tokensOutEstimate: STUDY_TOKENS_OUT,
      overBudget: false,
    });
    expect(plan.inputMode).toBe('text_only');
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
      studyId: 'd1',
      documentIds: ['d1'],
      section: 'methods',
      fieldIds: ['f_m1', 'f_m2'],
      overBudget: false,
    });
    expect(plan.batches[1]).toMatchObject({
      studyId: 'd1',
      documentIds: ['d1'],
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

  it('arm レベル項目を含むバッチは completeness 強調ぶんの文字数を入力トークンへ加算する（issue #97: buildSuffixSections の追記と概算を同期）', () => {
    const armField = makeField({ fieldId: 'f_arm_n', fieldName: 'arm_n', entityLevel: 'arm' });
    const armChars = FIELD_PROMPT_OVERHEAD_CHARS + 'f_arm_n'.length + 'arm_n'.length;
    const plan = planRun({
      documents: [makeDocument({ documentId: 'd1' })],
      fields: [armField],
      model: 'gemini-2.5-pro',
    });
    // + 2 はセクション結合の '\n\n' ぶん（estimateBatch の armCompletenessChars と同じ式）
    expect(plan.batches[0]?.tokensInEstimate).toBe(
      expectedTokensIn(4_000, armChars, 0, EXTRACT_DATA_ARM_COMPLETENESS_RULE.length + 2),
    );
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

describe('planRun の study 単位グルーピング（v0.10）', () => {
  it('同一 study の複数文書は 1 バッチに連結し、documentIds は role 固定順 → 取り込み順', () => {
    // 取り込み順は registration(order0) → article(order1) だが、role 順で article が先に来る
    const plan = planRun({
      documents: [
        makeDocument({
          documentId: 'reg',
          studyId: 's1',
          documentRole: 'registration',
          charCount: 1_000,
        }),
        makeDocument({
          documentId: 'art',
          studyId: 's1',
          documentRole: 'article',
          charCount: 2_000,
        }),
      ],
      fields: [STUDY_FIELD],
      model: 'gemini-2.5-pro',
    });
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]?.studyId).toBe('s1');
    expect(plan.batches[0]?.documentIds).toEqual(['art', 'reg']);
    expect(plan.batches[0]?.imageDocumentIds).toEqual([]);
    // 入力トークンは 2 文書の本文 + 見出しの合計
    expect(plan.batches[0]?.tokensInEstimate).toBe(
      expectedTokensIn([2_000, 1_000], STUDY_FIELD_CHARS),
    );
  });

  it('study 内の no_text_layer 文書は除外せず、画像入力（imageDocumentIds）として連結する（pdf_native）', () => {
    const plan = planRun({
      documents: [
        makeDocument({ documentId: 'art', studyId: 's1', documentRole: 'article', charCount: 2_000 }),
        makeDocument({
          documentId: 'scan',
          studyId: 's1',
          documentRole: 'supplement',
          textStatus: 'no_text_layer',
          textRef: null,
          pageCount: 3,
        }),
      ],
      fields: [STUDY_FIELD],
      model: 'gemini-2.5-pro',
    });
    expect(plan.batches).toHaveLength(1);
    // documentIds は role 固定順（article → supplement）のまま no_text_layer 文書も含む
    expect(plan.batches[0]?.documentIds).toEqual(['art', 'scan']);
    expect(plan.batches[0]?.imageDocumentIds).toEqual(['scan']);
    expect(plan.inputMode).toBe('pdf_native');
    // テキスト文書ぶん（本文 2,000 文字）と画像文書ぶん（3 ページ）を別建てで合算する
    expect(plan.batches[0]?.tokensInEstimate).toBe(
      expectedTokensIn([2_000], STUDY_FIELD_CHARS) + expectedImageTokens(3),
    );
  });

  it('全文書が no_text_layer の study も除外せず、画像入力のみのバッチを作る', () => {
    const plan = planRun({
      documents: [
        makeDocument({
          documentId: 'a',
          studyId: 's1',
          textStatus: 'no_text_layer',
          textRef: null,
          pageCount: 2,
        }),
        makeDocument({ documentId: 'b', studyId: 's2', charCount: 3_000 }),
      ],
      fields: [STUDY_FIELD],
      model: 'gemini-2.5-pro',
    });
    expect(plan.batches).toHaveLength(2);
    const s1Batch = plan.batches.find((batch) => batch.studyId === 's1');
    const s2Batch = plan.batches.find((batch) => batch.studyId === 's2');
    expect(s1Batch?.documentIds).toEqual(['a']);
    expect(s1Batch?.imageDocumentIds).toEqual(['a']);
    expect(s1Batch?.tokensInEstimate).toBe(expectedTokensIn([], STUDY_FIELD_CHARS) + expectedImageTokens(2));
    expect(s2Batch?.documentIds).toEqual(['b']);
    expect(s2Batch?.imageDocumentIds).toEqual([]);
    expect(plan.inputMode).toBe('pdf_native');
  });

  it('DOCUMENT_ROLE_ORDER に無いロールは末尾へ並べる（未知が先・防御的フォールバック）', () => {
    const plan = planRun({
      documents: [
        makeDocument({
          documentId: 'unknown',
          studyId: 's1',
          documentRole: 'weird' as DocumentRecord['documentRole'],
          charCount: 1_000,
        }),
        makeDocument({ documentId: 'art', studyId: 's1', documentRole: 'article', charCount: 2_000 }),
      ],
      fields: [STUDY_FIELD],
      model: 'gemini-2.5-pro',
    });
    expect(plan.batches[0]?.documentIds).toEqual(['art', 'unknown']);
  });

  it('未知ロールが複数あっても末尾へ取り込み順で並べる（比較の全方向を網羅）', () => {
    const plan = planRun({
      documents: [
        makeDocument({ documentId: 'art', studyId: 's1', documentRole: 'article', charCount: 2_000 }),
        makeDocument({
          documentId: 'wa',
          studyId: 's1',
          documentRole: 'weird-a' as DocumentRecord['documentRole'],
          charCount: 1_000,
        }),
        makeDocument({
          documentId: 'wb',
          studyId: 's1',
          documentRole: 'weird-b' as DocumentRecord['documentRole'],
          charCount: 1_000,
        }),
      ],
      fields: [STUDY_FIELD],
      model: 'gemini-2.5-pro',
    });
    expect(plan.batches[0]?.documentIds).toEqual(['art', 'wa', 'wb']);
  });
});

describe('planRun の画像文書のトークン概算（pdf_native）', () => {
  it('FALLBACK_DOCUMENT_PAGES は FALLBACK_DOCUMENT_CHARS / FALLBACK_CHARS_PER_PAGE（= 10）', () => {
    expect(FALLBACK_DOCUMENT_PAGES).toBe(10);
    expect(FALLBACK_DOCUMENT_PAGES).toBe(FALLBACK_DOCUMENT_CHARS / FALLBACK_CHARS_PER_PAGE);
  });

  it('page_count がある画像文書はページ数 × APPROX_IMAGE_TOKENS_PER_PAGE + 見出しぶんで概算する', () => {
    const plan = planRun({
      documents: [
        makeDocument({
          documentId: 'd1',
          textStatus: 'no_text_layer',
          textRef: null,
          pageCount: 7,
          charCount: null,
        }),
      ],
      fields: [STUDY_FIELD],
      model: 'gemini-2.5-pro',
    });
    expect(plan.batches[0]?.tokensInEstimate).toBe(
      expectedTokensIn([], STUDY_FIELD_CHARS) + expectedImageTokens(7),
    );
    // 画像文書は char_count を使わないため「文字数が未取得」の警告は出さない
    expect(plan.warnings).not.toContain('文字数が未取得の文献 1 件は既定値で概算しています');
  });

  it('page_count 欠損の画像文書は FALLBACK_DOCUMENT_PAGES で概算する', () => {
    const plan = planRun({
      documents: [
        makeDocument({
          documentId: 'd1',
          textStatus: 'no_text_layer',
          textRef: null,
          pageCount: null,
          charCount: null,
        }),
      ],
      fields: [STUDY_FIELD],
      model: 'gemini-2.5-pro',
    });
    expect(plan.batches[0]?.tokensInEstimate).toBe(
      expectedTokensIn([], STUDY_FIELD_CHARS) + expectedImageTokens(FALLBACK_DOCUMENT_PAGES),
    );
  });

  it('study 内で text + image が混在する場合、テキスト分と画像分を別建てで合算する', () => {
    const plan = planRun({
      documents: [
        makeDocument({ documentId: 'art', studyId: 's1', documentRole: 'article', charCount: 5_000 }),
        makeDocument({
          documentId: 'scan',
          studyId: 's1',
          documentRole: 'supplement',
          textStatus: 'no_text_layer',
          textRef: null,
          pageCount: 4,
        }),
      ],
      fields: [STUDY_FIELD],
      model: 'gemini-2.5-pro',
    });
    expect(plan.batches[0]?.tokensInEstimate).toBe(
      expectedTokensIn([5_000], STUDY_FIELD_CHARS) + expectedImageTokens(4),
    );
  });
});

describe('planRun のコスト概算と画像入力（pdf_native）の警告', () => {
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

  it('画像入力が無ければ inputMode は text_only で pdf_native の警告も出さない', () => {
    const plan = planRun({
      documents: [makeDocument({ documentId: 'd1' })],
      fields: [STUDY_FIELD],
      model: 'gemini-2.5-pro',
    });
    expect(plan.inputMode).toBe('text_only');
    expect(plan.warnings).toHaveLength(0);
  });

  it('テキスト層がない文献は画像入力として含め、pdf_native の警告を出す（対象外にはしない）', () => {
    const plan = planRun({
      documents: [
        makeDocument({ documentId: 'd1' }),
        makeDocument({
          documentId: 'd2',
          textStatus: 'no_text_layer',
          textRef: null,
          pageCount: 4,
        }),
      ],
      fields: [STUDY_FIELD],
      model: 'gemini-2.5-pro',
    });
    expect(plan.batches).toHaveLength(2);
    expect(plan.batches.find((b) => b.studyId === 'd1')?.imageDocumentIds).toEqual([]);
    expect(plan.batches.find((b) => b.studyId === 'd2')?.imageDocumentIds).toEqual(['d2']);
    expect(plan.inputMode).toBe('pdf_native');
    expect(plan.warnings).toEqual([
      'テキスト層がない文献 1 件はページ画像として LLM へ送信します（pdf_native。画像トークンぶんコストが増えます）',
    ]);
  });

  it('全文献が no_text_layer でも「対象外」にはせず、1 study 1 バッチとして画像入力で計画する', () => {
    const plan = planRun({
      documents: [
        makeDocument({
          documentId: 'd1',
          textStatus: 'no_text_layer',
          textRef: null,
          pageCount: 5,
        }),
      ],
      fields: [STUDY_FIELD],
      model: 'gemini-2.5-pro',
    });
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]?.imageDocumentIds).toEqual(['d1']);
    expect(plan.tokensInEstimate).toBeGreaterThan(0);
    expect(plan.inputMode).toBe('pdf_native');
    expect(plan.warnings).toEqual([
      'テキスト層がない文献 1 件はページ画像として LLM へ送信します（pdf_native。画像トークンぶんコストが増えます）',
    ]);
  });
});

describe('planRun の高精度読み取りモード（issue #176・input_mode = text_with_page_images）', () => {
  it('highAccuracyImages 省略時は従来どおり（既定は変えない。既存 batch の toEqual テストで augmentedImageDocumentIds: [] を確認済み）', () => {
    const plan = planRun({
      documents: [makeDocument({ documentId: 'd1', charCount: 4_000 })],
      fields: [STUDY_FIELD],
      model: 'gemini-2.5-pro',
    });
    expect(plan.batches[0]?.augmentedImageDocumentIds).toEqual([]);
    expect(plan.inputMode).toBe('text_only');
  });

  it('highAccuracyImages: false は明示指定でも省略時と同じ（既定を変えない）', () => {
    const plan = planRun({
      documents: [makeDocument({ documentId: 'd1', charCount: 4_000 })],
      fields: [STUDY_FIELD],
      model: 'gemini-2.5-pro',
      highAccuracyImages: false,
    });
    expect(plan.batches[0]?.augmentedImageDocumentIds).toEqual([]);
    expect(plan.inputMode).toBe('text_only');
    expect(plan.warnings).toHaveLength(0);
  });

  it('highAccuracyImages: true はテキスト層のある文献のページ画像トークンを追加算入し、input_mode = text_with_page_images + 警告を出す', () => {
    const plan = planRun({
      documents: [makeDocument({ documentId: 'd1', charCount: 4_000, pageCount: 3 })],
      fields: [STUDY_FIELD],
      model: 'gemini-2.5-pro',
      highAccuracyImages: true,
    });
    expect(plan.batches[0]?.imageDocumentIds).toEqual([]);
    expect(plan.batches[0]?.augmentedImageDocumentIds).toEqual(['d1']);
    // テキストぶん（従来どおり）+ 画像ぶん（ページ数 × 画像トークン単価 + 見出しぶん）を別建てで合算する
    expect(plan.batches[0]?.tokensInEstimate).toBe(
      expectedTokensIn(4_000, STUDY_FIELD_CHARS) + expectedImageTokens(3),
    );
    expect(plan.inputMode).toBe('text_with_page_images');
    expect(plan.warnings).toEqual([
      '高精度読み取りモード: テキスト層がある文献 1 件のページ画像も追加送信します（トークン消費量が大幅に増えます）',
    ]);
  });

  it('study 内に text と no_text_layer が混在する場合、両方の警告を出し augmentedImageDocumentIds は text 文書のみに限る（no_text_layer への「追加」はしない）', () => {
    const plan = planRun({
      documents: [
        makeDocument({ documentId: 'art', studyId: 's1', documentRole: 'article', charCount: 2_000 }),
        makeDocument({
          documentId: 'scan',
          studyId: 's1',
          documentRole: 'supplement',
          textStatus: 'no_text_layer',
          textRef: null,
          pageCount: 4,
        }),
      ],
      fields: [STUDY_FIELD],
      model: 'gemini-2.5-pro',
      highAccuracyImages: true,
    });
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]?.imageDocumentIds).toEqual(['scan']);
    expect(plan.batches[0]?.augmentedImageDocumentIds).toEqual(['art']);
    expect(plan.inputMode).toBe('text_with_page_images');
    expect(plan.warnings).toEqual([
      'テキスト層がない文献 1 件はページ画像として LLM へ送信します（pdf_native。画像トークンぶんコストが増えます）',
      '高精度読み取りモード: テキスト層がある文献 1 件のページ画像も追加送信します（トークン消費量が大幅に増えます）',
    ]);
  });

  it('highAccuracyImages: true でも全文書が no_text_layer なら augmentedImageDocumentIds は 0 件のまま（実際には何も変わらないため input_mode は pdf_native）', () => {
    const plan = planRun({
      documents: [
        makeDocument({
          documentId: 'd1',
          textStatus: 'no_text_layer',
          textRef: null,
          pageCount: 5,
        }),
      ],
      fields: [STUDY_FIELD],
      model: 'gemini-2.5-pro',
      highAccuracyImages: true,
    });
    expect(plan.batches[0]?.augmentedImageDocumentIds).toEqual([]);
    expect(plan.inputMode).toBe('pdf_native');
    expect(plan.warnings).toEqual([
      'テキスト層がない文献 1 件はページ画像として LLM へ送信します（pdf_native。画像トークンぶんコストが増えます）',
    ]);
  });

  it('section 分割時も highAccuracyImages を各バッチへ同じ値で適用する', () => {
    // 出力予算を超えると section 単位に分割するテスト（既存「planRun のバッチ分割」と同じ設定）と
    // 同じ 3 項目 2 section 構成で、確実に分割させる
    const m1 = makeField({ fieldId: 'f_m1', fieldName: 'm1', fieldIndex: 1, section: 'methods' });
    const o1 = makeField({ fieldId: 'f_o1', fieldName: 'o1', fieldIndex: 2, section: 'outcomes' });
    const m2 = makeField({ fieldId: 'f_m2', fieldName: 'm2', fieldIndex: 3, section: 'methods' });
    const plan = planRun({
      documents: [makeDocument({ documentId: 'd1', charCount: 4_000, pageCount: 2 })],
      fields: [o1, m2, m1],
      model: 'gemini-2.5-pro',
      highAccuracyImages: true,
      budget: { maxOutputTokensPerCall: 200 },
    });
    expect(plan.batches).toHaveLength(2);
    for (const batch of plan.batches) {
      expect(batch.augmentedImageDocumentIds).toEqual(['d1']);
    }
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
