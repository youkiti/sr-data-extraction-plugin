import { buildAskPaperHighlight } from '../../../../src/app/ui/askPaperHighlight';
import { makeCitation, makeAskPage } from '../askPaperFixtures';

test('既存の引用アンカリングで質問引用の矩形を作る', () => {
  expect(buildAskPaperHighlight(makeCitation(), [makeAskPage()])).toMatchObject({
    id: 'ask-paper:doc-1',
    kind: 'unverified',
    occurrence: { page: 1, rects: [expect.anything()] },
  });
});

test.each([
  { highlightable: false },
  { anchorStatus: 'failed' as const },
  { anchoredPage: null },
  { quote: '存在しない引用' },
])('照合できない引用を描画しない: %j', (overrides) => {
  expect(buildAskPaperHighlight(makeCitation(overrides), [makeAskPage()])).toBeNull();
});
