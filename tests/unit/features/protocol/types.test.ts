import { buildPreview, PREVIEW_MAX_LENGTH } from '../../../../src/features/protocol/types';

describe('buildPreview', () => {
  test('短いテキストは空白を畳んだだけで返す', () => {
    expect(buildPreview('  P: 成人肺炎\n\nI:  抗菌薬 A ')).toBe('P: 成人肺炎 I: 抗菌薬 A');
  });

  test('空文字は空文字のまま返す', () => {
    expect(buildPreview('')).toBe('');
  });

  test('500 文字を超えるテキストは 499 文字 + … に切り詰める', () => {
    const preview = buildPreview('あ'.repeat(600));
    expect(preview).toHaveLength(PREVIEW_MAX_LENGTH);
    expect(preview.endsWith('…')).toBe(true);
    expect(preview.startsWith('あああ')).toBe(true);
  });

  test('ちょうど 500 文字は切り詰めない', () => {
    const preview = buildPreview('a'.repeat(PREVIEW_MAX_LENGTH));
    expect(preview).toBe('a'.repeat(PREVIEW_MAX_LENGTH));
  });
});
