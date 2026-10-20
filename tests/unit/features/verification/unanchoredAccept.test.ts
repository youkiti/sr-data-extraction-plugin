import { unanchoredReasonOf } from '../../../../src/features/verification/unanchoredAccept';

describe('unanchoredReasonOf', () => {
  test('failed を優先し、照合なし（null）は unchecked、それ以外は null', () => {
    expect(unanchoredReasonOf([{ quote: 'a', anchorStatus: 'exact' }, { quote: 'b', anchorStatus: 'failed' }])).toBe('failed');
    expect(unanchoredReasonOf([{ quote: 'a', anchorStatus: null }, { quote: 'b', anchorStatus: 'failed' }])).toBe('failed');
    expect(unanchoredReasonOf([{ quote: 'a', anchorStatus: null }])).toBe('unchecked');
    expect(unanchoredReasonOf([{ quote: 'a', anchorStatus: 'fuzzy' }, { quote: 'b', anchorStatus: 'normalized' }])).toBeNull();
    expect(unanchoredReasonOf([])).toBeNull();
  });

  test('引用文が無い・空白だけの行は対象外', () => {
    expect(unanchoredReasonOf([{ quote: null, anchorStatus: null }])).toBeNull();
    expect(unanchoredReasonOf([{ quote: '  ', anchorStatus: 'failed' }])).toBeNull();
  });
});
