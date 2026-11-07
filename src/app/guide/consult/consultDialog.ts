// 公開ヘルプの端末内検索と、履歴を保存しない一問一答を表示する。
// ストアの再描画から独立した小窓に、公開前の Issue 下書きも置く。
import { getUiLanguage, t } from '../../../lib/i18n';
import { HELP_URL, withUiLanguage } from '../../../lib/publicPages';
import { consultHelp } from '../../../lib/help/consult/consult';
import { createIssueDraft, type IssueEnvironment } from '../../../lib/help/consult/issueDraft';
import { loadHelpSections } from '../../../lib/help/consult/load';
import { CONSULT_MODELS, resolveConsultProvider, type ConsultProviderDeps } from '../../../lib/help/consult/model';
import { searchHelpSections } from '../../../lib/help/consult/search';
import type { ConsultResult, HelpSection } from '../../../lib/help/consult/types';
import { llmProviderLabel } from '../../../lib/llm/modelCatalog';
import type { EnsureAiDataConsent } from '../../../lib/llm/aiDataConsent';
import { loadGeminiApiKey, loadAnthropicApiKey, loadOpenRouterApiKey } from '../../../lib/storage/secretsStore';
import { loadDefaultModel, loadLlmConnectionSettings } from '../../../lib/storage/settingsStore';
import { createChromeAiDataConsentGate } from '../../ui/aiDataConsentDialog';
import { headingWithHelp } from '../../ui/helpButton';

const FAILURE_KEYS = {
  no_key: 'help.consultFailureNoKey',
  rate_limited: 'help.consultFailureRateLimited',
  auth: 'help.consultFailureAuth',
  timeout: 'help.consultFailureTimeout',
  aborted: 'help.consultFailureAborted',
  network: 'help.consultFailureNetwork',
  invalid_response: 'help.consultFailureInvalidResponse',
  unknown: 'help.consultFailureUnknown',
} as const;

export interface ConsultDialogDeps extends ConsultProviderDeps {
  loadSections: typeof loadHelpSections;
  consult: typeof consultHelp;
  ensureAiDataConsent: EnsureAiDataConsent;
  copy: (text: string) => Promise<void>;
  version: () => string;
}

export function createConsultDialogDeps(doc: Document): ConsultDialogDeps {
  return {
    loadApiKey: (provider) => {
      if (provider === 'anthropic') {
        return loadAnthropicApiKey();
      }
      if (provider === 'openrouter') {
        return loadOpenRouterApiKey();
      }
      return loadGeminiApiKey();
    },
    loadDefaultModel,
    loadLlmConnectionSettings,
    loadSections: loadHelpSections,
    consult: consultHelp,
    ensureAiDataConsent: createChromeAiDataConsentGate(doc),
    copy: (text) => navigator.clipboard.writeText(text),
    version: () => {
      try {
        return chrome.runtime.getManifest().version;
      } catch {
        return '';
      }
    },
  };
}

