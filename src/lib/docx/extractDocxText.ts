// mammoth.js による .docx → プレーンテキスト変換（requirements.md §2.2）。
// webpack は package.json の browser フィールドを解決するためブラウザでもこの import で動く。
// features/protocol/parseDocx.ts へ DocxExtractor として注入する（テストは fake で完結）
import mammoth from 'mammoth';

export async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}
