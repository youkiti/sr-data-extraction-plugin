import { createHelpButton, headingWithHelp } from '../../../../src/app/ui/helpButton';
import { setUiLanguage } from '../../../../src/lib/i18n';

afterEach(() => setUiLanguage('ja'));

test.each([
  ['ja', 'この項目のヘルプを開く（新しいタブ）'],
  ['en', 'Open help for this item (new tab)'],
] as const)('%s のヘルプリンクと読み上げ名を生成する', (language, label) => {
  setUiLanguage(language);
  const link = createHelpButton('home');
  expect(link.tagName).toBe('A');
  expect(link.className).toBe('help-button');
  expect(link.dataset.help).toBe('home');
  expect(link.href).toBe(
    `https://youkiti.github.io/sr-data-extraction-plugin/help.html?lang=${language}#project`,
  );
  expect(link.target).toBe('_blank');
  expect(link.rel).toBe('noopener noreferrer');
  expect(link.textContent).toBe('?');
  expect(link.hasAttribute('aria-hidden')).toBe(false);
  expect(link.getAttribute('aria-label')).toBe(label);
  expect(link.title).toBe(label);
});

test.each(['h2', 'h3'] as const)('%s とリンクを兄弟として包む', (level) => {
  const wrapper = headingWithHelp(level, '見出し', 'verify');
  expect(wrapper.tagName).toBe('DIV');
  expect(wrapper.className).toBe('heading-with-help');
  expect(wrapper.children).toHaveLength(2);
  expect(wrapper.children[0]!.tagName.toLowerCase()).toBe(level);
  expect(wrapper.children[0]!.textContent).toBe('見出し');
  expect(wrapper.children[0]!.querySelector('a')).toBeNull();
  expect(wrapper.children[1]!.getAttribute('data-help')).toBe('verify');
});
