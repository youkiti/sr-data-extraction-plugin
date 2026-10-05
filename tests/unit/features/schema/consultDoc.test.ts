// 相談用ドキュメントの HTML ビルダー（純関数）の文字列検証
import {
  buildSchemaConsultDocHtml,
  escapeHtml,
  type SchemaConsultDocInput,
} from '../../../../src/features/schema/consultDoc';
import { serializeQuadas3PrespecNote } from '../../../../src/features/schema/presets/quadas3Prespec';
import { serializeQuipsPrespecNote } from '../../../../src/features/schema/presets/quipsPrespec';
import { serializeRob2PrespecNote } from '../../../../src/features/schema/presets/robPrespec';
import { serializeRobinsIPrespecNote } from '../../../../src/features/schema/presets/robinsIPrespec';
import { makeArmEntityKey } from '../../../../src/utils/entityKey';
import type { SchemaVersion } from '../../../../src/domain/schemaVersion';
import {
  makeDecision,
  makeEvidence,
  makeField,
  makeRun,
} from '../verification/pilotMatrixFixtures';

const VERSION: SchemaVersion = {
  schemaVersion: 2,
  parentVersion: 1,
  protocolVersion: 3,
  createdByType: 'user_edit',
  createdAt: '2026-07-05T10:00:00Z',
  createdBy: 'me@example.com',
  note: '改訂理由メモ',
};

function base(overrides: Partial<SchemaConsultDocInput> = {}): SchemaConsultDocInput {
  return {
    projectName: 'テスト SR',
    schemaVersion: VERSION,
    fields: [makeField()],
    exportedDate: '2026-10-05',
    pilot: null,
    ...overrides,
  };
}

const labels = new Map([['study-1', 'Smith 2020']]);

