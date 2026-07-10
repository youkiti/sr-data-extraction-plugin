import { normalizeOpenAiCompatibleEndpoint } from './settingsStore';

/** 任意 API の完全 URL を、ポートを含まない Chrome の scheme + hostname pattern へ変換する */
export function endpointOriginPattern(endpoint: string): string {
  const url = new URL(normalizeOpenAiCompatibleEndpoint(endpoint));
  return `${url.protocol}//${url.hostname}/*`;
}

/** 利用者操作内で、指定された接続先の scheme + hostname だけの通信権限を要求する */
export async function requestEndpointPermission(endpoint: string): Promise<boolean> {
  return chrome.permissions.request({ origins: [endpointOriginPattern(endpoint)] });
}
