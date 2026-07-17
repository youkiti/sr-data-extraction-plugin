// hosted/picker.html（GitHub Pages 配信の Picker ホストページ）の分岐検証（issue #130）。
// 実ページを tools/playwright-server.js の /hosted/ 経由で配信し、
// apis.google.com はルートで空 JS に差し替え + gapi / google.picker / chrome.runtime を
// addInitScript でスタブして、モード分岐・nonce echo・メッセージ送信を確認する
import { expect, test, type Page } from '@playwright/test';

interface PickerRecord {
  views: Array<{ viewId: string; fileIds?: string }>;
  features: string[];
  title: string;
  appId: string;
  token: string;
  visible: boolean;
}

function stubs(): void {
  const w = window as unknown as Record<string, unknown>;
  const messages: unknown[] = [];
  const pickers: PickerRecord[] = [];
  const callbacks: Array<(data: Record<string, unknown>) => void> = [];
  w.__messages = messages;
  w.__pickers = pickers;
  w.__callbacks = callbacks;
  w.chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: (
        _extId: string,
        message: Record<string, unknown>,
        cb?: (r: unknown) => void,
      ) => {
        messages.push(message);
        if (message.kind === 'ready' && cb) {
          cb({ token: 'e2e-token' });
        }
      },
    },
  };
  w.gapi = { load: (_name: string, cb: () => void) => cb() };
  class DocsView {
    viewId: string;
    fileIds?: string;
    constructor(viewId?: string) {
      this.viewId = viewId ?? 'docs-default';
    }
    setMimeTypes(): DocsView {
      return this;
    }
    setIncludeFolders(): DocsView {
      return this;
    }
    setSelectFolderEnabled(): DocsView {
      return this;
    }
    setStarred(): DocsView {
      return this;
    }
    setFileIds(id: string): DocsView {
      this.fileIds = id;
      return this;
    }
  }
  class PickerBuilder {
    private views: Array<{ viewId: string; fileIds?: string }> = [];
    private features: string[] = [];
    private title = '';
    private appId = '';
    private token = '';
    enableFeature(f: string): PickerBuilder {
      this.features.push(f);
      return this;
    }
    setDeveloperKey(): PickerBuilder {
      return this;
    }
    setAppId(id: string): PickerBuilder {
      this.appId = id;
      return this;
    }
    setOAuthToken(t: string): PickerBuilder {
      this.token = t;
      return this;
    }
    addView(v: DocsView | string): PickerBuilder {
      this.views.push(typeof v === 'string' ? { viewId: v } : { viewId: v.viewId, fileIds: v.fileIds });
      return this;
    }
    setTitle(t: string): PickerBuilder {
      this.title = t;
      return this;
    }
    setCallback(cb: (data: Record<string, unknown>) => void): PickerBuilder {
      callbacks.push(cb);
      return this;
    }
    build(): { setVisible: (v: boolean) => void } {
      const record: PickerRecord = {
        views: this.views,
        features: this.features,
        title: this.title,
        appId: this.appId,
        token: this.token,
        visible: false,
      };
      pickers.push(record);
      return {
        setVisible: (v: boolean) => {
          record.visible = v;
        },
      };
    }
  }
  w.google = {
    picker: {
      DocsView,
      PickerBuilder,
      ViewId: { DOCS: 'docs', PDFS: 'pdfs', SPREADSHEETS: 'spreadsheets', RECENTLY_PICKED: 'recent' },
      Feature: { MULTISELECT_ENABLED: 'multiselect' },
      Response: { ACTION: 'action', DOCUMENTS: 'docs' },
      Action: { PICKED: 'picked', CANCEL: 'cancel' },
      Document: { ID: 'id', NAME: 'name', MIME_TYPE: 'mimeType' },
    },
  };
}

async function setup(page: Page, fragment: string, apiJs: 'ok' | 'fail' = 'ok'): Promise<void> {
  await page.route('https://apis.google.com/js/api.js', (route) => {
    if (apiJs === 'fail') {
      return route.abort();
    }
    // gapi は addInitScript のスタブが提供するため、中身は空でよい
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* stub */' });
  });
  await page.addInitScript(stubs);
  await page.goto(`/hosted/picker.html${fragment}`);
}

function messagesOf(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => (window as unknown as { __messages: Array<Record<string, unknown>> }).__messages);
}

