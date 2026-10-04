// webpack と同じ CommonJS の純粋関数を直接検証する。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { shouldIgnoreMermaidImport } = require('../../tools/bundle/mermaidFlowchartOnly') as {
  shouldIgnoreMermaidImport: (resource: string, context: string, dependencyType: string) => boolean;
};

describe.each([
  '/repo/node_modules/mermaid/dist',
  '/repo/node_modules/mermaid/dist/chunks/mermaid.core',
  'C:\\repo\\node_modules\\mermaid\\dist\\chunks\\mermaid.core',
])('mermaid 動的 import の許可判定: %s', (context) => {
  test.each(['chunk-SHARED', 'flowDiagram-FLOW', 'dagre-LAYOUT'])('%s は残す', (name) => {
    expect(shouldIgnoreMermaidImport(`./${name}.mjs`, context, 'import()')).toBe(false);
    expect(
      shouldIgnoreMermaidImport(`./chunks/mermaid.core/${name}.mjs`, context, 'import()'),
    ).toBe(false);
  });
  test.each([
    './chunks/mermaid.core/pieDiagram-PIE.mjs',
    './diagram-OTHER.mjs',
    './timeline-definition-TIME.mjs',
    './futureDiagram-NEW.mjs',
    './cose-bilkent-LAYOUT.mjs',
    './swimlanes-LAYOUT.mjs',
    './sizeCapture-SIZE.mjs',
    'katex',
  ])('%s は動的 import の場合だけ外す', (resource) => {
    expect(shouldIgnoreMermaidImport(resource, context, 'import()')).toBe(true);
    expect(shouldIgnoreMermaidImport(resource, context, 'harmony side effect evaluation')).toBe(
      false,
    );
  });
  test.each(['d3', './styles.css', '../outside.mjs'])('%s は対象外', (resource) => {
    expect(shouldIgnoreMermaidImport(resource, context, 'import()')).toBe(false);
  });
});

test.each(['/repo/src', '/repo/node_modules/mermaid/dist-other', '/repo/node_modules/other/dist'])(
  'mermaid 配下以外の %s は変更しない',
  (context) => {
    expect(shouldIgnoreMermaidImport('katex', context, 'import()')).toBe(false);
    expect(shouldIgnoreMermaidImport('./pieDiagram-PIE.mjs', context, 'import()')).toBe(false);
  },
);
