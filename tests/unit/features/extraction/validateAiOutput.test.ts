// validateAiOutput の単体テスト（docs/test-strategy.md §2.4:
// zod 形状検証 + 「値と quote の矛盾 → confidence=low 強制」を AI 応答 fixture JSON で網羅）
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { SchemaField } from '../../../../src/domain/schemaField';
import {
  AiOutputFormatError,
  validateAiOutput,
  validateBox,
} from '../../../../src/features/extraction/validateAiOutput';

function makeField(
  overrides: Pick<SchemaField, 'fieldId' | 'fieldName' | 'entityLevel' | 'dataType'> &
    Partial<SchemaField>,
): SchemaField {
  return {
    maxQuotes: null,
    multiSelect: null,
    schemaVersion: 1,
    fieldIndex: 0,
    section: 'methods',
    fieldLabel: overrides.fieldName,
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

const FIELDS: SchemaField[] = [
  makeField({ fieldId: 'f_design', fieldName: 'study_design', entityLevel: 'study', dataType: 'text' }),
  makeField({ fieldId: 'f_country', fieldName: 'country', entityLevel: 'study', dataType: 'text' }),
  makeField({
    fieldId: 'f_total_n',
    fieldName: 'sample_size_total',
    entityLevel: 'study',
    dataType: 'integer',
  }),
  makeField({ fieldId: 'f_arm_n', fieldName: 'sample_size_arm', entityLevel: 'arm', dataType: 'integer' }),
  makeField({
    fieldId: 'f_mean_change',
    fieldName: 'sbp_mean_change',
    entityLevel: 'outcome_result',
    dataType: 'float',
  }),
];

/** 1 要素だけを検証するヘルパ（既定は矛盾のない study レベル text 項目・文書 1 件） */
function runOne(element: Record<string, unknown>, documentCount = 1) {
  return validateAiOutput(
    [{ field_id: 'f_design', entity_key: '-', not_reported: false, ...element }],
    FIELDS,
    documentCount,
  );
}

describe('validateAiOutput', () => {
  describe('応答全体の形式', () => {
    it.each([null, {}, 'text', 42])('配列でない応答 %p は AiOutputFormatError', (raw) => {
      expect(() => validateAiOutput(raw, FIELDS, 1)).toThrow(AiOutputFormatError);
    });

    it('空配列は空の結果を返す', () => {
      expect(validateAiOutput([], FIELDS, 1)).toEqual({ items: [], rejected: [] });
    });
  });

  describe('fixture JSON（Gemini 応答相当の混在ケース）', () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, '../../../fixtures/ai-output/extract-data-response.json'), 'utf8'),
    ) as unknown;
    const result = validateAiOutput(raw, FIELDS, 1);

    it('妥当な 6 要素が items、不正な 3 要素が rejected になる', () => {
      expect(result.items).toHaveLength(6);
      expect(result.rejected).toHaveLength(3);
    });

    it('矛盾のない要素は自己申告 confidence を保持する（field_name 補助キーは無視）', () => {
      expect(result.items[0]).toEqual({
        quoteTheme: null,
        quoteSeq: null,
        section: null,
        fieldId: 'f_design',
        entityKey: '-',
        value: 'randomized controlled trial',
        notReported: false,
        quote: 'In this randomized controlled trial, we enrolled adults with hypertension.',
        page: 1,
        // document_index 欠落 + 文書 1 件なので既定で 1 に解決される
        documentIndex: 1,
        confidence: 'high',
        forcedLowReasons: [],
        // box_2d を含まない応答（requestBox=false 相当）は box: null
        box: null,
      });
      // 数値の value は文字列化して保持
      expect(result.items[1]).toMatchObject({
      quoteTheme: null,
      quoteSeq: null, value: '128', confidence: 'high', forcedLowReasons: [] });
    });

    it('値の数値が quote に無い要素は confidence=low を強制する（page 0 は null に落ちる）', () => {
      expect(result.items[2]).toMatchObject({
        quoteTheme: null,
        quoteSeq: null,
        section: null,
        value: '142',
        page: null,
        confidence: 'low',
        forcedLowReasons: ['number_not_in_quote'],
      });
    });

    it('値があるのに quote が無い要素は confidence=low を強制する', () => {
      expect(result.items[3]).toMatchObject({
        quoteTheme: null,
        quoteSeq: null,
        section: null,
        entityKey: 'arm:1',
        quote: null,
        confidence: 'low',
        forcedLowReasons: ['missing_quote'],
      });
    });

    it('not_reported=true なのに値がある要素は confidence=low を強制する（中黒小数点 −12·5 は 12.5 と照合できる）', () => {
      expect(result.items[4]).toMatchObject({
        quoteTheme: null,
        quoteSeq: null,
        section: null,
        confidence: 'low',
        forcedLowReasons: ['value_with_not_reported'],
      });
    });

    it('未知の confidence 値は null に落とし、矛盾がなければ強制しない', () => {
      expect(result.items[5]).toMatchObject({
        quoteTheme: null,
        quoteSeq: null,
        section: null,
        fieldId: 'f_country',
        confidence: null,
        forcedLowReasons: [],
      });
    });

    it('未知の field_id / entity_key 欠落 / entity_level 不整合は元位置つきで破棄する', () => {
      expect(result.rejected).toEqual([
        expect.objectContaining({
          index: 6,
          reason: 'unknown_field_id',
          detail: expect.stringContaining('f_unknown'),
        }),
        expect.objectContaining({
          index: 7,
          reason: 'invalid_shape',
          detail: expect.stringContaining('entity_key'),
        }),
        expect.objectContaining({
          index: 8,
          reason: 'entity_key_mismatch',
          detail: expect.stringContaining('sample_size_arm'),
        }),
      ]);
      expect(result.rejected[2]?.raw).toEqual((raw as unknown[])[8]);
    });
  });

  describe('要素の形状検証（zod）', () => {
    it('残りの応答が entity_key に飲み込まれた要素を invalid_shape として破棄する', () => {
      const element = {
        field_id: 'f_design',
        entity_key: '-", "value": "explore the experiences of participants", "not_reported": false, "quote": "participants described challenges" }, {"field_id": "f_country", "value": "Japan" }',
      };
      const raw: unknown = JSON.parse(JSON.stringify([element]));
      expect(validateAiOutput(raw, FIELDS, 1)).toEqual({
        items: [],
        rejected: [{ index: 0, reason: 'invalid_shape', detail: expect.any(String), raw: element }],
      });
    });

    it.each(['"', '\n', '\r'])(
      'entity_key に不正文字 %p がある要素は正規化せず破棄する',
      (character) => {
        const element = { field_id: 'f_design', entity_key: `-${character}`, value: null };
        expect(validateAiOutput([element], FIELDS, 1)).toEqual({
          items: [],
          rejected: [{
            index: 0, reason: 'invalid_shape', detail: expect.stringContaining('entity_key'), raw: element,
          }],
        });
      },
    );

    it('抽出内容の 3 キーがすべて欠けた要素を破棄する', () => {
      const element = { field_id: 'f_design', entity_key: '-' };
      expect(validateAiOutput([element], FIELDS, 1)).toEqual({
        items: [],
        rejected: [{
          index: 0, reason: 'invalid_shape',
          detail: expect.stringContaining('value / not_reported / quote'), raw: element,
        }],
      });
    });

    it.each([
      [{ not_reported: true }, true],
      [{ value: null }, false],
      [{ quote: null }, false],
      [{ not_reported: true, value: null, quote: null }, true],
    ])('抽出内容のキーがある要素 %p は従来どおり通す', (content, notReported) => {
      const result = validateAiOutput([{ field_id: 'f_design', entity_key: '-', ...content }], FIELDS, 1);
      expect(result.rejected).toEqual([]);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ value: null, quote: null, notReported });
    });

    it('null の要素は invalid_shape として破棄する', () => {
      expect(validateAiOutput([null], FIELDS, 1)).toEqual({
        items: [],
        rejected: [{ index: 0, reason: 'invalid_shape', detail: expect.any(String), raw: null }],
      });
    });

    it('オブジェクトでない要素は invalid_shape（パスなし issue のメッセージ整形）', () => {
      const { rejected } = validateAiOutput(['oops'], FIELDS, 1);
      expect(rejected).toEqual([
        expect.objectContaining({ index: 0, reason: 'invalid_shape', raw: 'oops' }),
      ]);
      // パスなし issue はメッセージのみ（「path: message」の前置きが付かない）
      expect(rejected[0]?.detail).toMatch(/^Invalid input/);
    });

    it('空文字の field_id は invalid_shape', () => {
      const { rejected } = runOne({ field_id: '' });
      expect(rejected[0]?.reason).toBe('invalid_shape');
    });

    it('value の型が不正（オブジェクト）なら invalid_shape', () => {
      const { rejected } = runOne({ value: { nested: 1 } });
      expect(rejected[0]?.reason).toBe('invalid_shape');
    });

    it.each([
      ['真偽値は文字列化', false, 'false'],
      ['空白のみは null', '   ', null],
      ['null はそのまま', null, null],
      ['未指定は null', undefined, null],
    ])('value: %s', (_label, value, expected) => {
      const { items } = runOne({ value });
      expect(items[0]?.value).toBe(expected);
    });

    it.each([
      ['null は false', null, false],
      ['未指定は false', undefined, false],
      ['true は保持', true, true],
    ])('not_reported: %s', (_label, notReported, expected) => {
      const { items } = runOne({ not_reported: notReported });
      expect(items[0]?.notReported).toBe(expected);
    });

    it.each([
      ['空文字は null', '', null],
      ['空白のみは null', '  \n ', null],
      ['未指定は null', undefined, null],
      ['本文は保持', 'as reported previously', 'as reported previously'],
    ])('quote: %s', (_label, quote, expected) => {
      const { items } = runOne({ quote });
      expect(items[0]?.quote).toBe(expected);
    });

    it.each([
      ['正の整数は保持', 4, 4],
      ['非整数は null', 2.5, null],
      ['文字列は null', '3', null],
      ['未指定は null', undefined, null],
    ])('page（補助ヒントは寛容にパース）: %s', (_label, page, expected) => {
      const { items } = runOne({ page });
      expect(items[0]?.page).toBe(expected);
    });

    it('confidence 未指定は null', () => {
      const { items } = runOne({});
      expect(items[0]?.confidence).toBeNull();
    });
  });

  describe('entity_key と entity_level の整合', () => {
    // arm / outcome_result はインスタンス識別が必要なので不整合キーは破棄する
    it('arm 項目のパースできない entity_key は entity_key_mismatch', () => {
      const { rejected } = validateAiOutput(
        [{ field_id: 'f_arm_n', entity_key: 'bogus', value: '10', not_reported: false }],
        FIELDS,
        1,
      );
      expect(rejected[0]?.reason).toBe('entity_key_mismatch');
    });

    it('arm 項目に study キー相当は entity_key_mismatch', () => {
      const { rejected } = validateAiOutput(
        [{ field_id: 'f_arm_n', entity_key: '-', value: '10', not_reported: false }],
        FIELDS,
        1,
      );
      expect(rejected[0]?.reason).toBe('entity_key_mismatch');
    });

    // study レベルは 1 document 1 インスタンスでキーが決定的なので、
    // モデルの表記ゆれ（"study" / "_" / 誤った "arm:1" 等）は破棄せず '-' へ正規化する
    it.each(['-', 'study', '_', 'bogus', 'arm:1'])(
      'study 項目の entity_key %p は "-" に正規化して通す',
      (entityKey) => {
        const { items, rejected } = runOne({ entity_key: entityKey });
        expect(rejected).toEqual([]);
        expect(items[0]?.entityKey).toBe('-');
      },
    );

    it('outcome_result 項目は outcome キーで通る', () => {
      const { items } = validateAiOutput(
        [
          {
            field_id: 'f_mean_change',
            entity_key: 'outcome:sbp_change',
            value: '3.5',
            not_reported: false,
            quote: 'a reduction of 3.5 mm Hg',
          },
        ],
        FIELDS,
        1,
      );
      expect(items[0]?.forcedLowReasons).toEqual([]);
    });
  });

  describe('値と quote の矛盾 → confidence=low 強制', () => {
    it('矛盾検出時は自己申告 high でも low へ上書きする', () => {
      const { items } = runOne({ value: '42', quote: 'forty-two participants', confidence: 'high' });
      expect(items[0]).toMatchObject({
      quoteTheme: null,
      quoteSeq: null, confidence: 'low', forcedLowReasons: ['number_not_in_quote'] });
    });

    it('not_reported=true + 値あり + quote なしは理由を 2 件とも記録する', () => {
      const { items } = runOne({ value: '5', not_reported: true, quote: null });
      expect(items[0]?.forcedLowReasons).toEqual(['value_with_not_reported', 'missing_quote']);
    });

    it('not_reported=true で値が無ければ強制しない', () => {
      const { items } = runOne({ value: null, not_reported: true, confidence: 'medium' });
      expect(items[0]).toMatchObject({
      quoteTheme: null,
      quoteSeq: null, confidence: 'medium', forcedLowReasons: [] });
    });

    it('数値を含まない値は quote に数値がなくても矛盾にしない', () => {
      const { items } = runOne({ value: 'multicenter', quote: 'a multicenter study' });
      expect(items[0]?.forcedLowReasons).toEqual([]);
    });

    it.each([
      ['桁区切りカンマ同士', '1,234', 'of 1,234 patients'],
      ['カンマなし値 vs 桁区切り quote', '1234', 'of 1,234 patients'],
      ['小数の末尾ゼロ差', '12.50', 'was 12.5 kg'],
      ['全角数字の値', '１２８', '128 participants'],
      ['中黒小数点（U+00B7）', '12.5', 'was 12·5 mm Hg'],
      ['ドット演算子小数点（U+22C5）', '3.5', 'was 3⋅5 kg'],
      ['値側の中黒小数点', '3·5', 'was 3.5 kg'],
    ])('数値照合が表記ゆれを吸収する: %s', (_label, value, quote) => {
      const { items } = runOne({ value, quote });
      expect(items[0]?.forcedLowReasons).toEqual([]);
    });

    it('複数数値の一部だけ quote に無い場合も矛盾とする', () => {
      const { items } = runOne({ value: '64/128', quote: 'sixty-four of 128 participants' });
      expect(items[0]?.forcedLowReasons).toEqual(['number_not_in_quote']);
    });
  });

  describe('document_index の検証・解決（v0.10）', () => {
    const QUOTE = 'A randomized controlled trial of 120 patients.';

    it('quote があり範囲内の document_index はそのまま解決する', () => {
      const { items } = runOne({ quote: QUOTE, document_index: 2 }, 3);
      expect(items[0]?.documentIndex).toBe(2);
    });

    it('quote があるのに document_index が欠落・文書が複数なら破棄する', () => {
      const { items, rejected } = runOne({ quote: QUOTE }, 2);
      expect(items).toHaveLength(0);
      expect(rejected[0]).toMatchObject({ reason: 'invalid_document_index' });
      expect(rejected[0]?.detail).toContain('2');
    });

    it('quote があり document_index が範囲外なら破棄する', () => {
      const { rejected } = runOne({ quote: QUOTE, document_index: 5 }, 2);
      expect(rejected[0]?.reason).toBe('invalid_document_index');
    });

    it('quote があり document_index 欠落でも文書 1 件なら 1 に解決する', () => {
      const { items, rejected } = runOne({ quote: QUOTE }, 1);
      expect(rejected).toEqual([]);
      expect(items[0]?.documentIndex).toBe(1);
    });

    it('not_reported=true（quote なし）は document_index 不要で 1 に帰属する', () => {
      const { items, rejected } = runOne(
        { value: null, not_reported: true, quote: null, document_index: null },
        3,
      );
      expect(rejected).toEqual([]);
      expect(items[0]?.documentIndex).toBe(1);
    });

    it('quote なしで範囲内の document_index が来ればそれを尊重する', () => {
      const { items } = runOne(
        { value: null, not_reported: true, quote: null, document_index: 2 },
        3,
      );
      expect(items[0]?.documentIndex).toBe(2);
    });

    it('非整数の document_index は zod で null へ落ち、quote 複数文書なら破棄する', () => {
      const { rejected } = runOne({ quote: QUOTE, document_index: 1.5 }, 2);
      expect(rejected[0]?.reason).toBe('invalid_document_index');
    });
  });

  describe('validateBox（box_2d の検証。handoff-scanned-pdf-native-highlight.md §7.2）', () => {
    it.each([
      ['正常な 4 要素', [100, 200, 300, 400], { ymin: 100, xmin: 200, ymax: 300, xmax: 400 }],
      [
        '5 要素で末尾が 4 番目と同値なら先頭 4 要素へ復元',
        [100, 200, 300, 400, 400],
        { ymin: 100, xmin: 200, ymax: 300, xmax: 400 },
      ],
      ['5 要素で末尾が非重複なら null', [100, 200, 300, 400, 999], null],
      ['3 要素は null', [100, 200, 300], null],
      ['6 要素は null', [100, 200, 300, 400, 500, 600], null],
      ['範囲外（負数）は null', [-1, 200, 300, 400], null],
      ['範囲外（1000 超）は null', [100, 200, 300, 1001], null],
      ['順序逆（ymin>ymax）は null', [500, 200, 300, 400], null],
      ['順序逆（xmin>xmax）は null', [100, 500, 300, 400], null],
      ['非整数（小数）は null', [100.5, 200, 300, 400], null],
      ['非整数（NaN）は null', [Number.NaN, 200, 300, 400], null],
      ['非整数（文字列混入）は null', [100, '200', 300, 400], null],
      ['境界値 0/1000 は許容', [0, 0, 1000, 1000], { ymin: 0, xmin: 0, ymax: 1000, xmax: 1000 }],
      ['ymin=ymax・xmin=xmax（点）は許容', [100, 100, 100, 100], { ymin: 100, xmin: 100, ymax: 100, xmax: 100 }],
    ])('%s', (_label, raw, expected) => {
      expect(validateBox(raw)).toEqual(expected);
    });

    it.each([
      ['配列でない（オブジェクト）', { ymin: 1 }],
      ['配列でない（文字列）', '[1,2,3,4]'],
      ['null', null],
      ['undefined', undefined],
    ])('%s は null', (_label, raw) => {
      expect(validateBox(raw)).toBeNull();
    });
  });

  describe('box_2d の要素検証への組み込み（§7.4 PR3）', () => {
    it('妥当な box_2d は item.box に反映される', () => {
      const { items } = runOne({ box_2d: [100, 200, 300, 400] });
      expect(items[0]?.box).toEqual({ ymin: 100, xmin: 200, ymax: 300, xmax: 400 });
    });

    it('壊れた box_2d は破棄せず box のみ null に落とす（他フィールドは正常に処理される）', () => {
      const { items, rejected } = runOne({
        value: 'randomized controlled trial',
        quote: 'a randomized controlled trial',
        box_2d: [500, 200, 300, 400], // ymin > ymax の不正値
      });
      expect(rejected).toEqual([]);
      expect(items[0]?.box).toBeNull();
      expect(items[0]?.value).toBe('randomized controlled trial');
    });

    it('box_2d 欠落は null', () => {
      const { items } = runOne({});
      expect(items[0]?.box).toBeNull();
    });
  });
});

