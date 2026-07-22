// #/documents（S3）のルート別 E2E（test-strategy.md §3 フェーズ 2 + ui-states.md §3 + requirements.md §4.5）。
// v0.10: study 単位グループ表示・インライン編集・統合ダイアログ・統合候補バナー。
// 状態は __E2E_PRELOADED_STATE__ で注入し、Sheets API は page.route で stub する。
// Picker はホスト済みページ + externally_connectable のため E2E 対象外
import { createHash } from 'node:crypto';
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
    // 文献除外機能（issue #181）。既定は除外なし
    excluded: false,
    exclusionReason: null,
    exclusionNote: null,
    excludedAt: null,
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

/** テキスト層つきの最小 1 ページ PDF（app-verify.spec.ts 等と同じ手組み構成） */
function minimalPdf(text: string): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '',
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = pdf.length;
    pdf += objects[i];
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

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
        // 認証は SW ブローカーへの sendMessage 経由（issue #129）
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
  await expect(page.locator('.documents__badge-note')).toHaveText('pdf_native 抽出・ハイライトは AI 推定（bbox）');
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
      { key: 's1', filename: 'a.pdf', status: 'copy', detail: null },
      { key: 's2', filename: 'b.pdf', status: 'extract', detail: null },
      { key: 's3', filename: 'c.pdf', status: 'failed', detail: 'コピーに失敗: 403' },
      { key: 's4', filename: 'd.pdf', status: 'skipped', detail: '取り込み済みのためスキップ' },
    ],
  }));

  const rows = page.locator('#documents-progress li');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('コピー中…');
  await expect(rows.nth(1)).toContainText('テキスト抽出中…');
  await expect(rows.nth(2)).toContainText('失敗（コピーに失敗: 403）');
  await expect(rows.nth(3)).toContainText('スキップ（取り込み済みのためスキップ）');
  await expect(page.locator('#documents-import')).toBeDisabled();
  await expect(page.locator('#documents-local-import')).toBeDisabled();
  await expect(page.locator('#documents-dropzone')).toHaveClass(/documents__dropzone--disabled/);
});

test('ローカル取り込み: ドロップゾーンに案内文 + ファイル選択ボタンを集約し、有効時は disabled でない', async ({ page }) => {
  await initApp(page, docsState());
  await expect(page.locator('#documents-dropzone')).toBeVisible();
  await expect(page.locator('#documents-dropzone')).toContainText('PDF をここにドラッグ&ドロップ');
  // ローカル選択ボタン + 隠し input はドロップゾーンの内側に置く
  await expect(page.locator('#documents-dropzone #documents-local-import')).toHaveText(
    '💻 PC からファイルを選択',
  );
  await expect(page.locator('#documents-local-import')).toBeEnabled();
  await expect(page.locator('#documents-file-input')).toBeHidden();
  await expect(page.locator('.view__lead')).toContainText(
    'この PC から PDF をドラッグ&ドロップ / ファイル選択できます',
  );
});

test('ローカル取り込み: ファイル選択ダイアログで PDF をアップロードし進捗行が完了する', async ({ page }) => {
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === 'POST' && url.includes(':append')) {
      await route.fulfill({ json: {} });
      return;
    }
    // フォルダ解決（ensureChildFolder）などの GET は空応答で十分
    await route.fulfill({ json: { values: [] } });
  });
  await page.route('https://www.googleapis.com/drive/v3/files**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      // ensureChildFolder の検索は「未存在」を返して新規作成させる
      await route.fulfill({ json: { files: [] } });
      return;
    }
    await route.fulfill({ json: { id: 'created-folder', webViewLink: 'https://drive/folder' } });
  });
  await page.route('https://www.googleapis.com/upload/drive/v3/files**', async (route) => {
    await route.fulfill({ json: { id: 'uploaded-1', webViewLink: 'https://drive/uploaded-1' } });
  });

  await initApp(page, docsState({ records: [], studies: [] }));

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('#documents-local-import').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: 'local.pdf',
    mimeType: 'application/pdf',
    buffer: minimalPdf('Local upload smoke test'),
  });

  await expect(page.locator('#documents-progress li').first()).toContainText('完了', { timeout: 10000 });
});

