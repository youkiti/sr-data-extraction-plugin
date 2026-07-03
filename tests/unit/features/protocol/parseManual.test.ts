import { parseManualProtocol } from '../../../../src/features/protocol/parseManual';

describe('parseManualProtocol', () => {
  test('手入力本文をパース結果形式（sourceType=manual・ファイル名なし）に整える', () => {
    const parsed = parseManualProtocol('P: 成人肺炎\nI: 抗菌薬 A');
    expect(parsed).toEqual({
      sourceType: 'manual',
      sourceFilename: '',
      plainText: 'P: 成人肺炎\nI: 抗菌薬 A',
      preview: 'P: 成人肺炎 I: 抗菌薬 A',
    });
  });
});
