// ビルド情報。__BUILD_DATE__ は webpack DefinePlugin がビルド時刻（YYYY-MM-DD）へ
// 置換する（webpack.config.js）。jest は jest.config.ts の globals で同名の値を与える。
declare const __BUILD_DATE__: string;

/** ビルド日（YYYY-MM-DD）。アプリ名の下に表示する */
export const BUILD_DATE: string = __BUILD_DATE__;
