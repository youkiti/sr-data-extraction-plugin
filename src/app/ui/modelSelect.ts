// モデル選択の共有ウィジェット（docs/ui-states.md §2「モデルセレクタ」）。
// tiab-review のモデルプルダウンと同じ体験: <select>（Gemini / OpenRouter の optgroup）
// + 「その他（直接入力）」でテキスト入力が現れる。
// 純 DOM 部品（store 非依存・Document を引数で受ける）のため Options からも使う
import { buildModelCatalog, isCatalogModel } from '../../lib/llm/modelCatalog';
import { t } from '../../lib/i18n';

/** 「その他（直接入力）」の option 値。表示切替専用の sentinel で state には漏らさない */
export const MODEL_SELECT_OTHER_VALUE = '__other__';

export interface ModelSelectOptions {
  /** select の id（例: 'schema-model'。テキスト入力は `{id}-custom`） */
  id: string;
  /** select の aria-label（テキスト入力は `{ariaLabel}（直接入力）`） */
  ariaLabel: string;
  /** 現在のモデル文字列（'' = 未選択） */
  value: string;
  /** 先頭 option（value=''）の表示文言（例: '選択してください' / '未設定'） */
  placeholderLabel: string;
  /** 常に素のモデル文字列（'' 含む）を通知する。sentinel は渡さない */
  onChange: (model: string) => void;
  className?: string;
}

/**
 * モデルセレクタを生成する。state の値からの復元は決定的:
 * - '' → プレースホルダ選択・テキスト非表示
 * - 単価表のモデル → 該当 option 選択・テキスト非表示
 * - それ以外 → 「その他」選択 + テキスト表示・値充填
 *   （Options の保存値や S5→S6→S7 の引き継ぎ値が任意文字列でも正しく表示される）
 */
export function createModelSelect(doc: Document, opts: ModelSelectOptions): HTMLElement {
  const container = doc.createElement('span');
  container.className =
    opts.className === undefined ? 'model-select' : `model-select ${opts.className}`;

  const select = doc.createElement('select');
  select.id = opts.id;
  select.setAttribute('aria-label', opts.ariaLabel);

  const placeholder = doc.createElement('option');
  placeholder.value = '';
  placeholder.textContent = opts.placeholderLabel;
  select.append(placeholder);

  for (const group of buildModelCatalog()) {
    const optgroup = doc.createElement('optgroup');
    optgroup.label = group.label;
    for (const model of group.models) {
      const option = doc.createElement('option');
      option.value = model;
      option.textContent = model;
      optgroup.append(option);
    }
    select.append(optgroup);
  }

  const other = doc.createElement('option');
  other.value = MODEL_SELECT_OTHER_VALUE;
  other.textContent = t('modelSelect.other');
  select.append(other);

  const custom = doc.createElement('input');
  custom.id = `${opts.id}-custom`;
  custom.type = 'text';
  custom.setAttribute('aria-label', t('modelSelect.customAria', { label: opts.ariaLabel }));
  custom.placeholder = t('modelSelect.customPlaceholder');
  custom.className = 'model-select__custom';

  // state の値からの決定的な復元（views は毎 render で DOM を作り直すため）
  if (opts.value === '') {
    select.value = '';
    custom.hidden = true;
  } else if (isCatalogModel(opts.value)) {
    select.value = opts.value;
    custom.hidden = true;
  } else {
    select.value = MODEL_SELECT_OTHER_VALUE;
    custom.value = opts.value;
    custom.hidden = false;
  }

  select.addEventListener('change', () => {
    if (select.value === MODEL_SELECT_OTHER_VALUE) {
      // 「その他」へ切替: テキストを表示してフォーカスするだけで通知しない。
      // ここで onChange すると store 再描画で DOM が作り直され選択が state 値へ戻るため、
      // state の更新はテキストの change（確定）まで遅らせる。
      // 確定前に他の操作で再描画されると選択は state 値へ戻る（既知の許容エッジ）
      custom.hidden = false;
      custom.focus();
      return;
    }
    custom.hidden = true;
    opts.onChange(select.value);
  });
  custom.addEventListener('change', () => {
    opts.onChange(custom.value.trim());
  });

  container.append(select, custom);
  return container;
}