describe('複数の引用', () => {
  const field = makeField({ fieldId: 'themes', fieldName: 'themes', entityLevel: 'arm', dataType: 'text', maxQuotes: 2 });
  const item = (patch: Record<string, unknown> = {}) => ({
    field_id: 'themes', entity_key: 'arm:1', value: '10', quote: '10 participants',
    confidence: 'high', theme: ' 第一 ', ...patch,
  });
  test('セルごとに未報告を除き、先頭 N 件のテーマを連結する', () => {
    const result = validateAiOutput([
      item({ not_reported: true, value: null, quote: null }),
      item(), item({ theme: '第二', value: '20', quote: '20 participants' }),
      item({ theme: '超過' }), item({ entity_key: 'arm:2', theme: '別の群' }),
    ], [field], 1);
    expect(result.items.map((i) => [i.value, i.quoteTheme, i.quoteSeq, i.confidence])).toEqual([
      ['第一; 第二', '第一', 1, 'high'], ['第一; 第二', '第二', 2, 'high'],
      ['別の群', '別の群', 1, 'high'],
    ]);
    expect(result.rejected).toEqual([expect.objectContaining({ index: 3, reason: 'quote_limit' })]);
  });
  test('空のテーマは値へフォールバックし、どちらも空なら連結から除く', () => {
    const result = validateAiOutput([
      item({ theme: ' ', value: ' 内容 ', quote: '内容' }),
      item({ theme: null, value: null, quote: null }),
    ], [field], 1);
    expect(result.items.map((i) => [i.value, i.quoteTheme, i.quoteSeq]))
      .toEqual([['内容', null, 1], ['内容', null, 2]]);
    expect(validateAiOutput([item({ theme: '', value: ' ' })], [field], 1).items[0]?.value).toBeNull();
  });
  test('未報告だけなら先頭だけを残して通常行にする', () => {
    const result = validateAiOutput([item({ not_reported: true }), item({ not_reported: true })], [field], 1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ quoteTheme: null, quoteSeq: null });
  });
  test('矛盾検出は他の引用や連結後のテーマではなく要素自身の値を使う', () => {
    const result = validateAiOutput([
      item({ theme: '20', value: '10', quote: '10 people' }),
      item({ theme: '10', value: '30', quote: '20 people' }),
    ], [field], 1);
    expect(result.items[0]?.forcedLowReasons).toEqual([]);
    expect(result.items[1]?.forcedLowReasons).toEqual(['number_not_in_quote']);
  });
  test('theme 欠落も受理し、OFF の項目は theme と重複をそのまま無視する', () => {
    const legacy = item();
    delete (legacy as Record<string, unknown>).theme;
    expect(validateAiOutput([legacy], [field], 1).items[0]).toMatchObject({ quoteTheme: null, value: '10' });
    const result = validateAiOutput([item(), item()], [{ ...field, maxQuotes: null }], 1);
    expect(result.items).toHaveLength(2);
    expect(result.items.every((i) => i.quoteSeq === null && i.quoteTheme === null && i.value === '10')).toBe(true);
  });
});

