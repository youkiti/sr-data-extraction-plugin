import { GUIDE_TOUR_IDS } from '../../../../src/lib/guide/tours';
import * as ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { ROUTES, SETTINGS_ROUTE } from '../../../../src/app/router';
import {
  HELP_TOPICS,
  buildHelpUrl,
  helpTopicForRoute,
  isHelpTopicId,
} from '../../../../src/lib/help/topics';
import type { HelpTopic } from '../../../../src/lib/help/topics';

const repoRoot = join(__dirname, '..', '..', '..', '..');
const help = new DOMParser().parseFromString(
  readFileSync(join(repoRoot, 'hosted', 'help.html'), 'utf8'),
  'text/html',
);
const topics: HelpTopic[] = Object.values(HELP_TOPICS);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.(ts|html)$/.test(entry.name) ? [path] : [];
  });
}

describe('ヘルプの対応表と公開ページの照合', () => {
  test('全トピックのアンカーがヘルプに実在する', () => {
    for (const topic of topics) {
      expect(help.getElementById(topic.helpAnchor)).not.toBeNull();
    }
  });

  test('全ルートにトピックがちょうど一つあり、対応表に未知のルートがない', () => {
    const hashes = [...ROUTES, SETTINGS_ROUTE].map((route) => route.hash);
    for (const hash of hashes) {
      expect(topics.filter((topic) => topic.route === hash)).toHaveLength(1);
    }
    for (const topic of topics) {
      if (topic.route !== undefined) expect(hashes).toContain(topic.route);
    }
  });

  test('ソース内に直接書かれたヘルプリンクのアンカーが実在する', () => {
    const files = sourceFiles(join(repoRoot, 'src'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/help\.html#([^\s"'`<>]+)/g)) {
        expect(help.getElementById(match[1]!)).not.toBeNull();
      }
    }
  });

  test('ヘルプ内の id が重複しない', () => {
    const ids = [...help.querySelectorAll('[id]')].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('アンカー付き見出しと節の最初の見出しに空でない日本語と英語がある', () => {
    const headings = new Set(help.querySelectorAll('h2[id], h3[id], h4[id]'));
    for (const section of help.querySelectorAll('section[id]')) {
      const heading = section.querySelector(':scope > h2');
      expect(heading).not.toBeNull();
      headings.add(heading!);
    }
    for (const heading of headings) {
      for (const language of ['ja', 'en']) {
        const span = heading.querySelector(`span.${language}[lang="${language}"]`);
        expect(span).not.toBeNull();
        expect(span!.textContent!.trim()).not.toBe('');
      }
    }
  });

  test('節内の小見出しの id は所属する節の id を接頭辞に持つ', () => {
    for (const heading of help.querySelectorAll('section h3[id], section h4[id]')) {
      const section = heading.closest('section')!;
      expect(section.id).not.toBe('');
      expect(heading.id.startsWith(`${section.id}-`)).toBe(true);
      expect(heading.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  test('既存の節の id と順序を維持する', () => {
    expect([...help.querySelectorAll('section')].map((section) => section.id)).toEqual([
      'about', 'video', 'setup', 'project', 'documents', 'protocol', 'schema', 'pilot',
      'extract', 'verify', 'dashboard', 'dual-review', 'export', 'options',
      'troubleshooting', 'faq',
    ]);
  });
});

describe('公開ヘルプの「こんなとき」', () => {
  test('全 FAQ に faq- で始まる id がある', () => {
    const faqs = [...help.querySelectorAll('details.faq')];
    expect(faqs).toHaveLength(8);
    for (const faq of faqs) expect(faq.id).toMatch(/^faq-[a-z]+(?:-[a-z]+)*$/);
  });

  test('見出しの直後に一つだけ置かれている', () => {
    const blocks = [...help.querySelectorAll('.help-when')];
    expect(blocks.length).toBeGreaterThan(0);
    const headings = new Set<Element>();
    for (const block of blocks) {
      const heading = block.previousElementSibling;
      expect(heading).not.toBeNull();
      expect(heading!.matches('h2, h3, summary')).toBe(true);
      expect(headings.has(heading!)).toBe(false);
      headings.add(heading!);
      expect(block.nextElementSibling?.matches('.help-when')).not.toBe(true);
    }
  });

  test('ラベルと二つから四つの例に空でない日英の対がある', () => {
    for (const block of help.querySelectorAll('.help-when')) {
      const labels = block.querySelectorAll(':scope > p.help-when-label');
      expect(labels).toHaveLength(1);
      const items = [...block.querySelectorAll(':scope > ul > li')];
      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(items.length).toBeLessThanOrEqual(4);
      for (const element of [labels[0]!, ...items]) {
        for (const language of ['ja', 'en']) {
          const spans = element.querySelectorAll(`span.${language}[lang="${language}"]`);
          expect(spans).toHaveLength(1);
          expect(spans[0]!.textContent!.trim()).not.toBe('');
        }
      }
    }
  });

  test('全小見出しと FAQ、本文がある節の冒頭に付いている', () => {
    // 小見出しや個別 FAQ より前に本文を持たない節は除外する。
    const emptySectionIds = ['troubleshooting', 'faq'];
    const headings = [...help.querySelectorAll('h3[id], details.faq > summary')];
    for (const section of help.querySelectorAll('section[id]')) {
      const heading = section.querySelector(':scope > h2')!;
      if (emptySectionIds.includes(section.id)) {
        expect(heading.nextElementSibling?.matches('.help-when')).not.toBe(true);
      } else {
        headings.push(heading);
      }
    }
    for (const heading of headings) {
      expect(heading.nextElementSibling?.matches('.help-when')).toBe(true);
    }
  });
});

describe('ヘルプの URL とトピック検索', () => {
  test.each(['ja', 'en'] as const)('%s の表示言語とアンカーを URL に付ける', (language) => {
    expect(buildHelpUrl('verify', language)).toBe(
      `https://youkiti.github.io/sr-data-extraction-plugin/help.html?lang=${language}#verify`,
    );
    expect(buildHelpUrl('home', language)).toBe(
      `https://youkiti.github.io/sr-data-extraction-plugin/help.html?lang=${language}#project`,
    );
  });

  test('登録済みのトピックだけを識別する', () => {
    for (const topicId of Object.keys(HELP_TOPICS)) expect(isHelpTopicId(topicId)).toBe(true);
    for (const value of ['unknown', '', 'toString', '__proto__']) {
      expect(isHelpTopicId(value)).toBe(false);
    }
  });

  test('一致するルートのトピックを返し、該当しなければ null を返す', () => {
    for (const [topicId, topic] of Object.entries(HELP_TOPICS)) {
      if ('route' in topic) {
        expect(helpTopicForRoute(topic.route)).toBe(topicId);
      } else {
        for (const route of [...ROUTES, SETTINGS_ROUTE]) {
          expect(helpTopicForRoute(route.hash)).not.toBe(topicId);
        }
        expect(helpTopicForRoute(`#/${topicId}`)).toBeNull();
      }
    }
    expect(helpTopicForRoute('#/unknown')).toBeNull();
    expect(helpTopicForRoute('')).toBeNull();
    expect(helpTopicForRoute('#/verify?study=example')).toBeNull();
  });
});


test('画面で使うヘルプ ID が対応表と一致し、全トピックを使っている', () => {
  const files = ['app', 'popup', 'options'].flatMap((directory) =>
    sourceFiles(join(repoRoot, 'src', directory)),
  );
  expect(files.length).toBeGreaterThan(0);
  const used = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/data-help="([^"]+)"/g)) used.add(match[1]!);
    if (!file.endsWith('.ts')) continue;
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        const argument = name === 'createHelpButton' ? node.arguments[0]
          : name === 'headingWithHelp' ? node.arguments[2] : undefined;
        if (argument && ts.isStringLiteral(argument)) used.add(argument.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  for (const id of used) expect(isHelpTopicId(id)).toBe(true);
  expect([...used].sort()).toEqual(Object.keys(HELP_TOPICS).sort());
});

test('対応ツアーは実在し、設定以外の全画面がツアーを持つ', () => {
  for (const [id, topic] of Object.entries(HELP_TOPICS) as Array<[string, HelpTopic]>) {
    if (topic.tourId) expect(GUIDE_TOUR_IDS).toContain(topic.tourId);
    if (topic.route && id !== 'options') expect(topic.tourId).toBeDefined();
  }
});
