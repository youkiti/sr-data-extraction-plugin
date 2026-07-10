// LlmProviderError（プロバイダ共通例外）の単体テスト（sr-query-builder から流用）
import { LlmProviderError } from '../../../../src/lib/llm/LLMProvider';

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
