// 一括抽出（S7）の実行計画: document × スキーマのバッチ分割 + トークン / コスト概算
// - requirements.md §4.3: 1 API 呼び出し = 1 document ×（スキーマ全項目 or section 単位分割。
//   どちらの粒度にするかをトークン概算で判断するのが本モジュールの責務）
// - 概算値は実行前の確認 UI（S7 のコスト概算表示）と ExtractionRuns.cost_estimate の素材。
//   実測 tokens_in / tokens_out は実行後に executeRun が LLMApiLog / ExtractionRuns へ記録する
// - MVP は text_only モードのみ（pdf_native ※Q3 のトークン計算は lib/llm 移植時に別途対応）
// - 実行（API 呼び出し・進捗・partial_failure）は executeRun の責務。ここは純粋関数のみ
import type { DocumentRecord } from '../../domain/document';
import type { EntityLevel, SchemaField } from '../../domain/schemaField';
import { estimateCostUsd } from '../../lib/llm/pricing';
import { EXTRACT_DATA_SYSTEM_PROMPT } from './skills/extractData';

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

/** Documents.char_count 欠損時のフォールバック: 1 ページあたり文字数の目安 */
export const FALLBACK_CHARS_PER_PAGE = 3_000;

/** char_count / page_count とも欠損時のフォールバック: 1 論文あたり文字数の目安 */
export const FALLBACK_DOCUMENT_CHARS = 30_000;

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

/** 計画から除外した文献とその理由 */
export interface SkippedDocument {
  documentId: string;
  /** text_only モードではテキスト層がない PDF を抽出できない（※Q7） */
  reason: 'no_text_layer';
}

/** 1 行 = 1 API 呼び出しの計画 */
export interface PlannedBatch {
  documentId: string;
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
  skippedDocuments: SkippedDocument[];
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

/** 1 バッチ（1 document × 項目集合）の入出力トークン概算 */
function estimateBatch(
  doc: DocumentRecord,
  fields: readonly SchemaField[],
  protocolChars: number,
): BatchEstimate {
  const promptChars =
    PROMPT_SCAFFOLD_CHARS +
    protocolChars +
    fields.reduce((sum, field) => sum + fieldPromptChars(field), 0) +
    documentChars(doc);
  const items = fields.reduce((sum, field) => sum + ENTITY_INSTANCE_ESTIMATE[field.entityLevel], 0);
  return {
    tokensIn: Math.ceil(promptChars / APPROX_CHARS_PER_TOKEN),
    tokensOut: Math.ceil((items * OUTPUT_CHARS_PER_ITEM) / APPROX_CHARS_PER_TOKEN),
  };
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

  const batches: PlannedBatch[] = [];
  const skippedDocuments: SkippedDocument[] = [];
  let unknownCharCountDocs = 0;

  for (const doc of input.documents) {
    if (doc.textStatus === 'no_text_layer') {
      skippedDocuments.push({ documentId: doc.documentId, reason: 'no_text_layer' });
      continue;
    }
    if (doc.charCount === null) {
      unknownCharCountDocs += 1;
    }

    const fullEstimate = estimateBatch(doc, sortedFields, protocolChars);
    if (withinBudget(fullEstimate, budget)) {
      batches.push({
        documentId: doc.documentId,
        section: null,
        fieldIds: allFieldIds,
        tokensInEstimate: fullEstimate.tokensIn,
        tokensOutEstimate: fullEstimate.tokensOut,
        overBudget: false,
      });
      continue;
    }

    for (const [section, sectionFields] of groupBySection(sortedFields)) {
      const estimate = estimateBatch(doc, sectionFields, protocolChars);
      batches.push({
        documentId: doc.documentId,
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

  const warnings: string[] = [];
  if (skippedDocuments.length > 0) {
    warnings.push(
      `テキスト層がない文献 ${skippedDocuments.length} 件は今回の抽出対象外です（text_only モードでは抽出できません）`,
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
    skippedDocuments,
    tokensInEstimate,
    tokensOutEstimate,
    costEstimateUsd,
    warnings,
  };
}
