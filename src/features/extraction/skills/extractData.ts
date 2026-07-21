// extract-data skill のプロンプト管理（requirements.md §4.3）
// - プロンプトは sr-query-builder の skills 管理方式（TS 定数）で持ち、
//   明示版数 EXTRACT_DATA_PROMPT_VERSION を LLMApiLog に記録する（architecture.md §2.1）
// - 抽出対象論文は英語を主想定のため、プロンプト本文は英語（requirements.md §6）
// - LLM 呼び出し自体は executeRun 側の責務（lib/llm 移植後に配線）。ここは
//   「プロンプト構築 → 構造化出力スキーマ → 応答パース（validateAiOutput へ委譲）」の純粋関数のみ
import type { DocumentRole } from '../../../domain/document';
import type { EntityLevel, SchemaField } from '../../../domain/schemaField';
import type { ChatContentPart } from '../../../lib/llm/LLMProvider';
import {
  AiOutputFormatError,
  validateAiOutput,
  type ValidateAiOutputResult,
} from '../validateAiOutput';

/** LLMApiLog.purpose と対応づける skill 識別子 */
export const EXTRACT_DATA_SKILL_NAME = 'extract-data';

/**
 * プロンプト版数。プロンプト文言・スキーマを変えたら必ずインクリメントする。
 * v2（2026-07）: 複数文書の連結入力 + document_index を導入（v0.10 study / document モデル）
 * v3（2026-07-11）: pdf_native 入力（no_text_layer 文書のページ画像添付）に対応。
 *   システムプロンプトへスキャン文書向けの quote/page 規約を追記
 *   （handoff-scanned-pdf-native-highlight.md §7.4 PR2）
 * v4（2026-07-11）: box_2d（quote の bounding box）の取得に対応。requestBox=true 時のみ
 *   システムプロンプト / ユーザープロンプト / 応答スキーマへ box ルールを追加する
 *   （requestBox=false の経路は 1 文字も変わらない。handoff-scanned-pdf-native-highlight.md §7.4 PR3）
 * v5（2026-07-12）: プロバイダの暗黙 prefix キャッシュ（Gemini implicit caching 等）のため
 *   セクションを protocol → documents → fields → 規約 → 出力形式 へ並び替え、
 *   画像パートを Documents セクション直後（fields より前）へ移動（issue #89）。
 *   同一 study の全バッチで system + protocol + documents（+ 画像）が共有 prefix になる
 * v6（2026-07-13）: 小型モデル（flash-lite）の arm 単位 omission 対策として、arm レベル項目を
 *   含むバッチの suffix 末尾（Output format の後）へ completeness 強調を追記（issue #97）。
 *   prefix（protocol / documents / 画像）は不変更のためキャッシュヒットに影響しない
 * v7（2026-07-20）: 多言語文書対応の明示（issue #95 層 2）。quote / value の規約へ
 *   「原文の言語・文字体系のまま（翻訳・音写の禁止）」を明記（和文論文で quote が
 *   英訳・音写されるとアンカリング不能になるため）。システムプロンプトのみの変更で、
 *   同一 study 内の全バッチが共有する prefix 構造は不変のためキャッシュヒット率に影響しない
 * v8（2026-07-21）: 高精度読み取りモード（issue #176・input_mode = text_with_page_images）に
 *   対応。テキスト層のある文書にページ画像を併用添付できる mode: 'text_with_images' を
 *   ExtractDataDocument へ追加し、システムプロンプトへ「画像は表・図を正しく読むための補助であり、
 *   quote は必ず添付テキストから逐語で取ること（画像から見えた内容を要約・書き起こしただけの
 *   文言にしない）」の規約を追記した。requestBox は従来どおり mode: 'image'（no_text_layer の
 *   pdf_native）のときだけ true にでき、text_with_images では常に false のまま
 *   （quote の出所がテキストのため bbox 対応は対象外。executeRun 側の判定は不変更）。
 *   prefix（Protocol context + Documents + 画像）の構造は変わらないため既存バッチの
 *   キャッシュヒットには影響しない
 */
export const EXTRACT_DATA_PROMPT_VERSION = 8;

/** text_only モードで LLM へ渡すページ別本文（extracted_texts/{id}.txt 由来） */
export interface ExtractDataPage {
  /** 1-indexed ページ番号。プロンプト内の [PAGE n] マーカーになる */
  page: number;
  text: string;
}