export async function openConsultDialog(doc: Document, deps = createConsultDialogDeps(doc)): Promise<void> {
  const existing = doc.getElementById('help-consult');
  if (existing) {
    existing.focus();
    return;
  }
  const previousFocus = doc.activeElement as HTMLElement | null;
  const lang = getUiLanguage();
  const overlay = doc.createElement('div');
  overlay.className = 'ai-consent';
  const panel = doc.createElement('div');
  panel.id = 'help-consult';
  panel.className = 'ai-consent__panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'help-consult-title');
  panel.tabIndex = -1;
  const heading = headingWithHelp('h2', t('help.consultTitle'), 'help-consult');
  heading.querySelector('h2')!.id = 'help-consult-title';
  const question = doc.createElement('textarea');
  question.id = 'help-consult-question';
  question.maxLength = 1000;
  question.rows = 3;
  const label = doc.createElement('label');
  label.htmlFor = question.id;
  label.textContent = t('help.consultQuestion');
  const output = doc.createElement('div');
  output.setAttribute('aria-live', 'polite');
  const actions = doc.createElement('div');
  const draft = doc.createElement('div');
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  let closed = false;
  let ready = false;
  let busy = false;
  let searched = '';
  let answer = '';
  let errorText = '';
  let sections: HelpSection[] = [];
  let selection: Awaited<ReturnType<typeof resolveConsultProvider>> = null;
  let configuredProviders: string[] = [];
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  function button(action: string, key: Parameters<typeof t>[0], run: () => void): HTMLButtonElement {
    const item = doc.createElement('button');
    item.type = 'button';
    item.dataset.consultAction = action;
    item.textContent = t(key);
    item.addEventListener('click', run);
    return item;
  }
  function paragraph(parent: HTMLElement, text: string): void {
    const item = doc.createElement('p');
    item.textContent = text;
    parent.append(item);
  }
  function links(parent: HTMLElement, items: readonly HelpSection[]): void {
    const list = doc.createElement('ul');
    for (const section of items) {
      const item = doc.createElement('li');
      const link = doc.createElement('a');
      const url = new URL(withUiLanguage(HELP_URL, lang));
      url.hash = section.id;
      link.href = url.toString();
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `${section.sectionTitle}: ${section.title}`;
      item.append(link);
      list.append(item);
    }
    parent.append(list);
  }
  function close(): void {
    closed = true;
    controller?.abort();
    clearInterval(timer);
    overlay.remove();
    doc.removeEventListener('keydown', keydown, true);
    if (previousFocus?.isConnected) {
      previousFocus.focus();
    }
  }
  function keydown(event: KeyboardEvent): void {
    // 後から開いた同意画面の操作を妨げない。
    if (doc.getElementById('ai-data-consent')) {
      return;
    }
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      const items = [...panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]):not([hidden]), textarea:not([disabled])')];
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && (doc.activeElement === first || doc.activeElement === panel)) {
        event.preventDefault();
        last.focus();
      } else if ((!event.shiftKey && doc.activeElement === last) || !panel.contains(doc.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  function showDraft(): void {
    const environment: IssueEnvironment = {
      version: deps.version(), uiLang: lang, screen: doc.location.hash,
      provider: selection?.providerId ?? '',
      model: selection ? CONSULT_MODELS[selection.providerId] : '',
      configuredProviders, errorText,
    };
    const issue = createIssueDraft({ question: searched, answer, environment });
    draft.replaceChildren();
    paragraph(draft, t('help.consultPublicWarning'));
    const preview = doc.createElement('textarea');
    preview.id = 'help-consult-draft';
    preview.readOnly = true;
    preview.rows = 8;
    preview.setAttribute('aria-label', t('help.consultDraft'));
    preview.value = issue.body;
    const link = doc.createElement('a');
    link.href = issue.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = t('help.consultOpenIssue');
    draft.append(preview, link, button('copy', 'help.consultCopy', () => {
      void deps.copy(issue.body).then(() => {
        paragraph(draft, t('help.consultCopied'));
      }).catch(() => {
        paragraph(draft, t('help.consultCopyFailed'));
      });
    }));
    paragraph(draft, t('help.consultNoAccount'));
  }
  function result(value: ConsultResult): void {
    output.replaceChildren();
    if (value.status === 'success') {
      answer = value.answer;
      paragraph(output, answer);
      links(output, sections.filter(section => value.sectionIds.includes(section.id)));
    } else if (value.status === 'no_match') {
      paragraph(output, t('help.consultNoMatch'));
    } else {
      errorText = value.kind;
      paragraph(output, t(FAILURE_KEYS[value.kind]));
    }
  }
  async function ask(): Promise<void> {
    if (busy || !selection) {
      return;
    }
    busy = true;
    askButton.disabled = true;
    search.disabled = true;
    question.disabled = true;
    draft.replaceChildren();
    answer = '';
    errorText = '';
    try {
      if (!(await deps.ensureAiDataConsent(selection.providerId)) || closed) {
        return;
      }
      controller = new AbortController();
      let seconds = 0;
      const update = (): void => {
        status.textContent = t('help.consultWaiting', { seconds });
      };
      update();
      timer = setInterval(() => {
        seconds++;
        update();
      }, 1000);
      stop.hidden = false;
      const value = await deps.consult({ question: searched, lang, sections,
        providerId: selection.providerId, apiKey: selection.apiKey, signal: controller.signal });
      if (!closed) {
        result(value);
      }
    } catch {
      if (!closed) {
        result({ status: 'failure', kind: 'unknown' });
      }
    } finally {
      clearInterval(timer);
      status.textContent = '';
      stop.hidden = true;
      busy = false;
      askButton.disabled = false;
      question.disabled = false;
      search.disabled = question.value.trim() === '';
    }
  }
  const askButton = button('ask', 'help.consultAsk', () => {
    void ask();
  });
  const stop = button('stop', 'help.consultStop', () => {
    controller!.abort();
  });
  stop.hidden = true;
  const search = button('search', 'help.consultSearch', () => {
    searched = question.value.trim().slice(0, 1000);
    answer = '';
    errorText = '';
    draft.replaceChildren();
    output.replaceChildren();
    const matches = searchHelpSections(sections, searched);
    if (matches.length === 0) {
      paragraph(output, t('help.consultNotFound'));
    } else {
      links(output, matches);
    }
    actions.replaceChildren();
    if (selection) {
      const provider = doc.createElement('small');
      provider.textContent = `${llmProviderLabel(selection.providerId)} / ${CONSULT_MODELS[selection.providerId]}`;
      actions.append(askButton, provider);
    } else {
      paragraph(actions, t('help.consultNoKey'));
    }
    actions.append(button('draft', 'help.consultDraft', showDraft));
  });
  search.disabled = true;
  question.addEventListener('input', () => {
    search.disabled = busy || !ready || question.value.trim() === '';
    actions.replaceChildren();
    draft.replaceChildren();
    output.replaceChildren();
  });
  panel.append(heading, label, question, search, output, actions, status, stop, draft,
    button('close', 'help.consultClose', close));
  overlay.append(panel);
  doc.body.append(overlay);
  doc.addEventListener('keydown', keydown, true);
  panel.focus();
  try {
    const providers = Object.keys(CONSULT_MODELS) as (keyof typeof CONSULT_MODELS)[];
    const loaded = await Promise.all([
      deps.loadSections(lang), resolveConsultProvider(deps),
      Promise.all(providers.map(async provider => await deps.loadApiKey(provider) ? provider : null)),
    ]);
    sections = loaded[0];
    selection = loaded[1];
    configuredProviders = loaded[2].filter(provider => provider !== null);
    ready = true;
    search.disabled = question.value.trim() === '';
  } catch {
    result({ status: 'failure', kind: 'unknown' });
    actions.append(button('draft', 'help.consultDraft', showDraft));
  }
}
