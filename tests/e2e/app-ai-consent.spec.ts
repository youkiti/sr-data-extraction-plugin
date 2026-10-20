// AI へ送る前の告知と同意（issue #381。docs/ui-states.md §3「AI へ送る前の告知と同意」・§2「AI へ送る内容」）。
// 他の E2E は chrome.storage.local のスタブへ同意済みの記録を入れているため、同意画面そのものは本ファイルで検証する。
// アプリ側は #/pilot の「パイロット抽出を実行」を入口に使い、LLM（Gemini）への送信の有無を数える
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SHEET_HEADERS } from '../../src/domain/sheetsSchema';

const DOCUMENT = {
  documentId: 'doc-1',
  studyId: 'study-1',
  documentRole: 'article',
  driveFileId: 'drive-1',
  sourceFileId: 'src-1',
  filename: 'smith2020.pdf',
  pmid: null,
  doi: null,
  textRef: 'https://drive.google.com/file/d/txt-1/view',
  textStatus: 'ok',
  pageCount: 1,
  charCount: 4000,
  importedAt: '2026-07-01T00:00:00Z',
  importedBy: 'e2e@example.com',
  note: null,
};

const PROTOCOL_HEADERS = [
  'version', 'framework_type', 'research_question', 'inclusion_criteria', 'exclusion_criteria',
  'study_design', 'block_count', 'combination_expression', 'source_type', 'source_filename',
  'raw_text_ref', 'raw_text_preview', 'raw_text_inline', 'created_at', 'created_by',
];

const PROTOCOL_ROW = [
  '1', '', '', '', '', '', '0', '', 'manual', '', '', 'P: 成人肺炎', 'P: 成人肺炎',
  '2026-07-01T00:00:00Z', 'e2e@example.com',
];

