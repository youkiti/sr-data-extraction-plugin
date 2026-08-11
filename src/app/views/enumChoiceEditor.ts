// enum 項目の値入力 UI（issue #254・ui-states.md §3 `#/verify`）。
// 判定画面（verificationCellCard の renderEditor）と裁定画面（adjudicateView の第 3 の値入力）の
// 双方から呼ぶ共有コンポーネント — 両者にチップ描画をコピペすると issue #38 で
// verificationCellCard を切り出した判断に逆行するため、ここへ切り出す。
//
// 判定規則そのもの（許容値のパース・許容値外判定・候補の絞り込み）は DOM を持たない
// features/verification/enumOptions.ts が正典で、本モジュールは描画と操作だけを担う
import type { SchemaField } from '../../domain/schemaField';
import {
  ENUM_CHIP_MAX,
  isOutOfAllowedValues,
  parseAllowedValues,
} from '../../features/verification/enumOptions';
import { t } from '../../lib/i18n';
import { el } from '../ui/dom';

export interface EnumChoiceEditorOptions {
  field: SchemaField;
  /**
   * 修正の初期値（null = 空欄から）。許容値外のときは「その他（自由入力）」側を開いた状態で
   * この値を保持する（既存値を失わせない。ui-states.md §3）
   */
  currentValue: string | null;
  /**
   * 「その他」の `<datalist>` に出す候補（同項目の過去入力のうち許容値外のもの）。
   * 呼び出し側が enumOptions.collectOtherValues で作る
   */
  candidates: readonly string[];
  /** 入力欄の aria-label（呼び出し側の文脈に合わせた文言） */
  ariaLabel: string;
  /** 確定ボタンのラベル（判定画面はモード別、裁定画面は「入力して確定」） */
  confirmLabel: string;
  onConfirm(value: string): void;
  /**
   * キャンセル（判定画面の編集モードから抜ける操作）。**省略可** — S12 裁定は入力欄が常時表示で
   * 「編集モードから抜ける」概念が無いため渡さない。省略時はキャンセルボタンを出さず、
   * `Escape` も何もしない
   */
  onCancel?: () => void;
}

/**
 * `<datalist>` の id は**モジュール内連番**にする。S12 裁定は全 visible セルの入力欄を同時に
 * 描画し、同じ field_id が複数 entity_key へ展開されるため（cellMatch の展開規則）、
 * field_id 由来の id にすると必ず衝突して axe の `duplicate-id` 違反になる
 */
let datalistSeq = 0;

/** テスト専用: 連番をリセットして id を決定的にする */
export function resetEnumDatalistSeq(): void {
  datalistSeq = 0;
}

/** 「その他（自由入力）」の入力欄 + 候補 datalist + 確定 / キャンセル */
function renderOtherInput(
  options: EnumChoiceEditorOptions,
  initialValue: string,
  datalistValues: readonly string[],
  onBack: (() => void) | null,
): HTMLElement[] {
  const children: HTMLElement[] = [];
  const attributes: Record<string, string> = { type: 'text', 'aria-label': options.ariaLabel };
  if (datalistValues.length > 0) {
    datalistSeq += 1;
    const listId = `enum-choice-list-${datalistSeq}`;
    attributes['list'] = listId;
    children.push(
      el(
        'datalist',
        { id: listId },
        datalistValues.map((value) => {
          const option = el('option');
          option.value = value;
          return option;
        }),
      ),
    );
  }
  const input = el('input', { className: 'verify__edit-input', attributes }) as HTMLInputElement;
  input.value = initialValue;
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      options.onConfirm(input.value);
    } else if (event.key === 'Escape') {
      options.onCancel?.();
    }
  });
  const confirm = el('button', {
    className: 'verify__edit-confirm',
    text: options.confirmLabel,
    attributes: { type: 'button' },
  });
  confirm.addEventListener('click', () => options.onConfirm(input.value));

  children.unshift(input);
  children.push(confirm);
  if (onBack !== null) {
    const back = el('button', {
      className: 'verify__enum-back',
      text: t('verify.enumBackToChoices'),
      attributes: { type: 'button' },
    });
    back.addEventListener('click', onBack);
    children.push(back);
  }
  const cancel = renderCancelButton(options);
  if (cancel !== null) {
    children.push(cancel);
  }
  return children;
}

