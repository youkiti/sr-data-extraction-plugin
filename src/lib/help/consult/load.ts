// 相談を開いたときだけ、表示言語のヘルプ小節を取得する。
import type { HelpLanguage, HelpSection } from './types';

export async function loadHelpSections(lang: HelpLanguage): Promise<HelpSection[]> {
  const loaded = lang === 'ja'
    ? await import(/* webpackChunkName: "help-sections-ja" */ '../../../../hosted/help.html?help-sections&lang=ja')
    : await import(/* webpackChunkName: "help-sections-en" */ '../../../../hosted/help.html?help-sections&lang=en');
  return loaded.default;
}
