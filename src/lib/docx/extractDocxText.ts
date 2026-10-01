// mammoth.js による .docx → プレーンテキスト変換（requirements.md §2.2）。
// webpack は package.json の browser フィールドを解決するためブラウザでもこの import で動く。
// features/protocol/parseDocx.ts へ DocxExtractor として注入する（テストは fake で完結）
type MammothApi = typeof import('mammoth');

let mammothLoad: Promise<MammothApi> | null = null;

/** 初回利用時だけロードし、取得失敗時は次の呼び出しで再試行する */
function loadMammoth(): Promise<MammothApi> {
  if (mammothLoad === null) {
    mammothLoad = import(/* webpackChunkName: "mammoth" */ 'mammoth').then(
      (module) => module.default,
    );
    mammothLoad.catch(() => {
      mammothLoad = null;
    });
  }
  return mammothLoad;
}

export async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const mammoth = await loadMammoth();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}
