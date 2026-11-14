// 一括抽出（S7）の実行計画: study × スキーマのバッチ分割 + トークン / コスト概算
// - requirements.md §4.3（v0.10）: 1 API 呼び出し = 1 study ×（スキーマ全項目 or section 単位分割。
//   どちらの粒度にするかをトークン概算で判断するのが本モジュールの責務）。study の全文書を
//   ロール付き区切りで連結して 1 回で抽出するため、分割閾値は study の全文書合計トークンで評価する
//   section 分割でも outcome_result 項目は最初の対象項目の section に集め、呼び出し間の
//   entity_key の違いで同じ結果が複数行に分かれることを防ぐ
// - 概算値は実行前の確認 UI（S7 のコスト概算表示）と ExtractionRuns.cost_estimate の素材。
//   実測 tokens_in / tokens_out は実行後に executeRun が LLMApiLog / ExtractionRuns へ記録する
// - text_status = no_text_layer の文書は除外せず、ページ画像を LLM へ添付する pdf_native 入力として
//   扱う（handoff-scanned-pdf-native-highlight.md §7.4 PR2。requirements.md Q7 の実装）。
//   study 内に text / image の文書が混在してもバッチは 1 本のまま（executeRun が文書ごとに
//   入力形式を出し分ける）。トークン概算はテキスト文書ぶん（文字数 ÷ 4）と画像文書ぶん
//   （ページ数 × 画像トークン単価）を別建てで計算してから合算する
// - 実行（API 呼び出し・進捗・partial_failure）は executeRun の責務。ここは純粋関数のみ
import { isMultiSelectField, multiSelectConfigOf, splitPipeList } from '../../domain/multiSelect';
import { DOCUMENT_ROLE_ORDER, type DocumentRecord } from '../../domain/document';
import type { InputMode } from '../../domain/extractionRun';
import type { LlmProviderId } from '../../domain/llmApiLog';
import type { EntityLevel, SchemaField } from '../../domain/schemaField';
import {
  APPROX_IMAGE_TOKENS_PER_PAGE,
  estimateCostUsd,
  type ModelPricing,
  resolveModelImageInputSupport,
  resolveThinkingOutputMultiplier,
} from '../../lib/llm/pricing';
import { resolveEffectivePageImages, resolveProviderId } from '../../lib/llm/providerFactory';
import {
  EXTRACT_DATA_ARM_COMPLETENESS_RULE,
  EXTRACT_DATA_OUTCOME_SOURCE_RULE,
  EXTRACT_DATA_SYSTEM_PROMPT,
  EXTRACT_DATA_PAGE_IMAGES_RULE,
} from './skills/extractData';

/** 英語論文テキストの 1 トークンあたり文字数の目安（概算専用） */
export const APPROX_CHARS_PER_TOKEN = 4;

/**
 * プロンプトの固定部（システムプロンプト + セクション見出し + entity_key 規約 + 出力形式）の
 * 文字数概算。extractData.ts のプロンプト構成に対応する
 * outcome_result の群の番号づけ規約が約 300 文字増えたぶんを含める
 */
export const PROMPT_SCAFFOLD_CHARS = EXTRACT_DATA_SYSTEM_PROMPT.length + 1_500;

/** 1 項目の定義ブロック（renderField）の固定行ぶんの文字数概算 */
export const FIELD_PROMPT_OVERHEAD_CHARS = 120;

/** 応答 JSON の 1 要素あたり文字数概算（固定キー + value + quote ≤300 文字の中間値） */
// 従来の 300 文字 + section のキー・区切り 15 文字 + 見出しの目安 20 文字。
export const OUTPUT_CHARS_PER_ITEM = 300 + '"section": "", '.length + 20;

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
  /** 本文に加えて全ページ画像を送る文書。画像のみの文書とは排他。 */
  augmentedImageDocumentIds?: readonly string[];
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
   * 本文と画像を併用する文書があれば 'text_with_page_images' を優先する。
   * 併用が無く画像入力の文書があれば 'pdf_native'、画像が無ければ 'text_only'。
   */
  inputMode: InputMode;
  /** 全バッチ合計（ExtractionRuns.cost_estimate と S7 表示の素材） */
  tokensInEstimate: number;
  tokensOutEstimate: number;
  /** コスト計算の出力推定にのみ適用する思考倍率。表示トークン数と分割判定には適用しない */
  thinkingOutputMultiplier: number;
  /** 単価表（lib/llm/pricing.ts）に無いモデルは null（UI は「概算不可」表示） */
  costEstimateUsd: number | null;
  /** UI にそのまま表示できる注意事項 */
  warnings: string[];
}

