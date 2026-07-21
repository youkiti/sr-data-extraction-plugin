// 一括抽出（S7）の実行計画: study × スキーマのバッチ分割 + トークン / コスト概算
// - requirements.md §4.3（v0.10）: 1 API 呼び出し = 1 study ×（スキーマ全項目 or section 単位分割。
//   どちらの粒度にするかをトークン概算で判断するのが本モジュールの責務）。study の全文書を
//   ロール付き区切りで連結して 1 回で抽出するため、分割閾値は study の全文書合計トークンで評価する
// - 概算値は実行前の確認 UI（S7 のコスト概算表示）と ExtractionRuns.cost_estimate の素材。
//   実測 tokens_in / tokens_out は実行後に executeRun が LLMApiLog / ExtractionRuns へ記録する
// - text_status = no_text_layer の文書は除外せず、ページ画像を LLM へ添付する pdf_native 入力として
//   扱う（handoff-scanned-pdf-native-highlight.md §7.4 PR2。requirements.md Q7 の実装）。
//   study 内に text / image の文書が混在してもバッチは 1 本のまま（executeRun が文書ごとに
//   入力形式を出し分ける）。トークン概算はテキスト文書ぶん（文字数 ÷ 4）と画像文書ぶん
//   （ページ数 × 画像トークン単価）を別建てで計算してから合算する
// - 高精度読み取りモード（issue #176・input_mode = text_with_page_images）: `highAccuracyImages`
//   を true で渡すと、テキスト層のある（= no_text_layer でない）文書についても本文に加えて
//   ページ画像を併用添付する（表・図の読み取り精度を上げる run 単位のオプトイン。既定 false =
//   既存の text_only / pdf_native 挙動を一切変えない）。対象文書は augmentedImageDocumentIds に
//   載り、そのぶんの画像トークンも estimateBatch の見積もりへ加算する
// - 実行（API 呼び出し・進捗・partial_failure）は executeRun の責務。ここは純粋関数のみ
import { DOCUMENT_ROLE_ORDER, type DocumentRecord } from '../../domain/document';
import type { InputMode } from '../../domain/extractionRun';
import type { EntityLevel, SchemaField } from '../../domain/schemaField';
import { APPROX_IMAGE_TOKENS_PER_PAGE, estimateCostUsd } from '../../lib/llm/pricing';
import {
  EXTRACT_DATA_ARM_COMPLETENESS_RULE,
  EXTRACT_DATA_SYSTEM_PROMPT,
} from './skills/extractData';

/** 英語論文テキストの 1 トークンあたり文字数の目安（概算専用） */
export const APPROX_CHARS_PER_TOKEN = 4;

/**
 * プロンプトの固定部（システムプロンプト + セクション見出し + entity_key 規約 + 出力形式）の
 * 文字数概算。extractData.ts のプロンプト構成に対応する
 */
export const PROMPT_SCAFFOLD_CHARS = EXTRACT_DATA_SYSTEM_PROMPT.length + 1_200;

/** 1 項目の定義ブロック（renderField）の固定行ぶんの文字数概算 */
export const FIELD_PROMPT_OVERHEAD_CHARS = 120;

/** 応答 JSON の 1 要素あたり文字数概算（固定キー + value + quote ≤300 文字の中間値） */
export const OUTPUT_CHARS_PER_ITEM = 300;

/** 文書 1 件ぶんの連結見出し（`=== Document i/N [role] filename ===`）の文字数概算 */
export const DOCUMENT_SEPARATOR_CHARS = 60;

/** Documents.char_count 欠損時のフォールバック: 1 ページあたり文字数の目安 */
export const FALLBACK_CHARS_PER_PAGE = 3_000;

/** char_count / page_count とも欠損時のフォールバック: 1 論文あたり文字数の目安 */
export const FALLBACK_DOCUMENT_CHARS = 30_000;

/**
 * page_count 欠損時のフォールバック: 1 論文あたりページ数の目安（画像文書のトークン概算に使う）。
 * FALLBACK_DOCUMENT_CHARS / FALLBACK_CHARS_PER_PAGE と前提を揃えた値（= 10）
 */
export const FALLBACK_DOCUMENT_PAGES = FALLBACK_DOCUMENT_CHARS / FALLBACK_CHARS_PER_PAGE;