describe('escapeHtml', () => {
  test('HTML 特殊文字をすべて置換する', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
});

describe('buildSchemaConsultDocHtml（パイロットなし）', () => {
  test('ヘッダーと「パイロットなし」の表示、AI 例・判定内訳は出さない', () => {
    const html = buildSchemaConsultDocHtml(base());
    expect(html).toContain('<h1>データ抽出スキーマ v2 相談用</h1>');
    expect(html).toContain('プロジェクト: テスト SR');
    expect(html).toContain('v2（確定日: 2026-07-05、依拠したプロトコル版: v3）');
    expect(html).toContain('出力日: 2026-10-05');
    expect(html).toContain('この版のパイロット抽出はありません');
    expect(html).not.toContain('AI の抽出例（パイロット）');
    expect(html).not.toContain('<th>採用</th>');
    expect(html).not.toContain('事前設定');
    // 改訂理由メモは載せない
    expect(html).not.toContain('改訂理由メモ');
  });

  test('項目の詳細: 許容値・複数選択・引用上限・指示・例・単位', () => {
    const html = buildSchemaConsultDocHtml(
      base({
        fields: [
          makeField({
            fieldId: 'b', fieldIndex: 2, section: 'outcomes', fieldLabel: '副次', fieldName: 'second',
            unit: 'mg/day', required: false, example: '例: 10',
          }),
          makeField({
            fieldId: 'a', fieldIndex: 1, section: 'methods', fieldLabel: '研究デザイン', fieldName: 'design',
            dataType: 'enum', allowedValues: 'RCT | cohort | other',
            multiSelect: { exclusiveValues: ['other'], freeTextValues: ['cohort'] },
            maxQuotes: 5, extractionInstruction: '<b>指示</b>',
          }),
          makeField({
            fieldId: 'c', fieldIndex: 3, section: 'methods', fieldLabel: '全部空', fieldName: 'c',
            dataType: 'enum', allowedValues: '', multiSelect: { exclusiveValues: [], freeTextValues: [] },
            example: '',
          }),
        ],
      }),
    );
    // fieldIndex 順 → section の初出順（methods → outcomes）
    expect(html.indexOf('セクション: methods')).toBeLessThan(html.indexOf('セクション: outcomes'));
    expect(html.indexOf('<h4>研究デザイン</h4>')).toBeLessThan(html.indexOf('<h4>副次</h4>'));
    expect(html).toContain('許容値: RCT / cohort / other');
    expect(html).toContain('複数選択: 可');
    expect(html).toContain('単独で選ぶ選択肢: other');
    expect(html).toContain('自由記述を付ける選択肢: cohort');
    expect(html).toContain('引用の上限: 5 件');
    expect(html).toContain('抽出指示: &lt;b&gt;指示&lt;/b&gt;');
    expect(html).toContain('単位: mg/day');
    expect(html).toContain('必須: いいえ');
    expect(html).toContain('例: 例: 10');
    // 空の許容値・空の例・空の選択肢リストは行を出さない
    const start = html.indexOf('<h4>全部空</h4>');
    const c = html.slice(start, html.indexOf('<h3>', start));
    expect(c).not.toContain('許容値');
    expect(c).not.toContain('単独で選ぶ');
    expect(c).not.toContain('自由記述を付ける');
    expect(c).not.toContain('例:');
  });

  test('利用者・LLM 由来の文字列はすべてエスケープする', () => {
    const html = buildSchemaConsultDocHtml(
      base({ projectName: '<script>x</script>', fields: [makeField({ fieldLabel: '<i>L</i>', section: '<s>' })] }),
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('&lt;i&gt;L&lt;/i&gt;');
    expect(html).toContain('セクション: &lt;s&gt;');
  });
});

describe('buildSchemaConsultDocHtml（パイロットあり）', () => {
  const armField = makeField({ fieldId: 'f-arm', fieldIndex: 2, fieldLabel: '群の人数', fieldName: 'n_arm', entityLevel: 'arm' });
  const emptyField = makeField({ fieldId: 'f-none', fieldIndex: 3, fieldLabel: '抽出なし項目', fieldName: 'none' });
  const fields = [makeField(), armField, emptyField];

  test('実行情報・判定内訳・AI 例・差分の印', () => {
    const evidence = [
      makeEvidence({ value: '120', quote: 'a total of 120', page: 3, section: 'Methods' }),
      makeEvidence({ evidenceId: 'ev-2', studyId: 'study-2', value: '99', quote: 'N=99', page: null, section: null }),
      makeEvidence({ evidenceId: 'ev-3', studyId: 'study-3', value: null, notReported: true, quote: null, page: null }),
      makeEvidence({ evidenceId: 'ev-4', studyId: 'study-1', fieldId: 'f-arm', entityKey: makeArmEntityKey(1), value: '60', quote: 'n=60', page: 2 }),
      makeEvidence({ evidenceId: 'ev-5', studyId: 'study-4', value: '5', quote: 'five' }),
      makeEvidence({ evidenceId: 'ev-6', studyId: 'study-5', value: '7', quote: 'seven' }),
      // 別 run の行は無視される
      makeEvidence({ evidenceId: 'ev-x', runId: 'other-run', studyId: 'study-1', value: '777', quote: 'other' }),
    ];
    const decisions = [
      makeDecision({ action: 'edit', value: '130', note: '秘密のメモ' }),
      makeDecision({ studyId: 'study-2', action: 'accept', value: '99' }),
      makeDecision({ studyId: 'study-3', action: 'not_reported', value: null }),
      makeDecision({ studyId: 'study-4', action: 'reject', value: null }),
      makeDecision({ studyId: 'study-5', action: 'not_reported', value: null }),
    ];
    const html = buildSchemaConsultDocHtml(
      base({
        fields,
        pilot: {
          run: makeRun({
            studyIds: ['study-1', 'study-2', 'study-3', 'study-4', 'study-5'],
            startedAt: '2026-08-01T01:00:00Z', finishedAt: '2026-08-01T02:00:00Z',
            requestedModel: 'gemini-x', modelVersion: 'gemini-x-001',
          }),
          evidence, decisions, studyLabels: labels,
        },
      }),
    );
    expect(html).toContain('パイロット抽出: 開始 2026-08-01 / 終了 2026-08-01、モデル gemini-x（実モデル: gemini-x-001）、対象 5 論文');
    // 概要表（総サンプルサイズ: accept1 edit1 reject1 未報告2（nrAccepted + nrMiss） 未判定0）
    expect(html).toContain('<th>採用</th><th>修正</th><th>棄却</th><th>未報告</th><th>未判定</th><th>要確認</th>');
    expect(html).toContain('<td>1</td><td><b>1</b></td><td><b>1</b></td><td>2</td><td>0</td><td>★</td>');
    // 群レベルの項目: 判定なしの 1 件は未判定、要確認の印なし
    expect(html).toContain('<td>0</td><td>0</td><td>0</td><td>0</td><td>1</td><td></td>');
    // 抽出なし項目
    expect(html).toContain('この項目の抽出結果はありません');
    // AI 例
    expect(html).toContain('Smith 2020');
    expect(html).toContain('study-2'); // ラベルなしは study_id
    expect(html).toContain('「a total of 120」（p.3 / Methods）');
    expect(html).toContain('「N=99」');
    expect(html).not.toContain('N=99」（');
    expect(html).toContain('<td>未報告</td>');
    expect(html).toContain('群 1');
    expect(html).toContain('★ AI と異なる');
    expect(html).toContain('修正後: 130');
    expect(html).toContain('棄却（値なし）');
    expect(html).toContain('未報告と判定（AI は値あり）');
    expect(html).not.toContain('777');
    // 載せないもの
    expect(html).not.toContain('秘密のメモ');
    expect(html).not.toContain('exact');
    expect(html).not.toContain('anchor');
  });

  test('複数引用は束ねて全件並べ、空の引用は出さない。run の時刻・実モデルが無いときの表示', () => {
    const evidence = [
      makeEvidence({ evidenceId: 'q1', quoteSeq: 1, quote: '引用A', page: 1, section: 'Results' }),
      makeEvidence({ evidenceId: 'q2', quoteSeq: 2, quote: '引用B', page: 2, section: '' }),
      makeEvidence({ evidenceId: 'q3', quoteSeq: 3, quote: '', page: null }),
    ];
    const html = buildSchemaConsultDocHtml(
      base({
        pilot: {
          run: makeRun({ startedAt: null, finishedAt: null, requestedModel: 'm', modelVersion: 'm' }),
          evidence, decisions: [], studyLabels: new Map(),
        },
      }),
    );
    expect(html).toContain('「引用A」（p.1 / Results）');
    expect(html).toContain('「引用B」（p.2）');
    expect(html).toContain('開始 — / 終了 —、モデル m、');
    // 判定なし → 未判定に計上、印なし
    expect(html).toContain('<td>0</td><td>0</td><td>0</td><td>0</td><td>1</td><td></td>');
    expect(html).not.toContain('★ AI と異なる');
  });

  test('引用が全く無い AI 値は「—」。modelVersion が null ならモデル名のみ', () => {
    const html = buildSchemaConsultDocHtml(
      base({
        pilot: {
          run: makeRun({ modelVersion: null }),
          evidence: [makeEvidence({ value: null, quote: null, page: null })],
          decisions: [makeDecision({ action: 'edit', value: null })],
          studyLabels: labels,
        },
      }),
    );
    expect(html).toContain('<td>—</td>');
    expect(html).toContain('修正後: </td>');
    expect(html).toContain('モデル gemini-test、');
  });

  test('human_independent・他人以外の annotatorType の判定は内訳にも例にも反映しない', () => {
    const html = buildSchemaConsultDocHtml(
      base({
        pilot: {
          run: makeRun(),
          evidence: [makeEvidence()],
          decisions: [
            makeDecision({ annotatorType: 'human_independent', action: 'edit', value: '独立入力の値', note: '独立メモ' }),
            makeDecision({ annotatorType: 'consensus', action: 'reject', value: null }),
          ],
          studyLabels: labels,
        },
      }),
    );
    expect(html).not.toContain('独立入力の値');
    expect(html).not.toContain('独立メモ');
    expect(html).not.toContain('★ AI と異なる');
    expect(html).toContain('<td>0</td><td>0</td><td>0</td><td>0</td><td>1</td><td></td>');
  });
});

describe('buildSchemaConsultDocHtml（事前設定）', () => {
  test('4 ツールの事前設定を読みやすく並べ、同じツールは 1 回だけ', () => {
    const rob2 = serializeRob2PrespecNote({
      design: 'individually_randomized_parallel_group', experimental: '薬 A', comparator: 'プラセボ',
      outcome: '死亡', numericalResult: 'HR', effect: 'adhering',
      deviationTypes: ['non_protocol_interventions', 'non_adherence'],
    });
    const rob2Dup = serializeRob2PrespecNote({
      design: 'individually_randomized_parallel_group', experimental: '重複', comparator: null,
      outcome: null, numericalResult: null, effect: null, deviationTypes: [],
    });
    const robinsI = serializeRobinsIPrespecNote({
      design: '目標試験', participants: '成人', experimental: null, comparator: null, outcome: null,
      numericalResult: null, benefitHarm: 'benefit', effect: 'starting_adhering',
      confoundingDomains: ['年齢', '性別'], coInterventions: ['X'],
    });
    const quadas = serializeQuadas3PrespecNote({
      population: '外来', indexTest: 'CT', targetCondition: '肺炎', intendedUsePopulation: null,
      testRole: 'triage', referenceStandard: '培養', analysisUnit: '患者',
    });
    const quips = serializeQuipsPrespecNote({
      population: 'P', prognosticFactor: 'PF', outcome: 'O', keyCharacteristics: ['k1'], importantConfounders: ['c1', 'c2'],
    });
    const html = buildSchemaConsultDocHtml(
      base({
        fields: [
          makeField({ fieldId: 'r1', fieldIndex: 1, note: rob2 }),
          makeField({ fieldId: 'r2', fieldIndex: 2, note: rob2Dup }),
          makeField({ fieldId: 'r3', fieldIndex: 3, note: robinsI }),
          makeField({ fieldId: 'r4', fieldIndex: 4, note: quadas }),
          makeField({ fieldId: 'r5', fieldIndex: 5, note: quips }),
          makeField({ fieldId: 'r6', fieldIndex: 6, note: '普通のメモ' }),
        ],
      }),
    );
    expect(html).toContain('<h2>事前設定（RoB 等）</h2>');
    expect(html.match(/<h3>RoB 2<\/h3>/g)).toHaveLength(1);
    expect(html).toContain('試験介入: 薬 A');
    expect(html).not.toContain('重複');
    expect(html).toContain('関心のある効果: 遵守の効果（per-protocol）');
    expect(html).toContain('扱う逸脱の種類: プロトコル外の介入の発生 / 参加者の割付け介入への非遵守');
    expect(html).toContain('<h3>ROBINS-I</h3>');
    expect(html).toContain('益か害か: 介入の益');
    expect(html).toContain('関心のある効果: 介入の開始と遵守の効果');
    expect(html).toContain('重要な交絡の領域: 年齢 / 性別');
    expect(html).toContain('併用介入: X');
    expect(html).toContain('<h3>QUADAS-3</h3>');
    expect(html).toContain('対象の検査: CT');
    expect(html).toContain('<h3>QUIPS</h3>');
    expect(html).toContain('重要な交絡因子: c1 / c2');
    expect(html).not.toContain('普通のメモ');
  });

  test('割付け効果・害・空の入力', () => {
    const rob2 = serializeRob2PrespecNote({
      design: 'individually_randomized_parallel_group', experimental: null, comparator: null,
      outcome: null, numericalResult: null, effect: 'assignment', deviationTypes: [],
    });
    const robinsI = serializeRobinsIPrespecNote({
      design: null, participants: null, experimental: null, comparator: null, outcome: null,
      numericalResult: null, benefitHarm: 'harm', effect: 'assignment',
      confoundingDomains: [], coInterventions: [],
    });
    const quips = serializeQuipsPrespecNote({
      population: null, prognosticFactor: null, outcome: null, keyCharacteristics: [], importantConfounders: [],
    });
    const html = buildSchemaConsultDocHtml(
      base({
        fields: [
          makeField({ fieldId: 'r1', fieldIndex: 1, note: rob2 }),
          makeField({ fieldId: 'r3', fieldIndex: 3, note: robinsI }),
          makeField({ fieldId: 'r5', fieldIndex: 5, note: quips }),
        ],
      }),
    );
    expect(html).toContain('関心のある効果: 割付けの効果（ITT）');
    expect(html).toContain('益か害か: 介入の害');
    expect(html).toContain('関心のある効果: 割付けの効果');
    expect(html).toContain('<p>入力なし</p>');
  });

  test('割付けの効果では逸脱の種類を出さない', () => {
    const rob2 = serializeRob2PrespecNote({
      design: 'individually_randomized_parallel_group', experimental: 'A', comparator: null,
      outcome: null, numericalResult: null, effect: 'assignment',
      deviationTypes: ['non_adherence'],
    });
    const html = buildSchemaConsultDocHtml(base({ fields: [makeField({ note: rob2 })] }));
    expect(html).toContain('割付けの効果（ITT）');
    expect(html).not.toContain('扱う逸脱の種類');
  });

  test('関心のある効果・益害が未指定なら行を出さない', () => {
    const rob2 = serializeRob2PrespecNote({
      design: 'individually_randomized_parallel_group', experimental: 'A', comparator: null,
      outcome: null, numericalResult: null, effect: null, deviationTypes: [],
    });
    const robinsI = serializeRobinsIPrespecNote({
      design: 'D', participants: null, experimental: null, comparator: null, outcome: null,
      numericalResult: null, benefitHarm: null, effect: null,
      confoundingDomains: [], coInterventions: [],
    });
    const html = buildSchemaConsultDocHtml(
      base({
        fields: [
          makeField({ fieldId: 'r1', fieldIndex: 1, note: rob2 }),
          makeField({ fieldId: 'r3', fieldIndex: 3, note: robinsI }),
        ],
      }),
    );
    expect(html).toContain('試験介入: A');
    expect(html).not.toContain('関心のある効果');
    expect(html).not.toContain('益か害か');
  });
});
