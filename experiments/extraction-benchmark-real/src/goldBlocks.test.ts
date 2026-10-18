import assert from 'node:assert/strict';
import test from 'node:test';
import { selectGoldBlocks } from './goldBlocks';

for (const [name, blocks, expected] of [
  ['1 回', ['a', 'a'], [true, true]],
  ['連続しない 2 回', ['a', 'b', 'a', 'b'], [true, false, true, false]],
  ['3 回', ['a', 'b', 'c', 'a'], [true, false, false, true]],
] as const) {
  test(`ブロック選択: ${name}`, () => {
    assert.deepEqual(selectGoldBlocks(blocks.map((block) => ({ paper: 'P', block }))), expected);
  });
}
test('別の論文が間に挟まっても各論文の最初を保持する', () => {
  const rows = [{ paper: 'P', block: 'a' }, { paper: 'Q', block: 'b' }, { paper: 'P', block: 'c' }, { paper: 'Q', block: 'b' }];
  assert.deepEqual(selectGoldBlocks(rows), [true, true, false, true]);
  assert.deepEqual(selectGoldBlocks(rows), [true, true, false, true]);
});