/**
 * entity_level ごとの「1 項目が生む応答要素数」の目安（概算専用）。
 * arm は 2 群比較、outcome_result は 2 群 × 2 時点相当を仮定する
 */
export const ENTITY_INSTANCE_ESTIMATE: Readonly<Record<EntityLevel, number>> = {
  study: 1,
  arm: 2,
  outcome_result: 4,
  rob_domain: 1,
};

/** 1 API 呼び出しあたりのトークン予算。超えると section 単位分割にフォールバックする */
export interface RunTokenBudget {
  /** 入力側の上限目安（モデルのコンテキスト長より保守的に） */
  maxInputTokensPerCall: number;
  /** 出力側の上限目安（長い構造化出力は欠落・打ち切りが増えるため保守的に） */
  maxOutputTokensPerCall: number;
}

export const DEFAULT_RUN_TOKEN_BUDGET: RunTokenBudget = {
  maxInputTokensPerCall: 200_000,
  maxOutputTokensPerCall: 8_000,
};

/** 1 行 = 1 API 呼び出しの計画（1 study） */
export interface PlannedBatch {
  /** 抽出単位である study（Evidence.study_id・ExtractionRuns.study_ids の素材） */
  studyId: string;
  /**
   * プロンプトへ連結する文書の順序リスト（本文ロード・アンカリング・Evidence.document_id の対象）。
   * 並びは role 固定順（DOCUMENT_ROLE_ORDER）→ 取り込み順で、AI 応答の document_index（1 始まり）に対応する。
   * text_status に関わらず study の全文書を含む（no_text_layer の文書は imageDocumentIds 側にも載る）
   */
  documentIds: readonly string[];
  /**
   * documentIds のうち text_status = no_text_layer でページ画像として送る文書（pdf_native）。
   * documentIds の部分集合・同順。0 件なら全文書がテキスト入力（text_only）
   */
  imageDocumentIds: readonly string[];
  /**
   * documentIds のうちテキスト層があり、かつ高精度読み取りモード（issue #176）でページ画像を
   * 「本文に加えて」併用添付する文書。documentIds の部分集合・同順で imageDocumentIds とは排他
   * （no_text_layer 文書は常に imageDocumentIds 側。テキスト層の無い文書に画像を「追加」する
   * 意味は無いため augmentedImageDocumentIds には載らない）。0 件 = 高精度読み取りモード無効、
   * または対象文書が無かった（全文書 no_text_layer 等）
   */
  augmentedImageDocumentIds: readonly string[];
  /** section 単位分割時の section 名。スキーマ全項目一括なら null */
  section: string | null;
  /** 当該バッチで抽出する項目（fieldIndex 順） */
  fieldIds: readonly string[];
  tokensInEstimate: number;
  tokensOutEstimate: number;
  /** section 分割してもなお予算超過（§4.3 の 2 粒度以上には分割しない） */
  overBudget: boolean;
}

export interface RunPlan {
  schemaVersion: number;
  model: string;
  batches: PlannedBatch[];
  /**
   * いずれかのバッチに画像入力の文書があれば 'pdf_native'、無ければ 'text_only'
   * （ExtractionRuns.input_mode の素材。requirements.md Q3 / handoff-scanned-pdf-native-highlight.md §7.4）
   */
  inputMode: InputMode;
  /** 全バッチ合計（ExtractionRuns.cost_estimate と S7 表示の素材） */
  tokensInEstimate: number;
  tokensOutEstimate: number;
  /** 単価表（lib/llm/pricing.ts）に無いモデルは null（UI は「概算不可」表示） */
  costEstimateUsd: number | null;
  /** UI にそのまま表示できる注意事項 */
  warnings: string[];
}

export interface PlanRunInput {
  documents: readonly DocumentRecord[];
  /** 同一 schema_version の抽出項目（混在は契約違反として throw） */
  fields: readonly SchemaField[];
  /** requested_model（単価表・トークン予算の対象） */
  model: string;
  /** extractData のプロンプトへ渡す予定の補助コンテキスト（トークン概算にのみ使用） */
  protocolContext?: string | null;
  budget?: Partial<RunTokenBudget>;
  /**
   * 高精度読み取りモード（issue #176）。true にすると、テキスト層のある文書についても
   * ページ画像を本文に加えて併用添付する（`input_mode = text_with_page_images`）。
   * 既定 false = 既存の text_only / pdf_native 挙動を一切変えない
   */
  highAccuracyImages?: boolean;
}

