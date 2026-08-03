// デモモード用 Gemini 応答モック（#/extract の一括抽出を実際に実行したときの応答）。
//
// extract-data skill（features/extraction/skills/extractData.ts）が組み立てるプロンプトの
// 「## Fields to extract」セクションから要求された field_id を読み取り、paperContent.ts の
// FIELD_INSTANCES から該当する項目だけを EXTRACT_DATA_RESPONSE_SCHEMA と同じ形の JSON 配列で返す。
// 本ファイルはスキーマドラフト（draft-schema skill）には対応しない — デモのスキーマは
// あらかじめ確定済み（seed.ts）で #/schema 画面は「AI がドラフト」を再実行せずに閲覧するだけの
// シナリオのため。
import { FIELD_INSTANCES } from './paperContent';

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
 * extract-data skill が要求した field_id 集合に対する応答項目一覧を組み立てる。
 * FIELD_INSTANCES は study / arm / outcome_result の全エンティティインスタンスを
 * あらかじめ列挙済みなので、要求された field_id に一致する行をそのまま返せばよい
 * （本デモは文書 1 件のみのため document_index は quote ありなら常に 1）。
 */
function buildExtractDataItems(requestedFieldIds: Set<string>): ExtractDataResponseItem[] {
  return FIELD_INSTANCES.filter((item) => requestedFieldIds.has(item.fieldId)).map((item) => ({
    field_id: item.fieldId,
    entity_key: item.entityKey,
    value: item.value,
    not_reported: item.notReported,
    quote: item.quote,
    page: item.page,
    document_index: item.quote === null ? null : 1,
    confidence: item.confidence,
  }));
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
  const items = buildExtractDataItems(requestedFieldIds);
  return JSON.stringify(items);
}
