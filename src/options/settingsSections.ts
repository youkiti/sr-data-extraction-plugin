// 設定（BYOK API キー / 既定モデル / 表示言語）の本文マークアップ生成。
// options.html（独立ページ）とアプリ内 #/options（settingsView）の双方から使う
// 単一の正典（ID は bootstrapOptions が querySelector で解決する）。
import { el } from '../app/ui/dom';
import { t } from '../lib/i18n';
import { RATE_LIMIT_TIERS } from '../lib/llm/rateLimitPolicy';

/**
 * 設定本文の各節（Gemini / OpenRouter / 既定モデル / レート制限 / 表示言語）を組み立てて返す。
 * 配線（読み込み・保存）は bootstrapOptions が担い、ここは静的な DOM のみを作る。
 */
export function buildSettingsSections(): HTMLElement {
  const body = el('div', { className: 'settings__body' });

  // Gemini API キー
  const geminiSection = el('section', { className: 'options__section' }, [
    el('h2', { text: t('options.geminiTitle') }),
    el('p', {
      className: 'options__help',
      text: t('options.geminiHelp'),
    }),
    el('p', { id: 'options-status', className: 'options__status', text: t('common.loading') }),
    el('div', { className: 'options__row' }, [
      el('label', { text: t('options.geminiLabel'), attributes: { for: 'gemini-api-key' } }),
      el('input', {
        id: 'gemini-api-key',
        attributes: { type: 'password', autocomplete: 'off' },
      }),
      el('button', { id: 'save-keys', text: t('options.save'), attributes: { type: 'button' } }),
    ]),
  ]);
  body.append(geminiSection);

  // OpenRouter API キー
  const openrouterHelp = el('p', { className: 'options__help' });
  openrouterHelp.append(
    t('options.openrouterHelpPrefix'),
    el('a', {
      text: 'openrouter.ai/settings/keys',
      attributes: {
        href: 'https://openrouter.ai/settings/keys',
        target: '_blank',
        rel: 'noreferrer',
      },
    }),
    t('options.openrouterHelpSuffix'),
  );
  const openrouterSection = el('section', { className: 'options__section' }, [
    el('h2', { text: t('options.openrouterTitle') }),
    openrouterHelp,
    el('p', { id: 'openrouter-status', className: 'options__status', text: t('common.loading') }),
    el('div', { className: 'options__row' }, [
      el('label', { text: t('options.openrouterLabel'), attributes: { for: 'openrouter-api-key' } }),
      el('input', {
        id: 'openrouter-api-key',
        attributes: { type: 'password', autocomplete: 'off' },
      }),
      el('button', {
        id: 'save-openrouter-key',
        text: t('options.save'),
        attributes: { type: 'button' },
      }),
    ]),
  ]);
  body.append(openrouterSection);

  // LLM 接続方式（Gemini / OpenRouter / OpenAI 互換 API）
  const providerSelect = el('select', {
    id: 'llm-provider',
    attributes: { 'aria-label': t('options.providerAria') },
  });
  providerSelect.append(
    el('option', { text: 'Gemini', attributes: { value: 'gemini' } }),
    el('option', { text: 'OpenRouter', attributes: { value: 'openrouter' } }),
    el('option', { text: t('options.providerOpenAiCompatible'), attributes: { value: 'openai_compatible' } }),
  );
  const customFields = el('div', { id: 'openai-compatible-fields' }, [
    el('p', {
      className: 'options__help',
      text: t('options.compatibleNotice'),
    }),
    el('div', { className: 'options__row' }, [
      el('label', {
        text: t('options.endpointLabel'),
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
        text: t('options.apiKeyLabel'),
        attributes: { for: 'openai-compatible-api-key' },
      }),
      el('input', {
        id: 'openai-compatible-api-key',
        attributes: { type: 'password', autocomplete: 'off' },
      }),
      el('span', {
        className: 'options__help',
        text: t('options.loopbackNote'),
      }),
    ]),
  ]);
  customFields.hidden = true;
  const connectionSection = el('section', { className: 'options__section' }, [
    el('h2', { text: t('options.connectionTitle') }),
    el('p', {
      className: 'options__help',
      text: t('options.connectionHelp'),
    }),
    el('p', {
      id: 'llm-connection-status',
      className: 'options__status',
      text: t('common.loading'),
    }),
    el('div', { className: 'options__row' }, [
      el('label', { text: t('options.providerLabel'), attributes: { for: 'llm-provider' } }),
      providerSelect,
    ]),
    customFields,
    el('div', { className: 'options__actions' }, [
      el('button', {
        id: 'save-llm-connection',
        text: t('options.saveConnection'),
        attributes: { type: 'button' },
      }),
      el('button', {
        id: 'test-llm-connection',
        text: t('options.testConnection'),
        attributes: { type: 'button' },
      }),
    ]),
  ]);
  body.append(connectionSection);

  // 既定モデル
  const modelSection = el('section', { className: 'options__section' }, [
    el('h2', { text: t('options.defaultModelTitle') }),
    el('p', {
      className: 'options__help',
      text: t('options.defaultModelHelp'),
    }),
    el('p', { id: 'default-model-status', className: 'options__status', text: t('common.loading') }),
    el('div', { className: 'options__row' }, [
      el('label', { text: t('options.defaultModelTitle'), attributes: { for: 'default-model' } }),
      el('span', { id: 'default-model-container' }),
      el('button', {
        id: 'save-default-model',
        text: t('options.save'),
        attributes: { type: 'button' },
      }),
    ]),
  ]);
  body.append(modelSection);

  // レート制限 tier（一括抽出の 429 対策。スロットル間隔 + リトライの強さを決める）
  const tierSelect = el('select', {
    id: 'rate-limit-tier',
    attributes: { 'aria-label': t('options.rateLimitTierAria') },
  }) as HTMLSelectElement;
  for (const tier of RATE_LIMIT_TIERS) {
    tierSelect.append(el('option', { text: tier.label, attributes: { value: tier.id } }));
  }
  const rateLimitSection = el('section', { className: 'options__section' }, [
    el('h2', { text: t('options.rateLimitTitle') }),
    el('p', {
      className: 'options__help',
      text: t('options.rateLimitHelp'),
    }),
    el('p', {
      id: 'rate-limit-tier-desc',
      className: 'options__help',
      text: '',
    }),
    el('p', { id: 'rate-limit-status', className: 'options__status', text: t('common.loading') }),
    el('div', { className: 'options__row' }, [
      el('label', { text: t('options.rateLimitTierLabel'), attributes: { for: 'rate-limit-tier' } }),
      tierSelect,
    ]),
    // カスタム tier のときだけ表示する RPM 入力（1 分あたりの最大リクエスト数）
    el('div', { id: 'rate-limit-custom-row', className: 'options__row', attributes: { hidden: 'true' } }, [
      el('label', {
        text: t('options.rateLimitRpmLabel'),
        attributes: { for: 'rate-limit-custom-rpm' },
      }),
      el('input', {
        id: 'rate-limit-custom-rpm',
        attributes: { type: 'number', min: '1', step: '1', inputmode: 'numeric' },
      }),
    ]),
    // カスタム tier のときだけ表示する同時実行数入力（並列化のスループット対策。1 = 逐次）
    el('div', { id: 'rate-limit-concurrency-row', className: 'options__row', attributes: { hidden: 'true' } }, [
      el('label', {
        text: t('options.rateLimitConcurrencyLabel'),
        attributes: { for: 'rate-limit-concurrency' },
      }),
      el('input', {
        id: 'rate-limit-concurrency',
        attributes: { type: 'number', min: '1', step: '1', inputmode: 'numeric', placeholder: '1' },
      }),
    ]),
    el('div', { className: 'options__row' }, [
      el('button', { id: 'save-rate-limit', text: t('options.save'), attributes: { type: 'button' } }),
    ]),
  ]);
  body.append(rateLimitSection);

  // 表示言語（issue #93。change で即時保存 + setUiLanguage の購読者が再描画する。
  // 言語名の option は翻訳しない = 各言語の母語表記で固定）
  const languageSelect = el('select', {
    id: 'ui-language',
    attributes: { 'aria-label': t('options.languageLabel') },
  });
  languageSelect.append(
    el('option', { text: '日本語', attributes: { value: 'ja' } }),
    el('option', { text: 'English', attributes: { value: 'en' } }),
  );
  const languageSection = el('section', { className: 'options__section' }, [
    el('h2', { text: t('options.languageTitle') }),
    el('p', { className: 'options__help', text: t('options.languageHelp') }),
    el('div', { className: 'options__row' }, [
      el('label', { text: t('options.languageLabel'), attributes: { for: 'ui-language' } }),
      languageSelect,
    ]),
  ]);
  body.append(languageSection);

  return body;
}