/** Sheets / Drive / Gemini をスタブし、Gemini への送信回数を返す関数を返す */
async function stubApis(page: Page): Promise<() => number> {
  let llmRequests = 0;
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (route.request().method() !== 'GET') {
      await route.fulfill({ json: {} });
      return;
    }
    if (url.includes('Protocol')) {
      await route.fulfill({ json: { values: [PROTOCOL_HEADERS, PROTOCOL_ROW] } });
    } else if (url.includes('values:batchGet') && url.includes('Evidence')) {
      await route.fulfill({ json: { valueRanges: [{ values: [[...SHEET_HEADERS.Evidence]] }] } });
    } else if (url.includes('values:batchGet') && url.includes('ExtractionRuns')) {
      await route.fulfill({ json: { valueRanges: [{ values: [[...SHEET_HEADERS.ExtractionRuns]] }] } });
    } else {
      await route.fulfill({ json: { values: [] } });
    }
  });
  await page.route('https://www.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (url.includes('/drive/v3/files?q=')) {
      const name = /name = '([^']+)'/.exec(url)?.[1] ?? 'folder';
      await route.fulfill({ json: { files: [{ id: `${name}-id`, webViewLink: `https://drive.example/${name}` }] } });
      return;
    }
    if (url.includes('/drive/v3/files/txt-1?alt=media')) {
      await route.fulfill({ contentType: 'text/plain', body: 'Mortality was 12 percent' });
      return;
    }
    await route.fulfill({ json: { id: 'log-1', webViewLink: 'https://drive.example/log-1' } });
  });
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    llmRequests += 1;
    await route.fulfill({
      json: {
        candidates: [{ content: { parts: [{ text: '[]' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
        modelVersion: 'gemini-test-001',
      },
    });
  });
  return () => llmRequests;
}

async function initApp(page: Page): Promise<void> {
  await page.addInitScript(
    ({ document: doc }) => {
      const win = window as unknown as Record<string, unknown>;
      // 同意の記録は持たない（= 初回）。保存された値はページ内に保持し、テストから読めるようにする
      const stored: Record<string, unknown> = { 'secrets.geminiApiKey': 'e2e-api-key' };
      win.__E2E_STORED__ = stored;
      win.chrome = {
        storage: {
          local: {
            get: async (keys: string | string[]) => {
              const found: Record<string, unknown> = {};
              for (const key of Array.isArray(keys) ? keys : [keys]) {
                if (key in stored) found[key] = stored[key];
              }
              return found;
            },
            set: async (items: Record<string, unknown>) => {
              Object.assign(stored, items);
            },
            remove: async (key: string) => {
              delete stored[key];
            },
          },
        },
        runtime: {
          sendMessage: async (msg: { type?: string }) => {
            if (msg?.type === 'auth:get-token') return { ok: true, token: 'e2e-token' };
            if (msg?.type === 'auth:get-email') return { ok: true, email: 'e2e@example.com' };
            return { ok: true };
          },
          id: 'e2e-extension-id',
          getURL: (p: string) => `/${p}`,
          lastError: undefined,
          onMessageExternal: { addListener: () => undefined, removeListener: () => undefined },
        },
        tabs: {
          create: async () => ({ id: 1 }),
          remove: async () => undefined,
          onRemoved: { addListener: () => undefined, removeListener: () => undefined },
        },
        identity: {
          getProfileUserInfo: (_opts: unknown, cb: (info: unknown) => void) => {
            cb({ email: 'e2e@example.com', id: '1' });
          },
        },
      };
      win.__E2E_PRELOADED_STATE__ = {
        currentProject: {
          projectId: 'e2e-project',
          spreadsheetId: 'e2e-sheet',
          driveFolderId: 'e2e-folder',
          name: 'E2E プロジェクト',
        },
        counts: {
          documents: 1,
          protocolVersions: 1,
          schemaVersions: 1,
          pilotRuns: 0,
          evidenceRows: 0,
          dataRows: 0,
        },
        documents: {
          records: [doc],
          studies: [
            {
              studyId: 'study-1',
              reviewSet: null,
              studyLabel: 'smith2020.pdf',
              registrationId: null,
              createdAt: '2026-07-01T00:00:00Z',
              createdBy: 'e2e@example.com',
              note: null,
            },
          ],
          extractedStudyIds: [],
          ignoredCandidateKeys: [],
          loading: false,
          loadError: null,
          importing: false,
          importRows: [],
          selectedStudyIds: [],
          mergeDialog: null,
          merging: false,
          mergeError: null,
        },
        schema: {
          versions: [
            {
              schemaVersion: 1,
              parentVersion: null,
              protocolVersion: 1,
              createdByType: 'user_edit',
              createdAt: '2026-07-01T00:00:00Z',
              createdBy: 'e2e@example.com',
              note: null,
            },
          ],
          currentFields: [
            {
              maxQuotes: null,
              schemaVersion: 1,
              fieldId: 'f-total',
              fieldIndex: 1,
              section: 'results',
              fieldName: 'mortality_pct',
              fieldLabel: '死亡率',
              entityLevel: 'study',
              dataType: 'text',
              unit: null,
              allowedValues: null,
              required: true,
              extractionInstruction: 'Report overall mortality.',
              example: null,
              aiGenerated: false,
              note: null,
            },
          ],
          loading: false,
          loadError: null,
          drafting: false,
          draftElapsedSeconds: 0,
          draftError: null,
          selectedDocumentIds: [],
          model: '',
          editorRows: null,
          editorErrors: [],
          editorOrigin: 'user_edit',
          confirming: false,
        },
        pilot: {
          selectionInitialized: true,
          selectedStudyIds: ['study-1'],
          model: 'gemini-test',
          history: [],
          historyInitialized: true,
        },
      };
    },
    { document: DOCUMENT },
  );
  await page.goto('/app/app.html#/pilot');
}

test('初回の AI 機能の実行前に同意画面を出す。キャンセル・Esc では送らず、同意すると記録して送る', async ({ page }) => {
  const llmRequests = await stubApis(page);
  await initApp(page);

  const dialog = page.getByRole('dialog', { name: 'AI へ送る内容の確認' });
  const runButton = page.locator('#pilot-run');

  // 1) 開く: 送り先の名前・送る内容・扱いを示し、フォーカスはダイアログへ
  await runButton.focus();
  await runButton.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toContainText('設定した LLM API（Gemini）');
  await expect(dialog).toContainText('研究プロトコルの本文');
  await expect(dialog).toContainText('Gemini API の無料枠');
  await expect(dialog).toContainText('開発者のサーバーへは何も送りません');
  await expect(dialog.getByRole('link', { name: 'プライバシーポリシー' })).toHaveAttribute(
    'href',
    'https://youkiti.github.io/sr-data-extraction-plugin/privacy-policy.html?lang=ja',
  );
  await expect(dialog).toBeFocused();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  // Tab はダイアログ内で循環する（最後のボタンから先頭のリンクへ）
  await page.locator('#ai-data-consent-cancel').focus();
  await page.keyboard.press('Tab');
  await expect(dialog.locator('a').first()).toBeFocused();

  // 2) Esc: 閉じて何も送らない。画面は元のまま（エラーも実行中表示も出ない）
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(runButton).toBeFocused();
  await expect(page.locator('#pilot-run-error')).toHaveCount(0);
  await expect(runButton).toBeEnabled();

  // 3) キャンセル: 同じく何も送らない
  await runButton.click();
  await page.locator('#ai-data-consent-cancel').click();
  await expect(dialog).toHaveCount(0);
  expect(llmRequests()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __E2E_STORED__: Record<string, unknown> }).__E2E_STORED__.aiDataConsent)).toBeUndefined();

  // 4) 同意して続行: 記録して実行し、LLM へ送る
  await runButton.click();
  await page.locator('#ai-data-consent-accept').click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(llmRequests, { timeout: 15_000 }).toBeGreaterThan(0);
  const record = await page.evaluate(
    () => (window as unknown as { __E2E_STORED__: Record<string, unknown> }).__E2E_STORED__.aiDataConsent,
  );
  expect(record).toMatchObject({ version: 1 });
});

test('Options の「AI へ送る内容」で説明を見直し、同意と取り消しができる', async ({ page }) => {
  await page.addInitScript(`
    (() => {
      const data = { 'settings.llmProvider': 'anthropic' };
      window.chrome = {
        storage: {
          local: {
            get: async (key) => (key in data ? { [key]: data[key] } : {}),
            set: async (items) => { Object.assign(data, items); },
            remove: async (key) => { delete data[key]; },
          },
        },
        permissions: { request: async () => true },
        runtime: { getURL: (p) => '/' + p, lastError: undefined },
      };
    })();
  `);
  await page.goto('/options/options.html');
  const status = page.locator('#ai-data-consent-status');
  await expect(status).toHaveText('まだ同意していません。最初の AI 機能の実行前に確認します。');
  await expect(page.locator('#ai-data-consent-revoke')).toBeDisabled();

  await page.locator('#ai-data-consent-show').click();
  const dialog = page.getByRole('dialog', { name: 'AI へ送る内容の確認' });
  await expect(dialog).toContainText('設定した LLM API（Anthropic）');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await page.locator('#ai-data-consent-accept').click();
  await expect(dialog).toHaveCount(0);
  await expect(status).toContainText('同意済み');
  await expect(page.locator('#ai-data-consent-revoke')).toBeEnabled();

  await page.locator('#ai-data-consent-revoke').click();
  await expect(status).toHaveText('まだ同意していません。最初の AI 機能の実行前に確認します。');
});