/** text_status = no_text_layer の文書はページ画像として送る（pdf_native。requirements.md Q7） */
function isImageDocument(doc: DocumentRecord): boolean {
  return doc.textStatus === 'no_text_layer';
}

/** 本文の文字数。char_count 欠損時は page_count × 目安、それも無ければ既定値 */
function documentChars(doc: DocumentRecord): number {
  if (doc.charCount !== null) {
    return doc.charCount;
  }
  if (doc.pageCount !== null) {
    return doc.pageCount * FALLBACK_CHARS_PER_PAGE;
  }
  return FALLBACK_DOCUMENT_CHARS;
}

/** 画像文書 1 件ぶんの入力トークン概算: ページ数（page_count 欠損時は既定値）× 画像トークン単価 + 連結見出しぶん */
function imageDocumentTokens(doc: DocumentRecord): number {
  const pages = doc.pageCount ?? FALLBACK_DOCUMENT_PAGES;
  return pages * APPROX_IMAGE_TOKENS_PER_PAGE + DOCUMENT_SEPARATOR_CHARS / APPROX_CHARS_PER_TOKEN;
}

/** 1 項目の定義ブロックの文字数概算（renderField の可変部 + 固定行ぶん） */
function fieldPromptChars(field: SchemaField): number {
  return (
    FIELD_PROMPT_OVERHEAD_CHARS +
    field.fieldId.length +
    field.fieldName.length +
    (field.unit?.length ?? 0) +
    (field.allowedValues?.length ?? 0) +
    field.extractionInstruction.length +
    (field.example?.length ?? 0)
  );
}

interface BatchEstimate {
  tokensIn: number;
  tokensOut: number;
}

/**
 * 1 バッチ（1 study の全文書連結 × 項目集合）の入出力トークン概算。
 * テキスト文書は文字数 ÷ 4 の目安（従来どおり）、画像文書はページ数 × 画像トークン単価で
 * 別建てに計算してから合算する（画像文書が無ければ従来と完全に同じ数値になる）。
 * `highAccuracyImages` が true のときは、テキスト文書（no_text_layer でない文書）ぶんの
 * 画像トークンも同じ単価で加算する（issue #176: 本文はそのまま・画像を追加するため、
 * imageDocumentTokens と同じ「ページ数 × APPROX_IMAGE_TOKENS_PER_PAGE + 見出しぶん」の式を流用する）
 */
function estimateBatch(
  docs: readonly DocumentRecord[],
  fields: readonly SchemaField[],
  protocolChars: number,
  highAccuracyImages: boolean,
): BatchEstimate {
  const textDocs = docs.filter((doc) => !isImageDocument(doc));
  const imageDocs = docs.filter(isImageDocument);
  const textBodyChars = textDocs.reduce(
    (sum, doc) => sum + DOCUMENT_SEPARATOR_CHARS + documentChars(doc),
    0,
  );
  // arm レベル項目を含むバッチは buildSuffixSections が completeness 強調を追記する（issue #97）
  // ため、同じ条件でそのぶんの文字数（+ セクション結合の '\n\n'）を概算にも加算して同期を保つ
  const armCompletenessChars = fields.some((field) => field.entityLevel === 'arm')
    ? EXTRACT_DATA_ARM_COMPLETENESS_RULE.length + 2
    : 0;
  const promptChars =
    PROMPT_SCAFFOLD_CHARS +
    protocolChars +
    fields.reduce((sum, field) => sum + fieldPromptChars(field), 0) +
    textBodyChars +
    armCompletenessChars;
  const items = fields.reduce((sum, field) => sum + ENTITY_INSTANCE_ESTIMATE[field.entityLevel], 0);
  const imageTokens = imageDocs.reduce((sum, doc) => sum + imageDocumentTokens(doc), 0);
  const augmentedImageTokens = highAccuracyImages
    ? textDocs.reduce((sum, doc) => sum + imageDocumentTokens(doc), 0)
    : 0;
  return {
    tokensIn: Math.ceil(promptChars / APPROX_CHARS_PER_TOKEN) + imageTokens + augmentedImageTokens,
    tokensOut: Math.ceil((items * OUTPUT_CHARS_PER_ITEM) / APPROX_CHARS_PER_TOKEN),
  };
}

