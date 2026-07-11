// AI 抽出応答（extract-data skill）のクライアント側バリデーション（requirements.md §4.3）
// 1) zod による要素単位の形状検証。不正要素は破棄し、partial_failure の素材として返す
// 2) field_id が当該 schema_version の SchemaFields に存在しない要素は破棄（§4.3）
// 3) entity_key が field の entity_level と整合しない要素も同様に破棄
// 4) document_index（v0.10）: quote があるのに欠落・範囲外の要素は破棄（field_id 不明と同じ扱い）。
//    not_reported=true の要素は document_index 不要。1..documentCount の値へ解決して返す
// 5) 値と quote の矛盾（quote 欠落 / 値中の数値が quote に無い / not_reported なのに値あり）は
//    confidence=low を強制する（破棄はしない — S8 の人間検証で拾わせるため）
// 6) box_2d（bbox。§7.4 PR3）: 壊れていても要素は破棄せず bbox のみ null に落とす
//    （anchor_status とは別軸で機械検証不能なため、他フィールドの信頼性に影響させない）
//
// 突合キーになる field_id / entity_key / value / not_reported / document_index は厳格に検証し、
// 補助ヒントの page / confidence / box_2d は寛容にパースして不正値を null へ落とす
import { z } from 'zod';
import type { Confidence, EvidenceBbox } from '../../domain/evidence';
import type { SchemaField } from '../../domain/schemaField';
import { parseEntityKey, STUDY_ENTITY_KEY } from '../../utils/entityKey';
import { normalizeText } from '../anchoring/normalizeText';

/** 応答全体（配列）の形式不正。要素単位の不正は rejected で返し、これは投げる */
export class AiOutputFormatError extends Error {}

/** confidence=low を強制した理由（Evidence 保存前の UI 表示・ログ用） */
export type ForcedLowReason =
  | 'missing_quote' // 値があるのに quote が無い
  | 'number_not_in_quote' // 値に含まれる数値が quote 内に見つからない
  | 'value_with_not_reported'; // not_reported=true なのに値がある

export type RejectReason =
  | 'invalid_shape'
  | 'unknown_field_id'
  | 'entity_key_mismatch'
  | 'invalid_document_index';

/** 検証を通過した 1 要素。Evidence への追記と ai annotator 行への転記の素材 */
export interface ValidatedAiItem {
  fieldId: string;
  entityKey: string;
  value: string | null;
  notReported: boolean;
  quote: string | null;
  page: number | null;
  /**
   * quote の出所文書の 1 始まり番号（1..documentCount へ解決済み）。
   * executeRun がこの index でバッチの documentIds を引き、Evidence.document_id とアンカリング対象を決める
   */
  documentIndex: number;
  confidence: Confidence | null;
  /** 空配列 = 強制なし。非空なら confidence は 'low' に強制済み */
  forcedLowReasons: ForcedLowReason[];
  /** box_2d の検証結果（validateBox）。欠落・壊れている場合は null（要素自体は破棄しない） */
  box: EvidenceBbox | null;
}

/** 破棄した要素。呼び出し側（executeRun）が partial_failure として記録する */
export interface RejectedAiItem {
  /** 応答配列内の位置 */
  index: number;
  reason: RejectReason;
  detail: string;
  raw: unknown;
}

export interface ValidateAiOutputResult {
  items: ValidatedAiItem[];
  rejected: RejectedAiItem[];
}

/** 値は文字列で保持（Evidence.value）。数値・真偽値は文字列化し、空白のみは null に落とす */
const valueSchema = z
  .union([z.string(), z.number(), z.boolean()])
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined) {
      return null;
    }
    const text = String(v);
    return text.trim() === '' ? null : text;
  });

const quoteSchema = z
  .string()
  .nullish()
  .transform((v) => (v === null || v === undefined || v.trim() === '' ? null : v));

/**
 * 応答要素のスキーマ。requirements.md §4.3 の
 * `{ field_id, entity_key, value, not_reported, quote, page, confidence }`。
 * field_name 等の補助キーは無視する（突合には使わない）
 */