test('重複スキップ: 内容が同一のローカル PDF は取り込まず、スキップ理由と専用トーストを出す（issue #102）', async ({ page }) => {
  // 取り込み済みの凍結コピー（drive-doc-1）と同一内容のバッファを再取り込みさせる
  const buffer = minimalPdf('Duplicate import check');
  const md5 = createHash('md5').update(buffer).digest('hex');
  let uploadCalled = false;
  let appendCalled = false;

  await page.route('https://sheets.googleapis.com/**', async (route) => {
    if (route.request().method() === 'POST' && route.request().url().includes(':append')) {
      appendCalled = true;
    }
    await route.fulfill({ json: { values: [] } });
  });
  await page.route('https://www.googleapis.com/drive/v3/files**', async (route) => {
    const url = decodeURIComponent(route.request().url()).replace(/\+/g, ' ');
    if (route.request().method() === 'GET') {
      if (url.includes("mimeType='application/vnd.google-apps.folder'")) {
        // ensureChildFolder: documents/ / extracted_texts/ は既存として返す
        await route.fulfill({ json: { files: [{ id: 'sub-folder', webViewLink: 'https://drive/sub' }] } });
        return;
      }
      // listFolderPdfs: 既存レコードの凍結コピーが同じ md5 を持つ
      await route.fulfill({
        json: { files: [{ id: 'drive-doc-1', name: 'smith2020.pdf', md5Checksum: md5 }] },
      });
      return;
    }
    await route.fulfill({ json: { id: 'created', webViewLink: 'https://drive/created' } });
  });
  await page.route('https://www.googleapis.com/upload/drive/v3/files**', async (route) => {
    uploadCalled = true;
    await route.fulfill({ json: { id: 'uploaded-dup', webViewLink: 'https://drive/uploaded-dup' } });
  });

  await initApp(page, docsState({ records: [RECORDS[0]], studies: [STUDIES[0]] }));

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('#documents-local-import').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({ name: 'copy-of-smith.pdf', mimeType: 'application/pdf', buffer });

  await expect(page.locator('#documents-progress li').first()).toContainText(
    'スキップ（内容が同一の PDF が取り込み済みのためスキップ）',
    { timeout: 10000 },
  );
  await expect(page.locator('.toast').last()).toHaveText('取り込み済みのため 1 件をスキップしました');
  // 新規レコードは作られない（アップロードも Documents 追記も走らない）
  expect(uploadCalled).toBe(false);
  expect(appendCalled).toBe(false);
  await expect(page.locator('.documents__study-group')).toHaveCount(1);
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

// 文献除外機能（issue #181）
test('文書の除外: 除外済みセクションへ移動し、解除ボタンで元に戻る', async ({ page }) => {
  const recordA = makeRecord({ documentId: 'doc-1a', studyId: 'study-1', documentRole: 'article', filename: 'smith2020.pdf', textStatus: 'ok', pageCount: 12 });
  const recordB = makeRecord({ documentId: 'doc-1b', studyId: 'study-1', documentRole: 'supplement', filename: 'smith2020-appendix.pdf', textStatus: 'ok', pageCount: 3 });
  const docRow = (documentId: string, filename: string, role: string): string[] => [
    documentId, 'study-1', role, `drive-${documentId}`, `src-${documentId}`, filename,
    '', '', `https://drive.google.com/file/d/txt-${documentId}/view`, 'ok', '12', '24000',
    '2026-07-02T00:00:00Z', 'e2e@example.com', '', 'FALSE', '', '', '',
  ];
  const batchUpdateBodies: string[] = [];
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const req = route.request();
    const url = decodeURIComponent(req.url());
    const method = req.method();
    // ensureDocumentExclusionColumns: ヘッダ行（既にフル列数）を返す
    if (method === 'GET' && url.includes('values:batchGet')) {
      await route.fulfill({ json: { valueRanges: [{ values: [[...SHEET_HEADERS.Documents]] }] } });
      return;
    }
    if (method === 'POST' && url.includes('values:batchUpdate')) {
      batchUpdateBodies.push(req.postData() ?? '');
      await route.fulfill({ json: {} });
      return;
    }
    // updateDocuments の行番号解決（fetchDocuments）: 現在値は問わず妥当な行を返せばよい
    // （楽観反映はクライアント側の state 更新で行われ、Sheets を読み直さないため）
    if (method === 'GET' && url.includes('/values/Documents')) {
      await route.fulfill({
        json: {
          values: [
            [...SHEET_HEADERS.Documents],
            docRow('doc-1a', 'smith2020.pdf', 'article'),
            docRow('doc-1b', 'smith2020-appendix.pdf', 'supplement'),
          ],
        },
      });
      return;
    }
    await route.fulfill({ json: { values: [] } });
  });

  await initApp(page, docsState({ records: [recordA, recordB], studies: [STUDIES[0]] }));

  await expect(page.locator('.documents__exclude-doc')).toHaveCount(2);
  await page.locator('.documents__exclude-doc').first().click();
  await expect(page.locator('#exclusion-dialog')).toBeVisible();
  // 文書単位は理由未選択でも確定できる
  await expect(page.locator('#exclusion-confirm')).toBeEnabled();
  await page.locator('#exclusion-confirm').click();

  await expect(page.locator('#exclusion-dialog')).toHaveCount(0);
  await expect(page.locator('.documents__excluded summary')).toHaveText('除外済み (1)');
  await expect(
    page.locator('.documents__docs-table:not(.documents__docs-table--excluded) .documents__doc-filename'),
  ).toHaveText('smith2020-appendix.pdf');
  await expect(page.locator('.toast').last()).toHaveText('smith2020.pdf を抽出候補から除外しました');

  // 除外済みセクションを開いて解除する
  await page.locator('.documents__excluded summary').click();
  await page.locator('.documents__restore-doc').click();

  await expect(page.locator('.documents__excluded')).toHaveCount(0);
  await expect(page.locator('.documents__exclude-doc')).toHaveCount(2);
  await expect(page.locator('.toast').last()).toHaveText('smith2020.pdf の除外を解除しました');
  expect(batchUpdateBodies.length).toBe(2);
});