/**
 * 文書を study ごとにグルーピングする（study の初出順を保つ）。
 * 各 study 内は role 固定順（DOCUMENT_ROLE_ORDER）→ 取り込み順（入力配列順）で並べる。
 * この並びが AI 応答の document_index（1 始まり）の基準になる
 */
function groupDocumentsByStudy(
  documents: readonly DocumentRecord[],
): Map<string, DocumentRecord[]> {
  const roleRank = new Map(DOCUMENT_ROLE_ORDER.map((role, index) => [role, index]));
  const groups = new Map<string, { doc: DocumentRecord; order: number }[]>();
  documents.forEach((doc, order) => {
    const group = groups.get(doc.studyId);
    if (group === undefined) {
      groups.set(doc.studyId, [{ doc, order }]);
    } else {
      group.push({ doc, order });
    }
  });
  const ordered = new Map<string, DocumentRecord[]>();
  for (const [studyId, entries] of groups) {
    entries.sort((a, b) => {
      // 未知ロールは末尾へ（roleRank に無い = 想定外だが安全側）
      const rankA = roleRank.get(a.doc.documentRole) ?? DOCUMENT_ROLE_ORDER.length;
      const rankB = roleRank.get(b.doc.documentRole) ?? DOCUMENT_ROLE_ORDER.length;
      return rankA !== rankB ? rankA - rankB : a.order - b.order;
    });
    ordered.set(
      studyId,
      entries.map((entry) => entry.doc),
    );
  }
  return ordered;
}

function withinBudget(estimate: BatchEstimate, budget: RunTokenBudget): boolean {
  return (
    estimate.tokensIn <= budget.maxInputTokensPerCall &&
    estimate.tokensOut <= budget.maxOutputTokensPerCall
  );
}

/** fieldIndex 順を保ったまま section ごとにグループ化する（出現順） */
function groupBySection(fields: readonly SchemaField[]): Map<string, SchemaField[]> {
  const groups = new Map<string, SchemaField[]>();
  for (const field of fields) {
    const group = groups.get(field.section);
    if (group === undefined) {
      groups.set(field.section, [field]);
    } else {
      group.push(field);
    }
  }
  return groups;
}

/**
 * 一括抽出の実行計画を立てる。
 * 文献ごとに「スキーマ全項目 1 バッチ」を試算し、予算超過なら section 単位分割へフォールバック。
 * section 分割は本文を各バッチへ重複投入するため、入力トークン合計は分割で増える点に注意
 */
