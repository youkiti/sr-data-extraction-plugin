// unit テストでは app を含む全画面の文言を利用する。
import '../../src/lib/i18n/registerAppMessages';

// resetModules で読み直される場合も全辞書を登録する。
// requireActual を使う未登録状態のテストには、この初期化を適用しない。
jest.mock('../../src/lib/i18n', () => {
  const i18n: typeof import('../../src/lib/i18n') = jest.requireActual('../../src/lib/i18n');
  const { jaApp }: typeof import('../../src/lib/i18n/ja.app') = jest.requireActual('../../src/lib/i18n/ja.app');
  const { enApp }: typeof import('../../src/lib/i18n/en.app') = jest.requireActual('../../src/lib/i18n/en.app');
  i18n.registerMessages({ ja: jaApp, en: enApp });
  return i18n;
});
