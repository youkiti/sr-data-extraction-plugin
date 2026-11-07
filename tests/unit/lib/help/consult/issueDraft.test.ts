// 公開 Issue 用の伏せ字と、注意書きを残す URL 長の制限を検証する。
import { createIssueDraft, sanitizeForIssue } from '../../../../../src/lib/help/consult/issueDraft';

const repository = 'https://github.com/youkiti/sr-data-extraction-plugin';
const pages = 'https://youkiti.github.io/sr-data-extraction-plugin';
const environment = { version: '1', uiLang: 'ja', screen: 'home', provider: 'gemini', model: 'flash', configuredProviders: ['gemini'] };

test('メール・許可外 URL・資格情報とポート付き URL・長い識別子を伏せる', () => {
  for (const value of ['person@example.org', 'https://example.org/path', 'ftp://example.org/path', 'http://github.com/youkiti/sr-data-extraction-plugin', `${repository}-other`, `${repository.replace('https://', 'https://user:pass@')}/x`, `${repository.replace('github.com', 'github.com:443')}/x`, 'https://[invalid', 'Abcdefghijklmn_123456-789']) {
    expect(sanitizeForIssue(value)).toBe('[REDACTED]');
  }
  for (const value of [repository, pages, `${repository}/issues/1234567890123456789012345`, `${pages}/help.html#setup`]) {
    expect(sanitizeForIssue(value)).toBe(value);
  }
  expect(sanitizeForIssue('短いID safe_123')).toBe('短いID safe_123');
});

test('全項目を伏せ、質問を一行化したタイトルと日英の本文を作る', () => {
  const draft = createIssueDraft({ question: '質問\nperson@example.org', answer: 'https://private.example', environment: { version: 'person@example.org', uiLang: 'person@example.org', screen: 'person@example.org', provider: 'person@example.org', model: 'person@example.org', configuredProviders: ['person@example.org'], errorText: '123456789012345678901' } });
  expect(draft.title).toBe('ヘルプ相談: 質問 [REDACTED]');
  expect(draft.body).not.toContain('person@example.org');
  expect(draft.body).not.toContain('private.example');
  expect(draft.body).not.toContain('123456789012345678901');
  for (const heading of ['## 環境 / Environment', '## 質問 / Question', '## AI の回答 / AI answer', '## エラー / Error']) {
    expect(draft.body).toContain(heading);
  }
  expect(new URL(draft.url).searchParams.get('body')).toBe(draft.body);
  expect(createIssueDraft({ question: '質問', environment }).body).toContain('This draft will become a public Issue.');
});

test.each(['長い質問。'.repeat(3000), '😀'.repeat(4000)])('URL は8000文字以内で、注意は省略しない', (question) => {
  const draft = createIssueDraft({ question, environment });
  expect(draft.title.length).toBeLessThanOrEqual(100);
  expect(draft.url.length).toBeLessThanOrEqual(8000);
  expect(draft.body).toMatch(/^この下書きは公開の Issue になります。/);
  expect(draft.body).toContain('This draft will become a public Issue.');
  expect(draft.body).toContain('Truncated to fit the URL length limit.');
  expect(new URL(draft.url).searchParams.get('body')).toBe(draft.body);
});