const aiOutputItemSchema = z.object({
  field_id: z.string().min(1),
  entity_key: z.string().min(1),
  value: valueSchema,
  not_reported: z
    .boolean()
    .nullish()
    .transform((v) => v ?? false),
  page: z.number().int().min(1).nullable().catch(null),
  // 範囲（1..documentCount）の検証は破棄対象なので catch では潰さず、後段で明示的に判定する。
  // 整数でない・0 以下などの形式不正だけを null へ落とす
  document_index: z.number().int().min(1).nullable().catch(null),
  quote: quoteSchema,
  confidence: z.enum(['high', 'medium', 'low']).nullable().catch(null),
  // box_2d（bbox。requestBox=true のときだけモデルが返す）は形は問わず素通しし、
  // validateBox() が別途厳密に検証する（壊れていても要素自体は破棄しない。§7.4 PR3）
  box_2d: z.unknown().nullish(),
});

type ParsedAiItem = z.infer<typeof aiOutputItemSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join('.');
      return path === '' ? issue.message : `${path}: ${issue.message}`;
    })
    .join('; ');
}

// 数値トークン: 桁区切りカンマ付き（1,234.5）を 1 トークンとして先に拾い、残りは連続数字
const NUMBER_TOKEN_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

/**
 * テキストから数値を抽出する。anchoring と同じ正規化（NFKC で全角→半角等）を通し、
 * 医学誌の中黒小数点（12·5）を '.' に読み替え、桁区切りカンマを外して数値比較できる形にする
 */
function extractNumbers(text: string): number[] {
  const normalized = normalizeText(text).replace(/(\d)[·⋅](\d)/g, '$1.$2');
  const tokens = normalized.match(NUMBER_TOKEN_RE) ?? [];
  return tokens.map((token) => Number.parseFloat(token.replace(/,/g, '')));
}

/** 値と quote の矛盾検出（requirements.md §4.3「quote に数値がない」等）。検出順に返す */
function detectContradictions(item: ParsedAiItem): ForcedLowReason[] {
  const reasons: ForcedLowReason[] = [];
  if (item.not_reported && item.value !== null) {
    reasons.push('value_with_not_reported');
  }
  if (item.value === null) {
    return reasons; // 値なしは quote との突合対象がない
  }
  if (item.quote === null) {
    reasons.push('missing_quote');
    return reasons;
  }
  const quoteNumbers = new Set(extractNumbers(item.quote));
  if (extractNumbers(item.value).some((n) => !quoteNumbers.has(n))) {
    reasons.push('number_not_in_quote');
  }
  return reasons;
}

/**
 * quote の出所文書番号（document_index）を 1..documentCount へ解決する。
 * - quote あり: 欠落・範囲外なら null を返す（呼び出し側で破棄）。ただし文書が 1 件だけなら
 *   出所は一意なので欠落は 1 と解決する（範囲外は他文書を指すため破棄する）
 * - quote なし（not_reported 等）: document_index は不要。既定で 1（先頭 = 主文書）へ帰属させる
 */
function resolveDocumentIndex(
  raw: number | null,
  hasQuote: boolean,
  documentCount: number,
): number | null {
  const inRange = raw !== null && raw >= 1 && raw <= documentCount;
  if (!hasQuote) {
    return inRange ? raw : 1;
  }
  if (raw === null) {
    return documentCount === 1 ? 1 : null;
  }
  return inRange ? raw : null;
}

/** 0–1000 の整数か（validateBox の各座標検証で使う） */
function isValidCoordinate(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 1000;
}

/**
 * AI 応答の box_2d を検証する（handoff-scanned-pdf-native-highlight.md §7.2・スパイク §3）。
 * - 配列でない・長さが 4 未満 or 6 以上 → null
 * - 長さ 5 で末尾要素が 4 番目の要素と同値なら先頭 4 要素へ復元する
 *   （responseSchema で minItems/maxItems=4 を指定しても実測 8 件中 2 件が末尾重複の
 *   5 要素で返ってきた実績があるため。それ以外の長さ 5 は復元できず null）
 * - 復元後の 4 要素は全て整数かつ 0–1000 の範囲内であること。外れれば null
 * - ymin <= ymax かつ xmin <= xmax（順序が逆なら壊れた box とみなし null）
 * - 上記を満たせば { ymin, xmin, ymax, xmax } を返す
 *
 * 壊れた box は「行ごと破棄」ではなく「bbox のみ null」に落とす（呼び出し側の責務）
 */