describe('AI 応答の群の番号検証', () => {
  const fields = [
    ...FIELDS,
    makeField({ fieldId: 'f_rob', fieldName: 'rob', entityLevel: 'rob_domain', dataType: 'text' }),
  ];

  it.each([
    ['f_arm_n', 'arm:dcbt_i'],
    ['f_arm_n', 'arm:1a'],
    ['f_mean_change', 'outcome:isi|arm:dcbt_i|time:post_treatment'],
    ['f_mean_change', 'outcome:isi|arm:0'],
    ['f_mean_change', 'outcome:isi|arm:01'],
    ['f_rob', 'rob:d1|outcome:isi|arm:book'],
  ])('正の整数でない群を破棄する（%s / %s）', (fieldId, entityKey) => {
    const element = { field_id: fieldId, entity_key: entityKey, not_reported: true };
    const result = validateAiOutput([element], fields, 1);
    expect(result.items).toEqual([]);
    expect(result.rejected).toEqual([{
      index: 0,
      reason: 'entity_key_mismatch',
      detail: expect.stringContaining('番号ではありません'),
      raw: element,
    }]);
  });

  it.each([
    ['f_arm_n', 'arm:1'],
    ['f_arm_n', 'arm:12'],
    ['f_mean_change', 'outcome:isi|arm:2|time:post'],
    ['f_mean_change', 'outcome:isi'],
    ['f_mean_change', 'outcome:isi|time:post'],
    ['f_rob', 'rob:d1'],
    ['f_rob', 'rob:d1|outcome:isi'],
    ['f_rob', 'rob:d1|outcome:isi|arm:1'],
  ])('番号の群と群なしのキーは通す（%s / %s）', (fieldId, entityKey) => {
    const result = validateAiOutput(
      [{ field_id: fieldId, entity_key: entityKey, not_reported: true }], fields, 1,
    );
    expect(result.rejected).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ fieldId, entityKey });
  });

  it('番号と名前が混在する応答では名前の要素だけを破棄する', () => {
    const raw = ['arm:1', 'arm:dcbt_i', 'arm:12'].map((entityKey) => ({
      field_id: 'f_arm_n', entity_key: entityKey, not_reported: true,
    }));
    const result = validateAiOutput(raw, fields, 1);
    expect(result.items.map((item) => item.entityKey)).toEqual(['arm:1', 'arm:12']);
    expect(result.rejected).toEqual([{
      index: 1,
      reason: 'entity_key_mismatch',
      detail: expect.stringContaining('番号ではありません'),
      raw: raw[1],
    }]);
  });
});