/**
 * pdf_native モードで LLM へ添付するページ画像。
 * 型は features/documents/loadDocumentPageImages.ts の DocumentPageImage と同一形
 * （こちらは skill 側の呼称。定義の正典はローダ側で、ここは import して使う）
 */
export interface ExtractDataImagePage {
  /** 1-indexed ページ番号。画像ラベル `[Document i/N page p]` の p になる */
  page: number;
  mimeType: string;
  dataBase64: string;
}

/**
 * プロンプトへ連結する 1 文書（v0.10）。並び順（配列の添字 + 1）が document_index になる。
 * 同一 study の全文書をロール付き区切りで連結して 1 回で抽出する（§4.3）。
 * text_status = no_text_layer の文書は mode: 'image'（本文の代わりにページ画像を添付する
 * pdf_native 入力。handoff-scanned-pdf-native-highlight.md §7.4 PR2）。
 * mode: 'text_with_images' は高精度読み取りモード（issue #176）: テキスト層がある文書に
 * ページ画像を「併用」添付する（本文はそのまま残し、画像は表・図の読み取り補助として追加する）
 */
export type ExtractDataDocument =
  | {
      /** 見出しに出すロール（DOCUMENT_ROLE_ORDER 順に並べるのは planRun / executeRun の責務） */
      role: DocumentRole;
      /** 見出しに出すファイル名（可読性のみ。突合には使わない） */
      filename: string;
      mode: 'text';
      /** 当該文書の本文（ページ順） */
      pages: readonly ExtractDataPage[];
    }
  | {
      role: DocumentRole;
      filename: string;
      mode: 'image';
      /** 当該文書のページ画像（ページ順） */
      imagePages: readonly ExtractDataImagePage[];
    }
  | {
      role: DocumentRole;
      filename: string;
      mode: 'text_with_images';
      /** 当該文書の本文（ページ順）。quote のアンカリングはこちらを基準にする */
      pages: readonly ExtractDataPage[];
      /** 本文に加えて添付するページ画像（表・図の読み取り補助。ページ順） */
      imagePages: readonly ExtractDataImagePage[];
    };

export interface ExtractDataPromptInput {
  /** 当該バッチで抽出する項目（同一 schema_version。分割は planRun の責務） */
  fields: readonly SchemaField[];
  /**
   * 同一 study の文書（document_index 順）。1 件でも複数でも可。
   * mode: 'image' の文書はプロンプト本文には注記だけを出し、実ページ画像は
   * buildExtractDataUserContent が ChatContentPart[] の画像パートとして別途添付する
   */
  documents: readonly ExtractDataDocument[];
  /** RQ・PICO 等の要約。項目の解釈を安定させる補助コンテキスト（省略可） */
  protocolContext?: string | null;
  /**
   * box_2d（quote の bounding box）の取得を要求するか。省略時 false。
   * true にできるのは「Gemini 系 provider」かつ「バッチに画像文書を含む」ときだけ
   * （判定は executeRun 側の責務。handoff-scanned-pdf-native-highlight.md §7.4 PR3）
   */
  requestBox?: boolean;
}

/**
 * システムプロンプト。quote の verbatim 必須化（言い換え禁止・最大 300 文字）と
 * not_reported / confidence の規約はアンカリング成功率・監査性に直結するため、
 * 文言を変える場合は EXTRACT_DATA_PROMPT_VERSION を上げる
 */
export const EXTRACT_DATA_SYSTEM_PROMPT = `
You are a meticulous data extraction assistant for a systematic review.
Extract the requested fields from the provided documents and return ONLY a JSON array — no markdown fences, no commentary.

The documents (see "## Documents") all report the SAME trial (e.g. the main article, its trial registration, a protocol paper, a conference abstract). Read them together as one study.

Rules:
- "quote": copy the supporting passage VERBATIM from the document text — character for character, exactly as it appears (including line-break artifacts), no paraphrasing, no ellipsis. Keep it in the document's original language and script — NEVER translate or transliterate (e.g. quote Japanese text in Japanese). At most 300 characters; choose the shortest passage that contains the reported value. Highlighting in the PDF viewer depends on an exact match.
- Never infer, compute, or guess values that are not explicitly stated. If NO document reports a field, return the item with "not_reported": true, "value": null, "quote": null and "document_index": null.
- "value": report exactly as written in the document, in its original language and script. Do not convert units, do not round, do not translate or transliterate.
- "document_index": the 1-based number of the document (from the "=== Document i/N ... ===" headers) that your quote and page refer to. REQUIRED whenever "quote" is provided; set it to null only when "not_reported" is true.
- "page": the 1-indexed page number within THAT document where the quote appears. Page boundaries are marked as [PAGE n] within each document.
- For a scanned document with no text layer (its "=== Document i/N ..." note says so): its pages are attached as images right after the Documents section, each labeled "Document i/N page p". "quote" must be a verbatim transcription of the text actually visible in that page image (character for character, no paraphrasing), and "page" must be the p shown in that image's label.
- Some documents that DO have a text layer are ALSO attached as page images right after their text (its "=== Document i/N ..." note says so), each labeled "Document i/N page p", to help you read tables and figures more accurately. When you use such an image to determine a value, still copy "quote" VERBATIM from that document's extracted TEXT below (not from the image) — locate the matching passage in the text even if its line breaks or spacing differ slightly from the image. This keeps quote-based highlighting reliable.
- When documents disagree on a value, prefer the main article, lower your "confidence", and take the quote from the document you actually read the value from.
- "confidence": self-assess each item as "high", "medium" or "low".
- "field_id" is the matching key: echo it exactly as listed. Never invent field_ids.
- Return one item for EVERY listed field and EVERY entity instance it applies to (see the entity_key rules).
`.trim();