export interface PlanRunInput {
  /** 明示選択時だけ本文に全ページ画像を追加する。 */
  pageImages?: boolean;
  /** 保存済みの接続方式をモデル名からの推定より優先する。 */
  providerOverride?: LlmProviderId | null;
  fallbackPricing?: ModelPricing;
  documents: readonly DocumentRecord[];
  /** 同一 schema_version の抽出項目（混在は契約違反として throw） */
  fields: readonly SchemaField[];
  /** requested_model（単価表・トークン予算の対象） */
  model: string;
  /** extractData のプロンプトへ渡す予定の補助コンテキスト（トークン概算にのみ使用） */
  protocolContext?: string | null;
  budget?: Partial<RunTokenBudget>;
  /**
   * モデルが実際に選択されているか（画像非対応モデルの実行ブロック。既定 true）。
   * `false` を明示したときだけ「画像対応が unknown のモデル」警告を出さない。
   * extractView.ts の `renderEstimate` はモデル未選択時にコスト概算のためだけに
   * `model: 'unknown'` という文字列を代入して planRun を呼ぶ経路があり、その代入値を
   * 「画像対応が不明なモデルが選ばれている」と誤検出しないための切り分けフラグ
   */
  modelSelected?: boolean;
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
  const config = multiSelectConfigOf(field);
  let multiSelectChars = 0;
  if (config !== null && isMultiSelectField(field)) {
    multiSelectChars += '  multi_select: true\n'.length;
    if (config.exclusiveValues.length > 0) {
      multiSelectChars += `  exclusive_values: ${config.exclusiveValues.join('|')}\n`.length;
    }
    if (config.freeTextValues.length > 0) {
      multiSelectChars += `  free_text_values: ${config.freeTextValues.join('|')}\n`.length;
    }
  }
  return (
    multiSelectChars +
    FIELD_PROMPT_OVERHEAD_CHARS +
    field.fieldId.length +
    field.fieldName.length +
    (field.unit?.length ?? 0) +
    (field.allowedValues?.length ?? 0) +
    field.extractionInstruction.length +
    (field.example?.length ?? 0) +
    (field.maxQuotes === null ? 0 : `  max_quotes: ${field.maxQuotes}\n`.length)
  );
}

interface BatchEstimate {
  tokensIn: number;
  tokensOut: number;
}

/**
 * 1 バッチ（1 study の全文書連結 × 項目集合）の入出力トークン概算。
 * テキスト文書は文字数 ÷ 4 の目安（従来どおり）、画像文書はページ数 × 画像トークン単価で
 * 別建てに計算してから合算する（画像文書が無ければ従来と完全に同じ数値になる）
 */
