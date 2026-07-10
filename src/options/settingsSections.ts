// 設定（BYOK API キー / 既定モデル / 表示言語）の本文マークアップ生成。
// options.html（独立ページ）とアプリ内 #/options（settingsView）の双方から使う
// 単一の正典（ID は bootstrapOptions が querySelector で解決する）。
import { el } from '../app/ui/dom';

/**
 * 設定本文の各節（Gemini / OpenRouter / 既定モデル / 表示言語）を組み立てて返す。
 * 配線（読み込み・保存）は bootstrapOptions が担い、ここは静的な DOM のみを作る。
 */
export function buildSettingsSections(): HTMLElement {
  const body = el('div', { className: 'settings__body' });

  // Gemini API キー
  const geminiSection = el('section', { className: 'options__section' }, [
    el('h2', { text: 'Gemini API キー（BYOK）' }),
    el('p', {
      className: 'options__help',
      text: 'API キーはこの端末の chrome.storage にのみ保存され、開発者へ送信されることはありません。',
    }),
    el('p', { id: 'options-status', className: 'options__status', text: '読み込み中…' }),
    el('div', { className: 'options__row' }, [
      el('label', { text: 'Gemini API キー', attributes: { for: 'gemini-api-key' } }),
      el('input', {
        id: 'gemini-api-key',
        attributes: { type: 'password', autocomplete: 'off' },
      }),
      el('button', { id: 'save-keys', text: '保存', attributes: { type: 'button' } }),
    ]),
  ]);
  body.append(geminiSection);

  // OpenRouter API キー
  const openrouterHelp = el('p', { className: 'options__help' });
  openrouterHelp.append(
    'OpenRouter 経由のモデル（qwen / deepseek 等）を使う場合に設定します。キーは ',
    el('a', {
      text: 'openrouter.ai/settings/keys',
      attributes: {
        href: 'https://openrouter.ai/settings/keys',
        target: '_blank',
        rel: 'noreferrer',
      },
    }),
    ' で取得できます。この端末の chrome.storage にのみ保存されます。',
  );
  const openrouterSection = el('section', { className: 'options__section' }, [
    el('h2', { text: 'OpenRouter API キー（BYOK）' }),
    openrouterHelp,
    el('p', { id: 'openrouter-status', className: 'options__status', text: '読み込み中…' }),
    el('div', { className: 'options__row' }, [
      el('label', { text: 'OpenRouter API キー', attributes: { for: 'openrouter-api-key' } }),
      el('input', {
        id: 'openrouter-api-key',
        attributes: { type: 'password', autocomplete: 'off' },
      }),
      el('button', {
        id: 'save-openrouter-key',
        text: '保存',
        attributes: { type: 'button' },
      }),
    ]),
  ]);
  body.append(openrouterSection);

  // LLM 接続方式（Gemini / OpenRouter / OpenAI 互換 API）
  const providerSelect = el('select', {
    id: 'llm-provider',
    attributes: { 'aria-label': 'LLM 接続方式' },
  });
  providerSelect.append(
    el('option', { text: 'Gemini', attributes: { value: 'gemini' } }),
    el('option', { text: 'OpenRouter', attributes: { value: 'openrouter' } }),
    el('option', { text: 'OpenAI 互換 API', attributes: { value: 'openai_compatible' } }),
  );
  const customFields = el('div', { id: 'openai-compatible-fields' }, [
    el('p', {
      className: 'options__help',
      text: '論文本文と抽出プロンプトは、ここで指定した接続先へブラウザから直接送信されます。',
    }),
    el('div', { className: 'options__row' }, [
      el('label', {
        text: 'API エンドポイント',
        attributes: { for: 'openai-compatible-endpoint' },
      }),
      el('input', {
        id: 'openai-compatible-endpoint',
        attributes: {
          type: 'url',
          placeholder: 'https://example.org/v1/chat/completions',
          autocomplete: 'off',
        },
      }),
    ]),
    el('div', { className: 'options__row' }, [
      el('label', {
        text: 'API キー',
        attributes: { for: 'openai-compatible-api-key' },
      }),
      el('input', {
        id: 'openai-compatible-api-key',
        attributes: { type: 'password', autocomplete: 'off' },
      }),
    ]),
  ]);
  customFields.hidden = true;
  const connectionSection = el('section', { className: 'options__section' }, [
    el('h2', { text: 'LLM 接続先' }),
    el('p', {
      className: 'options__help',
      text: '保存した接続方式はモデル名より優先されます。OpenAI 互換 API は HTTPS、Bearer 認証、JSON Schema 対応が必要です。',
    }),
    el('p', {
      id: 'llm-connection-status',
      className: 'options__status',
      text: '読み込み中…',
    }),
    el('div', { className: 'options__row' }, [
      el('label', { text: '接続方式', attributes: { for: 'llm-provider' } }),
      providerSelect,
    ]),
    customFields,
    el('div', { className: 'options__actions' }, [
      el('button', {
        id: 'save-llm-connection',
        text: '接続設定を保存',
        attributes: { type: 'button' },
      }),
      el('button', {
        id: 'test-llm-connection',
        text: '接続テスト',
        attributes: { type: 'button' },
      }),
    ]),
  ]);
  body.append(connectionSection);

  // 既定モデル
  const modelSection = el('section', { className: 'options__section' }, [
    el('h2', { text: '既定モデル' }),
    el('p', {
      className: 'options__help',
      text: '単価表にないモデルはコスト概算が表示されません。',
    }),
    el('p', { id: 'default-model-status', className: 'options__status', text: '読み込み中…' }),
    el('div', { className: 'options__row' }, [
      el('label', { text: '既定モデル', attributes: { for: 'default-model' } }),
      el('span', { id: 'default-model-container' }),
      el('button', {
        id: 'save-default-model',
        text: '保存',
        attributes: { type: 'button' },
      }),
    ]),
  ]);
  body.append(modelSection);

  // 表示言語（MVP は ja 固定）
  const languageSelect = el('select', {
    id: 'ui-language',
    attributes: { disabled: 'true' },
  });
  languageSelect.append(el('option', { text: '日本語（MVP は ja 固定）', attributes: { selected: 'true' } }));
  const languageSection = el('section', { className: 'options__section' }, [
    el('h2', { text: '表示言語' }),
    el('div', { className: 'options__row' }, [
      el('label', { text: '言語', attributes: { for: 'ui-language' } }),
      languageSelect,
    ]),
  ]);
  body.append(languageSection);

  return body;
}