/**
 * box_2d（quote の bounding box）の追加ルール。requestBox=true のときだけ
 * システムプロンプトの末尾に足す（handoff-scanned-pdf-native-highlight.md §7.2）。
 * 幻覚 box 防止のため「位置特定できたときだけ返す・最も近い box を推測するのは禁止」を明記する
 */
const EXTRACT_DATA_BOX_RULES = `
Additional rule about "box_2d" (bounding box), for scanned documents only (those attached as page images):
- For an item whose quote comes from a scanned document, try to visually locate that exact quote in its page image. If — and only if — you can actually see and pinpoint it, return "box_2d": [ymin, xmin, ymax, xmax], 4 integers normalized to 0-1000 against that page image's height/width, with the origin at the image's top-left corner.
- If you cannot pinpoint the quote's location in the image, or the quote comes from a text (non-image) document, return "box_2d": null.
- NEVER guess or return the "closest" or "most likely" box when you are not sure of the exact location. A missing box (null) is always preferable to a wrong one — downstream highlighting trusts this box completely and cannot verify it.
`.trim();

/**
 * システムプロンプトを組み立てる。requestBox=false は EXTRACT_DATA_SYSTEM_PROMPT と
 * 完全一致（text_only 経路は 1 文字も変えない）。true のときだけ box ルールを末尾に追記する
 */
export function buildExtractDataSystemPrompt(requestBox: boolean): string {
  return requestBox
    ? `${EXTRACT_DATA_SYSTEM_PROMPT}\n\n${EXTRACT_DATA_BOX_RULES}`
    : EXTRACT_DATA_SYSTEM_PROMPT;
}

/** entity_key の構成規約（requirements.md §3.3 / utils/entityKey.ts と同一規則） */
const ENTITY_KEY_RULES: Record<EntityLevel, string> = {
  study: '- study level: "entity_key" is always "-" (one instance per article).',
  arm: '- arm level: identify every study arm (group), number them in order of first appearance, and use "arm:1", "arm:2", ... Keep the same numbering consistent across all arm-level and outcome-level items.',
  outcome_result:
    '- outcome_result level: use "outcome:<slug>", appending "|arm:<n>" when the value is arm-specific and "|time:<token>" when a timepoint applies (e.g. "outcome:mortality|arm:1|time:30d"). <slug> is a short lowercase snake_case name; never use "|" or ":" inside segment values; reuse the identical slug for the same outcome across fields.',
  rob_domain: '- rob_domain level: use "rob:<domain_id>" (e.g. "rob:domain_1").',
};

/** ENTITY_KEY_RULES の出力順（study → arm → outcome_result → rob_domain） */
const ENTITY_LEVEL_ORDER: readonly EntityLevel[] = ['study', 'arm', 'outcome_result', 'rob_domain'];

