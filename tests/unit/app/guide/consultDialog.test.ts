// ヘルプ相談の状態遷移と、同意・中止・フォーカス・公開前の下書きを検証する。
import { createConsultDialogDeps, openConsultDialog, type ConsultDialogDeps } from '../../../../src/app/guide/consult/consultDialog';
import { setUiLanguage } from '../../../../src/lib/i18n';
import type { ConsultFailureKind, ConsultResult, HelpSection } from '../../../../src/lib/help/consult/types';
import { installChromeMock } from '../../../setup/chrome-mock';
import { saveGeminiApiKey, saveAnthropicApiKey, saveOpenRouterApiKey } from '../../../../src/lib/storage/secretsStore';
import { loadHelpSections } from '../../../../src/lib/help/consult/load';

jest.mock('../../../../src/lib/help/consult/load', () => ({ loadHelpSections: jest.fn() }));

const sections: HelpSection[] = [{
  id: 'project-tours', kind: 'subsection', sectionId: 'project', sectionTitle: 'Project',
  title: 'Tours', when: ['tour'], body: 'Start the tour',
}];
let deps: ConsultDialogDeps;
let opener: HTMLButtonElement;
const panel = (): HTMLElement => document.getElementById('help-consult')!;
const action = (name: string): HTMLButtonElement => panel().querySelector(`[data-consult-action="${name}"]`)!;
const question = (): HTMLTextAreaElement => document.getElementById('help-consult-question') as HTMLTextAreaElement;
const flush = async (): Promise<void> => {
  for (let i = 0; i < 15; i++) {
    await Promise.resolve();
  }
};
function input(text = 'tour'): void {
  question().value = text;
  question().dispatchEvent(new Event('input'));
}
function key(name: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
}
async function search(): Promise<void> {
  await openConsultDialog(document, deps);
  input();
  action('search').click();
}
beforeEach(() => {
  installChromeMock();
  setUiLanguage('ja');
  document.body.replaceChildren();
  opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  deps = {
    loadApiKey: jest.fn(async provider => provider === 'gemini' ? 'test-secret' : null),
    loadDefaultModel: async () => null,
    loadSections: jest.fn(async () => sections),
    ensureAiDataConsent: jest.fn(async () => true),
    consult: jest.fn(async (): Promise<ConsultResult> => ({ status: 'success', sectionIds: ['project-tours'], answer: '<b>answer</b>' })),
    copy: jest.fn(async () => undefined),
    version: () => '1.0',
  };
});
afterEach(() => {
  if (panel()) {
    action('close').click();
  }
  setUiLanguage('ja');
  jest.useRealTimers();
});

test('入力・検索結果・下書きを表示しコピーできる。閉じると履歴が消える', async () => {
  await openConsultDialog(document, deps);
  await openConsultDialog(document, deps);
  expect(document.querySelectorAll('#help-consult')).toHaveLength(1);
  expect(panel().getAttribute('aria-modal')).toBe('true');
  expect(panel().getAttribute('aria-labelledby')).toBe('help-consult-title');
  expect(document.activeElement).toBe(panel());
  expect(question().maxLength).toBe(1000);
  expect(action('search').disabled).toBe(true);
  input('  ');
  expect(action('search').disabled).toBe(true);
  input();
  action('search').click();
  expect(panel().textContent).toContain('Project: Tours');
  expect(panel().textContent).toContain('Gemini / gemini-3.1-flash-lite');
  expect(panel().textContent).not.toContain('test-secret');
  action('draft').click();
  const preview = document.getElementById('help-consult-draft') as HTMLTextAreaElement;
  expect(preview.readOnly).toBe(true);
  expect(preview.value).toContain('Version: 1.0');
  expect(preview.value).toContain('Configured providers: gemini');
  expect(panel().textContent).toContain('公開の Issue');
  expect(panel().textContent).toContain('プロジェクトの管理者や紹介者');
  const github = panel().querySelector<HTMLAnchorElement>('a[href*="issues/new"]')!;
  expect(github.target).toBe('_blank');
  expect(github.href).toContain(encodeURIComponent(preview.value));
  action('copy').click();
  await flush();
  expect(deps.copy).toHaveBeenCalledWith(preview.value);
  expect(panel().textContent).toContain('コピーしました');
  input('changed');
  expect(action('ask')).toBeNull();
  action('close').click();
  expect(document.activeElement).toBe(opener);
  await openConsultDialog(document, deps);
  expect(question().value).toBe('');
  expect(document.getElementById('help-consult-draft')).toBeNull();
});