/** キャンセルボタン（onCancel を渡さない呼び出し元 = S12 裁定では出さない） */
function renderCancelButton(options: EnumChoiceEditorOptions): HTMLElement | null {
  const { onCancel } = options;
  if (onCancel === undefined) {
    return null;
  }
  const cancel = el('button', {
    className: 'verify__edit-cancel',
    text: t('common.cancel'),
    attributes: { type: 'button' },
  });
  cancel.addEventListener('click', () => onCancel());
  return cancel;
}

/** 許容値チップ列（クリック or 数字キー 1〜9 で確定）+ 「その他（自由入力）」+ キャンセル */
function renderChips(
  options: EnumChoiceEditorOptions,
  allowed: readonly string[],
  onOther: () => void,
): HTMLElement[] {
  const chips = allowed.map((value, index) => {
    // 既定選択は置かない（automation bias 対策の「1 操作必須」。requirements.md §4.2）。
    // そのため現在値のチップにも aria-pressed / aria-current は付けない — 前者はトグル用で
    // 「既定選択を置かない」方針と衝突し、後者は「関連項目集合の現在項目」用で即時確定
    // ボタンには不適
    const chip = el(
      'button',
      {
        className: 'verify__enum-chip',
        attributes: { type: 'button', 'aria-label': value, title: `${index + 1}: ${value}` },
      },
      [
        el('span', {
          className: 'verify__enum-chip-key',
          attributes: { 'aria-hidden': 'true' },
          text: String(index + 1),
        }),
        el('span', { className: 'verify__enum-chip-value', text: value }),
      ],
    );
    chip.addEventListener('click', () => options.onConfirm(value));
    return chip;
  });
  const other = el('button', {
    className: 'verify__enum-chip verify__enum-chip--other',
    text: t('verify.enumOther'),
    attributes: { type: 'button' },
  });
  other.addEventListener('click', onOther);

  const group = el(
    'div',
    {
      className: 'verify__enum-choices',
      attributes: {
        role: 'group',
        'aria-label': t('verify.enumChooseAria', { label: options.field.fieldLabel }),
      },
    },
    [...chips, other],
  );
  // 数字キーはグローバルの判定ショートカット（verificationPanel.handleKeydown）へは届かない
  // （editing !== null で早期 return し、さらに target が input/textarea/select でも return する）。
  // チップ列のローカル keydown で拾う（ui-flow.md §7）
  group.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (event.key === 'Escape') {
      options.onCancel?.();
      return;
    }
    const index = Number(event.key) - 1;
    if (Number.isInteger(index) && index >= 0 && index < allowed.length) {
      event.preventDefault();
      options.onConfirm(allowed[index] as string);
    }
  });

  const children: HTMLElement[] = [
    group,
    el('p', { className: 'verify__enum-hint', text: t('verify.enumHint') }),
  ];
  const cancel = renderCancelButton(options);
  if (cancel !== null) {
    children.push(cancel);
  }
  return children;
}

/**
 * enum 項目の値入力エディタ。**enum でない・許容値が取れない項目では null を返す**ので、
 * 呼び出し側は従来の自由入力 UI へフォールバックすること。
 *
 * 内部モードは 'chips' | 'other' の 2 つ。初期モードは
 * - 許容値が ENUM_CHIP_MAX を超える → 'other'（許容値 + 候補を datalist に入れる。戻る導線なし）
 * - 現在値が許容値外 → 'other'（既存値を保持。戻る導線あり）
 * - それ以外 → 'chips'
 */
