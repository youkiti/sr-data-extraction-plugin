// flow 図（mermaid）の描画プレビュー（issue #109 PR5。ui-states.md §3 `#/verify`
// 「flow 図（mermaid）プレビュー」/ requirements.md §4.2）。
// mermaid は MV3 の CSP 上 CDN から読めないため拡張に同梱するが、app 本体バンドルの肥大を
// 避けるため dynamic import の遅延チャンク（webpack が dist/chunks/ へ分割出力）として
// 初回プレビュー時にロードする。quote 由来の任意ソースを描画するため securityLevel は
// 'strict'、描画は本モジュールの明示 API 経由のみ（startOnLoad: false）。
// jest では 'mermaid' パッケージを jest.mock し、本モジュール経由の分岐だけを検証する

/**
 * 描画プレビュー対象の予約 field_name（robFields.ts と同じ「予約名規約」方式）。
 * 現状は QUADAS-3 テンプレートの flow 図のみ（robTemplates.ts の QUADAS3_FLOW_DIAGRAM_ROW）
 */
export const MERMAID_PREVIEW_FIELD_NAMES: readonly string[] = ['quadas3_flow_diagram'];

/** 値を mermaid ソースとして扱う（= セルカードに描画プレビューを出す）項目か */
export function isMermaidPreviewField(fieldName: string): boolean {
  return MERMAID_PREVIEW_FIELD_NAMES.includes(fieldName);
}

type MermaidApi = (typeof import('mermaid'))['default'];

let mermaidLoad: Promise<MermaidApi> | null = null;

/**
 * mermaid チャンクの遅延ロード + 1 回だけの初期化。ロード失敗（チャンク取得不能等）は
 * キャッシュしない（次回のプレビュー開閉・保存チェックで再試行できるようにする）
 */
function loadMermaid(): Promise<MermaidApi> {
  if (mermaidLoad === null) {
    mermaidLoad = import(/* webpackChunkName: "mermaid" */ 'mermaid').then((module) => {
      module.default.initialize({ startOnLoad: false, securityLevel: 'strict' });
      return module.default;
    });
    mermaidLoad.catch(() => {
      mermaidLoad = null;
    });
  }
  return mermaidLoad;
}

/** 構文チェックの結果（valid でないときだけ理由を持つ） */
export type MermaidParseResult = { valid: true } | { valid: false; error: string };

/** 描画の結果（ok でないときだけ理由を持つ） */
export type MermaidRenderResult = { ok: true } | { ok: false; error: string };

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 構文チェック（`mermaid.parse`）。編集保存前チェック（警告表示のみ・保存はブロックしない。
 * ui-states.md §3）に使うため、構文エラー・ロード失敗のいずれでも throw せず結果で返す
 */
export async function parseMermaid(source: string): Promise<MermaidParseResult> {
  try {
    const mermaid = await loadMermaid();
    await mermaid.parse(source);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: reasonOf(error) };
  }
}

// mermaid.render に渡す一意 id の連番（同一画面で複数回プレビューしても衝突させない）
let renderSeq = 0;

/**
 * mermaid ソースを SVG として container へ描画する。構文エラー・ロード失敗は throw せず
 * ok: false + 理由で返す（呼び出し側がエラーメッセージ表示へフォールバックする）
 */
export async function renderMermaid(
  source: string,
  container: HTMLElement,
): Promise<MermaidRenderResult> {
  try {
    const mermaid = await loadMermaid();
    renderSeq += 1;
    const { svg } = await mermaid.render(`sr-mermaid-preview-${renderSeq}`, source);
    container.innerHTML = svg;
    return { ok: true };
  } catch (error) {
    return { ok: false, error: reasonOf(error) };
  }
}
