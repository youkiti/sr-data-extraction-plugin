import { parseSignalingQuestion } from '../../../../src/lib/rob/parseSignalingQuestion';
import { SQ_TRANSLATIONS_JA } from '../../../../src/lib/rob/sqTranslationsJa';
import {
  buildRob2SqTemplateRows,
  buildRobinsISqTemplateRows,
  ROB_TEMPLATE_QUADAS3,
} from '../../../../src/features/schema/presets/robTemplates';

describe('保存された SQ 指示の取り出し', () => {
  test.each(['RoB 2', 'ROBINS-I', 'QUADAS-3'] as const)('%s の前置き・条件の有無', (tool) => {
    const base = `${tool} signaling question 1.1: "Question?" Answer with exactly one of: y / n.`;
    for (const prefix of ['', 'Review context: target outcome. ']) {
      expect(parseSignalingQuestion(prefix + base)).toEqual({
        tool, code: '1.1', question: 'Question?', condition: null,
      });
      const condition = tool === 'ROBINS-I' ? 'SQ 1.1 が y のとき' : '1.1 が y のとき';
      expect(parseSignalingQuestion(`${prefix}${base} この設問は条件付きです（${condition}）。条件を満たさない場合は na（not applicable）と明示的に回答してください。`)).toEqual({
        tool, code: '1.1', question: 'Question?', condition,
      });
    }
  });

  test.each(['', '通常の抽出指示', 'RoB 2 signaling question 1.1: "Question?"'])('一致しない指示は null: %s', (instruction) => {
    expect(parseSignalingQuestion(instruction)).toBeNull();
  });

  test('条件内の括弧は保持し、na の案内を含めない', () => {
    const condition = '常に na（not applicable）と回答する';
    expect(parseSignalingQuestion(`RoB 2 signaling question 2.3: "Question?" Answer with y. この設問は条件付きです（${condition}）。条件を満たさない場合は na と回答してください。`)?.condition).toBe(condition);
  });
});

test('全プリセットの SQ を取り出せ、全原文に参考訳がある', () => {
  const presets = [
    buildRob2SqTemplateRows({ effect: 'assignment' }),
    buildRob2SqTemplateRows({ effect: 'adhering', deviationTypes: [] }),
    buildRob2SqTemplateRows({ effect: 'adhering', deviationTypes: [
      'non_protocol_interventions', 'implementation_failures', 'non_adherence',
    ] }),
    buildRobinsISqTemplateRows('assignment'),
    buildRobinsISqTemplateRows('starting_adhering'),
    ROB_TEMPLATE_QUADAS3,
  ];
  for (const rows of presets) {
    let count = 0;
    for (const row of rows) {
      const sq = parseSignalingQuestion(row.extractionInstruction);
      if (/^(rob2_sq|robins_i_sq|quadas3_sq)/.test(row.fieldName)) {
        expect(sq).not.toBeNull();
        count++;
      }
      if (sq !== null) expect(SQ_TRANSLATIONS_JA[sq.question]).toBeDefined();
    }
    expect(count).toBeGreaterThan(0);
  }
});
