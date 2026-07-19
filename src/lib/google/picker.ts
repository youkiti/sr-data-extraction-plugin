// Drive Picker（S3 / requirements.md §2.1）。
//
// MV3 では apis.google.com のスクリプトを拡張ページへ読み込めない（remote hosted code 禁止）ため、
// Picker 本体はホスト済み HTTPS ページ（hosted/picker.html を GitHub Pages 等へデプロイ）を
// 新規タブで開き、次のプロトコルで拡張と通信する（externally_connectable 経由の外部メッセージ）:
//
//   1. 拡張がタブを開く（URL フラグメントで extension_id と nonce、モードにより
//      view=spreadsheet / file_id、または view=files を渡す。トークンと files モードの
//      対象ファイル ID 一覧はいずれも URL に載せない）
//   2. ページが { kind: 'ready', nonce, page_version } を chrome.runtime.sendMessage(extensionId, ...)
//      で送る（page_version はページ側のプロトコル対応バージョン。issue #141 のハンドシェイク）
//      → 拡張は sender.url（ホストページのオリジン）と nonce を検証してから
//        sendResponse({ token }) で OAuth トークンを返す（原則 5: URL / ログへ出さない）。
//        files モードでは sendResponse({ token, file_ids }) で対象ファイル ID 一覧も同じ経路
//        （sendResponse）で渡す（issue #141: 数百件規模で URL フラグメントの実用上限に当たり得る
//        うえ、ID 一覧をブラウザ履歴に残さないため）。ページの page_version が未対応
//        （無い / 1 未満）の場合、files モードはトークンを渡さずに拒否する
//        （openProjectFilesPicker が日本語エラーで reject する。ページの再デプロイ待ちを示す）
//   3. ユーザーが選択 → ページが { kind: 'picked', files, nonce } を送る（キャンセルは 'cancelled'）
//      files[].mimeType でフォルダ（FOLDER_MIME_TYPE）とファイルを見分ける。フォルダは呼び出し側
//      （documentsService）が直下 PDF を列挙して取り込む
//   4. 拡張がタブを閉じ、選択結果を返す。ユーザーがタブを直接閉じた場合はキャンセル扱い
//
// セキュリティ（issue #130）: bearer token を外部ホストへ渡す境界のため、
// (a) 送信元タブ ID、(b) sender.url がホストページ URL と一致、(c) 起動ごとの nonce の
// 3 点を検証してからトークンを応答する。nonce はページが「受け取ったら echo する」方式
// （旧デプロイのページは echo しないため、ページを先行デプロイしてから拡張をリリースする）
import type { GoogleApiDeps } from './types';

/** Drive のフォルダを表す mimeType（Picker のフォルダ選択の判定に使う） */
export const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

/**
 * Picker で選択された項目。documentsService.expandSelections が importDocuments の
 * ImportSelection（Drive/ローカル共通形）へ変換する。
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

/** メッセージ送信元の情報（externally_connectable の sender から抽出） */
export interface PickerMessageSender {
  tabId: number | null;
  url: string | null;
}

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
   * chrome.runtime.onMessageExternal の購読。listener には送信元情報（タブ ID + URL）と
   * 同期応答用の sendResponse を渡す。戻り値は購読解除関数
   */
  addExternalMessageListener: (
    listener: (
      message: unknown,
      sender: PickerMessageSender,
      sendResponse: (response: unknown) => void,
    ) => void,
  ) => () => void;
  /** chrome.tabs.onRemoved の購読。戻り値は購読解除関数 */
  addTabRemovedListener: (listener: (tabId: number) => void) => () => void;
  /** 起動ごとの nonce 生成（テストで固定するため注入可能）。省略時は crypto.randomUUID */
  createNonce?: () => string;
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
        listener(
          message,
          { tabId: sender.tab?.id ?? null, url: sender.url ?? null },
          sendResponse,
        );
      };
      chrome.runtime.onMessageExternal.addListener(wrapped);
      return () => chrome.runtime.onMessageExternal.removeListener(wrapped);
    },
    addTabRemovedListener: (listener) => {
      chrome.tabs.onRemoved.addListener(listener);
      return () => chrome.tabs.onRemoved.removeListener(listener);
    },
    createNonce: () => crypto.randomUUID(),
  };
}

interface PickedFileShape {
  id: string;
  name: string;
  mimeType?: string;
}

type ParsedPickerMessage =
  | { kind: 'ready'; nonce: string | null; pageVersion: number | undefined }
  | { kind: 'cancelled'; nonce: string | null }
  | { kind: 'picked'; nonce: string | null; files: PickedFileShape[] };

