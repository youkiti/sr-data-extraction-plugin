import { detectRegistrationId } from '../../../../src/features/documents/detectRegistrationId';

describe('detectRegistrationId', () => {
  test('1 件も無ければ null（過検出より取りこぼし優先）', () => {
    expect(detectRegistrationId('この文書に登録番号はありません。')).toBeNull();
    expect(detectRegistrationId('')).toBeNull();
  });

  test('各レジストリを検出し、正規化する（大文字小文字の揺れも吸収）', () => {
    expect(detectRegistrationId('Trial NCT01234567 registered.')).toBe('NCT01234567');
    expect(detectRegistrationId('nct01234567 lower')).toBe('NCT01234567');
    expect(detectRegistrationId('ISRCTN12345678 only')).toBe('ISRCTN12345678');
    expect(detectRegistrationId('UMIN000012345 only')).toBe('UMIN000012345');
    expect(detectRegistrationId('jRCTs031180123 only')).toBe('jRCTs031180123');
    expect(detectRegistrationId('JPRN-C000012345 only')).toBe('JPRN-C000012345');
    expect(detectRegistrationId('ChiCTR2000012345 only')).toBe('ChiCTR2000012345');
    expect(detectRegistrationId('EudraCT2004-001234-12 only')).toBe('EudraCT2004-001234-12');
    expect(detectRegistrationId('EudraCT: 2004-001234-12 spaced')).toBe('EudraCT2004-001234-12');
    expect(detectRegistrationId('ACTRN12345678901234 only')).toBe('ACTRN12345678901234');
  });

  test('EudraCT はラベルが無い裸の数値では拾わない（過検出回避）', () => {
    expect(detectRegistrationId('phone 2004-001234-12 without label')).toBeNull();
  });

  test('複数ヒットは最頻出を返す（頻度優先。後方の別番号が上回る場合も含む）', () => {
    // NCT 1 回 + ISRCTN 2 回 → ISRCTN が頻度で上回る（best 更新の分岐）
    const text = 'NCT01234567 then ISRCTN12345678 and again ISRCTN12345678';
    expect(detectRegistrationId(text)).toBe('ISRCTN12345678');
  });

  test('頻度が同じなら先頭出現の早いものを返す（残りは棄却）', () => {
    // ISRCTN が最初、NCT が中間、UMIN が最後（すべて 1 回）→ ISRCTN
    const text = 'ISRCTN12345678, then NCT01234567, then UMIN000012345';
    expect(detectRegistrationId(text)).toBe('ISRCTN12345678');
  });

  test('全レジストリが 1 回ずつなら先頭出現を返す', () => {
    const text = [
      'NCT01234567',
      'ISRCTN12345678',
      'UMIN000012345',
      'jRCTs031180123',
      'JPRN-C000012345',
      'ChiCTR2000012345',
      'EudraCT2004-001234-12',
      'ACTRN12345678901234',
    ].join(' / ');
    expect(detectRegistrationId(text)).toBe('NCT01234567');
  });
});