test('study の除外: 理由未選択は確定不可・選択後に確定すると全除外注記 + 解除ボタンを表示する', async ({ page }) => {
  const record = makeRecord({ documentId: 'doc-1', studyId: 'study-1', documentRole: 'article', filename: 'smith2020.pdf', textStatus: 'ok', pageCount: 12 });
  const docRow = [
    'doc-1', 'study-1', 'article', 'drive-doc-1', 'src-doc-1', 'smith2020.pdf', '', '',
    'https://drive.google.com/file/d/txt-doc-1/view', 'ok', '12', '24000',
    '2026-07-02T00:00:00Z', 'e2e@example.com', '', 'FALSE', '', '', '',
  ];
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const req = route.request();
    const url = decodeURIComponent(req.url());
    const method = req.method();
    if (method === 'GET' && url.includes('values:batchGet')) {
      await route.fulfill({ json: { valueRanges: [{ values: [[...SHEET_HEADERS.Documents]] }] } });
      return;
    }
    if (method === 'POST' && url.includes('values:batchUpdate')) {
      await route.fulfill({ json: {} });
      return;
    }
    if (method === 'GET' && url.includes('/values/Documents')) {
      await route.fulfill({ json: { values: [[...SHEET_HEADERS.Documents], docRow] } });
      return;
    }
    await route.fulfill({ json: { values: [] } });
  });

  await initApp(page, docsState({ records: [record], studies: [STUDIES[0]] }));

  await page.locator('.documents__exclude-study').click();
  await expect(page.locator('#exclusion-dialog-title')).toHaveText('study を抽出候補から除外しますか？');
  await expect(page.locator('#exclusion-reason-hint')).toBeVisible();
  await expect(page.locator('#exclusion-confirm')).toBeDisabled();

  await page.locator('#exclusion-reason').selectOption('duplicate');
  await expect(page.locator('#exclusion-confirm')).toBeEnabled();
  await page.locator('#exclusion-confirm').click();

  await expect(page.locator('#exclusion-dialog')).toHaveCount(0);
  await expect(page.locator('.documents__all-excluded-note')).toBeVisible();
  await expect(page.locator('.documents__restore-study')).toBeVisible();
  await expect(page.locator('.toast').last()).toHaveText('Smith 2020 を抽出候補から除外しました');
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