test('小節の読み込み中は検索を押せず、読み込み後に使える', async () => {
  let loaded!: (value: HelpSection[]) => void;
  deps.loadSections = () => new Promise(resolve => {
    loaded = resolve;
  });
  const opening = openConsultDialog(document, deps);
  input();
  expect(action('search').disabled).toBe(true);
  loaded(sections);
  await opening;
  expect(action('search').disabled).toBe(false);
});

test('検索0件、キーなしでも下書きが使え、コピー失敗を表示する', async () => {
  deps.loadApiKey = async () => null;
  deps.copy = async () => {
    throw new Error('copy');
  };
  await search();
  input('zzzz');
  action('search').click();
  expect(panel().textContent).toContain('見つかりませんでした');
  expect(panel().textContent).toContain('検索・ツアー・下書き');
  expect(action('ask')).toBeNull();
  action('draft').click();
  action('copy').click();
  await flush();
  expect(panel().textContent).toContain('コピーできませんでした');
});

test('同意拒否では送らず、同意待ちの二重押しを防ぐ', async () => {
  let consent!: (value: boolean) => void;
  deps.ensureAiDataConsent = jest.fn(() => new Promise(resolve => {
    consent = resolve;
  }));
  await search();
  action('ask').click();
  action('ask').dispatchEvent(new Event('click'));
  expect(deps.ensureAiDataConsent).toHaveBeenCalledTimes(1);
  consent(false);
  await flush();
  expect(deps.consult).not.toHaveBeenCalled();
  expect(action('ask').disabled).toBe(false);
});

test('成功では回答を文字として表示し、sectionIdsから言語付きリンクを作る', async () => {
  setUiLanguage('en');
  await search();
  action('ask').click();
  await flush();
  expect(panel().textContent).toContain('<b>answer</b>');
  expect(panel().querySelector('b')).toBeNull();
  expect(panel().querySelector('a[href*="#project-tours"]')!.getAttribute('href')).toContain('?lang=en#project-tours');
  expect(deps.consult).toHaveBeenCalledWith(expect.objectContaining({ question: 'tour', lang: 'en', apiKey: 'test-secret' }));
  action('draft').click();
  expect((document.getElementById('help-consult-draft') as HTMLTextAreaElement).value).toContain('<b>answer</b>');
});

test.each<ConsultFailureKind>(['no_key', 'rate_limited', 'auth', 'timeout', 'aborted', 'network', 'invalid_response', 'unknown'])('失敗 %s を表示し下書きに種類を入れる', async kind => {
  deps.consult = async () => ({ status: 'failure', kind });
  await search();
  action('ask').click();
  await flush();
  action('draft').click();
  expect((document.getElementById('help-consult-draft') as HTMLTextAreaElement).value).toContain(kind);
});

test('該当なしを表示し、例外も失敗として扱う', async () => {
  deps.consult = async () => ({ status: 'no_match' });
  await search();
  action('ask').click();
  await flush();
  expect(panel().textContent).toContain('ヘルプに該当する箇所');
  deps.ensureAiDataConsent = async () => {
    throw new Error('consent');
  };
  action('ask').click();
  await flush();
  expect(panel().textContent).toContain('相談を実行できませんでした');
});

