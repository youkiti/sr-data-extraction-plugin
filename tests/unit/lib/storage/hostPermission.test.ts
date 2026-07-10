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

  test('指定 origin だけを permissions.request へ渡す', async () => {
    const mock = installChromeMock();
    mock.permissions.request.mockResolvedValueOnce(false);
    await expect(
      requestEndpointPermission('https://llm.example/v1/chat/completions'),
    ).resolves.toBe(false);
    expect(mock.permissions.request).toHaveBeenCalledWith({ origins: ['https://llm.example/*'] });
  });
});
