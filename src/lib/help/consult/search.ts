// API キーを使わず、小見出しと本文を端末内で検索する。
import type { HelpSection } from './types';

function tokens(text: string): Set<string> {
  const normalized = text.normalize('NFKC').toLowerCase();
  const result = new Set(normalized.match(/[a-z0-9]+/g));
  for (const run of normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu) ?? []) {
    const characters = [...run];
    for (let index = 0; index < characters.length - 1; index++) {
      result.add(characters.slice(index, index + 2).join(''));
    }
  }
  return result;
}

export function searchHelpSections(sections: readonly HelpSection[], query: string, limit = 3): HelpSection[] {
  if (!Number.isFinite(limit) || limit <= 0) {
    return [];
  }
  const requested = tokens(query);
  const matches = (value: string): number => [...tokens(value)].filter((token) => requested.has(token)).length;
  return sections.map((section, index) => ({
    section,
    index,
    score: matches(section.when.join(' ')) * 3 + matches(section.title) * 2 + matches(section.body),
  })).filter(({ section, score }) => section.body.trim() !== '' && score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.floor(limit)).map(({ section }) => section);
}
