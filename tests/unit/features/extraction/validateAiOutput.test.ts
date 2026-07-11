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
      expect(result.items[1]).toMatchObject({ value: '128', confidence: 'high', forcedLowReasons: [] });
    });

    it('値の数値が quote に無い要素は confidence=low を強制する（page 0 は null に落ちる）', () => {
      expect(result.items[2]).toMatchObject({
        value: '142',
        page: null,
        confidence: 'low',
        forcedLowReasons: ['number_not_in_quote'],
      });
    });

    it('値があるのに quote が無い要素は confidence=low を強制する', () => {
      expect(result.items[3]).toMatchObject({
        entityKey: 'arm:1',
        quote: null,
        confidence: 'low',
        forcedLowReasons: ['missing_quote'],
      });
    });

    it('not_reported=true なのに値がある要素は confidence=low を強制する（中黒小数点 −12·5 は 12.5 と照合できる）', () => {
      expect(result.items[4]).toMatchObject({
        confidence: 'low',
        forcedLowReasons: ['value_with_not_reported'],
      });
    });

    it('未知の confidence 値は null に落とし、矛盾がなければ強制しない', () => {
      expect(result.items[5]).toMatchObject({
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
      expect(items[0]).toMatchObject({ confidence: 'low', forcedLowReasons: ['number_not_in_quote'] });
    });

    it('not_reported=true + 値あり + quote なしは理由を 2 件とも記録する', () => {
      const { items } = runOne({ value: '5', not_reported: true, quote: null });
      expect(items[0]?.forcedLowReasons).toEqual(['value_with_not_reported', 'missing_quote']);
    });

    it('not_reported=true で値が無ければ強制しない', () => {
      const { items } = runOne({ value: null, not_reported: true, confidence: 'medium' });
      expect(items[0]).toMatchObject({ confidence: 'medium', forcedLowReasons: [] });
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
