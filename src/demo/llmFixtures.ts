// デモモード用 Gemini 応答モック（#/extract の一括抽出を実際に実行したときの応答）。
//
// extract-data skill（features/extraction/skills/extractData.ts）が組み立てるプロンプトから
// 2 つの手がかりを読み取る:
// - `=== Document i/N [role] filename ===` の filename → どのデモ論文（DEMO_PAPERS のどの要素）
//   を読んでいるか。デモは 3 論文あるため、要求された field_id が一致しても「どの論文の
//   FIELD_INSTANCES を返すべきか」を文書名で絞り込まないと、他の論文の値が混ざってしまう
// - `- field_id: xxx` 行の集合 → 当該バッチで要求されている項目
// 該当する論文の FIELD_INSTANCES から、要求された field_id に一致する行だけを
// EXTRACT_DATA_RESPONSE_SCHEMA と同じ形の JSON 配列で返す。
// 本ファイルはスキーマドラフト（draft-schema skill）には対応しない — デモのスキーマは
// あらかじめ確定済み（seed.ts）で #/schema 画面は「AI がドラフト」を再実行せずに閲覧するだけの
// シナリオのため。
import { DEMO_PAPERS } from './paperContent';

/** extract-data のユーザープロンプトから `- field_id: xxx` 行を全件拾う */
function extractRequestedFieldIds(promptText: string): Set<string> {
  const ids = new Set<string>();
  const re = /-\s*field_id:\s*(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(promptText)) !== null) {
    ids.add(match[1] as string);
  }
  return ids;
}

/** プロンプトの `=== Document i/N [role] filename ===` 見出しから文書ファイル名を全件拾う */
function extractReferencedFilenames(promptText: string): Set<string> {
  const names = new Set<string>();
  const re = /^=== Document \d+\/\d+ \[[^\]]+\] (.+?) ===$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(promptText)) !== null) {
    names.add((match[1] as string).trim());
  }
  return names;
}

/** Gemini generateContent リクエストボディから全パートのテキストを連結する（contents[].parts[].text） */
function extractPromptText(body: unknown): string {
  const contents = (body as { contents?: unknown })?.contents;
  if (!Array.isArray(contents)) return '';
  const chunks: string[] = [];
  for (const content of contents) {
    const parts = (content as { parts?: unknown })?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const text = (part as { text?: unknown })?.text;
      if (typeof text === 'string') chunks.push(text);
    }
  }
  return chunks.join('\n');
}

interface ExtractDataResponseItem {
  field_id: string;
  entity_key: string;
  value: string | null;
  not_reported: boolean;
  quote: string | null;
  page: number | null;
  document_index: number | null;
  confidence: 'high' | 'medium' | 'low' | null;
}

/**
 * 参照された文書ファイル名（通常 1 件。プロンプトに一致する DEMO_PAPERS の要素が
 * 見つからない場合は全論文を対象にする防御的フォールバック）に対応する FIELD_INSTANCES を集め、
 * 要求された field_id に一致する行だけを応答項目一覧として組み立てる。
 * 本デモは 1 study = 1 document のため document_index は quote ありなら常に 1
 */
function buildExtractDataItems(
  requestedFieldIds: Set<string>,
  referencedFilenames: Set<string>,
): ExtractDataResponseItem[] {
  const targetPapers =
    referencedFilenames.size === 0
      ? DEMO_PAPERS
      : DEMO_PAPERS.filter((paper) => referencedFilenames.has(paper.meta.filename));
  const papers = targetPapers.length > 0 ? targetPapers : DEMO_PAPERS;

  return papers.flatMap((paper) =>
    paper.fieldInstances
      .filter((item) => requestedFieldIds.has(item.fieldId))
      .map((item) => ({
        field_id: item.fieldId,
        entity_key: item.entityKey,
        value: item.value,
        not_reported: item.notReported,
        quote: item.quote,
        page: item.page,
        document_index: item.quote === null ? null : 1,
        confidence: item.confidence,
      })),
  );
}

/**
 * Gemini generateContent の応答テキスト（candidates[0].content.parts[0].text 相当）を組み立てる。
 * extract-data 以外（例: 将来 draft-schema をデモで動かす場合）のプロンプトが来た場合は、
 * 要求された field_id が 1 件も見つからず空配列を返す（呼び出し側の validateAiOutput は
 * 空配列を「該当項目なし」として扱い、例外にはしない設計のため安全側に倒れる）。
 */
export function buildGenerateContentResponseText(body: unknown): string {
  const promptText = extractPromptText(body);
  const requestedFieldIds = extractRequestedFieldIds(promptText);
  const referencedFilenames = extractReferencedFilenames(promptText);
  const items = buildExtractDataItems(requestedFieldIds, referencedFilenames);
  return JSON.stringify(items);
}
