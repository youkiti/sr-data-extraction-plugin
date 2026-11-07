// 公開前に利用者が確認できる、機密情報を伏せた Issue 下書きを作る。
import { SITE_URL } from '../../publicPages';

const REPOSITORY_URL = 'https://github.com/youkiti/sr-data-extraction-plugin';
const REDACTED = '[REDACTED]';
const WARNING = 'この下書きは公開の Issue になります。個人情報や未公開の研究内容が含まれていないか確認してください。\nThis draft will become a public Issue. Check that it contains no personal information or unpublished research.\n\n';
const TRUNCATED = '\n（URL の長さ制限により省略しました / Truncated to fit the URL length limit.）';

function redactText(text: string): string {
  return text.replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, REDACTED)
    .replace(/[A-Z0-9_-]{20,}/gi, REDACTED);
}

/** 許可した URL も、クエリとフラグメントには利用者の情報が入りうるので通常の文字列として伏せる。 */
function redactAllowedUrl(url: string): string {
  const cut = url.search(/[?#]/);
  if (cut < 0) {
    return url;
  }
  return url.slice(0, cut) + redactText(url.slice(cut));
}

export function sanitizeForIssue(text: string): string {
  // URL は先に分離し、許可済みパスの長い ID を通常の文字列として再処理しない。
  return text.split(/([a-z][a-z0-9+.-]*:\/\/[^\s<>"'）)]+)/gi).map((part) => {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(part)) {
      try {
        const url = new URL(part);
        const allowed = [REPOSITORY_URL, SITE_URL.replace(/\/$/, '')].some((base) => {
          const target = new URL(base);
          return url.origin === target.origin && (url.pathname === target.pathname || url.pathname.startsWith(`${target.pathname}/`));
        });
        return allowed && !url.username && !url.password && !url.port
          && !/^https?:\/\/[^/]*:/i.test(part)
          ? redactAllowedUrl(part) : REDACTED;
      } catch {
        return REDACTED;
      }
    }
    return redactText(part);
  }).join('');
}

export interface IssueEnvironment {
  version: string;
  uiLang: string;
  screen: string;
  provider: string;
  model: string;
  configuredProviders: string[];
  errorText?: string;
}

export function createIssueDraft(input: { question: string; answer?: string; environment: IssueEnvironment }): { title: string; body: string; url: string } {
  const clean = sanitizeForIssue;
  const title = `ヘルプ相談: ${clean(input.question).replace(/\s+/g, ' ').trim()}`.slice(0, 100).replace(/[\uD800-\uDBFF]$/, '');
  const environment = input.environment;
  const content = `## 環境 / Environment\n${[
    ['Version', environment.version], ['UI language', environment.uiLang], ['Screen', environment.screen],
    ['Provider', environment.provider], ['Model', environment.model],
    ['Configured providers', environment.configuredProviders.join(', ')],
  ].map(([label, value]) => `- ${label}: ${clean(value!)}`).join('\n')}\n\n## 質問 / Question\n${clean(input.question)}\n\n## AI の回答 / AI answer\n${clean(input.answer ?? '')}\n\n## エラー / Error\n${clean(environment.errorText ?? '')}`;
  const urlFor = (body: string): string => `${REPOSITORY_URL}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  let body = WARNING + content;
  if (urlFor(body).length > 8000) {
    // コードポイント単位で切り、サロゲートペアの途中で encodeURIComponent を呼ばない。
    const characters = [...content];
    let low = 0;
    let high = characters.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (urlFor(WARNING + characters.slice(0, middle).join('') + TRUNCATED).length <= 8000) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    body = WARNING + characters.slice(0, low).join('') + TRUNCATED;
  }
  return { title, body, url: urlFor(body) };
}