export function validateBox(raw: unknown): EvidenceBbox | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  let restored: unknown[];
  if (raw.length === 4) {
    restored = raw;
  } else if (raw.length === 5 && raw[4] === raw[3]) {
    restored = raw.slice(0, 4);
  } else {
    return null;
  }
  const [ymin, xmin, ymax, xmax] = restored;
  if (
    !isValidCoordinate(ymin) ||
    !isValidCoordinate(xmin) ||
    !isValidCoordinate(ymax) ||
    !isValidCoordinate(xmax)
  ) {
    return null;
  }
  if (ymin > ymax || xmin > xmax) {
    return null;
  }
  return { ymin, xmin, ymax, xmax };
}

/**
 * AI 応答（JSON パース済み）を検証する。
 *
 * @param raw   LLM 応答の JSON（構造化出力）。配列でなければ AiOutputFormatError
 * @param fields 当該 schema_version の SchemaFields（呼び出し側で版を絞って渡す）
 * @param documentCount 当該バッチでプロンプトに連結した文書数（document_index の範囲検証。1 以上）
 */
export function validateAiOutput(
  raw: unknown,
  fields: readonly SchemaField[],
  documentCount: number,
): ValidateAiOutputResult {
  if (!Array.isArray(raw)) {
    throw new AiOutputFormatError('AI 応答が配列ではありません（構造化出力の形式不正）');
  }
  const fieldById = new Map(fields.map((field) => [field.fieldId, field]));
  const items: ValidatedAiItem[] = [];
  const rejected: RejectedAiItem[] = [];
  raw.forEach((element, index) => {
    const parsed = aiOutputItemSchema.safeParse(element);
    if (!parsed.success) {
      rejected.push({ index, reason: 'invalid_shape', detail: formatIssues(parsed.error), raw: element });
      return;
    }
    const field = fieldById.get(parsed.data.field_id);
    if (field === undefined) {
      rejected.push({
        index,
        reason: 'unknown_field_id',
        detail: `field_id "${parsed.data.field_id}" は当該 schema_version の SchemaFields に存在しません`,
        raw: element,
      });
      return;
    }
    // study レベルは 1 document 1 インスタンスで entity_key が決定的（'-'）。
    // モデルが "study" / "_" / "" など別表記を返しても意味は一意なので、
    // 破棄せず正典キーへ正規化する（arm / outcome_result はインスタンス識別が
    // 必要なので従来どおり厳格に検証する）
    let entityKey: string;
    if (field.entityLevel === 'study') {
      entityKey = STUDY_ENTITY_KEY;
    } else {
      const entity = parseEntityKey(parsed.data.entity_key);
      if (entity === null || entity.level !== field.entityLevel) {
        rejected.push({
          index,
          reason: 'entity_key_mismatch',
          detail: `entity_key "${parsed.data.entity_key}" が entity_level "${field.entityLevel}"（${field.fieldName}）と整合しません`,
          raw: element,
        });
        return;
      }
      entityKey = parsed.data.entity_key;
    }
    // document_index（v0.10）: quote があるのに欠落・範囲外なら破棄（field_id 不明と同じ扱い）
    const documentIndex = resolveDocumentIndex(
      parsed.data.document_index,
      parsed.data.quote !== null,
      documentCount,
    );
    if (documentIndex === null) {
      rejected.push({
        index,
        reason: 'invalid_document_index',
        detail: `document_index "${String(parsed.data.document_index)}" が文書数（${documentCount}）と整合しません（quote があるのに欠落・範囲外）`,
        raw: element,
      });
      return;
    }
    const forcedLowReasons = detectContradictions(parsed.data);
    items.push({
      fieldId: parsed.data.field_id,
      entityKey,
      value: parsed.data.value,
      notReported: parsed.data.not_reported,
      quote: parsed.data.quote,
      page: parsed.data.page,
      documentIndex,
      confidence: forcedLowReasons.length > 0 ? 'low' : parsed.data.confidence,
      forcedLowReasons,
      box: validateBox(parsed.data.box_2d),
    });
  });
  return { items, rejected };
}