/**
 * arm レベル項目の omission 対策（issue #97）。プロンプト v5（PR #91）でセクション順を
 * protocol → documents → fields → 規約 → 出力形式 へ並び替えた結果、小型モデル
 * （gemini-3.1-flash-lite）で 2 つ目以降の arm の項目を書き落とす確率的な欠落が観測された
 * （項目正確度 62.1% → ≈54.2%）。
 * - なぜ suffix 末尾か: suffix（Fields to extract 以降）はバッチごとに変わる部分で、
 *   プロバイダの暗黙 prefix キャッシュ対象には元々含まれない。ここに追記しても
 *   prefix（Protocol context + Documents + 画像）のキャッシュヒットには影響しない
 * - なぜ条件付きか: arm レベル項目が無いバッチ（study / outcome_result / rob_domain のみ）には
 *   無関係な強調文がノイズになるため、ENTITY_KEY_RULES の presentLevels 出し分けと同じ方針で
 *   「バッチに arm レベル項目が含まれるときだけ」追加する
 *
 * export しているのは planRun のトークン概算（estimateBatch）が同じ条件で .length を
 * 加算し、見積りとプロンプト実体の同期を保つため
 */
export const EXTRACT_DATA_ARM_COMPLETENESS_RULE = `
## Completeness check (arm-level fields)

Before returning, verify your JSON array is COMPLETE for arm-level fields: for EVERY arm-level field listed under "## Fields to extract", return one item for EVERY arm that appears in the documents ("arm:1", "arm:2", ...). If the study has A arms and this batch lists F arm-level fields, your array must contain exactly A x F arm-level items (plus the items for other levels). Do NOT stop after the first arm; arms 2, 3, ... require the same complete set of items as arm 1.
`.trim();

/** 1 項目ぶんの定義ブロック。null / 空の補助情報は行ごと省略する */
function renderField(field: SchemaField): string {
  const lines = [
    `- field_id: ${field.fieldId}`,
    `  field_name: ${field.fieldName}`,
    `  entity_level: ${field.entityLevel}`,
    `  data_type: ${field.dataType}`,
  ];
  if (field.unit !== null) {
    lines.push(`  unit: ${field.unit} (report the value as written even if the article uses a different unit)`);
  }
  if (field.allowedValues !== null) {
    lines.push(`  allowed_values: ${field.allowedValues} ("value" must be one of these)`);
  }
  if (field.extractionInstruction !== '') {
    lines.push(`  instruction: ${field.extractionInstruction}`);
  }
  if (field.example !== null) {
    lines.push(`  example: ${field.example}`);
  }
  return lines.join('\n');
}

/**
 * 1 文書ぶんの連結ブロック（`=== Document i/N [role] filename ===` + ページ本文）。
 * mode: 'image' の文書は本文の代わりに画像添付の注記だけを出す。mode: 'text_with_images'
 * （issue #176・高精度読み取りモード）は本文をそのまま出したうえで画像併用の注記を足す。
 * 実ページ画像は buildExtractDataUserContent がこのプロンプトの後ろへ ChatContentPart[] として添付する
 */
function renderDocument(doc: ExtractDataDocument, index: number, total: number): string {
  const header = `=== Document ${index}/${total} [${doc.role}] ${doc.filename} ===`;
  if (doc.mode === 'image') {
    return (
      `${header}\n\n` +
      'This document is a scanned PDF with no text layer. Its pages are attached as images ' +
      `right after this Documents section, labeled "Document ${index}/${total} page p".`
    );
  }
  const body = doc.pages.map((page) => `[PAGE ${page.page}]\n${page.text}`).join('\n\n');
  if (doc.mode === 'text_with_images') {
    return (
      `${header}\n\n${body}\n\n` +
      'This document\'s pages are ALSO attached as images right after this Documents section, ' +
      `labeled "Document ${index}/${total} page p" (to help you read tables and figures more accurately).`
    );
  }
  return `${header}\n\n${body}`;
}

/** buildExtractDataUserPrompt / buildExtractDataUserContent 共通の入力検証 */
function assertValidPromptInput(input: ExtractDataPromptInput): void {
  if (input.fields.length === 0) {
    throw new Error('extract-data skill に抽出項目が 1 件も渡されていません');
  }
  if (input.documents.length === 0) {
    throw new Error('extract-data skill に文書が 1 件も渡されていません');
  }
  if (
    input.documents.some(
      (doc) => (doc.mode === 'text' || doc.mode === 'text_with_images') && doc.pages.length === 0,
    )
  ) {
    throw new Error('extract-data skill に本文ページが 1 件も無い文書が含まれています');
  }
  if (
    input.documents.some(
      (doc) =>
        (doc.mode === 'image' || doc.mode === 'text_with_images') && doc.imagePages.length === 0,
    )
  ) {
    throw new Error('extract-data skill にページ画像が 1 件も無い文書が含まれています');
  }
}

