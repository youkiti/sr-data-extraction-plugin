// stylelint 設定（docs/test-strategy.md §1: CSS 規約を最初から導入）
module.exports = {
  extends: ['stylelint-config-standard'],
  rules: {
    // CSS カスタムプロパティはケバブケース + 用途プレフィックス（--color-* 等）を許容
    'custom-property-pattern': null,
    // BEM 風のクラス名（app__sidebar 等）を許容
    'selector-class-pattern': null,
  },
};
