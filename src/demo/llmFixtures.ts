// デモモード用 Gemini 応答モック（#/extract の一括抽出・#/verify の「AI で再特定」を
// 実際に実行したときの応答）。
//
// extract-data skill（features/extraction/skills/extractData.ts）が組み立てるプロンプトから
// 2 つの手がかりを読み取る:
// - `=== Document i/N [role] filename ===` の filename → どのデモ論文（DEMO_PAPERS のどの要素）
//   を読んでいるか。デモは 3 論文あるため、要求された field_id が一致しても「どの論文の
//   FIELD_INSTANCES を返すべきか」を文書名で絞り込まないと、他の論文の値が混ざってしまう
// - `- field_id: xxx` 行の集合 → 当該バッチで要求されている項目
// 該当する論文の FIELD_INSTANCES から、要求された field_id に一致する行だけを
// EXTRACT_DATA_RESPONSE_SCHEMA と同じ形の JSON 配列で返す。
//
// relocate-quote skill（features/extraction/skills/relocateQuote.ts）のプロンプトは
// `## Reported value` / `## Document text` の見出しで extract-data と判別する（下記
// isRelocateQuotePrompt）。プロンプト中の「previously attempted quote」（アンカリングに
// 失敗した元の quote）を手がかりに DEMO_PAPERS から対象の論文・項目を特定し、
// DEMO_FAILED_QUOTE_CORRECTIONS（paperContent.ts）から本文に実在する正しい quote を引いて
// 返す。呼び出し側（app/services/relocateQuoteService.ts）は返ってきた quote を実際に
// 本文へ再アンカリングして検証するため、ここで嘘の quote を返すと相変わらず失敗する —
// 必ず本文と完全一致する文字列を返すこと。
//
// 本ファイルはスキーマドラフト（draft-schema skill）には対応しない — デモのスキーマは
// あらかじめ確定済み（seed.ts）で #/schema 画面は「AI がドラフト」を再実行せずに閲覧するだけの
// シナリオのため。
import { DEMO_FAILED_QUOTE_CORRECTIONS, DEMO_PAPERS } from './paperContent';

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
 * relocate-quote のユーザープロンプト（features/extraction/skills/relocateQuote.ts の
 * buildRelocateQuoteUserPrompt）だけが持つ見出しの組み合わせで判別する。
 * extract-data のプロンプト（`- field_id:` / `=== Document i/N ... ===`）には出現しない
 */
function isRelocateQuotePrompt(promptText: string): boolean {
  return promptText.includes('## Reported value') && promptText.includes('## Document text');
}

/**
 * 「previously attempted quote (could not be located verbatim in the document): "..."」から
 * アンカリングに失敗した元の quote 文字列を取り出す（buildRelocateQuoteUserPrompt が
 * originalQuote 有りのときだけ出力する行。無ければ null）
 */
function extractOriginalQuote(promptText: string): string | null {
  const match =
    /previously attempted quote \(could not be located verbatim in the document\): "([\s\S]*?)"/.exec(promptText);
  return match?.[1] ?? null;
}

/**
 * 元の（アンカリングに失敗した）quote 文字列から、対応する論文・項目を特定する。
 * FIELD_INSTANCES 上は anchor_status = 'failed' の行がその失敗した quote をそのまま
 * 保持しているため、文字列一致で照合できる
 */
function findFailedFieldInstance(
  originalQuote: string,
): { paperId: string; fieldId: string; entityKey: string } | null {
  for (const paper of DEMO_PAPERS) {
    const item = paper.fieldInstances.find(
      (candidate) => candidate.anchorStatus === 'failed' && candidate.quote === originalQuote,
    );
    if (item !== undefined) {
      return { paperId: paper.paperId, fieldId: item.fieldId, entityKey: item.entityKey };
    }
  }
  return null;
}

/**
 * relocate-quote の応答（RelocateQuoteResponse と同形の JSON オブジェクト）を組み立てる。
 * 元の quote から対象論文・項目を特定できた場合は DEMO_FAILED_QUOTE_CORRECTIONS から
 * 本文に実在する正しい quote を引いて found: true を返す。特定できない場合（デモに無い項目で
 * 再特定を試みた等）は found: false を返し、呼び出し側は通常の「見つかりませんでした」
 * 案内に倒れる（例外にはしない）
 */
function buildRelocateQuoteResponseText(promptText: string): string {
  const originalQuote = extractOriginalQuote(promptText);
  const target = originalQuote !== null ? findFailedFieldInstance(originalQuote) : null;
  const correction =
    target !== null
      ? DEMO_FAILED_QUOTE_CORRECTIONS.find(
          (c) =>
            c.paperId === target.paperId && c.fieldId === target.fieldId && c.entityKey === target.entityKey,
        )
      : undefined;
  if (correction === undefined) {
    return JSON.stringify({ found: false, quote: null, page: null });
  }
  return JSON.stringify({ found: true, quote: correction.correctQuote, page: correction.page });
}

/**
 * Gemini generateContent の応答テキスト（candidates[0].content.parts[0].text 相当）を組み立てる。
 * relocate-quote のプロンプトは buildRelocateQuoteResponseText へ分岐する。
 * それ以外（例: 将来 draft-schema をデモで動かす場合）のプロンプトが来た場合は、
 * 要求された field_id が 1 件も見つからず空配列を返す（呼び出し側の validateAiOutput は
 * 空配列を「該当項目なし」として扱い、例外にはしない設計のため安全側に倒れる）。
 */
export function buildGenerateContentResponseText(body: unknown): string {
  const promptText = extractPromptText(body);
  if (isRelocateQuotePrompt(promptText)) {
    return buildRelocateQuoteResponseText(promptText);
  }
  const requestedFieldIds = extractRequestedFieldIds(promptText);
  const referencedFilenames = extractReferencedFilenames(promptText);
  const items = buildExtractDataItems(requestedFieldIds, referencedFilenames);
  return JSON.stringify(items);
}