/**
 * プロンプト前半（バッチ間で変わらない部分）のセクション群: Protocol context（省略可）→ Documents。
 * 同一 study の全バッチ（fields だけが異なる）でここが一致するため、プロバイダの暗黙 prefix
 * キャッシュ（Gemini implicit caching / OpenAI 系 automatic prompt caching）の対象になる（issue #89）。
 * 文書は入力順（= document_index 順）にロール付き区切りで連結する（§4.3 v0.10）
 */
function buildPrefixSections(input: ExtractDataPromptInput): string[] {
  const sections: string[] = [];

  const protocol = input.protocolContext?.trim() ?? '';
  if (protocol !== '') {
    sections.push(`## Protocol context\n\n${protocol}`);
  }

  const total = input.documents.length;
  const intro =
    total === 1
      ? 'One document is provided.'
      : `${total} documents from the same trial are provided, in this order. Use "document_index" to say which one each quote comes from.`;
  const body = input.documents
    .map((doc, i) => renderDocument(doc, i + 1, total))
    .join('\n\n');
  sections.push(`## Documents\n\n${intro}\n\n${body}`);

  return sections;
}

/**
 * プロンプト後半（バッチごとに変わる部分）のセクション群: Fields to extract → entity_key rules →
 * Output format（→ arm レベル項目を含むバッチのみ Completeness check）。
 * fields は fieldIndex 順に並べ、entity_key 規約は当該バッチに現れる entity_level のぶんだけ提示する
 */
function buildSuffixSections(input: ExtractDataPromptInput): string[] {
  const sections: string[] = [];

  const fields = [...input.fields].sort((a, b) => a.fieldIndex - b.fieldIndex);
  sections.push(`## Fields to extract\n\n${fields.map(renderField).join('\n')}`);

  const presentLevels = new Set(fields.map((field) => field.entityLevel));
  const rules = ENTITY_LEVEL_ORDER.filter((level) => presentLevels.has(level)).map(
    (level) => ENTITY_KEY_RULES[level],
  );
  sections.push(`## entity_key rules\n\n${rules.join('\n')}`);

  const total = input.documents.length;
  const outputFormatFields =
    `{ "field_id": "<as listed>", "entity_key": "<per the rules>", "value": "<as reported>" | null, ` +
    `"not_reported": true | false, "quote": "<verbatim, <=300 chars>" | null, "page": <1-indexed> | null, ` +
    `"document_index": <1..${total}> | null, "confidence": "high" | "medium" | "low"` +
    (input.requestBox === true ? `, "box_2d": [ymin, xmin, ymax, xmax] | null` : '') +
    ' }';
  sections.push(`## Output format\n\nReturn a JSON array. Each element must be:\n${outputFormatFields}`);

  // arm レベル項目を含むバッチだけ、suffix 末尾へ completeness 強調を追記する（issue #97）
  if (presentLevels.has('arm')) {
    sections.push(EXTRACT_DATA_ARM_COMPLETENESS_RULE);
  }

  return sections;
}

/**
 * ユーザープロンプトを組み立てる。セクション順は Protocol context（省略可）→ Documents →
 * Fields to extract → entity_key rules → Output format（issue #89: buildPrefixSections /
 * buildSuffixSections への分割は「documents（バッチ間不変）」と「fields ほか（バッチ間で変わる）」を
 * 分け、プロバイダの暗黙 prefix キャッシュを効かせるため）。
 * 常に `[...buildPrefixSections(input), ...buildSuffixSections(input)].join('\n\n')` と等価
 */
export function buildExtractDataUserPrompt(input: ExtractDataPromptInput): string {
  assertValidPromptInput(input);
  return [...buildPrefixSections(input), ...buildSuffixSections(input)].join('\n\n');
}

/**
 * ユーザープロンプトを LLMProvider へそのまま渡せる形（string | ChatContentPart[]）に組み立てる。
 * - 画像を伴う文書（mode: 'image' / 'text_with_images'）が 1 件も無ければ
 *   buildExtractDataUserPrompt の文字列をそのまま返す（text_only の既存経路と完全一致。
 *   呼び出し側はどちらの戻り値も ChatMessage.content にそのまま渡せる）
 * - 画像を伴う文書があれば、prefix（Protocol context + Documents）の text パートに続けて
 *   「文書順 → ページ順」で画像パートを並べ、末尾に suffix（Fields to extract 以降）の text パートを置く。
 *   各画像の直前に `[Document i/N page p]` のラベル（text パート）を置く
 *   （画像だけでは LLM がどの文書 / ページの画像かを見失うため。i/N/p は実際の値に展開する）。
 *   画像がバッチ間で変わらない Documents セクション直後に来るため、fields より前にあり
 *   prefix キャッシュの対象に含まれる（issue #89）。mode: 'text_with_images'（issue #176）の
 *   画像も同じ位置・同じラベル形式で並ぶ（本文はすでに prefixSections の text に含まれている）
 */
