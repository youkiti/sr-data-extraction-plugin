// i18n 基盤（issue #93）: 辞書のキー集合一致（受け入れ条件）+ t のフォールバック +
// 言語切替の購読 + data-i18n 属性の DOM 反映
import { en } from '../../../../src/lib/i18n/en';
import { ja } from '../../../../src/lib/i18n/ja';
import {
  getUiLanguage,
  isUiLanguage,
  localizeDom,
  onUiLanguageChange,
  setUiLanguage,
  t,
  type MessageKey,
} from '../../../../src/lib/i18n';

afterEach(() => {
  // モジュール内状態を既定言語へ戻す（他テストへの言語漏れを防ぐ）
  setUiLanguage('ja');
});

describe('辞書（ja / en）', () => {
  test('ja / en のキー集合が一致する（受け入れ条件: 両辞書の網羅）', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ja).sort());
  });

  test('キーは「画面.要素」形式（小文字始まりのセグメントをドットで 1 回区切る）', () => {
    for (const key of Object.keys(ja)) {
      expect(key).toMatch(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/);
    }
  });

  test('全キーの文言が空文字でない', () => {
    for (const value of [...Object.values(ja), ...Object.values(en)]) {
      expect(value).not.toBe('');
    }
  });
});

describe('isUiLanguage', () => {
  test('ja / en のみ真', () => {
    expect(isUiLanguage('ja')).toBe(true);
    expect(isUiLanguage('en')).toBe(true);
    expect(isUiLanguage('fr')).toBe(false);
    expect(isUiLanguage(undefined)).toBe(false);
  });
});

describe('t', () => {
  test('既定言語は ja', () => {
    expect(getUiLanguage()).toBe('ja');
    expect(t('common.cancel')).toBe('キャンセル');
  });

  test('en へ切り替えると en の文言を返す', () => {
    setUiLanguage('en');
    expect(getUiLanguage()).toBe('en');
    expect(t('common.cancel')).toBe('Cancel');
  });

  test('params は {name} プレースホルダを充填する（ja / en とも）', () => {
    expect(t('app.statusProject', { name: '肺炎 SR' })).toBe('プロジェクト: 肺炎 SR');
    setUiLanguage('en');
    expect(t('app.statusProject', { name: 'Pneumonia SR' })).toBe('Project: Pneumonia SR');
  });

  test('en に無いキーは ja へフォールバックする', () => {
    // 型上は網羅が強制されるため、実行時にキーを一時的に欠落させて挙動を検証する
    const dict = en as unknown as Record<string, string | undefined>;
    const saved = dict['home.title'];
    delete dict['home.title'];
    try {
      setUiLanguage('en');
      expect(t('home.title')).toBe(ja['home.title']);
    } finally {
      dict['home.title'] = saved;
    }
  });

  test('ja にも無い未知キーはキー文字列をそのまま返す（フェイルセーフ）', () => {
    expect(t('nope.nope' as MessageKey)).toBe('nope.nope');
    setUiLanguage('en');
    expect(t('nope.nope' as MessageKey)).toBe('nope.nope');
  });
});

describe('setUiLanguage / onUiLanguageChange', () => {
  test('変化時のみ購読者へ通知し、解除後は呼ばれない', () => {
    const listener = jest.fn();
    const unsubscribe = onUiLanguageChange(listener);
    setUiLanguage('ja'); // 同値 = 通知しない
    expect(listener).not.toHaveBeenCalled();
    setUiLanguage('en');
    expect(listener).toHaveBeenCalledWith('en');
    unsubscribe();
    setUiLanguage('ja');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('localizeDom', () => {
  test('data-i18n / -placeholder / -title / -aria-label を現在言語で解決する', () => {
    document.body.innerHTML = `
      <p data-i18n="common.cancel">キャンセル</p>
      <input data-i18n-placeholder="popup.createTitleLabel" placeholder="プロジェクトタイトル" />
      <a data-i18n-title="app.openOptionsTitle" data-i18n-aria-label="app.openOptionsTitle"
         title="設定を開く" aria-label="設定を開く">⚙</a>
    `;
    setUiLanguage('en');
    localizeDom(document);
    expect(document.querySelector('p')?.textContent).toBe('Cancel');
    expect(document.querySelector('input')?.getAttribute('placeholder')).toBe('Project title');
    expect(document.querySelector('a')?.getAttribute('title')).toBe('Open settings');
    expect(document.querySelector('a')?.getAttribute('aria-label')).toBe('Open settings');

    // ja へ戻すと元の文言へ戻る（HTML の初期文言 = ja と一致）
    setUiLanguage('ja');
    localizeDom(document);
    expect(document.querySelector('p')?.textContent).toBe('キャンセル');
    expect(document.querySelector('input')?.getAttribute('placeholder')).toBe(
      'プロジェクトタイトル',
    );
  });
});