test('tiab-review 取り込み: 導線ボタン → プレビュー（Sheets 直読み stub）→ 実行で反映結果を表示する', async ({ page }) => {
  const refHeader = ['ref_id', 'title', 'abstract', 'year', 'authors', 'doi', 'pmid', 'fulltext_url'];
  const decHeader = ['decision_id', 'ref_id', 'reviewer_id', 'decision', 'reason', 'labels', 'note', 'decided_at', 'client_version', 'source_url', 'screening_phase'];
  const studyRow = ['study-1', 'Smith 2020', '', '2026-07-02T00:00:00Z', 'e2e@example.com', ''];
  const batchUpdateBodies: string[] = [];
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const req = route.request();
    const url = decodeURIComponent(req.url());
    const method = req.method();
    if (method === 'POST' && url.includes('values:batchUpdate')) {
      batchUpdateBodies.push(req.postData() ?? '');
      await route.fulfill({ json: {} });
      return;
    }
    if (method === 'GET' && url.includes('values:batchGet')) {
      // tiab シートの References / Decisions（fulltext 相の include 1 件）
      await route.fulfill({
        json: {
          valueRanges: [
            {
              values: [
                refHeader,
                ['r1', 'Effect of X on Y', '', '2020', 'Smith, John; Doe, A', '10.1000/xyz', '123', 'https://drive.google.com/file/d/src-doc-1/view'],
              ],
            },
            {
              values: [
                decHeader,
                ['d1', 'r1', 'a@example.com', 'include', '', '', '', '2026-07-01T00:00:00Z', '', '', 'fulltext'],
              ],
            },
          ],
        },
      });
      return;
    }
    if (method === 'GET' && url.includes('/values/Config')) {
      await route.fulfill({ json: { values: [['fulltext_ai_active_round', '']] } });
      return;
    }
    if (method === 'GET' && url.includes('/values/Documents')) {
      const docRow = [
        'doc-1', 'study-1', 'article', 'drive-doc-1', 'src-doc-1', 'smith2020.pdf',
        '123', '10.1000/xyz', 'https://drive.google.com/file/d/txt-doc-1/view', 'ok', '12', '24000',
        '2026-07-02T00:00:00Z', 'e2e@example.com', '',
      ];
      await route.fulfill({ json: { values: [[...SHEET_HEADERS.Documents], docRow] } });
      return;
    }
    if (method === 'GET' && url.includes('/values/Studies')) {
      await route.fulfill({ json: { values: [[...SHEET_HEADERS.Studies], studyRow] } });
      return;
    }
    await route.fulfill({ json: { values: [[...SHEET_HEADERS.ExtractionRuns]] } });
  });

  await initApp(page, docsState({ records: [RECORDS[0]], studies: [STUDIES[0]] }));

  // 導線ボタン → カードを開く
  await page.locator('#documents-tiab-open').click();
  await expect(page.locator('#documents-tiab')).toBeVisible();

  // URL を入れてプレビュー
  await page.locator('#tiab-sheet-input').fill('https://docs.google.com/spreadsheets/d/tiab-sheet-1/edit');
  await page.locator('#tiab-preview').click();
  await expect(page.locator('#tiab-summary')).toContainText(
    '最終判定 include 1 件（全文スクリーニングの判定・全 1 件中）',
  );
  await expect(page.locator('#tiab-plan tbody tr')).toHaveCount(1);
  await expect(page.locator('.documents__tiab-status--update')).toHaveText('反映');

  // 実行 → Studies（study_label）+ Documents（pmid / doi 転記）の batchUpdate が各 1 回 + 結果サマリ
  await page.locator('#tiab-apply').click();
  await expect(page.locator('#tiab-result')).toContainText(
    'study_label 1 件を更新し、DOI / PMID を 1 文書に転記しました',
  );
  await expect(page.locator('.toast').last()).toHaveText('tiab-review の採用リストを反映しました');
  expect(batchUpdateBodies).toHaveLength(2);
  expect(batchUpdateBodies[0]).toContain('Studies!A2');
  expect(batchUpdateBodies[0]).toContain('Smith (2020)');
  expect(batchUpdateBodies[1]).toContain('Documents!A2');
  expect(batchUpdateBodies[1]).toContain('10.1000/xyz');
});

