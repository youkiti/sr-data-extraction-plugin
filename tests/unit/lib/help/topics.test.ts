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
      'video', 'setup', 'project', 'documents', 'protocol', 'schema', 'pilot',
      'extract', 'verify', 'dashboard', 'dual-review', 'export', 'options',
      'troubleshooting', 'faq',
    ]);
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