export function planRun(input: PlanRunInput): RunPlan {
  const [firstField] = input.fields;
  if (firstField === undefined) {
    throw new Error('planRun に抽出項目が 1 件も渡されていません');
  }
  if (input.documents.length === 0) {
    throw new Error('planRun に対象文献が 1 件も渡されていません');
  }
  const schemaVersion = firstField.schemaVersion;
  if (input.fields.some((field) => field.schemaVersion !== schemaVersion)) {
    throw new Error('planRun に複数の schema_version の項目が混在しています');
  }

  const budget: RunTokenBudget = { ...DEFAULT_RUN_TOKEN_BUDGET, ...input.budget };
  const protocolChars = input.protocolContext?.length ?? 0;
  const sortedFields = [...input.fields].sort((a, b) => a.fieldIndex - b.fieldIndex);
  const allFieldIds = sortedFields.map((field) => field.fieldId);
  // 高精度読み取りモード（issue #176）: 明示的に true を渡したときだけ有効にする
  // （既定 undefined は従来どおり false 相当 = 挙動・コストを変えない）
  const highAccuracyImages = input.highAccuracyImages === true;

  const batches: PlannedBatch[] = [];
  const imageDocumentIds = new Set<string>();
  const augmentedImageDocumentIds = new Set<string>();
  let unknownCharCountDocs = 0;

  for (const [studyId, docs] of groupDocumentsByStudy(input.documents)) {
    const documentIds = docs.map((doc) => doc.documentId);
    const batchImageDocumentIds = docs.filter(isImageDocument).map((doc) => doc.documentId);
    // 高精度読み取りモードの対象はテキスト層がある文書のみ（no_text_layer は既に画像入力のため
    // 「追加」する意味が無く、imageDocumentIds と augmentedImageDocumentIds は排他になる）
    const batchAugmentedImageDocumentIds = highAccuracyImages
      ? docs.filter((doc) => !isImageDocument(doc)).map((doc) => doc.documentId)
      : [];
    for (const id of batchImageDocumentIds) {
      imageDocumentIds.add(id);
    }
    for (const id of batchAugmentedImageDocumentIds) {
      augmentedImageDocumentIds.add(id);
    }
    for (const doc of docs) {
      if (!isImageDocument(doc) && doc.charCount === null) {
        unknownCharCountDocs += 1;
      }
    }

    const fullEstimate = estimateBatch(docs, sortedFields, protocolChars, highAccuracyImages);
    if (withinBudget(fullEstimate, budget)) {
      batches.push({
        studyId,
        documentIds,
        imageDocumentIds: batchImageDocumentIds,
        augmentedImageDocumentIds: batchAugmentedImageDocumentIds,
        section: null,
        fieldIds: allFieldIds,
        tokensInEstimate: fullEstimate.tokensIn,
        tokensOutEstimate: fullEstimate.tokensOut,
        overBudget: false,
      });
      continue;
    }

    for (const [section, sectionFields] of groupBySection(sortedFields)) {
      const estimate = estimateBatch(docs, sectionFields, protocolChars, highAccuracyImages);
      batches.push({
        studyId,
        documentIds,
        imageDocumentIds: batchImageDocumentIds,
        augmentedImageDocumentIds: batchAugmentedImageDocumentIds,
        section,
        fieldIds: sectionFields.map((field) => field.fieldId),
        tokensInEstimate: estimate.tokensIn,
        tokensOutEstimate: estimate.tokensOut,
        overBudget: !withinBudget(estimate, budget),
      });
    }
  }

  const tokensInEstimate = batches.reduce((sum, batch) => sum + batch.tokensInEstimate, 0);
  const tokensOutEstimate = batches.reduce((sum, batch) => sum + batch.tokensOutEstimate, 0);
  const costEstimateUsd = estimateCostUsd(input.model, tokensInEstimate, tokensOutEstimate);
  // 高精度読み取りモードが実際に何か文書へ適用されたときだけ input_mode をそう記録する
  // （全対象が no_text_layer などで augmentedImageDocumentIds が 0 件なら、
  // ユーザーがモードをオンにしていても実際の入力は変わっていないため pdf_native / text_only のまま）
  const inputMode: InputMode =
    augmentedImageDocumentIds.size > 0
      ? 'text_with_page_images'
      : imageDocumentIds.size > 0
        ? 'pdf_native'
        : 'text_only';

  const warnings: string[] = [];
  if (imageDocumentIds.size > 0) {
    warnings.push(
      `テキスト層がない文献 ${imageDocumentIds.size} 件はページ画像として LLM へ送信します（pdf_native。画像トークンぶんコストが増えます）`,
    );
  }
  if (augmentedImageDocumentIds.size > 0) {
    warnings.push(
      `高精度読み取りモード: テキスト層がある文献 ${augmentedImageDocumentIds.size} 件のページ画像も追加送信します（トークン消費量が大幅に増えます）`,
    );
  }
  if (unknownCharCountDocs > 0) {
    warnings.push(`文字数が未取得の文献 ${unknownCharCountDocs} 件は既定値で概算しています`);
  }
  const overBudgetCount = batches.filter((batch) => batch.overBudget).length;
  if (overBudgetCount > 0) {
    warnings.push(
      `section 分割後もトークン予算を超えるバッチが ${overBudgetCount} 件あります（応答の欠落・打ち切りに注意）`,
    );
  }
  if (costEstimateUsd === null) {
    warnings.push(`モデル「${input.model}」は単価表に無いためコストを概算できません`);
  }

  return {
    schemaVersion,
    model: input.model,
    batches,
    inputMode,
    tokensInEstimate,
    tokensOutEstimate,
    costEstimateUsd,
    warnings,
  };
}
