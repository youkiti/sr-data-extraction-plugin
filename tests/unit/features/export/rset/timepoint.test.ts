import { parseTimepoint } from '../../../../../src/features/export/rset/timepoint';

describe('parseTimepoint', () => {
  test('null は空を返す（entity_key に time セグメントが無い）', () => {
    expect(parseTimepoint(null)).toEqual({ value: '', unit: '' });
  });

  test('数値 + 英字単位（30d）を分解する', () => {
    expect(parseTimepoint('30d')).toEqual({ value: '30', unit: 'd' });
  });

  test('小数点・空白・大文字単位も受理する', () => {
    expect(parseTimepoint('12.5 W')).toEqual({ value: '12.5', unit: 'w' });
  });

  test('規約外の自由記述は空を返す（timepoint 列の原文で読み取る前提）', () => {
    expect(parseTimepoint('baseline')).toEqual({ value: '', unit: '' });
    expect(parseTimepoint('術後6ヶ月')).toEqual({ value: '', unit: '' });
  });
});
