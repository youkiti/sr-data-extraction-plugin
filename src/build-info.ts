// ビルド情報。__BUILD_DATE__ / __IS_DEV_BUILD__ は webpack DefinePlugin がビルド時に
// 置換する（webpack.config.js）。jest は jest.config.ts の globals で同名の値を与える。
declare const __BUILD_DATE__: string;
declare const __IS_DEV_BUILD__: boolean;

/** ビルド日（YYYY-MM-DD）。アプリ名の下に表示する */
export const BUILD_DATE: string = __BUILD_DATE__;

/** dev ビルド（webpack --mode development）かどうか。manifest 名の (dev) 付与と対応 */
export const IS_DEV_BUILD: boolean = __IS_DEV_BUILD__;

/** dev ビルドのとき表示名へ「 (dev)」を付ける（manifest 名とヘッダー表示を揃える） */
export function withDevSuffix(name: string | null, isDev: boolean): string {
  const base = name ?? '';
  return isDev ? `${base} (dev)` : base;
}
