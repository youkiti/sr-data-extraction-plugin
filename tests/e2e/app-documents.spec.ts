// #/documents（S3）のルート別 E2E（test-strategy.md §3 フェーズ 2 + ui-states.md §3）。
// 状態は __E2E_PRELOADED_STATE__ で注入し、Sheets API は page.route で stub する。
// Picker はホスト済みページ + externally_connectable のため E2E 対象外
// （openPdfPicker のプロトコルは unit テストで検証済み）
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

interface DocumentSeed {
  documentId: string;
  studyLabel: string;
  filename: string;
  textStatus: 'ok' | 'partial' | 'no_text_layer';
  pageCount: number | null;
}

function makeRecord(seed: DocumentSeed): Record<string, unknown> {
  return {
    documentId: seed.documentId,
    studyLabel: seed.studyLabel,
    driveFileId: `drive-${seed.documentId}`,
    sourceFileId: `src-${seed.documentId}`,
    filename: seed.filename,
    pmid: null,
    doi: null,
    textRef: seed.textStatus === 'no_text_layer' ? null : `https://drive.google.com/file/d/txt-${seed.documentId}/view`,
    textStatus: seed.textStatus,
    pageCount: seed.pageCount,
    charCount: seed.pageCount === null ? null : seed.pageCount * 2000,
    importedAt: '2026-07-02T00:00:00Z',
    importedBy: 'e2e@example.com',
    note: null,
  };
}

const RECORDS = [
  makeRecord({ documentId: 'doc-1', studyLabel: 'Smith 2020', filename: 'smith2020.pdf', textStatus: 'ok', pageCount: 12 }),
  makeRecord({ documentId: 'doc-2', studyLabel: 'Jones 2021', filename: 'jones2021.pdf', textStatus: 'partial', pageCount: 8 }),
  makeRecord({ documentId: 'doc-3', studyLabel: 'Brown 2019', filename: 'brown2019.pdf', textStatus: 'no_text_layer', pageCount: null }),
];

async function initApp(
  page: Page,
  documents: Record<string, unknown>,
): Promise<void> {
  await page.addInitScript((docsState) => {
    const win = window as unknown as Record<string, unknown>;
    win.chrome = {
      storage: {
        local: {
          get: async () => ({}),
          set: async () => undefined,
          remove: async () => undefined,
        },
      },
      runtime: {
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
        getAuthToken: (_opts: unknown, cb: (token?: string) => void) => {
          cb('e2e-token');
        },
        removeCachedAuthToken: (_details: unknown, cb: () => void) => {
          cb();
        },
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
        documents: 3,
        protocolVersions: 1,
        schemaVersions: 1,
        pilotRuns: 1,
        evidenceRows: 10,
        dataRows: 10,
      },
      documents: docsState,
    };
  }, documents);
  await page.goto('/app/app.html#/documents');
}

test('一覧 N 件: text_status バッジ・注記・study_label 入力を表示する', async ({ page }) => {
  await initApp(page, { records: RECORDS, loading: false, loadError: null, importing: false, importRows: [] });

  await expect(page.locator('#documents-table tbody tr')).toHaveCount(3);
  await expect(page.locator('.documents__badge--ok')).toHaveText('ok');
  await expect(page.locator('.documents__badge--partial')).toHaveText('partial');
  await expect(page.locator('.documents__badge--no_text_layer')).toHaveText('no_text_layer');
  await expect(page.locator('.documents__badge-note')).toHaveText('pdf_native 抽出のみ・ハイライト不可');
  await expect(page.locator('.documents__label-input').first()).toHaveValue('Smith 2020');
  // 常時表示の著作権注意書き（チェック UI は無い）
  await expect(page.locator('.view__notice')).toContainText('著作権フリー / 利用許諾済みの PDF のみ取り込んでください');
  await expect(page.locator('#documents-import')).toBeEnabled();
});

test('空状態: 取り込みボタンと空状態説明を表示する', async ({ page }) => {
  await initApp(page, { records: [], loading: false, loadError: null, importing: false, importRows: [] });

  await expect(page.locator('#documents-empty')).toContainText('まだ文献がありません');
  await expect(page.locator('#documents-import')).toBeEnabled();
  await expect(page.locator('#documents-table')).toBeHidden();
});

test('取り込み中: 進捗行（コピー → テキスト抽出の 2 段階）とボタン無効化', async ({ page }) => {
  await initApp(page, {
    records: [],
    loading: false,
    loadError: null,
    importing: true,
    importRows: [
      { sourceFileId: 's1', filename: 'a.pdf', status: 'copy', detail: null },
      { sourceFileId: 's2', filename: 'b.pdf', status: 'extract', detail: null },
      { sourceFileId: 's3', filename: 'c.pdf', status: 'failed', detail: 'コピーに失敗: 403' },
    ],
  });

  const rows = page.locator('#documents-progress li');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('コピー中…');
  await expect(rows.nth(1)).toContainText('テキスト抽出中…');
  await expect(rows.nth(2)).toContainText('失敗（コピーに失敗: 403）');
  await expect(page.locator('#documents-import')).toBeDisabled();
});

test('study_label のインライン編集が Sheets 更新（GET + PUT）まで到達する', async ({ page }) => {
  const HEADERS = [
    'document_id', 'study_label', 'drive_file_id', 'source_file_id', 'filename', 'pmid', 'doi',
    'text_ref', 'text_status', 'page_count', 'char_count', 'imported_at', 'imported_by', 'note',
  ];
  const row = [
    'doc-1', 'Smith 2020', 'drive-doc-1', 'src-doc-1', 'smith2020.pdf', '', '',
    'https://drive.google.com/file/d/txt-doc-1/view', 'ok', '12', '24000',
    '2026-07-02T00:00:00Z', 'e2e@example.com', '',
  ];
  let updateBody: string | null = null;
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { values: [HEADERS, row] } });
      return;
    }
    updateBody = route.request().postData();
    await route.fulfill({ json: {} });
  });
  await initApp(page, { records: RECORDS.slice(0, 1), loading: false, loadError: null, importing: false, importRows: [] });

  const input = page.locator('.documents__label-input');
  await input.fill('Smith 2020a');
  await input.press('Enter');

  await expect(page.locator('.toast').last()).toHaveText('study_label を保存しました');
  expect(updateBody).toContain('Smith 2020a');
  await expect(page.locator('.documents__label-input')).toHaveValue('Smith 2020a');
});

test('アクセシビリティ違反がない（axe）', async ({ page }) => {
  await initApp(page, { records: RECORDS, loading: false, loadError: null, importing: false, importRows: [] });
  await expect(page.locator('#documents-table tbody tr')).toHaveCount(3);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