describe('複数選択の応答', () => {
  const field = makeField({ fieldId: 'multi', fieldName: 'participants', entityLevel: 'study', dataType: 'enum',
    allowedValues: 'Students|Teachers|Other|None|NA',
    multiSelect: { exclusiveValues: ['None', 'NA'], freeTextValues: ['Other'] } });
  const item = (value: string | null, extra: Record<string, unknown> = {}) => ({
    field_id: 'multi', entity_key: '-', value, quote: 'passage', confidence: 'high', ...extra,
  });
  const run = (raw: unknown[]) => validateAiOutput(raw, [field], 1);

  test.each([
    ['未報告だけ', [item(null, { not_reported: true, theme: 'unused' }), item(null, { not_reported: true })]],
    ['値なしだけ', [item(null, { theme: 'unused' }), item(null)]],
  ])('%s は先頭だけ残して番号とテーマを付けない', (_name, raw) => {
    const result = run(raw);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ value: null, quoteTheme: null, quoteSeq: null });
    expect(result.rejected).toEqual([]);
  });
  test('報告あり一件でも選択肢名と番号を付ける', () => {
    expect(run([item('Students')]).items[0]).toMatchObject({ value: 'Students', quoteTheme: 'Students', quoteSeq: 1 });
  });
  test('報告あり複数は正準順の番号と共通値を持ち、応答順を維持する', () => {
    const result = run([item('Teachers'), item('Students')]);
    expect(result.items.map(({ value, quoteTheme, quoteSeq }) => [value, quoteTheme, quoteSeq])).toEqual([
      ['Students|Teachers', 'Teachers', 2], ['Students|Teachers', 'Students', 1],
    ]);
  });
  test('報告ありと未報告・値なしの混在では報告ありだけ残す', () => {
    const result = run([item(null, { not_reported: true }), item('Students'), item(null)]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.value).toBe('Students');
    expect(result.rejected).toEqual([]);
  });
  test.each([
    ['同じ選択肢', 'Students', 'Students'],
    ['大文字小文字違い', 'students', 'STUDENTS'],
    ['説明が違う自由記述', 'Other: first', 'Other: second'],
  ])('%s の重複は二件目を破棄する', (_name, a, b) => {
    const raw = [item(a), item(b)];
    const result = run(raw);
    expect(result.items).toHaveLength(1);
    expect(result.rejected).toEqual([{ index: 1, raw: raw[1], reason: 'duplicate_option', detail: expect.any(String) }]);
  });
  test('連結された値も拾い、一部重複は未出の選択肢だけ残す', () => {
    const result = run([item('Teachers|Students'), item('Students|Other: patients')]);
    expect(result.items.map(({ value, quoteTheme, quoteSeq }) => [value, quoteTheme, quoteSeq])).toEqual([
      ['Students|Teachers|Other: patients', 'Students|Teachers', 1],
      ['Students|Teachers|Other: patients', 'Other: patients', 2],
    ]);
    expect(result.rejected).toEqual([]);
  });
  test.each([
    [['Unknown'], 'Unknown'], [['zeta', 'Students', 'alpha'], 'Students|alpha|zeta'],
  ])('許容値外も失わない %p', (values, expected) => {
    expect(run(values.map((value) => item(value))).items.every((row) => row.value === expected)).toBe(true);
  });
  test.each([
    [['None', 'Students'], 'Students'],
    [['None|Students', 'Teachers'], 'Students|Teachers'],
    [['NA', 'None'], 'None'],
    [['NA|None'], 'None'],
    [['None', 'Unknown'], 'Unknown'],
  ])('単独選択の競合 %p を解消して残った全要素を low にする', (values, expected) => {
    const result = run(values.map((value) => item(value)));
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((row) => row.value === expected && row.confidence === 'low'
      && row.forcedLowReasons.includes('exclusive_conflict'))).toBe(true);
    expect(result.rejected).toEqual([]);
  });
  test('単独選択一件は競合しない', () => {
    expect(run([item('None')]).items[0]).toMatchObject({ value: 'None', confidence: 'high', forcedLowReasons: [] });
  });
  test.each([
    ['Other', ' Standardized patients | simulated\npatients ', 'Other: Standardized patients / simulated patients'],
    ['Other: direct', 'ignored', 'Other: direct'],
    ['Other', null, 'Other'],
    ['Other', ' ', 'Other'],
    ['Students', 'ignored', 'Students'],
    ['Other|Students', 'ignored', 'Students|Other'],
  ])('自由記述 %s / %s を保存する', (value, theme, expected) => {
    const row = run([item(value, { theme })]).items[0];
    expect(row).toMatchObject({ value: expected, quoteTheme: expected, quoteSeq: 1 });
  });
  test.each([
    [['high', 'medium'], 'medium'], [['low', 'high'], 'low'], [[null, 'high'], 'high'], [[null, null], null],
  ])('確信度 %p は最低の非 null 値に揃える', (confidence, expected) => {
    expect(run([item('Students', { confidence: confidence[0] }), item('Teachers', { confidence: confidence[1] })])
      .items.map((row) => row.confidence)).toEqual([expected, expected]);
  });
  test('強制 low の理由があれば全要素を low にする', () => {
    const result = run([item('Students', { quote: null }), item('Teachers')]);
    expect(result.items.map((row) => row.confidence)).toEqual(['low', 'low']);
    expect(result.items[0]?.forcedLowReasons).toContain('missing_quote');
  });
  test('field と entity が違うグループは独立する', () => {
    const fields = [field, { ...field, fieldId: 'arms', entityLevel: 'arm' as const }];
    const result = validateAiOutput([item('Students'), item('Teachers', { field_id: 'arms', entity_key: 'arm:1' }),
      item('Other', { field_id: 'arms', entity_key: 'arm:2' })], fields, 1);
    expect(result.items.map((row) => row.value)).toEqual(['Students', 'Teachers', 'Other']);
  });
  test('通常 enum は従来どおり値を保持して theme を捨てる', () => {
    const result = validateAiOutput([item('Students|Teachers', { theme: 'ignored' })], [{ ...field, multiSelect: null }], 1);
    expect(result.items[0]).toMatchObject({ value: 'Students|Teachers', quoteTheme: null, quoteSeq: null });
  });
});

test.each([
  [undefined, 'quote', null], [null, 'quote', null], [' ', 'quote', null], [' Methods ', 'quote', 'Methods'], ['Methods', null, null],
])('section %p と quote %p を正規化する', (section, quote, expected) => {
  expect(runOne({ value: null, quote, section }).items[0]?.section).toBe(expected);
});
