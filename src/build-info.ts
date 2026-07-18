// ビルド情報。__BUILD_DATE__ / __DEV_NAME_SUFFIX__ は webpack DefinePlugin がビルド時に
// 置換する（webpack.config.js）。jest は jest.config.ts の globals で同名の値を与える。
declare const __BUILD_DATE__: string;
declare const __DEV_NAME_SUFFIX__: string;

/** ビルド日（YYYY-MM-DD）。アプリ名の下に表示する */
export const BUILD_DATE: string = __BUILD_DATE__;

/**
 * dev ビルドで表示名の末尾へ付けるサフィックス（本番ビルドは空文字）。
 * 定義元は webpack.config.js の devNameSuffix ただ 1 箇所で、manifest 名と常に一致する
 */
export const DEV_NAME_SUFFIX: string = __DEV_NAME_SUFFIX__;

/** 表示名（ヘッダー・タブタイトル）へ dev サフィックスを付ける。null は空文字扱い */
export function withDevSuffix(name: string | null): string {
  return `${name ?? ''}${DEV_NAME_SUFFIX}`;
}