function estimateBatch(
  docs: readonly DocumentRecord[],
  fields: readonly SchemaField[],
  protocolChars: number,
  pageImages: boolean,
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
  // outcome_result レベル項目を含むバッチは buildSuffixSections が出所の規則を追記する
  // ため、同じ条件でそのぶんの文字数（+ セクション結合の '\n\n'）を概算にも加算して同期を保つ
  const outcomeSourceChars = fields.some((field) => field.entityLevel === 'outcome_result')
    ? EXTRACT_DATA_OUTCOME_SOURCE_RULE.length + 2
    : 0;
  const promptChars =
    (pageImages && textDocs.length > 0 ? EXTRACT_DATA_PAGE_IMAGES_RULE.length + 2 : 0) +
    PROMPT_SCAFFOLD_CHARS +
    protocolChars +
    fields.reduce((sum, field) => sum + fieldPromptChars(field), 0) +
    textBodyChars +
    armCompletenessChars +
    outcomeSourceChars;
  const items = fields.reduce((sum, field) => {
    const config = multiSelectConfigOf(field);
    return sum + ENTITY_INSTANCE_ESTIMATE[field.entityLevel] * (config !== null && isMultiSelectField(field)
    ? Math.max(1, splitPipeList(field.allowedValues).filter((option) => !config.exclusiveValues.includes(option)).length)
    : (field.maxQuotes ?? 1));
  }, 0);
  const imageTokens = imageDocs.reduce((sum, doc) => sum + imageDocumentTokens(doc), 0);
  const extraImageTokens = pageImages
    ? textDocs.reduce((sum, doc) => sum + imageDocumentTokens(doc), 0)
    : 0;
  return {
    tokensIn: Math.ceil(promptChars / APPROX_CHARS_PER_TOKEN) + imageTokens + extraImageTokens,
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

/**
 * fieldIndex 順の項目を section の初出順でグループ化する。
 * outcome_result は全て最初の対象項目の section に集め、各バッチ内も fieldIndex 順を保つ。
 * 移動で空になった section は除く。
 */
function groupBySection(fields: readonly SchemaField[]): Map<string, SchemaField[]> {
  const groups = new Map<string, SchemaField[]>(fields.map((field) => [field.section, []]));
  const outcomeSection = fields.find((field) => field.entityLevel === 'outcome_result')?.section;
  for (const field of fields) {
    const section = field.entityLevel === 'outcome_result' ? outcomeSection! : field.section;
    groups.get(section)!.push(field);
  }
  return new Map([...groups].filter(([, group]) => group.length > 0));
}

/**
 * 一括抽出の実行計画を立てる。
 * 文献ごとに「スキーマ全項目 1 バッチ」を試算し、予算超過なら section 単位分割へフォールバック。
 * outcome_result 項目は最初の対象項目の section の 1 バッチに集め、予算超過でも再分割しない。
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
  const pageImages = resolveEffectivePageImages(input.pageImages === true, input.model, input.providerOverride);

  const batches: PlannedBatch[] = [];
  const imageDocumentIds = new Set<string>();
  const augmentedImageDocumentIds = new Set<string>();
  let unknownCharCountDocs = 0;

  for (const [studyId, docs] of groupDocumentsByStudy(input.documents)) {
    const documentIds = docs.map((doc) => doc.documentId);
    const batchImageDocumentIds = docs.filter(isImageDocument).map((doc) => doc.documentId);
    const augmentedIds = pageImages
      ? docs.filter((doc) => !isImageDocument(doc)).map((doc) => doc.documentId)
      : [];
    for (const id of augmentedIds) {
      augmentedImageDocumentIds.add(id);
    }
    for (const id of batchImageDocumentIds) {
      imageDocumentIds.add(id);
    }
    for (const doc of docs) {
      if (!isImageDocument(doc) && doc.charCount === null) {
        unknownCharCountDocs += 1;
      }
    }

    const fullEstimate = estimateBatch(docs, sortedFields, protocolChars, pageImages);
    if (withinBudget(fullEstimate, budget)) {
      batches.push({
        studyId,
        documentIds,
        imageDocumentIds: batchImageDocumentIds,
        ...(augmentedIds.length > 0 ? { augmentedImageDocumentIds: augmentedIds } : {}),
        section: null,
        fieldIds: allFieldIds,
        tokensInEstimate: fullEstimate.tokensIn,
        tokensOutEstimate: fullEstimate.tokensOut,
        overBudget: false,
      });
      continue;
    }

    for (const [section, sectionFields] of groupBySection(sortedFields)) {
      const estimate = estimateBatch(docs, sectionFields, protocolChars, pageImages);
      batches.push({
        studyId,
        documentIds,
        imageDocumentIds: batchImageDocumentIds,
        ...(augmentedIds.length > 0 ? { augmentedImageDocumentIds: augmentedIds } : {}),
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
  const thinkingOutputMultiplier = resolveThinkingOutputMultiplier(input.model);
  const costEstimateUsd = estimateCostUsd(
    input.model,
    tokensInEstimate,
    tokensOutEstimate * thinkingOutputMultiplier,
    null,
    input.fallbackPricing,
    Date.now(),
  );
  const inputMode: InputMode = augmentedImageDocumentIds.size > 0
    ? 'text_with_page_images'
    : imageDocumentIds.size > 0 ? 'pdf_native' : 'text_only';

  const warnings: string[] = [];
  if (augmentedImageDocumentIds.size > 0) {
    warnings.push(`本文に加えて文献 ${augmentedImageDocumentIds.size} 件の全ページ画像も送信します（画像トークンぶん費用が増えます）`);
  }
  if (thinkingOutputMultiplier > 1 && costEstimateUsd !== null) {
    warnings.push(
      `思考（thinking）トークンを見込み、コスト概算では出力トークンに ×${thinkingOutputMultiplier.toFixed(2)} を掛けています（表示の出力トークン数は応答本文ぶんのみ）`,
    );
  }
  if (imageDocumentIds.size > 0) {
    warnings.push(
      `テキスト層がない文献 ${imageDocumentIds.size} 件はページ画像として LLM へ送信します（pdf_native。画像トークンぶんコストが増えます）`,
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
  // 画像非対応モデルの実行ブロック（B）: バッチに画像入力（pdf_native）が含まれ、かつモデルが
  // 実際に選択されている（modelSelected !== false）のに画像対応可否が unknown（カタログに
  // 実測が無い）なら警告だけ足す（ブロックはしない。ブロックは isRunBlockedByImageUnsupportedModel
  // の役目 = 'unsupported' 確定時のみ）
  const modelSelected = input.modelSelected !== false;
  if (
    modelSelected &&
    (imageDocumentIds.size > 0 || augmentedImageDocumentIds.size > 0) &&
    resolveModelImageInputSupport(input.providerOverride ?? resolveProviderId(input.model), input.model) === 'unknown'
  ) {
    warnings.push(
      imageDocumentIds.size > 0
        ? `モデル「${input.model}」が画像入力に対応しているか分かっていません（カタログ外）。テキスト層のない文献が正しく読めない可能性があります`
        : `モデル「${input.model}」が画像入力に対応しているか分かっていません（カタログ外）。追加で送るページ画像が読まれない可能性があります`,
    );
  }

  return {
    schemaVersion,
    model: input.model,
    batches,
    inputMode,
    tokensInEstimate,
    tokensOutEstimate,
    thinkingOutputMultiplier,
    costEstimateUsd,
    warnings,
  };
}