test('経過秒数・中止・二重押し防止', async () => {
  jest.useFakeTimers();
  let finish!: (value: ConsultResult) => void;
  deps.consult = jest.fn(params => new Promise(resolve => {
    finish = resolve;
    params.signal!.addEventListener('abort', () => resolve({ status: 'failure', kind: 'aborted' }));
  }));
  await search();
  action('ask').click();
  await flush();
  action('ask').dispatchEvent(new Event('click'));
  expect(deps.consult).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(2000);
  expect(panel().textContent).toContain('2秒');
  action('stop').click();
  await flush();
  expect(panel().textContent).toContain('相談を中止しました');
  expect(action('stop').hidden).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
  finish({ status: 'no_match' });
});

test('Tabを循環させEscで閉じ、元のフォーカスへ戻す', async () => {
  await search();
  const first = panel().querySelector<HTMLAnchorElement>('a')!;
  const last = action('close');
  key('Tab', true);
  expect(document.activeElement).toBe(last);
  key('Tab');
  expect(document.activeElement).toBe(first);
  key('Tab', true);
  expect(document.activeElement).toBe(last);
  opener.focus();
  key('Tab');
  expect(document.activeElement).toBe(first);
  expect(key('Tab').defaultPrevented).toBe(false);
  key('Enter');
  const consent = document.createElement('div');
  consent.id = 'ai-data-consent';
  document.body.append(consent);
  key('Escape');
  expect(panel()).not.toBeNull();
  consent.remove();
  key('Escape');
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(opener);
});

test('開く前のフォーカスがなくなっていても閉じる', async () => {
  await search();
  opener.remove();
  action('close').click();
  expect(panel()).toBeNull();
});

test('同意待ちと回答待ちの途中で閉じても結果を出さない', async () => {
  let consent!: (value: boolean) => void;
  deps.ensureAiDataConsent = () => new Promise(resolve => {
    consent = resolve;
  });
  await search();
  action('ask').click();
  action('close').click();
  consent(true);
  await flush();
  expect(deps.consult).not.toHaveBeenCalled();
  deps.ensureAiDataConsent = async () => true;
  deps.consult = params => new Promise(resolve => {
    params.signal!.addEventListener('abort', () => resolve({ status: 'failure', kind: 'aborted' }));
  });
  await search();
  action('ask').click();
  await flush();
  action('close').click();
  await flush();
  expect(panel()).toBeNull();
});

test('読み込み失敗と閉じた後の例外を扱う', async () => {
  deps.loadSections = async () => {
    throw new Error('load');
  };
  await openConsultDialog(document, deps);
  expect(panel().textContent).toContain('相談を実行できませんでした');
  action('draft').click();
  action('close').click();
  let fail!: (reason: Error) => void;
  deps.loadSections = async () => sections;
  deps.consult = () => new Promise((_resolve, reject) => {
    fail = reject;
  });
  await search();
  action('ask').click();
  await flush();
  action('close').click();
  fail(new Error('closed'));
  await flush();
  expect(panel()).toBeNull();
});

test('本番依存は3社のキーと同意・コピー・版を読む', async () => {
  await saveGeminiApiKey('gemini');
  await saveAnthropicApiKey('anthropic');
  await saveOpenRouterApiKey('openrouter');
  const defaults = createConsultDialogDeps(document);
  expect(await defaults.loadApiKey('gemini')).toBe('gemini');
  expect(await defaults.loadApiKey('anthropic')).toBe('anthropic');
  expect(await defaults.loadApiKey('openrouter')).toBe('openrouter');
  chrome.runtime.getManifest = jest.fn(() => {
    throw new Error('manifest');
  });
  expect(defaults.version()).toBe('');
  chrome.runtime.getManifest = jest.fn(() => ({ version: '2.0' } as chrome.runtime.Manifest));
  expect(defaults.version()).toBe('2.0');
  const writeText = jest.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  await defaults.copy('draft');
  expect(writeText).toHaveBeenCalledWith('draft');
});

test('依存の省略時は本番の読み込みを使う', async () => {
  jest.mocked(loadHelpSections).mockResolvedValue(sections);
  await openConsultDialog(document);
  expect(loadHelpSections).toHaveBeenCalledWith('ja');
  input();
  action('search').click();
  expect(action('ask')).toBeNull();
});
