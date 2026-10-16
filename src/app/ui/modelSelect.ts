// モデル選択の共有ウィジェット（docs/ui-states.md §2「モデルセレクタ」）。
// 入力中は通知せず、候補の選択や入力の確定で通知する。
import { buildModelCatalog, buildModelCatalogFor, type ModelCatalogGroup } from '../../lib/llm/modelCatalog';
import { t } from '../../lib/i18n';
import type { AppState } from '../store';

/** 保存済み接続方式と取得済みモデルから画面の候補を組み立てる。 */
export function buildModelCatalogForState(state: AppState): readonly ModelCatalogGroup[] {
  const provider = state.llmProviderOverride;
  return buildModelCatalogFor(provider, provider === null ? [] : state.fetchedModelIds[provider] ?? []);
}

export interface ModelSelectOptions {
  /** 入力欄の id（例: 'schema-model'） */
  id: string;
  /** 入力欄の aria-label */
  ariaLabel: string;
  /** 現在のモデル文字列（'' = 未選択） */
  value: string;
  /** 空欄時の表示文言 */
  placeholderLabel: string;
  /** 確定時に trim したモデル文字列（'' 含む）を通知する */
  onChange: (model: string) => void;
  className?: string;
  groups?: readonly ModelCatalogGroup[];
}

/** 候補付き入力欄を生成し、現在値をそのまま復元する。 */
export function createModelSelect(doc: Document, opts: ModelSelectOptions): HTMLElement {
  const container = doc.createElement('span');
  container.className =
    opts.className === undefined ? 'model-select' : `model-select ${opts.className}`;
  const input = doc.createElement('input');
  input.id = opts.id;
  input.type = 'text';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', `${opts.id}-listbox`);
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-label', opts.ariaLabel);
  input.autocomplete = 'off';
  input.placeholder = opts.placeholderLabel;
  input.value = opts.value;
  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.textContent = '▾';
  toggle.setAttribute('aria-label', t('modelSelect.showOptions'));
  const list = doc.createElement('ul');
  list.id = `${opts.id}-listbox`;
  list.className = 'model-select__list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', opts.ariaLabel);
  list.hidden = true;
  const groups = opts.groups ?? buildModelCatalog();
  let rows: HTMLElement[] = [];
  let active = -1;
  let lastNotified: string | undefined;
  const observer = new MutationObserver(() => {
    if (!container.isConnected) {
      close();
    }
  });

  /** 外部 listener と監視を開いている間だけ保持する。 */
  function close(): void {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    doc.removeEventListener('mousedown', outside);
    observer.disconnect();
  }

  /** 部品外のクリックで候補を閉じる。 */
  function outside(event: MouseEvent): void {
    if (!container.contains(event.target as Node)) {
      close();
    }
  }

  /** キーボードの移動先を読み上げとスクロールに反映する。 */
  function activate(index: number): void {
    active = index;
    rows.forEach((row, i) => row.classList.toggle('model-select__option--active', i === active));
    const row = rows[active];
    if (row) {
      input.setAttribute('aria-activedescendant', row.id);
      row.scrollIntoView?.({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  /** 候補を描き直す。初回は現在値で絞り込まない。 */
  function render(query: string): void {
    list.replaceChildren();
    rows = [];
    for (const group of groups) {
      const models = group.models.filter((model) => model.toLowerCase().includes(query.toLowerCase()));
      if (models.length === 0) {
        continue;
      }
      const heading = doc.createElement('li');
      heading.className = 'model-select__heading';
      heading.setAttribute('role', 'presentation');
      heading.textContent = group.kind === 'fetched' ? t('options.fetchedModels') : t('modelSelect.priceList');
      list.append(heading);
      for (const model of models) {
        const row = doc.createElement('li');
        row.id = `${opts.id}-candidate-${rows.length}`;
        row.className = 'model-select__option';
        row.dataset.value = model;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(model === input.value));
        const mark = doc.createElement('span');
        mark.className = 'model-select__mark';
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = model === input.value ? '✓' : '';
        row.append(mark, model);
        row.addEventListener('mousedown', (event) => event.preventDefault());
        row.addEventListener('click', () => {
          input.value = model;
          close();
          lastNotified = model.trim();
          opts.onChange(lastNotified);
        });
        rows.push(row);
        list.append(row);
      }
    }
    if (rows.length === 0) {
      const empty = doc.createElement('li');
      empty.className = 'model-select__heading';
      empty.setAttribute('role', 'presentation');
      empty.textContent = t('modelSelect.noOptions');
      list.append(empty);
    }
    activate(rows.findIndex((row) => row.dataset.value === input.value));
  }

  /** 初回表示と外部イベントの購読をまとめる。 */
  function open(): void {
    if (!list.hidden) {
      return;
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    render('');
    doc.addEventListener('mousedown', outside);
    observer.observe(doc, { childList: true, subtree: true });
  }

  /** Enter 後の blur による重複通知を防ぐ。 */
  function commit(): void {
    const value = input.value.trim();
    close();
    if (value !== lastNotified) {
      lastNotified = value;
      opts.onChange(value);
    }
  }
  // フォーカスだけでは開かない。S5〜S7 は確定のたびに部品を作り直し、フォーカスを戻すため
  // （preserveFocus）、フォーカスで開くと閉じたはずのリストが開き直して下の実行ボタンを覆う
  input.addEventListener('click', open);
  input.addEventListener('input', () => {
    open();
    render(input.value);
  });
  input.addEventListener('change', commit);
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.hidden) {
        open();
      } else {
        const next = active + (event.key === 'ArrowDown' ? 1 : -1);
        activate(Math.max(0, Math.min(rows.length - 1, next)));
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[active];
      if (!list.hidden && row) {
        row.click();
      } else {
        commit();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  toggle.addEventListener('mousedown', (event) => event.preventDefault());
  toggle.addEventListener('click', () => {
    if (list.hidden) {
      input.focus();
      open();
    } else {
      close();
    }
  });
  render('');
  container.append(input, toggle, list);
  return container;
}
