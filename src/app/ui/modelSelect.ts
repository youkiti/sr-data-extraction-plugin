// モデル選択の共有ウィジェット（docs/ui-states.md §2「モデルセレクタ」）。
// 入力中は通知せず、候補の選択や入力の確定を change で通知する。
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
  input.setAttribute('list', `${opts.id}-options`);
  input.setAttribute('aria-label', opts.ariaLabel);
  input.autocomplete = 'off';
  input.placeholder = opts.placeholderLabel;
  input.value = opts.value;
  const datalist = doc.createElement('datalist');
  datalist.id = `${opts.id}-options`;
  for (const group of opts.groups ?? buildModelCatalog()) {
    for (const model of group.models) {
      const option = doc.createElement('option');
      option.value = model;
      option.label = group.label === t('options.fetchedModels')
        ? t('options.fetchedModels')
        : t('modelSelect.priceList');
      datalist.append(option);
    }
  }
  input.addEventListener('change', () => {
    opts.onChange(input.value.trim());
  });
  container.append(input, datalist);
  return container;
}
