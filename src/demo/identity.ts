// デモモード用のプロフィール差し替え（src/lib/google/identity.ts の代わり）。
// サインイン中アカウントのメールを常にデモ用アドレスとして返す。
import { DEMO_USER_EMAIL } from './constants';

export interface ProfileDeps {
  getProfileUserInfo: () => Promise<{ email: string; id: string }>;
}

export function createChromeProfileDeps(): ProfileDeps {
  return {
    getProfileUserInfo: async () => ({ email: DEMO_USER_EMAIL, id: 'demo-profile-id' }),
  };
}

export async function getCurrentUserEmail(deps: ProfileDeps): Promise<string | null> {
  const info = await deps.getProfileUserInfo();
  return info.email.length > 0 ? info.email : null;
}

/** Chrome プロファイルのメール（identity.email 権限）。デモでは常にデモ用アドレスを返す */
export function getChromeProfileEmail(): Promise<string | null> {
  return Promise.resolve(DEMO_USER_EMAIL);
}
