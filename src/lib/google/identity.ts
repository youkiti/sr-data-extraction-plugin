// サインイン中アカウントのメール取得（issue #129 で userinfo ベースへ移行）。
//
// 旧実装は chrome.identity.getProfileUserInfo（Chrome プロファイル固定）だったが、
// launchWebAuthFlow 移行で認可アカウントとプロファイルが一致しなくなるため、
// 正は常に OAuth 応答側（認証ブローカーが userinfo で取得し storage.local に保持）とする。
// `ProfileDeps` / `getCurrentUserEmail` のインターフェースは移行前と不変
// （annotator / created_by を記録する各サービスと、そのテストの fake 注入を無傷に保つ）。
import {
  createChromeAuthClientDeps,
  getSignedInEmail,
  type AuthClientDeps,
} from './auth';

export interface ProfileDeps {
  getProfileUserInfo: () => Promise<{ email: string; id: string }>;
}

export function createChromeProfileDeps(auth?: AuthClientDeps): ProfileDeps {
  const client = auth ?? createChromeAuthClientDeps();
  return {
    getProfileUserInfo: async () => {
      const email = await getSignedInEmail(client);
      // id は旧 API（getProfileUserInfo）由来のフィールドで、現在の消費側は未使用。
      // インターフェース互換のため空文字で残す
      return { email: email ?? '', id: '' };
    },
  };
}

/**
 * 現在サインイン中のアカウント（OAuth で認可したアカウント）のメールアドレスを返す。
 * 取れなければ null。
 */
export async function getCurrentUserEmail(deps: ProfileDeps): Promise<string | null> {
  const info = await deps.getProfileUserInfo();
  return info.email.length > 0 ? info.email : null;
}

/**
 * Chrome プロファイルのメール（identity.email 権限）。取れなければ null。
 * 用途は 2 つに限定する:
 * 1. 認証ブローカーの初回 interactive 認可の login_hint シード
 * 2. Popup の「プロファイルと別アカウントでログイン中」表示の比較対象
 */
export function getChromeProfileEmail(): Promise<string | null> {
  return new Promise((resolve) => {
    // @types/chrome では AccountStatus が enum で提供されるためキャストで渡す
    chrome.identity.getProfileUserInfo(
      { accountStatus: 'ANY' as chrome.identity.AccountStatus },
      (info) => {
        resolve(info.email.length > 0 ? info.email : null);
      },
    );
  });
}
