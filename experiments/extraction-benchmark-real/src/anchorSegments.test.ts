// 断片の境界と六分類を、本番の照合関数を通して確認する。
import assert from 'node:assert/strict';
import test from 'node:test';
import { classifySegments, splitSegments } from './anchorSegments';
import { normalizeText } from '../../../src/features/anchoring/normalizeText';

const first = 'abcdefghijklmno';
const second = '123456789012345';
const missing = 'ZZZZZZZZZZZZZZZ';
const page = (number: number, text: string) => ({ page: number, text: normalizeText(text) });

test('single: 区切りがなく一断片、または空なら分割効果なし', () => {
  assert.equal(classifySegments(first, [], null), 'single');
  assert.equal(classifySegments(' … \n ', [], null), 'single');
});
test('has_short_segment: 正規化後八文字未満を含めば成功を数えない', () => {
  assert.equal(classifySegments(first + '\n短 い', [page(1, first + '短い')], 1), 'has_short_segment');
  assert.equal(classifySegments(first + '\n12345678', [page(1, first + '12345678')], 1), 'all_same_page');
});
test('all_same_page: 両断片が同じページで一致する', () => {
  assert.equal(classifySegments(first + '\n' + second, [page(1, first + missing + second)], 1), 'all_same_page');
});
test('all_diff_pages: 両断片が別ページで一致する', () => {
  assert.equal(classifySegments(first + '\n' + second, [page(1, first), page(3, second)], 1), 'all_diff_pages');
});
test('partial: 一断片だけ成功する', () => {
  assert.equal(classifySegments(first + '\n' + second, [page(1, first)], null), 'partial');
});
test('none: 全断片が失敗する', () => {
  assert.equal(classifySegments(first + '\n' + second, [page(1, missing)], null), 'none');
});
test('断片: 改行三種・省略記号二種・空・前後空白を処理する', () => {
  assert.deepEqual(splitSegments('  a \r\n b\n c\r d... e.... f… g … \n '), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.deepEqual(splitSegments('1.2..3'), ['1.2..3']);
});
