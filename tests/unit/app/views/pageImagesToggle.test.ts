// ページ画像の任意追加とモデル能力による無効化を検証する。
import { renderPageImagesToggle } from '../../../../src/app/views/pageImagesToggle';
import { setUiLanguage } from '../../../../src/lib/i18n';

afterEach(() => setUiLanguage('ja'));

test('既定は未選択で説明と関連づけ、切替を通知する', () => {
  const onToggle = jest.fn();
  const root = renderPageImagesToggle({
    idPrefix: 'pilot', enabled: false, model: '', providerOverride: null, onToggle,
  });
  const box = root.querySelector('input')!;
  expect(box.checked).toBe(false);
  expect(box.disabled).toBe(false);
  expect(box.getAttribute('aria-describedby')).toBe('pilot-page-images-description');
  expect(root.textContent).toContain('全ページ');
  expect(root.textContent).toContain('約 1.5 倍');
  box.checked = true;
  box.dispatchEvent(new Event('change'));
  expect(onToggle).toHaveBeenCalledWith(true);
});

test('画像非対応のモデルでは選択を無効にし理由を示す', () => {
  const root = renderPageImagesToggle({
    idPrefix: 'extract', enabled: true, model: 'deepseek/deepseek-v4-flash',
    providerOverride: 'openrouter', onToggle: jest.fn(),
  });
  const box = root.querySelector('input')!;
  expect(box.disabled).toBe(true);
  expect(box.checked).toBe(false);
  expect(root.textContent).toContain('画像入力に対応していない');
});

test('接続方式の指定を優先し、不明のモデルも英語で選択できる', () => {
  setUiLanguage('en');
  const root = renderPageImagesToggle({
    idPrefix: 'extract', enabled: true, model: 'deepseek/deepseek-v4-flash',
    providerOverride: 'openai_compatible', onToggle: jest.fn(),
  });
  expect(root.querySelector('input')!.disabled).toBe(false);
  expect(root.querySelector('input')!.checked).toBe(true);
  expect(root.textContent).toContain('Also send page images');
});
