// #/documents（S3）のルート別 E2E（test-strategy.md §3 フェーズ 2 + ui-states.md §3 + requirements.md §4.5）。
// v0.10: study 単位グループ表示・インライン編集・統合ダイアログ・統合候補バナー。
// 状態は __E2E_PRELOADED_STATE__ で注入し、Sheets API は page.route で stub する。
// Picker はホスト済みページ + externally_connectable のため E2E 対象外
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SHEET_HEADERS } from '../../src/domain/sheetsSchema';

interface DocumentSeed {
  documentId: string;
  studyId: string;
  documentRole: 'article' | 'registration' | 'protocol' | 'abstract' | 'supplement' | 'other';
  filename: string;
  textStatus: 'ok' | 'partial' | 'no_text_layer';
  pageCount: number | null;
}

function makeRecord(seed: DocumentSeed): Record<string, unknown> {
  return {
    documentId: seed.documentId,
    studyId: seed.studyId,
    documentRole: seed.documentRole,
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

function makeStudy(studyId: string, studyLabel: string, registrationId: string | null): Record<string, unknown> {
  return {
    studyId,
    studyLabel,
    registrationId,
    createdAt: '2026-07-02T00:00:00Z',
    createdBy: 'e2e@example.com',
    note: null,
  };
}

const RECORDS = [
  makeRecord({ documentId: 'doc-1', studyId: 'study-1', documentRole: 'article', filename: 'smith2020.pdf', textStatus: 'ok', pageCount: 12 }),
  makeRecord({ documentId: 'doc-2', studyId: 'study-2', documentRole: 'article', filename: 'jones2021.pdf', textStatus: 'partial', pageCount: 8 }),
  makeRecord({ documentId: 'doc-3', studyId: 'study-3', documentRole: 'article', filename: 'brown2019.pdf', textStatus: 'no_text_layer', pageCount: null }),
];

const STUDIES = [
  makeStudy('study-1', 'Smith 2020', null),
  makeStudy('study-2', 'Jones 2021', null),
  makeStudy('study-3', 'Brown 2019', null),
];

function docsState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    records: RECORDS,
    studies: STUDIES,
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
    ...overrides,
  };
}

async function initApp(page: Page, documents: Record<string, unknown>): Promise<void> {
  await page.addInitScript((docsStateArg) => {
    const win = window as unknown as Record<string, unknown>;
    win.chrome = {
      storage: {
        local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
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
        getAuthToken: (_opts: unknown, cb: (token?: string) => void) => cb('e2e-token'),
        removeCachedAuthToken: (_details: unknown, cb: () => void) => cb(),
        getProfileUserInfo: (_opts: unknown, cb: (info: unknown) => void) =>
          cb({ email: 'e2e@example.com', id: '1' }),
      },
    };
    win.__E2E_PRELOADED_STATE__ = {
      currentProject: {
        projectId: 'e2e-project',
        spreadsheetId: 'e2e-sheet',
        driveFolderId: 'e2e-folder',
        name: 'E2E プロジェクト',
      },
      counts: { documents: 3, protocolVersions: 1, schemaVersions: 1, pilotRuns: 1, evidenceRows: 10, dataRows: 10 },
      documents: docsStateArg,
    };
  }, documents);
  await page.goto('/app/app.html#/documents');
}

test('一覧: study 単位グループと role セレクト・text_status バッジ・編集入力を表示する', async ({ page }) => {
  await initApp(page, docsState());

  await expect(page.locator('.documents__study-group')).toHaveCount(3);
  await expect(page.locator('.documents__label-input').first()).toHaveValue('Smith 2020');
  await expect(page.locator('.documents__registration-input').first()).toHaveValue('');
  await expect(page.locator('.documents__role-select').first()).toHaveValue('article');
  await expect(page.locator('.documents__badge--ok')).toHaveText('ok');
  await expect(page.locator('.documents__badge--partial')).toHaveText('partial');
  await expect(page.locator('.documents__badge--no_text_layer')).toHaveText('no_text_layer');
  await expect(page.locator('.documents__badge-note')).toHaveText('pdf_native 抽出のみ・ハイライト不可');
  await expect(page.locator('.view__notice')).toContainText('取り込んだ PDF が外部へ送信されるのは LLM API への抽出リクエストのみです');
  // 選択 0 件では統合ボタンは無効
  await expect(page.locator('#documents-merge')).toBeDisabled();
});

test('空状態: 取り込みボタンと空状態説明を表示する', async ({ page }) => {
  await initApp(page, docsState({ records: [], studies: [] }));
  await expect(page.locator('#documents-empty')).toContainText('まだ文献がありません');
  await expect(page.locator('#documents-import')).toBeEnabled();
  await expect(page.locator('.documents__study-group')).toHaveCount(0);
});

test('取り込み中: 進捗行（コピー → テキスト抽出の 2 段階）とボタン無効化', async ({ page }) => {
  await initApp(page, docsState({
    records: [],
    studies: [],
    importing: true,
    importRows: [
      { sourceFileId: 's1', filename: 'a.pdf', status: 'copy', detail: null },
      { sourceFileId: 's2', filename: 'b.pdf', status: 'extract', detail: null },
      { sourceFileId: 's3', filename: 'c.pdf', status: 'failed', detail: 'コピーに失敗: 403' },
    ],
  }));

  const rows = page.locator('#documents-progress li');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('コピー中…');
  await expect(rows.nth(1)).toContainText('テキスト抽出中…');
  await expect(rows.nth(2)).toContainText('失敗（コピーに失敗: 403）');
  await expect(page.locator('#documents-import')).toBeDisabled();
});

