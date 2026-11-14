// ビルド時に生成する言語別ヘルプ小節の import 宣言。
/* eslint-disable no-restricted-syntax -- ローダーの CommonJS 出力を動的 import で受け取るための型宣言。 */
declare module '*?help-sections&lang=ja' {
  const sections: import('../lib/help/consult/types').HelpSection[];
  export default sections;
}
declare module '*?help-sections&lang=en' {
  const sections: import('../lib/help/consult/types').HelpSection[];
  export default sections;
}
