// flow 図（mermaid）プレビューのラッパー（issue #109 PR5）のユニットテスト。
// mermaid パッケージは ESM 専用配布のため jest（CommonJS 実行）では実体をロードせず、
// jest.mock で API 面（initialize / parse / render）だけを差し替えてラッパーの分岐を検証する。
// ラッパーはロード結果をモジュール内にキャッシュするため、テストごとに jest.resetModules で
// 独立させる（キャッシュ再利用の分岐は同一テスト内の 2 回呼び出しで踏む）
const mockInitialize = jest.fn();
const mockParse = jest.fn();
const mockRender = jest.fn();

jest.mock('mermaid', () => ({
  __esModule: true,
  default: {
    initialize: mockInitialize,
    parse: mockParse,
    render: mockRender,
  },
}));

type Wrapper = typeof import('../../../../src/features/verification/mermaidPreview');

async function loadWrapper(): Promise<Wrapper> {
  jest.resetModules();
  return import('../../../../src/features/verification/mermaidPreview');
}

describe('mermaidPreview: 予約 field_name 規約', () => {
  test('quadas3_flow_diagram だけが対象になる', async () => {
    const wrapper = await loadWrapper();
    expect(wrapper.MERMAID_PREVIEW_FIELD_NAMES).toEqual(['quadas3_flow_diagram']);
    expect(wrapper.isMermaidPreviewField('quadas3_flow_diagram')).toBe(true);
    expect(wrapper.isMermaidPreviewField('quadas3_flow_enrolled')).toBe(false);
    expect(wrapper.isMermaidPreviewField('mortality_pct')).toBe(false);
  });
});

describe('parseMermaid', () => {
  test('構文 OK: valid を返し、初期化は strict + startOnLoad なしで 1 回だけ走る', async () => {
    const wrapper = await loadWrapper();
    mockParse.mockResolvedValue({ diagramType: 'flowchart-v2' });
    await expect(wrapper.parseMermaid('flowchart TD\n  A --> B')).resolves.toEqual({ valid: true });
    await expect(wrapper.parseMermaid('flowchart TD\n  B --> C')).resolves.toEqual({ valid: true });
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockInitialize).toHaveBeenCalledWith({ startOnLoad: false, securityLevel: 'strict' });
    expect(mockParse).toHaveBeenCalledWith('flowchart TD\n  A --> B');
  });

  test('構文エラー（Error）: 理由つきの invalid を返す（throw しない）', async () => {
    const wrapper = await loadWrapper();
    mockParse.mockRejectedValue(new Error('Parse error on line 2'));
    await expect(wrapper.parseMermaid('flowchart TD\n  A -->')).resolves.toEqual({
      valid: false,
      error: 'Parse error on line 2',
    });
  });

  test('構文エラー（非 Error の reject）: 文字列化した理由を返す', async () => {
    const wrapper = await loadWrapper();
    mockParse.mockRejectedValue('mermaid version mismatch');
    await expect(wrapper.parseMermaid('x')).resolves.toEqual({
      valid: false,
      error: 'mermaid version mismatch',
    });
  });

  test('ロード失敗（初期化の throw）は負のキャッシュにせず、次の呼び出しで再試行できる', async () => {
    const wrapper = await loadWrapper();
    mockInitialize.mockImplementationOnce(() => {
      throw new Error('chunk load failed');
    });
    mockParse.mockResolvedValue({});
    await expect(wrapper.parseMermaid('flowchart TD')).resolves.toEqual({
      valid: false,
      error: 'chunk load failed',
    });
    // 2 回目は初期化からやり直して成功する（mermaidLoad の負のキャッシュを持たない）
    await expect(wrapper.parseMermaid('flowchart TD')).resolves.toEqual({ valid: true });
    expect(mockInitialize).toHaveBeenCalledTimes(2);
  });
});

