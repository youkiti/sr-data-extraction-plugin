// Drive Picker（S3 / requirements.md §2.1）。
//
// MV3 では apis.google.com のスクリプトを拡張ページへ読み込めない（remote hosted code 禁止）ため、
// Picker 本体はホスト済み HTTPS ページ（hosted/picker.html を GitHub Pages 等へデプロイ）を
// 新規タブで開き、次のプロトコルで拡張と通信する（externally_connectable 経由の外部メッセージ）:
//
//   1. 拡張がタブを開く（URL フラグメントで extension_id を渡す。トークンは URL に載せない）
//   2. ページが { kind: 'ready' } を chrome.runtime.sendMessage(extensionId, ...) で送る
//      → 拡張は sendResponse({ token }) で OAuth トークンを返す（原則 5: URL / ログへ出さない）
//   3. ユーザーが PDF / フォルダを選択 → ページが { kind: 'picked', files } を送る（キャンセルは 'cancelled'）
//      files[].mimeType でフォルダ（FOLDER_MIME_TYPE）とファイルを見分ける。フォルダは呼び出し側
//      （documentsService）が直下 PDF を列挙して取り込む
//   4. 拡張がタブを閉じ、選択結果を返す。ユーザーがタブを直接閉じた場合はキャンセル扱い
import type { GoogleApiDeps } from './types';

/** Drive のフォルダを表す mimeType（Picker のフォルダ選択の判定に使う） */
export const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

/**
 * Picker で選択された項目。PDF なら importDocuments の ImportSelection と同形。
 * mimeType が FOLDER_MIME_TYPE のときはフォルダで、呼び出し側が直下 PDF を展開する。
 * （旧デプロイのホストページは mimeType を送らないため optional。欠落時はファイル扱い）
 */
export interface PickerSelection {
  sourceFileId: string;
  filename: string;
  mimeType?: string;
}

/** ホスト済みページ ⇔ 拡張のメッセージが名乗る source 識別子 */
export const PICKER_MESSAGE_SOURCE = 'sr-data-extraction-picker';

/**
 * hosted/picker.html のデプロイ先。manifest.json の externally_connectable.matches と
 * 同一オリジンであること（変更時は両方直す）
 */
export const PICKER_PAGE_URL =
  'https://youkiti.github.io/sr-data-extraction-plugin/picker.html';

export interface PickerDeps {
  /** OAuth アクセストークン（drive.file スコープ）を取得する */
  getAccessToken: () => Promise<string>;
  /** chrome.runtime.id（ページが sendMessage の宛先に使う） */
  extensionId: string;
  pickerPageUrl: string;
  /** タブを開いて tabId を返す */
  createTab: (url: string) => Promise<number>;
  removeTab: (tabId: number) => Promise<void>;
  /**
   * chrome.runtime.onMessageExternal の購読。listener には送信元タブ ID と
   * 同期応答用の sendResponse を渡す。戻り値は購読解除関数
   */
  addExternalMessageListener: (
    listener: (
      message: unknown,
      senderTabId: number | null,
      sendResponse: (response: unknown) => void,
    ) => void,
  ) => () => void;
  /** chrome.tabs.onRemoved の購読。戻り値は購読解除関数 */
  addTabRemovedListener: (listener: (tabId: number) => void) => () => void;
}

/** Chrome ランタイムから PickerDeps を組み立てる（app エントリ用） */
export function createChromePickerDeps(google: GoogleApiDeps): PickerDeps {
  return {
    getAccessToken: google.getAccessToken,
    extensionId: chrome.runtime.id,
    pickerPageUrl: PICKER_PAGE_URL,
    createTab: async (url) => {
      const tab = await chrome.tabs.create({ url });
      if (tab.id === undefined) {
        throw new Error('Picker タブの作成に失敗しました（tab.id が取得できません）');
      }
      return tab.id;
    },
    removeTab: (tabId) => chrome.tabs.remove(tabId),
    addExternalMessageListener: (listener) => {
      const wrapped = (
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: unknown) => void,
      ): void => {
        listener(message, sender.tab?.id ?? null, sendResponse);
      };
      chrome.runtime.onMessageExternal.addListener(wrapped);
      return () => chrome.runtime.onMessageExternal.removeListener(wrapped);
    },
    addTabRemovedListener: (listener) => {
      chrome.tabs.onRemoved.addListener(listener);
      return () => chrome.tabs.onRemoved.removeListener(listener);
    },
  };
}