export function buildExtractDataUserContent(
  input: ExtractDataPromptInput,
): string | ChatContentPart[] {
  assertValidPromptInput(input);
  const prefixSections = buildPrefixSections(input);
  const suffixSections = buildSuffixSections(input);
  const hasImageDocument = input.documents.some(
    (doc) => doc.mode === 'image' || doc.mode === 'text_with_images',
  );
  if (!hasImageDocument) {
    return [...prefixSections, ...suffixSections].join('\n\n');
  }
  const total = input.documents.length;
  const parts: ChatContentPart[] = [{ type: 'text', text: prefixSections.join('\n\n') }];
  input.documents.forEach((doc, i) => {
    if (doc.mode === 'text') {
      return;
    }
    const docIndex = i + 1;
    for (const image of doc.imagePages) {
      parts.push({ type: 'text', text: `[Document ${docIndex}/${total} page ${image.page}]` });
      parts.push({ type: 'image', mimeType: image.mimeType, dataBase64: image.dataBase64 });
    }
  });
  parts.push({ type: 'text', text: suffixSections.join('\n\n') });
  return parts;
}

/**
 * 構造化出力（constrained decoding）用の JSON Schema。
 * LLMProvider の ChatOptions.responseSchema に渡す想定（標準 JSON Schema 方言。
 * プロバイダ実装が各社方言へ変換する）。validateAiOutput と同じ形状を制約する
 */
export const EXTRACT_DATA_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      field_id: { type: 'string' },
      entity_key: { type: 'string' },
      value: { type: ['string', 'null'] },
      not_reported: { type: 'boolean' },
      quote: { type: ['string', 'null'] },
      page: { type: ['integer', 'null'] },
      document_index: { type: ['integer', 'null'] },
      confidence: { type: ['string', 'null'], enum: ['high', 'medium', 'low', null] },
    },
    required: [
      'field_id',
      'entity_key',
      'value',
      'not_reported',
      'quote',
      'page',
      'document_index',
      'confidence',
    ],
    additionalProperties: false,
  },
};

/**
 * 構造化出力スキーマを requestBox に応じて組み立てる。
 * false（既定）は EXTRACT_DATA_RESPONSE_SCHEMA をそのまま返す（既存定数は変更しない）。
 * true は items.properties に box_2d（4 要素固定長の配列 | null）を追加した**新しいオブジェクト**を
 * 返す（GeminiProvider.toGeminiSchema は minItems/maxItems をパススルー済みのため方言変換は不要）
 */
export function extractDataResponseSchema(requestBox: boolean): Record<string, unknown> {
  if (!requestBox) {
    return EXTRACT_DATA_RESPONSE_SCHEMA;
  }
  const baseItems = EXTRACT_DATA_RESPONSE_SCHEMA['items'] as Record<string, unknown>;
  const baseProperties = baseItems['properties'] as Record<string, unknown>;
  const baseRequired = baseItems['required'] as string[];
  return {
    ...EXTRACT_DATA_RESPONSE_SCHEMA,
    items: {
      ...baseItems,
      properties: {
        ...baseProperties,
        box_2d: {
          type: ['array', 'null'],
          items: { type: 'integer' },
          minItems: 4,
          maxItems: 4,
        },
      },
      required: [...baseRequired, 'box_2d'],
    },
  };
}

/** 構造化出力を要求しても markdown フェンスで包むモデルがあるため防御的に剥がす */
function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  return match?.[1] ?? trimmed;
}

/**
 * LLM 応答テキストをパースして validateAiOutput（zod 検証 + confidence=low 強制 + document_index 検証）へ
 * 委譲する。JSON としてパースできない応答は AiOutputFormatError（バッチ全体の失敗として executeRun が扱う）。
 *
 * @param documentCount 当該バッチでプロンプトに連結した文書数（document_index の範囲検証に使う）
 */
export function parseExtractDataResponse(
  text: string,
  fields: readonly SchemaField[],
  documentCount: number,
): ValidateAiOutputResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stripJsonFence(text));
  } catch (error) {
    throw new AiOutputFormatError(`AI 応答が JSON としてパースできません: ${String(error)}`);
  }
  return validateAiOutput(raw, fields, documentCount);
}
