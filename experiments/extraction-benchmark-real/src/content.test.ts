import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExtractDataUserContent } from '../../../src/features/extraction/skills/extractData';
import { loadBenchmarkSchema } from './loadSchema';

// mode: 'text_with_images'（issue #176 の高精度読み取りモード）は本番から撤去済み
// （ExtractDataDocument は 'text' / 'image' の 2 種のみ。extractData.ts の EXTRACT_DATA_PROMPT_VERSION=9
// コメント参照）。runner も text_only 固定になったため、ここは本番の仕様変更に追従する修正であり、
// テストを緩めているのではない: 本ベンチが実際に使う唯一の経路（テキストのみ）が
// 本番 content builder を通って文字列を返すことだけを確かめる。
test('テキストモードが本番 content builder を通り、文字列を返す', async () => {
  const fields = (await loadBenchmarkSchema()).slice(0, 1);
  const pages = [{ page: 1, text: 'Table 1' }];
  const text = buildExtractDataUserContent({
    fields, documents: [{ role: 'article', filename: 'paper.pdf', mode: 'text', pages }],
  });
  assert.equal(typeof text, 'string');
});