test('study_label のインライン編集が Studies 更新（GET + PUT）まで到達する', async ({ page }) => {
  const studyRow = ['study-1', 'Smith 2020', '', '2026-07-02T00:00:00Z', 'e2e@example.com', ''];
  let updateBody: string | null = null;
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { values: [[...SHEET_HEADERS.Studies], studyRow] } });
      return;
    }
    updateBody = route.request().postData();
    await route.fulfill({ json: {} });
  });
  await initApp(page, docsState({ records: RECORDS.slice(0, 1), studies: STUDIES.slice(0, 1) }));

  const input = page.locator('.documents__label-input').first();
  await input.fill('Smith 2020a');
  await input.press('Enter');

  await expect(page.locator('.toast').last()).toHaveText('study_label を保存しました');
  expect(updateBody).toContain('Smith 2020a');
  await expect(page.locator('.documents__label-input').first()).toHaveValue('Smith 2020a');
});

test('統合シナリオ: 2 study を選択 → 統合ダイアログ → 確定で Studies 追記 + Documents 付け替え', async ({ page }) => {
  const documentsRow = (documentId: string, studyId: string): string[] => [
    documentId, studyId, 'article', `drive-${documentId}`, `src-${documentId}`, `${documentId}.pdf`,
    '', '', `https://drive.google.com/file/d/txt-${documentId}/view`, 'ok', '24000', '12',
    '2026-07-02T00:00:00Z', 'e2e@example.com', '',
  ];
  const studyRow = (studyId: string, label: string): string[] => [
    studyId, label, '', '2026-07-02T00:00:00Z', 'e2e@example.com', '',
  ];

  let merged = false;
  let appendedStudies: string | null = null;
  const updatedDocs: string[] = [];
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (method === 'POST' && url.includes(':append')) {
      if (url.includes('Studies')) {
        appendedStudies = req.postData();
        merged = true;
      }
      await route.fulfill({ json: {} });
      return;
    }
    if (method === 'PUT') {
      updatedDocs.push(req.postData() ?? '');
      await route.fulfill({ json: {} });
      return;
    }
    // GET: タブ名で分岐（更新後は付け替え済みを返す）
    if (url.includes('Documents')) {
      const rows = merged
        ? [documentsRow('doc-1', 'study-new'), documentsRow('doc-2', 'study-new')]
        : [documentsRow('doc-1', 'study-1'), documentsRow('doc-2', 'study-2')];
      await route.fulfill({ json: { values: [[...SHEET_HEADERS.Documents], ...rows] } });
      return;
    }
    if (url.includes('Studies')) {
      const rows = merged
        ? [studyRow('study-1', 'Smith 2020'), studyRow('study-2', 'Jones 2021'), studyRow('study-new', 'Smith 2020')]
        : [studyRow('study-1', 'Smith 2020'), studyRow('study-2', 'Jones 2021')];
      await route.fulfill({ json: { values: [[...SHEET_HEADERS.Studies], ...rows] } });
      return;
    }
    // ExtractionRuns（coverage）・その他はヘッダのみ
    await route.fulfill({ json: { values: [[...SHEET_HEADERS.ExtractionRuns]] } });
  });

  await initApp(page, docsState({
    records: [RECORDS[0], RECORDS[1]],
    studies: [STUDIES[0], STUDIES[1]],
  }));

  await expect(page.locator('.documents__study-group')).toHaveCount(2);
  // study を 2 件チェック
  await page.locator('.documents__study-check').nth(0).check();
  await page.locator('.documents__study-check').nth(1).check();
  await expect(page.locator('#documents-merge')).toBeEnabled();
  await page.locator('#documents-merge').click();

  // 統合ダイアログ（alertdialog）
  await expect(page.locator('#merge-dialog')).toBeVisible();
  await expect(page.locator('#merge-label')).toHaveValue('Smith 2020');
  await page.locator('#merge-confirm').click();

  await expect(page.locator('.toast').last()).toContainText('試験を統合しました');
  expect(appendedStudies).toContain('Smith 2020');
  expect(updatedDocs.length).toBe(2);
  // 再読込後は統合後の 1 study だけがアクティブ（study-new に 2 文書）
  await expect(page.locator('.documents__study-group')).toHaveCount(1);
});

test('統合候補バナー: 同じ登録番号のアクティブ study が複数なら候補を出す', async ({ page }) => {
  await initApp(page, docsState({
    records: [RECORDS[0], RECORDS[1]],
    studies: [makeStudy('study-1', 'Smith 2020', 'NCT01234567'), makeStudy('study-2', 'Smith 2020 reg', 'NCT01234567')],
  }));
  await expect(page.locator('.documents__candidate')).toHaveCount(1);
  await expect(page.locator('.documents__candidate')).toContainText('NCT01234567');
  await expect(page.locator('.documents__candidate-merge')).toBeVisible();
  await expect(page.locator('.documents__candidate-ignore')).toBeVisible();
});

test('アクセシビリティ違反がない（axe）', async ({ page }) => {
  await initApp(page, docsState({
    studies: [makeStudy('study-1', 'Smith 2020', 'NCT01234567'), makeStudy('study-2', 'Smith 2020 reg', 'NCT01234567'), STUDIES[2]],
    mergeDialog: {
      studyIds: ['study-1', 'study-2'],
      label: 'Smith 2020',
      registrationId: 'NCT01234567',
      hasExtractedData: true,
    },
  }));
  await expect(page.locator('.documents__study-group')).toHaveCount(3);
  await expect(page.locator('#merge-dialog')).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
