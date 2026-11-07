// 本物の公開ヘルプと小さな HTML で、言語別小節の境界を検証する。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HELP_TOPICS } from '../../../src/lib/help/topics';
import type { HelpSection } from '../../../src/lib/help/consult/types';

// ビルド用 CommonJS ローダーの関数プロパティも検査する。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loader = require('../../../tools/help/helpSections.cjs') as {
  (this: { resourceQuery: string }, source: string): string;
  parseHelpSections: (html: string, lang: string) => HelpSection[];
};
const parse = loader.parseHelpSections;
const html = readFileSync(join(__dirname, '../../../hosted/help.html'), 'utf8');

test('本物のヘルプで日英の ID とトピックが一致し、言語が混在しない', () => {
  const ja = parse(html, 'ja');
  const en = parse(html, 'en');
  expect(ja.length).toBeGreaterThan(0);
  expect(ja.map(({ id }) => id)).toEqual(en.map(({ id }) => id));
  expect(new Set(ja.map(({ id }) => id)).size).toBe(ja.length);
  for (const topic of Object.values(HELP_TOPICS)) {
    expect(ja.map(({ id }) => id)).toContain(topic.helpAnchor);
  }
  for (const section of en) {
    expect([section.title, section.body, ...section.when].join(' ')).not.toMatch(/[ぁ-ゖ]/);
  }
  const document = new DOMParser().parseFromString(html, 'text/html');
  for (const language of ['ja', 'en'] as const) {
    const sections = language === 'ja' ? ja : en;
    const output = sections.flatMap(({ title, body, when }) => [title, body, ...when]).join(' ');
    const opposite = language === 'ja' ? 'en' : 'ja';
    for (const span of document.querySelectorAll(`span.${opposite}`)) {
      const phrase = span.textContent!.replace(/\s+/g, ' ').trim();
      if (phrase.length > 35 && ![...document.querySelectorAll(`span.${language}`)].some((other) => other.textContent!.includes(phrase))) {
        expect(output).not.toContain(phrase);
      }
    }
    for (const section of sections.filter(({ when }) => when.length > 0)) {
      expect(section.when.length).toBeGreaterThanOrEqual(2);
      expect(section.when.length).toBeLessThanOrEqual(4);
    }
  }
});

test('入れ子の span・実体参照・不要要素・こんなとき・FAQ を切り分ける', () => {
  const source = `<section id="s"><h2><span class="ja">見出し</span><span class="en">Heading</span></h2>
    <div class="help-when"><p>こんなとき</p><ul><li><span class="ja">条件<b>一</b></span><span class="en">Case one</span></li><li>Two</li></ul></div>
    <p><span class="ja">日本<span>入れ子</span>語</span><span class="en">English<span> nested</span> only</span> &amp; &#x41; &#66; &copy; &amp;lt;</p>
    <!--秘密--><script>secret()</script><style>.secret{}</style>
    <h3 id="s-sub">Sub</h3><p>Body <a href="https://secret.example">Link</a></p>
    <details class="faq" id="faq-one"><summary>Question</summary><p>Answer</p></details></section>
    <section id="empty"><h2>Empty</h2></section>`;
  const ja = parse(source, 'ja');
  expect(ja).toHaveLength(4);
  expect(ja[0]).toMatchObject({ id: 's', title: '見出し', when: ['条件 一', 'Two'], body: '日本 入れ子 語 & A B © &lt;' });
  expect(parse(source, 'en')[0]).toMatchObject({ title: 'Heading', when: ['Case one', 'Two'], body: 'English nested only & A B © &lt;' });
  expect(ja[1]).toMatchObject({ kind: 'subsection', body: 'Body Link' });
  expect(ja[2]).toMatchObject({ kind: 'faq', title: 'Question', body: 'Answer' });
  expect(ja[3]!.body).toBe('');
  expect(() => parse(source, 'fr')).toThrow();
  expect(loader.call({ resourceQuery: '?help-sections&lang=ja' }, source)).toBe(`module.exports = ${JSON.stringify(ja)};`);
});
