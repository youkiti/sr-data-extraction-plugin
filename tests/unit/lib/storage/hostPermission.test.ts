import { installChromeMock } from '../../../setup/chrome-mock';
import {
  endpointOriginPattern,
  requestEndpointPermission,
} from '../../../../src/lib/storage/hostPermission';

describe('hostPermission', () => {
  test('完全 URL から origin pattern を作る', () => {
    expect(endpointOriginPattern('https://llm.example/v1/chat/completions')).toBe(
      'https://llm.example/*',
    );
  });

  test.each([
    ['https://llm.example:8443/v1/chat/completions', 'https://llm.example/*'],
    ['http://localhost:11434/v1/chat/completions', 'http://localhost/*'],
    ['http://127.0.0.1:1234/v1/chat/completions', 'http://127.0.0.1/*'],
    ['http://[::1]:8080/v1/chat/completions', 'http://[::1]/*'],
  ])('ポートを除き scheme + hostname pattern を作る: %s', (endpoint, pattern) => {
    expect(endpointOriginPattern(endpoint)).toBe(pattern);
  });

  test('指定 origin だけを permissions.request へ渡す', async () => {
    const mock = installChromeMock();
    mock.permissions.request.mockResolvedValueOnce(false);
    await expect(
      requestEndpointPermission('https://llm.example/v1/chat/completions'),
    ).resolves.toBe(false);
    expect(mock.permissions.request).toHaveBeenCalledWith({ origins: ['https://llm.example/*'] });
  });
});
