// S1 の既存利用者に告知する小窓。保存が終わるまで閉じず、ログアウトも選べる。
import { el } from '../app/ui/dom';
import { getUiLanguage, t } from '../lib/i18n';
import { PRIVACY_POLICY_URL, withUiLanguage } from '../lib/publicPages';
import { SIGN_IN_DATA_CONSENT_VERSION, saveSignInDataConsent } from '../lib/storage/signInDataConsentStore';

const FOCUSABLE = 'a[href], button:not([disabled])';

/** 保存済みなら true、ログアウトを選んだら false を返す */
export function openSignInDataConsentDialog(doc: Document): Promise<boolean> {
  const previousFocus = doc.activeElement as HTMLElement | null;
  return new Promise<boolean>((resolve) => {
    const privacyLink = el('a', {
      text: t('aiConsent.privacyLink'),
      attributes: {
        href: withUiLanguage(PRIVACY_POLICY_URL, getUiLanguage()),
        target: '_blank',
        rel: 'noopener noreferrer',
      },
    });
    const acceptButton = el('button', {
      id: 'sign-in-data-consent-accept',
      text: t('signInConsent.accept'),
      attributes: { type: 'button' },
    });
    const logoutButton = el('button', {
      id: 'sign-in-data-consent-logout',
      text: t('popup.logout'),
      attributes: { type: 'button' },
    });
    const error = el('p', {
      id: 'sign-in-data-consent-error',
      className: 'popup__form-error',
      attributes: { role: 'alert' },
    });
    const panel = el('div', {
      id: 'sign-in-data-consent',
      className: 'ai-consent__panel',
      attributes: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'sign-in-data-consent-title',
        'aria-describedby': 'sign-in-data-consent-body',
        tabindex: '-1',
      },
    }, [
      el('h2', { id: 'sign-in-data-consent-title', text: t('signInConsent.title') }),
      el('div', { className: 'ai-consent__body' }, [
        el('p', { id: 'sign-in-data-consent-body', text: t('signInConsent.body') }),
      ]),
      el('p', {}, [privacyLink]),
      error,
      el('div', { className: 'ai-consent__actions' }, [acceptButton, logoutButton]),
    ]);
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
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
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
    acceptButton.addEventListener('click', () => {
      error.textContent = '';
      acceptButton.disabled = true;
      logoutButton.disabled = true;
      void saveSignInDataConsent({
        version: SIGN_IN_DATA_CONSENT_VERSION,
        acceptedAt: new Date().toISOString(),
      }).then(() => close(true)).catch(() => {
        error.textContent = t('signInConsent.saveFailed');
      }).finally(() => {
        acceptButton.disabled = false;
        logoutButton.disabled = false;
      });
    });
    logoutButton.addEventListener('click', () => close(false));
    doc.addEventListener('keydown', onKeydown, true);
    doc.body.append(overlay);
    panel.focus();
  });
}
