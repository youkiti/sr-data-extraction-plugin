// AI へ送る前の告知と同意のダイアログ（issue #381。docs/ui-states.md §3「AI へ送る前の告知と同意」）。
// サービス層から await できるよう、ストアを介さず document.body へ直接出して Promise で結果を返す
// （画面の再描画〔replaceChildren〕の外に置くため、表示中に再描画が走っても消えない）。
// アプリ（app.html）と設定ページ（options.html / アプリ内 #/options）で共通に使う。見た目は globals.css
import type { LlmProviderId } from '../../domain/llmApiLog';
import { getUiLanguage, t } from '../../lib/i18n';
import { createAiDataConsentGate, type EnsureAiDataConsent } from '../../lib/llm/aiDataConsent';
import { llmProviderLabel } from '../../lib/llm/modelCatalog';
import { loadAiDataConsent, saveAiDataConsent } from '../../lib/storage/aiDataConsentStore';
import { PRIVACY_POLICY_URL, withUiLanguage } from '../../lib/publicPages';
import { el } from './dom';
import { headingWithHelp } from './helpButton';

export const AI_DATA_CONSENT_DIALOG_ID = 'ai-data-consent';

const FOCUSABLE = 'a[href], button:not([disabled])';

/**
 * 同意ダイアログを開く。「同意して続行」で true、「キャンセル」・Esc で false に解決する。
 * 開くとダイアログ本体へフォーカスを移し、Tab はダイアログ内で循環させ、
 * 閉じたら開く前にフォーカスしていた要素へ戻す
 */
export function openAiDataConsentDialog(doc: Document, provider: LlmProviderId): Promise<boolean> {
  const previousFocus = doc.activeElement as HTMLElement | null;
  return new Promise<boolean>((resolve) => {
    const heading = headingWithHelp('h2', t('aiConsent.title'), 'ai-data-consent');
    heading.querySelector('h2')!.id = 'ai-data-consent-title';
    const privacyLink = el('a', {
      text: t('aiConsent.privacyLink'),
      attributes: {
        href: withUiLanguage(PRIVACY_POLICY_URL, getUiLanguage()),
        target: '_blank',
        rel: 'noopener noreferrer',
      },
    });
    const acceptButton = el('button', {
      id: 'ai-data-consent-accept',
      text: t('aiConsent.accept'),
      attributes: { type: 'button' },
    });
    const cancelButton = el('button', {
      id: 'ai-data-consent-cancel',
      text: t('common.cancel'),
      attributes: { type: 'button' },
    });
    const panel = el(
      'div',
      {
        id: AI_DATA_CONSENT_DIALOG_ID,
        className: 'ai-consent__panel',
        attributes: {
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'ai-data-consent-title',
          'aria-describedby': 'ai-data-consent-body',
          tabindex: '-1',
        },
      },
      [
        heading,
        el('div', { id: 'ai-data-consent-body', className: 'ai-consent__body' }, [
          el('p', { text: t('aiConsent.intro', { provider: llmProviderLabel(provider) }) }),
          el('ul', {}, [
            el('li', { text: t('aiConsent.itemPaper') }),
            el('li', { text: t('aiConsent.itemProtocol') }),
            el('li', { text: t('aiConsent.itemSchema') }),
            el('li', { text: t('aiConsent.itemQuestion') }),
          ]),
          el('p', { text: t('aiConsent.providerTerms') }),
          el('p', { text: t('aiConsent.geminiFree') }),
          el('p', { text: t('aiConsent.noDeveloperServer') }),
          el('p', { text: t('aiConsent.checkTerms') }),
        ]),
        el('p', {}, [privacyLink]),
        el('p', { className: 'ai-consent__note', text: t('aiConsent.reviewLater') }),
        el('div', { className: 'ai-consent__actions' }, [acceptButton, cancelButton]),
      ],
    );
    const overlay = el('div', { className: 'ai-consent' }, [panel]);

    const close = (accepted: boolean): void => {
      overlay.remove();
      doc.removeEventListener('keydown', onKeydown, true);
      if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
      resolve(accepted);
    };
    function onKeydown(event: KeyboardEvent): void {
      // モーダルの間は背後の画面のショートカット（検証画面の判定キー等）へキーを渡さない。
      // ボタン上の Enter / Space などの既定動作は止めない
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = doc.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (!panel.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    acceptButton.addEventListener('click', () => close(true));
    cancelButton.addEventListener('click', () => close(false));
    // capture で先に受ける（背後の画面の keydown より前）
    doc.addEventListener('keydown', onKeydown, true);
    doc.body.append(overlay);
    panel.focus();
  });
}

/** 本番の同意ゲート（chrome.storage.local の記録 + このダイアログ）。app/bootstrap.ts が注入する */
export function createChromeAiDataConsentGate(doc: Document): EnsureAiDataConsent {
  return createAiDataConsentGate({
    loadConsent: loadAiDataConsent,
    saveConsent: saveAiDataConsent,
    openDialog: (provider) => openAiDataConsentDialog(doc, provider),
  });
}