interface PickedFileShape {
  id: string;
  name: string;
  mimeType?: string;
}

/** ページからのメッセージを堅く検証する（外部オリジン由来のため信用しない） */
function parsePickerMessage(
  message: unknown,
): { kind: 'ready' } | { kind: 'cancelled' } | { kind: 'picked'; files: PickedFileShape[] } | null {
  if (typeof message !== 'object' || message === null) {
    return null;
  }
  const record = message as Record<string, unknown>;
  if (record.source !== PICKER_MESSAGE_SOURCE) {
    return null;
  }
  if (record.kind === 'ready') {
    return { kind: 'ready' };
  }
  if (record.kind === 'cancelled') {
    return { kind: 'cancelled' };
  }
  if (record.kind === 'picked' && Array.isArray(record.files)) {
    const files: PickedFileShape[] = [];
    for (const item of record.files as unknown[]) {
      if (typeof item !== 'object' || item === null) {
        return null;
      }
      const file = item as Record<string, unknown>;
      if (typeof file.id !== 'string' || file.id === '' || typeof file.name !== 'string') {
        return null;
      }
      // mimeType は旧ホストページでは欠落しうる。string 以外は無視（ファイル扱い）
      const mimeType = typeof file.mimeType === 'string' ? file.mimeType : undefined;
      files.push({ id: file.id, name: file.name, mimeType });
    }
    return { kind: 'picked', files };
  }
  return null;
}

/**
 * Drive Picker を開き、ユーザーが選択した PDF の一覧を返す。
 * キャンセル（Picker のキャンセルボタン / タブを閉じる）は null。
 */
export async function openPdfPicker(deps: PickerDeps): Promise<PickerSelection[] | null> {
  // タブを開く前にトークンを確保する（未ログインならここで失敗させ、空タブを残さない）
  const token = await deps.getAccessToken();
  const url = `${deps.pickerPageUrl}#extension_id=${encodeURIComponent(deps.extensionId)}`;
  const tabId = await deps.createTab(url);

  return await new Promise<PickerSelection[] | null>((resolve) => {
    let settled = false;

    // 確定後に届いた遅延イベント（タブ削除 → メッセージ等の競合）は無視する。
    // 2 つの購読はこの直後に同期的に確立され、settle はイベントでしか呼ばれないため、
    // 呼び出し時点で removeMessageListener / removeTabListener は必ず初期化済み
    const settle = (result: PickerSelection[] | null, closeTab: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      removeMessageListener();
      removeTabListener();
      if (closeTab) {
        // タブが既に閉じられていても失敗を無視する（結果は確定済み）
        void deps.removeTab(tabId).catch(() => undefined);
      }
      resolve(result);
    };

    const removeMessageListener = deps.addExternalMessageListener(
      (message, senderTabId, sendResponse) => {
        if (senderTabId !== tabId) {
          return;
        }
        const parsed = parsePickerMessage(message);
        if (parsed === null) {
          return;
        }
        if (parsed.kind === 'ready') {
          sendResponse({ token });
          return;
        }
        if (parsed.kind === 'cancelled') {
          settle(null, true);
          return;
        }
        settle(
          parsed.files.map((file) => ({
            sourceFileId: file.id,
            filename: file.name,
            mimeType: file.mimeType,
          })),
          true,
        );
      },
    );
    const removeTabListener = deps.addTabRemovedListener((removedTabId) => {
      if (removedTabId === tabId) {
        settle(null, false);
      }
    });
  });
}
