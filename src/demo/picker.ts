// デモモード用の Drive Picker 差し替え（src/lib/google/picker.ts の代わり）。
//
// デモは実データがあらかじめシード済み（src/demo/seed.ts）のため、Picker ダイアログを
// 実際に開く必要がない。呼び出された場合は「キャンセルされた」相当（null）を即返し、
// 拡張タブが本当に開いてしまう・応答が返らずハングする、といった事故を防ぐ。
// 型・エクスポート名は実物（lib/google/picker.ts）と同じ形を保つ（呼び出し側の import が
// そのまま解決できるようにするため）。
import type { GoogleApiDeps } from '../lib/google/types';

/** Drive のフォルダを表す mimeType（実物と同じ値。デモでは判定に使うことはない） */
export const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

export interface PickerSelection {
  sourceFileId: string;
  filename: string;
  mimeType?: string;
}

export const PICKER_MESSAGE_SOURCE = 'sr-data-extraction-picker';

/** デモでは実際に開かないため実体を持たないダミー URL */
export const PICKER_PAGE_URL = 'about:blank#demo-picker-not-used';

export interface PickerMessageSender {
  tabId: number | null;
  url: string | null;
}

/** 実物と同じ形を保つ（デモでは使わないフィールドも含む） */
export interface PickerDeps {
  getAccessToken: () => Promise<string>;
  extensionId: string;
  pickerPageUrl: string;
  createTab: (url: string) => Promise<number>;
  removeTab: (tabId: number) => Promise<void>;
  addExternalMessageListener: (
    listener: (
      message: unknown,
      sender: PickerMessageSender,
      sendResponse: (response: unknown) => void,
    ) => void,
  ) => () => void;
  addTabRemovedListener: (listener: (tabId: number) => void) => () => void;
  createNonce?: () => string;
}

/** デモでは Picker を実際に開かないため、tabId 操作系はすべて no-op のダミー実装を返す */
export function createChromePickerDeps(google: GoogleApiDeps): PickerDeps {
  return {
    getAccessToken: google.getAccessToken,
    extensionId: typeof chrome !== 'undefined' ? chrome.runtime.id : 'demo-extension',
    pickerPageUrl: PICKER_PAGE_URL,
    createTab: async () => {
      console.warn('[demo] Picker タブは開きません（デモではファイル選択はすべてシード済みです）');
      return -1;
    },
    removeTab: async () => {},
    addExternalMessageListener: () => () => {},
    addTabRemovedListener: () => () => {},
    createNonce: () => 'demo-nonce',
  };
}

function warnPickerNotAvailable(name: string): void {
  console.warn(
    `[demo] ${name}() が呼ばれましたが、デモモードでは Picker を開けません（キャンセル扱いで応答します）`,
  );
}

export async function openPdfPicker(_deps: PickerDeps): Promise<PickerSelection[] | null> {
  warnPickerNotAvailable('openPdfPicker');
  return null;
}

export async function openProjectFilesPicker(
  _deps: PickerDeps,
  _fileIds: readonly string[],
): Promise<PickerSelection[] | null> {
  warnPickerNotAvailable('openProjectFilesPicker');
  return null;
}

export async function openTiabSpreadsheetPicker(_deps: PickerDeps): Promise<PickerSelection | null> {
  warnPickerNotAvailable('openTiabSpreadsheetPicker');
  return null;
}

export type SpreadsheetPickResult = 'granted' | 'mismatch' | 'cancelled';

export async function openSpreadsheetPicker(
  _deps: PickerDeps,
  _spreadsheetId: string,
): Promise<SpreadsheetPickResult> {
  warnPickerNotAvailable('openSpreadsheetPicker');
  return 'cancelled';
}
