// enum 項目の許容値まわりの純ロジック（issue #254・requirements.md §4.2）。
// DOM を持たないため、判定画面（verificationCellCard）と裁定画面（adjudicateView）の双方から
// 同じ規則で使える。DOM 側は app/views/enumChoiceEditor.ts が担う
import { NOT_REPORTED_TOKEN, type AnnotatorType } from '../../domain/annotation';
import type { Decision } from '../../domain/decision';
import type { SchemaField } from '../../domain/schemaField';

/**
 * チップ列で並べる許容値の上限。これを超える項目はチップ列を出さず
 * `<datalist>` 付き入力へフォールバックする（横に伸びて扱いづらくなるため）。
 * 数字キー `1`〜`9` の割当と同数にしてあり、チップ列が出るときは必ず全チップに
 * キーが割り当たる（ui-flow.md §7）
 */
export const ENUM_CHIP_MAX = 9;

/**
 * 許容値の一覧（`|` 区切り）。enum 以外・許容値なしは null。
 * S5 の `validateField` が「enum は `|` 区切りで 2 つ以上」を強制しているため保存済み
 * スキーマは常にパースできるが、旧版データ・手書きシートに備えて空要素は落とし、
 * 結果が空になるときも null を返す（呼び出し側は従来の自由入力へフォールバックする）
 */
export function parseAllowedValues(field: SchemaField): string[] | null {
  if (field.dataType !== 'enum' || field.allowedValues === null) {
    return null;
  }
  const values: string[] = [];
  for (const raw of field.allowedValues.split('|')) {
    const value = raw.trim();
    if (value !== '' && !values.includes(value)) {
      values.push(value);
    }
  }
  return values.length === 0 ? null : values;
}

/**
 * 確定値が許容値の外かどうか（「許容値外」警告の判定）。
 * 未入力（null / 空文字）と未報告トークン（`NR`）は対象外 — `not_reported` は専用操作であり
 * 許容値に混ぜない設計のため、素朴に含有判定すると enum の未報告セル全件へ誤警告が出る。
 * enum 以外・許容値なしの項目も常に false
 */
export function isOutOfAllowedValues(field: SchemaField, value: string | null): boolean {
  if (value === null || value === '' || value === NOT_REPORTED_TOKEN) {
    return false;
  }
  const allowed = parseAllowedValues(field);
  return allowed !== null && !allowed.includes(value);
}

/**
 * 候補値のうち「その項目の許容値外」のものだけを重複なく（初出順で）返す。
 * 「その他（自由入力）」の `<datalist>` に出す候補で、`low risk` と打った人が次も同じ綴りを
 * 選べるようにして表記ゆれの量産を防ぐのが狙い（許容値そのものはチップ列に出るため除く）
 */
export function collectOtherValues(field: SchemaField, rawValues: readonly string[]): string[] {
  const values: string[] = [];
  for (const raw of rawValues) {
    if (isOutOfAllowedValues(field, raw) && !values.includes(raw)) {
      values.push(raw);
    }
  }
  return values;
}

/**
 * 判定履歴から field_id 単位の過去入力値を集める（「その他」の候補素材）。
 *
 * **`annotator` と `annotatorType` の両方の完全一致で絞る**（`startsWith('human_')` のような
 * 緩い絞りは不可）。`accept` は AI 値をそのまま `Decision.value` へ保存し、同一 email は
 * モードを変更できるため、緩く絞ると `with_ai` 時代の AI 値が `independent` の候補に現れて
 * 独立二重レビューの盲検が破れる（design §5.2）。
 *
 * なお、セル現在値・編集初期値・進捗・群構成といった**他の経路**が `annotator`（email）だけで
 * 絞っている既存の穴は本 issue のスコープ外で、issue #255 が扱う。ここで保証するのは
 * 「候補リストに漏れない」ことだけ
 */
export function buildEnumCandidates(
  decisions: readonly Decision[],
  annotator: string,
  annotatorType: AnnotatorType,
): Map<string, string[]> {
  const byField = new Map<string, string[]>();
  for (const decision of decisions) {
    if (decision.annotator !== annotator || decision.annotatorType !== annotatorType) {
      continue;
    }
    const { value } = decision;
    if (value === null || value === '' || value === NOT_REPORTED_TOKEN) {
      continue;
    }
    const values = byField.get(decision.fieldId);
    if (values === undefined) {
      byField.set(decision.fieldId, [value]);
    } else if (!values.includes(value)) {
      values.push(value);
    }
  }
  return byField;
}
