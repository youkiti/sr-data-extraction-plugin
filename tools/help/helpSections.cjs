// 公開ヘルプを言語別の小節へ変換するビルド用ローダー。
// タグのスタックで入れ子を保持し、言語と本文の境界を判定する。
const { decodeHTML } = require('entities');

function parseHelpSections(html, lang) {
  if (lang !== 'ja' && lang !== 'en') {
    throw new Error('ヘルプの言語が不正です');
  }
  const root = { tag: '', attrs: {}, children: [] };
  const stack = [root];
  const cleaned = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ');
  for (const token of cleaned.match(/<[^>]*>|[^<]+/g) || []) {
    if (token.startsWith('</')) {
      const tag = token.slice(2).match(/^\w+/)?.[0].toLowerCase();
      const index = stack.findLastIndex((node) => node.tag === tag);
      if (index > 0) {
        stack.length = index;
      }
    } else if (/^<\w/.test(token)) {
      const tag = token.slice(1).match(/^\w+/)[0].toLowerCase();
      const attrs = {};
      for (const match of token.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        attrs[match[1]] = match[2] ?? match[3];
      }
      const node = { tag, attrs, children: [] };
      stack.at(-1).children.push(node);
      if (!/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag) && !token.endsWith('/>')) {
        stack.push(node);
      }
    } else if (!token.startsWith('<')) {
      stack.at(-1).children.push(token);
    }
  }
  const hasClass = (node, value) => (node.attrs.class || '').split(/\s+/).includes(value);
  const visible = (node) => !(node.tag === 'span' && hasClass(node, lang === 'ja' ? 'en' : 'ja'));
  const rawText = (nodes) => nodes.map((node) => typeof node === 'string' ? node : visible(node) ? ` ${rawText(node.children)} ` : ' ').join('');
  const text = (nodes) => decodeHTML(rawText(nodes)).replace(/\s+/g, ' ').trim();
  const find = (nodes, predicate) => nodes.flatMap((node) => typeof node === 'string' ? [] : [ ...(predicate(node) ? [node] : []), ...find(node.children, predicate) ]);
  const result = [];
  for (const section of find(root.children, (node) => node.tag === 'section' && node.attrs.id)) {
    const heading = section.children.find((node) => node.tag === 'h2');
    const sectionTitle = text(heading.children);
    let current;
    const start = (id, kind, title) => {
      current = { id, kind, sectionId: section.attrs.id, sectionTitle, title, when: [], body: '' };
      result.push(current);
    };
    const append = (node) => {
      if (typeof node !== 'string' && hasClass(node, 'help-when')) {
        current.when.push(...find(node.children, (child) => child.tag === 'li').map((item) => text(item.children)));
      } else {
        current.body = `${current.body} ${text([node])}`.trim();
      }
    };
    start(section.attrs.id, 'section', sectionTitle);
    for (const node of section.children.slice(section.children.indexOf(heading) + 1)) {
      if (node.tag === 'h3') {
        start(node.attrs.id, 'subsection', text(node.children));
      } else if (node.tag === 'details' && hasClass(node, 'faq')) {
        const summary = node.children.find((child) => child.tag === 'summary');
        start(node.attrs.id, 'faq', text(summary.children));
        node.children.filter((child) => child !== summary).forEach(append);
      } else {
        append(node);
      }
    }
  }
  return result;
}

module.exports = function (source) {
  const lang = new URLSearchParams(this.resourceQuery.slice(1)).get('lang');
  return `module.exports = ${JSON.stringify(parseHelpSections(source, lang))};`;
};
module.exports.parseHelpSections = parseHelpSections;
