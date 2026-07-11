// LlmProviderError（プロバイダ共通例外）の単体テスト（sr-query-builder から流用）
// + マルチモーダル対応（handoff-scanned-pdf-native-highlight.md §7.4 PR1）の共有ヘルパのテスト
import {
  LlmProviderError,
  chatContentToText,
  hasImagePart,
  toOpenAiContent,
  type ChatMessage,
} from '../../../../src/lib/llm/LLMProvider';

describe('LlmProviderError', () => {
  test('providerId / status / responseBody を保持し name を上書きする', () => {
    const err = new LlmProviderError('boom', 'gemini', 503, 'overloaded');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('LlmProviderError');
    expect(err.providerId).toBe('gemini');
    expect(err.status).toBe(503);
    expect(err.responseBody).toBe('overloaded');
    expect(err.message).toBe('boom');
  });

  test('status が null の場合も保持できる', () => {
    const err = new LlmProviderError('network', 'gemini', null, '');
    expect(err.status).toBeNull();
  });

  test('retryAfterMs は既定 null、指定すれば保持する', () => {
    expect(new LlmProviderError('boom', 'gemini', 429, 'x').retryAfterMs).toBeNull();
    expect(new LlmProviderError('boom', 'gemini', 429, 'x', 5000).retryAfterMs).toBe(5000);
  });
});

describe('chatContentToText', () => {
  test('文字列 content はそのまま返す', () => {
    expect(chatContentToText('hello')).toBe('hello');
  });

  test('パート配列は text を連結し、image は [image mimeType] のプレースホルダにする', () => {
    const content: ChatMessage['content'] = [
      { type: 'text', text: 'この画像を見て: ' },
      { type: 'image', mimeType: 'image/png', dataBase64: 'aGVsbG8=' },
      { type: 'text', text: ' 以上' },
    ];
    expect(chatContentToText(content)).toBe('この画像を見て: [image image/png] 以上');
  });

  test('空配列は空文字', () => {
    expect(chatContentToText([])).toBe('');
  });
});

describe('hasImagePart', () => {
  test('image パートを含むメッセージが 1 つでもあれば true', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'text only' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'see' },
          { type: 'image', mimeType: 'image/png', dataBase64: 'AA==' },
        ],
      },
    ];
    expect(hasImagePart(messages)).toBe(true);
  });

  test('文字列 content のみ・image を含まない配列 content では false', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: [{ type: 'text', text: 'text only part' }] },
    ];
    expect(hasImagePart(messages)).toBe(false);
  });

  test('メッセージ 0 件は false', () => {
    expect(hasImagePart([])).toBe(false);
  });
});

describe('toOpenAiContent', () => {
  test('文字列 content はそのまま返す（現状の body 形を変えない）', () => {
    expect(toOpenAiContent('hi')).toBe('hi');
  });

  test('パート配列は text → {type:"text"} / image → image_url の data URL に写す', () => {
    const content: ChatMessage['content'] = [
      { type: 'text', text: 'この画像:' },
      { type: 'image', mimeType: 'image/jpeg', dataBase64: 'Zm9v' },
    ];
    expect(toOpenAiContent(content)).toEqual([
      { type: 'text', text: 'この画像:' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,Zm9v' } },
    ]);
  });
});
