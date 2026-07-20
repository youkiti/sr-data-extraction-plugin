// estimate 別 RoB オーバーライド（issue #109）のドメイン解決。
// - 宣言フォームのドメインセレクタ: 挿入済み RoB ツールのテンプレート定義から全ドメインを列挙
//   （ツール非依存。robFields.activeRobToolFieldSets が唯一の情報源）
// - セル展開: オーバーライドインスタンスには「当該ドメインの判定 + 根拠 + そのドメインの
//   SQ / prompting item」だけを field として展開する（base の全 field 直積と異なり、
//   宣言したドメインに属さない field セルをばら撒かない — ui-states.md #/verify）
import type { SchemaField } from '../../domain/schemaField';
import {
  activeRobToolFieldSets,
  type RobDomainDefinition,
} from '../export/rset/robFields';
import {
  QUADAS3_SQ_FIELD_NAMES,
  QUIPS_ITEM_FIELD_NAMES,
  ROB2_SQ_FIELD_NAMES,
  ROBINS_I_SQ_FIELD_NAMES,
} from '../schema/presets/robTemplates';

export type { RobDomainDefinition } from '../export/rset/robFields';

/**
 * ツール名 → （ドメイン id → SQ / prompting item の field_name 一覧）。
 * quadas3_applicability は SQ を持たない（SQ は risk-of-bias 側の所属）ため載せない
 */
const SQ_FIELD_NAMES_BY_TOOL: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  rob2: ROB2_SQ_FIELD_NAMES,
  robins_i: ROBINS_I_SQ_FIELD_NAMES,
  quadas3: QUADAS3_SQ_FIELD_NAMES,
  quips: QUIPS_ITEM_FIELD_NAMES,
};

/**
 * 宣言フォームのドメインセレクタに出す全ドメイン（挿入済みツールのテンプレート定義から列挙。
 * QUADAS-3 の risk-of-bias / applicability のように同一 id を共有するツールは初出だけ残す）
 */
export function robDomainOptions(fields: readonly SchemaField[]): RobDomainDefinition[] {
  const seen = new Set<string>();
  const options: RobDomainDefinition[] = [];
  for (const set of activeRobToolFieldSets(fields)) {
    for (const domain of set.domains) {
      if (!seen.has(domain.id)) {
        seen.add(domain.id);
        options.push(domain);
      }
    }
  }
  return options;
}

/**
 * estimate 別オーバーライドインスタンスへ展開する field_name 集合。
 * 当該ドメインを持つ全ツールの判定 + 根拠 + そのドメインの SQ / prompting item の和集合
 * （QUADAS-3 は risk-of-bias / applicability の両判定が同一ドメイン id を共有する）。
 * どの挿入済みツールにも属さないドメイン id は null（呼び出し側は base と同じ全 field 展開）
 */
export function robOverrideFieldNames(
  domainId: string,
  fields: readonly SchemaField[],
): ReadonlySet<string> | null {
  const sets = activeRobToolFieldSets(fields).filter((set) =>
    set.domains.some((domain) => domain.id === domainId),
  );
  if (sets.length === 0) {
    return null;
  }
  const names = new Set<string>();
  for (const set of sets) {
    names.add(set.judgementFieldName);
    names.add(set.supportFieldName);
    for (const name of SQ_FIELD_NAMES_BY_TOOL[set.tool]?.[domainId] ?? []) {
      names.add(name);
    }
  }
  return names;
}