/** ページからのメッセージを堅く検証する（外部オリジン由来のため信用しない） */
function parsePickerMessage(message: unknown): ParsedPickerMessage | null {
  if (typeof message !== 'object' || message === null) {
    return null;
  }
  const record = message as Record<string, unknown>;
  if (record.source !== PICKER_MESSAGE_SOURCE) {
    return null;
  }
  const nonce = typeof record.nonce === 'string' ? record.nonce : null;
  if (record.kind === 'ready') {
    // page_version はバージョンハンドシェイク（issue #141）。number 以外（欠落含む）は
    // 未対応の旧ページとみなせるよう undefined 扱いにする
    const pageVersion = typeof record.page_version === 'number' ? record.page_version : undefined;
    return { kind: 'ready', nonce, pageVersion };
  }
  if (record.kind === 'cancelled') {
    return { kind: 'cancelled', nonce };
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
    return { kind: 'picked', nonce, files };
  }
  return null;
}

/** 送信元 URL がホストページそのもの（+ フラグメント / クエリ）かを判定する */
function isPickerPageUrl(senderUrl: string, pageUrl: string): boolean {
  return (
    senderUrl === pageUrl ||
    senderUrl.startsWith(`${pageUrl}#`) ||
    senderUrl.startsWith(`${pageUrl}?`)
  );
}

/** runPicker の内部オプション（呼び出し側ごとの ready 応答拡張・版数要求。issue #141） */
interface RunPickerOptions {
  /** ready 応答へ token 以外に追加するフィールド（例: files モードの file_ids） */
  extraReadyFields?: Record<string, unknown>;
  /**
   * ready の page_version に要求する最低値。未指定なら検証しない（pdf / spreadsheet モードは
   * 旧ページでも動く必要があるため不要）。ページの page_version がこれ未満（未対応の旧ページ
   * を含む）なら、トークンを渡さずに reject する
   */
  minPageVersion?: number;
}

/**
 * ホスト済み Picker ページを開き、選択結果を返す共通処理。
 * extraFragment でページのモード（view=spreadsheet / file_id）を切り替える。
 * キャンセル（Picker のキャンセルボタン / タブを閉じる）は null。
 * minPageVersion 未達（旧ページ）のときは reject する。
 */