export function renderEnumChoiceEditor(options: EnumChoiceEditorOptions): HTMLElement | null {
  const parsed = parseAllowedValues(options.field);
  if (parsed === null) {
    return null;
  }
  // 巻き上げられる関数宣言（otherChildren / showChips）の中では `parsed` の null 除外narrowing が
  // 効かないため、非 null 型の別名へ束ね直す
  const allowed: readonly string[] = parsed;
  const container = el('div', { className: 'verify__editor verify__editor--enum' });
  const chipsAvailable = allowed.length <= ENUM_CHIP_MAX;
  const currentValue = options.currentValue ?? '';

  function otherChildren(): HTMLElement[] {
    // チップ列から降りてきた「その他」は許容値をあえて候補に入れない（選び直すならチップへ戻る）。
    // 許容値が多すぎてチップを出せないフォールバックのときだけ、許容値も候補に含める
    const datalistValues = chipsAvailable
      ? options.candidates
      : [...allowed, ...options.candidates.filter((value) => !allowed.includes(value))];
    return renderOtherInput(
      options,
      currentValue,
      datalistValues,
      chipsAvailable ? showChips : null,
    );
  }
  function showChips(): void {
    container.replaceChildren(...renderChips(options, allowed, showOther));
    container.querySelector<HTMLElement>('.verify__enum-chip')?.focus();
  }
  function showOther(): void {
    container.replaceChildren(...otherChildren());
    container.querySelector<HTMLElement>('.verify__edit-input')?.focus();
  }

  // 初期描画では focus を奪わない（着地先は呼び出し側の onStartEdit が決める）ため、
  // showChips / showOther ではなく子要素の組み立てだけを行う
  const startsInOther = !chipsAvailable || isOutOfAllowedValues(options.field, options.currentValue);
  container.replaceChildren(
    ...(startsInOther ? otherChildren() : renderChips(options, allowed, showOther)),
  );
  return container;
}

/** 許容値外の警告文（形態 A の本文・形態 B の aria-label / title に使う共通文言） */
export function allowedValuesWarningText(field: SchemaField, value: string | null): string | null {
  if (value === null || !isOutOfAllowedValues(field, value)) {
    return null;
  }
  // isOutOfAllowedValues が true = 許容値が取れている（parseAllowedValues は非 null）
  const allowed = parseAllowedValues(field) as string[];
  return t('verify.enumOutOfRange', { value, allowed: allowed.join(' / ') });
}

/**
 * 形態 A: 警告文 + スキーマ画面への導線。詳細セルカード（renderCell）・S12 の裁定済みセルで使う。
 * `#/schema` リンクは **owner のみ**（reviewer 系 3 ロールは `#/home` / `#/verify` 以外へ
 * 遷移できないため〔app/guards.ts〕、非 owner に出すとガードで弾かれる死んだリンクになる）。
 * 該当しなければ null（描画しない）
 */
export function renderAllowedValuesNote(
  field: SchemaField,
  value: string | null,
  canEditSchema: boolean,
): HTMLElement | null {
  const message = allowedValuesWarningText(field, value);
  if (message === null) {
    return null;
  }
  const children: HTMLElement[] = [el('p', { className: 'verify__enum-out-of-range-text', text: message })];
  if (canEditSchema) {
    const link = el('a', {
      className: 'verify__enum-out-of-range-link',
      text: t('verify.enumOutOfRangeLink'),
      attributes: { href: '#/schema' },
    });
    children.push(link);
  }
  return el(
    'div',
    { className: 'verify__enum-out-of-range', attributes: { role: 'note' } },
    children,
  );
}

/**
 * 形態 B: 非対話バッジ。フォーカスモードのマトリクスボタン・判定済みコンパクト行のように
 * 要素自体が `<button>` の場所で使う（`<a>` を入れ子にすると axe の `nested-interactive`
 * 違反になるため）。**出す / 出さないの判断と警告文の取得は呼び出し側が
 * `allowedValuesWarningText` で行い**、親ボタンの aria-label / title へ連結する
 * （#65 / #61 のバッジと同じパターン）
 */
export function renderAllowedValuesBadge(): HTMLElement {
  return el('span', {
    className: 'verify__enum-badge',
    attributes: { 'aria-hidden': 'true' },
    text: '⚠',
  });
}