test('tiab-review 取り込み: 不正入力はインラインエラー（role=alert）', async ({ page }) => {
  await initApp(page, docsState());
  await page.locator('#documents-tiab-open').click();
  await page.locator('#tiab-sheet-input').fill('not a sheet url');
  await page.locator('#tiab-preview').click();
  await expect(page.locator('#tiab-error')).toContainText('URL または ID を入力してください');
  await expect(page.locator('#tiab-error')).toHaveAttribute('role', 'alert');
  // 閉じると導線ボタンへ戻る
  await page.locator('#tiab-close').click();
  await expect(page.locator('#documents-tiab')).toHaveCount(0);
  await expect(page.locator('#documents-tiab-open')).toBeVisible();
});

test('tiab-review 取り込み: 404（drive.file 未許可）は Picker 許可導線を表示する（issue #142。Picker 本体は seam でスタブ）', async ({ page }) => {
  // tiab-review は別 OAuth クライアントが作成したシートのため、drive.file スコープでは
  // 初回 403/404 になる（#128〜#132）。References / Decisions の batchGet を 404 で応答させる
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const req = route.request();
    const url = decodeURIComponent(req.url());
    if (req.method() === 'GET' && url.includes('values:batchGet')) {
      await route.fulfill({ status: 404, json: { error: { message: 'not found' } } });
      return;
    }
    await route.fulfill({ json: { values: [] } });
  });

  await initApp(page, docsState());
  await page.locator('#documents-tiab-open').click();
  await page.locator('#tiab-sheet-input').fill('https://docs.google.com/spreadsheets/d/tiab-sheet-1/edit');
  await page.locator('#tiab-preview').click();

  const error = page.locator('#tiab-error');
  await expect(error).toContainText('このスプレッドシートを開く権限がまだありません');
  await expect(error).toHaveAttribute('role', 'alert');
  const grant = page.locator('#tiab-grant-access');
  await expect(grant).toBeVisible();
  await expect(grant).toHaveText('Google で許可する');

  // Picker 本体はホスト済みページ + externally_connectable のため E2E 対象外（他 spec と同じ方針。
  // hosted-picker.spec.ts が別途分岐を検証する）。ここではクリックで Picker 起動導線（二重起動防止の
  // disabled 化）まで配線されていることだけを確認する
  await grant.click();
  await expect(grant).toBeDisabled();
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
    // tiab-review 取り込みカード（issue #68）もプレビュー + エラー表示込みで検査する
    tiabImport: {
      open: true,
      sheetInput: 'https://docs.google.com/spreadsheets/d/tiab-sheet-1/edit',
      loading: false,
      error: 'テスト用のエラー表示',
      plan: {
        phase: 'fulltext',
        totalReferences: 2,
        includeCount: 1,
        items: [
          {
            refId: 'r1',
            title: 'Effect of X on Y',
            studyLabel: 'Smith (2020)',
            status: 'update',
            matchedFilenames: ['smith2020.pdf'],
          },
        ],
        studyUpdates: [makeStudy('study-1', 'Smith (2020)', null)],
        documentUpdates: [],
      },
      applying: false,
      result: { studiesUpdated: 1, documentsUpdated: 0, unmatched: 0 },
    },
  }));
  await expect(page.locator('.documents__study-group')).toHaveCount(3);
  await expect(page.locator('#merge-dialog')).toBeVisible();
  await expect(page.locator('#documents-tiab')).toBeVisible();
  await expect(page.locator('#tiab-plan')).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