async function runPicker(
  deps: PickerDeps,
  extraFragment: Record<string, string>,
  options: RunPickerOptions = {},
): Promise<PickerSelection[] | null> {
  // タブを開く前にトークンを確保する（未ログインならここで失敗させ、空タブを残さない）
  const token = await deps.getAccessToken();
  const nonce = (deps.createNonce ?? (() => crypto.randomUUID()))();
  const params = new URLSearchParams({ extension_id: deps.extensionId, ...extraFragment });
  params.set('nonce', nonce);
  const url = `${deps.pickerPageUrl}#${params.toString()}`;
  const tabId = await deps.createTab(url);

  return await new Promise<PickerSelection[] | null>((resolve, reject) => {
    let settled = false;

    // 確定後に届いた遅延イベント（タブ削除 → メッセージ等の競合）は無視する。
    // 2 つの購読はこの直後に同期的に確立され、settle / fail はイベントでしか呼ばれないため、
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
    // 版数不足の旧ページ等、Picker を続行できないエラー。トークンを渡さずタブを閉じて reject する
    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      removeMessageListener();
      removeTabListener();
      void deps.removeTab(tabId).catch(() => undefined);
      reject(error);
    };

    const removeMessageListener = deps.addExternalMessageListener(
      (message, sender, sendResponse) => {
        if (sender.tabId !== tabId) {
          return;
        }
        // bearer token を渡す境界の防御: 開いたホストページ以外（リダイレクト・
        // 同一タブでの別ページ遷移等）からのメッセージには応答しない。
        // 単純な前方一致だと同一オリジンの picker.html.bak 等も通るため、
        // ページ URL そのもの + フラグメント / クエリ区切りのみ許可する
        if (sender.url === null || !isPickerPageUrl(sender.url, deps.pickerPageUrl)) {
          return;
        }
        const parsed = parsePickerMessage(message);
        if (parsed === null) {
          return;
        }
        // 起動ごとの nonce を全メッセージで照合する（フラグメントを知る = 拡張が開いた
        // 正規のページであることの確認）
        if (parsed.nonce !== nonce) {
          return;
        }
        if (parsed.kind === 'ready') {
          if (
            options.minPageVersion !== undefined &&
            (parsed.pageVersion === undefined || parsed.pageVersion < options.minPageVersion)
          ) {
            fail(
              new Error(
                'Picker ページの更新がまだ反映されていません。数分待ってからもう一度お試しください',
              ),
            );
            return;
          }
          sendResponse(options.extraReadyFields ? { token, ...options.extraReadyFields } : { token });
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

/**
 * Drive Picker を開き、ユーザーが選択した PDF の一覧を返す。
 * キャンセル（Picker のキャンセルボタン / タブを閉じる）は null。
 */
export async function openPdfPicker(deps: PickerDeps): Promise<PickerSelection[] | null> {
  return runPicker(deps, {});
}

/** files モードのページ側プロトコル対応に要求する最低 page_version（issue #141） */
const FILES_MODE_MIN_PAGE_VERSION = 1;

/**
 * プロジェクトの必要ファイル（PDF・抽出テキスト）へ drive.file アクセスを付与するための
 * Picker（issue #139）。共有フォルダの Picker 選択では配下ファイルへの読み取りが付与されない
 * ことが実機で確定したため（issue #62）、Documents タブ由来のファイル ID を setFileIds で
 * 列挙し、reviewer に全選択してもらってファイル単位で付与する。全件選択されたかの照合は
 * 呼び出し側（roleService.grantFolderAccess）が行う。
 * ファイル ID 一覧は URL フラグメントではなく ready 応答（sendResponse）経由でページへ渡す
 * （issue #141: 数百件規模で URL / Picker 内部リクエストの実用上限に当たり得るうえ、
 * ID 一覧をブラウザ履歴に残さないため）。ページが未対応（page_version が無い / 1 未満の
 * 旧デプロイ）の場合はトークンを渡さずに reject する（呼び出し側 roleService.grantFolderAccess
 * は既存の catch でトースト表示 + folderAccessError へ格納するため、この関数側での追加対応は不要）
 */
export async function openProjectFilesPicker(
  deps: PickerDeps,
  fileIds: readonly string[],
): Promise<PickerSelection[] | null> {
  return runPicker(
    deps,
    { view: 'files' },
    { extraReadyFields: { file_ids: fileIds }, minPageVersion: FILES_MODE_MIN_PAGE_VERSION },
  );
}

/**
 * tiab-review 引き継ぎ用: 任意のスプレッドシートを 1 件選ぶ Picker（S1 `#popup-tiab-handoff`。
 * docs/ui-states.md §1 / ※Q2）。`view=spreadsheet` を `file_id` 制限なしで開く
 * （ホスト済みページは `file_id` が無ければ setFileIds を掛けず全シート表示になる）。
 * 選択がそのまま drive.file 付与になる（tiab-review は別 OAuth クライアント作成のシートのため、
 * この選択が唯一のアクセス経路）。キャンセル / タブを閉じる → null
 */
export async function openTiabSpreadsheetPicker(
  deps: PickerDeps,
): Promise<PickerSelection | null> {
  const selections = await runPicker(deps, { view: 'spreadsheet' });
  if (selections === null || selections.length === 0) {
    return null;
  }
  // length > 0 が確定しているので [0] は必ず定義されている（noUncheckedIndexedAccess の分岐を作らない）
  return selections[0] as PickerSelection;
}

/** スプレッドシート Picker の結果（docs/ui-states.md §1「アクセス許可が必要」） */
export type SpreadsheetPickResult = 'granted' | 'mismatch' | 'cancelled';

/**
 * 共有スプレッドシートへの drive.file アクセスを付与するための Picker（issue #130）。
 * ホストページをスプレッドシートビュー（setFileIds で対象 1 件に限定）で開き、
 * ユーザーが要求 ID と同じシートを選んだときだけ 'granted' を返す。
 * 「すべてのスプレッドシートから選ぶ」で別シートを選んだ場合は 'mismatch'
 * （選択したシート自体には drive.file が付与されるが、開こうとした ID は未許可のまま）。
 */
export async function openSpreadsheetPicker(
  deps: PickerDeps,
  spreadsheetId: string,
): Promise<SpreadsheetPickResult> {
  const selections = await runPicker(deps, { view: 'spreadsheet', file_id: spreadsheetId });
  if (selections === null || selections.length === 0) {
    return 'cancelled';
  }
  return selections.some((s) => s.sourceFileId === spreadsheetId) ? 'granted' : 'mismatch';
}
