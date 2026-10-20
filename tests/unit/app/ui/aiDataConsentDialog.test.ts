import { installChromeMock, type ChromeMock } from '../../../setup/chrome-mock';
import {
  createChromeAiDataConsentGate,
  openAiDataConsentDialog,
} from '../../../../src/app/ui/aiDataConsentDialog';
import { setUiLanguage } from '../../../../src/lib/i18n';
import {
  AI_DATA_CONSENT_STORAGE_KEY,
  AI_DATA_CONSENT_VERSION,
} from '../../../../src/lib/storage/aiDataConsentStore';

let mock: ChromeMock;

beforeEach(() => {
  mock = installChromeMock();
  document.body.replaceChildren();
});

afterEach(() => setUiLanguage('ja'));

function dialog(): HTMLElement {
  return document.getElementById('ai-data-consent')!;
}

function key(name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
}

test('送る内容・送り先・扱い・リンクを示し、モーダルとしてフォーカスを移す', () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  void openAiDataConsentDialog(document, 'anthropic');
  const panel = dialog();
  expect(panel.getAttribute('role')).toBe('dialog');
  expect(panel.getAttribute('aria-modal')).toBe('true');
  expect(document.getElementById(panel.getAttribute('aria-labelledby')!)?.textContent).toBe(
    'AI へ送る内容の確認',
  );
  const body = document.getElementById(panel.getAttribute('aria-describedby')!)!;
  expect(body.textContent).toContain('設定した LLM API（Anthropic）');
  expect(body.textContent).toContain('論文の本文（文字を読み取れない PDF はページの画像）');
  expect(body.textContent).toContain('研究プロトコルの本文');
  expect(body.textContent).toContain('抽出項目の定義');
  expect(body.textContent).toContain('論文への質問の文');
  expect(body.textContent).toContain('Gemini API の無料枠');
  expect(body.textContent).toContain('開発者のサーバーへは何も送りません');
  expect(body.textContent).toContain('出版社の利用条件');
  const privacy = [...panel.querySelectorAll('a')].find((a) => a.textContent === 'プライバシーポリシー')!;
  expect(privacy.href).toBe('https://youkiti.github.io/sr-data-extraction-plugin/privacy-policy.html?lang=ja');
  expect(privacy.target).toBe('_blank');
  expect(privacy.rel).toBe('noopener noreferrer');
  expect(panel.querySelector<HTMLAnchorElement>('a[data-help]')?.dataset.help).toBe('ai-data-consent');
  expect(document.activeElement).toBe(panel);
});

test('英語表示では文言とリンクの言語が切り替わる', () => {
  setUiLanguage('en');
  void openAiDataConsentDialog(document, 'openai_compatible');
  expect(dialog().textContent).toContain('the LLM API you configured (OpenAI-compatible API)');
  expect(document.getElementById('ai-data-consent-accept')?.textContent).toBe('Agree and continue');
  expect(document.getElementById('ai-data-consent-cancel')?.textContent).toBe('Cancel');
});

test('「同意して続行」で true になり、閉じて元の要素へフォーカスを戻す', async () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const result = openAiDataConsentDialog(document, 'gemini');
  document.getElementById('ai-data-consent-accept')!.click();
  expect(await result).toBe(true);
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(opener);
});

test('「キャンセル」で false になる。元の要素が外れていればフォーカスは戻さない', async () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const result = openAiDataConsentDialog(document, 'gemini');
  opener.remove();
  document.getElementById('ai-data-consent-cancel')!.click();
  expect(await result).toBe(false);
  expect(dialog()).toBeNull();
});

test('Esc でキャンセルし、背後の keydown へは渡さない', async () => {
  const behind = jest.fn();
  document.addEventListener('keydown', behind);
  const result = openAiDataConsentDialog(document, 'gemini');
  const other = key('a');
  expect(other.defaultPrevented).toBe(false);
  const escape = key('Escape');
  expect(escape.defaultPrevented).toBe(true);
  expect(await result).toBe(false);
  expect(behind).not.toHaveBeenCalled();
  // 閉じた後は購読を外している
  key('a');
  expect(behind).toHaveBeenCalledTimes(1);
  document.removeEventListener('keydown', behind);
});

test('Tab / Shift+Tab はダイアログ内で循環する', () => {
  void openAiDataConsentDialog(document, 'gemini');
  const items = [...dialog().querySelectorAll<HTMLElement>('a[href], button')];
  const first = items[0]!;
  const last = items[items.length - 1]!;
  // 本体にフォーカスがある状態の Shift+Tab は最後へ
  expect(key('Tab', { shiftKey: true }).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(last);
  // 最後で Tab は最初へ
  expect(key('Tab').defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(first);
  // 最初で Shift+Tab は最後へ
  key('Tab', { shiftKey: true });
  expect(document.activeElement).toBe(last);
  // 途中の要素では既定の移動に任せる
  items[1]!.focus();
  expect(key('Tab').defaultPrevented).toBe(false);
  expect(key('Tab', { shiftKey: true }).defaultPrevented).toBe(false);
  // 外へ出たフォーカスは最初へ戻す
  const outside = document.createElement('button');
  document.body.append(outside);
  outside.focus();
  expect(key('Tab').defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(first);
});

test('本番のゲートは chrome.storage.local の記録とこのダイアログを使う', async () => {
  const gate = createChromeAiDataConsentGate(document);
  const first = gate('gemini');
  await new Promise((resolve) => setTimeout(resolve, 0));
  document.getElementById('ai-data-consent-accept')!.click();
  expect(await first).toBe(true);
  expect(mock.storage.local.data[AI_DATA_CONSENT_STORAGE_KEY]).toMatchObject({
    version: AI_DATA_CONSENT_VERSION,
  });
  expect(await gate('gemini')).toBe(true);
  expect(dialog()).toBeNull();
});