describe('renderMermaid', () => {
  test('成功: 一意 id で描画し、SVG を container へ差し込む', async () => {
    const wrapper = await loadWrapper();
    mockRender.mockResolvedValue({ svg: '<svg data-kind="flow"><g></g></svg>' });
    const container = document.createElement('div');
    await expect(wrapper.renderMermaid('flowchart TD\n  A --> B', container)).resolves.toEqual({
      ok: true,
    });
    expect(container.querySelector('svg[data-kind="flow"]')).not.toBeNull();
    // 同一画面で複数回プレビューしても id が衝突しない（連番）
    await wrapper.renderMermaid('flowchart TD\n  B --> C', container);
    expect(mockRender).toHaveBeenNthCalledWith(
      1,
      'sr-mermaid-preview-1',
      'flowchart TD\n  A --> B',
    );
    expect(mockRender).toHaveBeenNthCalledWith(
      2,
      'sr-mermaid-preview-2',
      'flowchart TD\n  B --> C',
    );
  });

  test('構文エラー: 理由つきの ok:false を返し、container は書き換えない', async () => {
    const wrapper = await loadWrapper();
    mockRender.mockRejectedValue(new Error('No diagram type detected'));
    const container = document.createElement('div');
    container.textContent = '描画中…';
    await expect(wrapper.renderMermaid('not mermaid', container)).resolves.toEqual({
      ok: false,
      error: 'No diagram type detected',
    });
    expect(container.textContent).toBe('描画中…');
  });
});

test.each([
  ['モジュール不足の code と message', Object.assign(
    new Error("Cannot find module './chunks/mermaid.core/pieDiagram-X.mjs'"),
    { code: 'MODULE_NOT_FOUND' },
  ), '対応する構文はフロー図（flowchart）のみです（他の図種は未対応）'],
  ['モジュール不足の code のみ', Object.assign(new Error('missing diagram'), {
    code: 'MODULE_NOT_FOUND',
  }), '対応する構文はフロー図（flowchart）のみです（他の図種は未対応）'],
  ['モジュール不足の message のみ', new Error("Cannot find module './chunks/mermaid.core/pieDiagram-X.mjs'"),
    '対応する構文はフロー図（flowchart）のみです（他の図種は未対応）'],
  ['数式モジュール不足の code と message', Object.assign(new Error("Cannot find module 'katex'"), {
    code: 'MODULE_NOT_FOUND',
  }), '数式（$$…$$）を含むラベルには対応していません'],
  ['数式モジュール不足の message のみ', new Error("Cannot find module 'katex'"),
    '数式（$$…$$）を含むラベルには対応していません'],
  ['別の code のエラー', Object.assign(new Error('chunk load failed'), { code: 'CHUNK_LOAD_FAILED' }),
    'chunk load failed'],
  ['非 Error の reject', 'mermaid version mismatch', 'mermaid version mismatch'],
  ['非 Error のモジュール不足文字列', "Cannot find module 'katex'", "Cannot find module 'katex'"],
  ['非 Error の code 付きオブジェクト', { code: 'MODULE_NOT_FOUND' }, '[object Object]'],
  ['null の reject', null, 'null'],
])('%s は検査・描画で同じ理由を返す', async (_label, rejection, error) => {
  const wrapper = await loadWrapper();
  mockParse.mockRejectedValue(rejection);
  mockRender.mockRejectedValue(rejection);
  const source = 'flowchart TD\n  A --> B';
  await expect(wrapper.parseMermaid(source)).resolves.toEqual({ valid: false, error });
  await expect(wrapper.renderMermaid(source, document.createElement('div'))).resolves.toEqual({
    ok: false,
    error,
  });
});

test('先頭に空行のある frontmatter 付きソースをそのまま検査・描画へ渡す', async () => {
  const wrapper = await loadWrapper();
  const source = '\n---\ntitle: Test\n---\nflowchart TD\n  A --> B';
  mockParse.mockResolvedValue({ diagramType: 'flowchart-v2' });
  mockRender.mockResolvedValue({ svg: '<svg></svg>' });
  await expect(wrapper.parseMermaid(source)).resolves.toEqual({ valid: true });
  await expect(wrapper.renderMermaid(source, document.createElement('div'))).resolves.toEqual({
    ok: true,
  });
  expect(mockParse).toHaveBeenCalledWith(source);
  expect(mockRender).toHaveBeenCalledWith('sr-mermaid-preview-1', source);
});