function pickersOf(page: Page): Promise<PickerRecord[]> {
  return page.evaluate(() => (window as unknown as { __pickers: PickerRecord[] }).__pickers);
}

test('スプレッドシート許可モード: setFileIds で対象限定 + nonce echo + picked 送信', async ({ page }) => {
  await setup(page, '#extension_id=ext-1&view=spreadsheet&file_id=SID-1&nonce=n-1');
  await expect(page.locator('#title')).toHaveText('プロジェクトのスプレッドシートを選択');
  await expect(page.locator('#sheet-note')).toBeVisible();
  await expect(page.locator('#status')).toContainText('スプレッドシートを選択してください');

  // ready は nonce を echo し、応答トークンで Picker が組み立てられている
  await expect.poll(() => messagesOf(page)).toEqual([
    { source: 'sr-data-extraction-picker', kind: 'ready', nonce: 'n-1' },
  ]);
  const pickers = await pickersOf(page);
  expect(pickers).toHaveLength(1);
  expect(pickers[0]).toMatchObject({
    views: [{ viewId: 'spreadsheets', fileIds: 'SID-1' }],
    features: [],
    appId: '1022221973986',
    token: 'e2e-token',
    visible: true,
  });

  // PICKED → picked メッセージ（nonce echo + mimeType 込み）
  await page.evaluate(() => {
    (window as unknown as { __callbacks: Array<(d: unknown) => void> }).__callbacks[0]?.({
      action: 'picked',
      docs: [{ id: 'SID-1', name: 'プロジェクト', mimeType: 'application/vnd.google-apps.spreadsheet' }],
    });
  });
  await expect.poll(async () => (await messagesOf(page)).at(-1)).toEqual({
    source: 'sr-data-extraction-picker',
    kind: 'picked',
    nonce: 'n-1',
    files: [{ id: 'SID-1', name: 'プロジェクト', mimeType: 'application/vnd.google-apps.spreadsheet' }],
  });
  await expect(page.locator('#status')).toContainText('選択を拡張へ送信しました');
});

test('「すべてのスプレッドシートから選ぶ」で setFileIds なしの Picker を開き直す', async ({ page }) => {
  await setup(page, '#extension_id=ext-1&view=spreadsheet&file_id=SID-1&nonce=n-1');
  await expect(page.locator('#sheet-note')).toBeVisible();
  await page.locator('#show-all').click();
  await expect.poll(() => pickersOf(page)).toHaveLength(2);
  const pickers = await pickersOf(page);
  expect(pickers[1]?.views).toEqual([{ viewId: 'spreadsheets', fileIds: undefined }]);
});

test('PDF モード（view なし）: 3 ビュー + MULTISELECT + キャンセル送信', async ({ page }) => {
  await setup(page, '#extension_id=ext-1&nonce=n-2');
  await expect(page.locator('#title')).toHaveText('Drive から PDF / フォルダを選択');
  await expect(page.locator('#sheet-note')).toBeHidden();
  const pickers = await pickersOf(page);
  expect(pickers[0]?.features).toEqual(['multiselect']);
  expect(pickers[0]?.views.map((v) => v.viewId)).toEqual(['recent', 'docs', 'pdfs']);

  await page.evaluate(() => {
    (window as unknown as { __callbacks: Array<(d: unknown) => void> }).__callbacks[0]?.({
      action: 'cancel',
    });
  });
  await expect.poll(async () => (await messagesOf(page)).at(-1)).toEqual({
    source: 'sr-data-extraction-picker',
    kind: 'cancelled',
    nonce: 'n-2',
  });
});

test('nonce なし（旧拡張互換）: メッセージへ nonce を付けない', async ({ page }) => {
  await setup(page, '#extension_id=ext-1');
  await expect.poll(() => messagesOf(page)).toEqual([
    { source: 'sr-data-extraction-picker', kind: 'ready' },
  ]);
});

test('extension_id が無ければエラー表示して何も送らない', async ({ page }) => {
  await setup(page, '');
  await expect(page.locator('#status')).toContainText('extension_id がありません');
  expect(await messagesOf(page)).toEqual([]);
});

test('Picker API の読み込み失敗はエラー表示する', async ({ page }) => {
  await setup(page, '#extension_id=ext-1&nonce=n-3', 'fail');
  await expect(page.locator('#status')).toContainText('読み込みに失敗しました');
});
