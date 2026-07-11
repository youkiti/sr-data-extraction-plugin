// #/schema（S5）のルート別 E2E（test-strategy.md §3 フェーズ 2 + ui-states.md §3）。
// 状態は __E2E_PRELOADED_STATE__ で注入し、Sheets API は page.route で stub する。
// LLM 呼び出し（draft-schema skill）は unit テストで検証済みのため、E2E では
// フォーム検証・エディタ操作・確定フローの配線と各状態の描画を検証する
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const SCHEMA_VERSIONS_HEADERS = [
  'schema_version', 'parent_version', 'protocol_version', 'created_by_type',
  'created_at', 'created_by', 'note',
];

const PROTOCOL_HEADERS = [
  'version', 'framework_type', 'research_question', 'inclusion_criteria', 'exclusion_criteria',
  'study_design', 'block_count', 'combination_expression', 'source_type', 'source_filename',
  'raw_text_ref', 'raw_text_preview', 'raw_text_inline', 'created_at', 'created_by',
];

const PROTOCOL_ROW = [
  '1', '', '', '', '', '', '0', '', 'manual', '', '', 'P: 成人肺炎', 'P: 成人肺炎',
  '2026-07-01T00:00:00Z', 'e2e@example.com',
];

function makeEditorRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fieldId: null,
    section: 'methods',
    fieldName: 'study_design',
    fieldLabel: '研究デザイン',
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: 'Report the design.',
    example: null,
    aiGenerated: true,
    note: null,
    ...overrides,
  };
}

// v0.10: 1 文書 = 1 study。document は study_id + document_role を持つ（study_label は Studies へ移設）
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
  pageCount: 2,
  charCount: 4000,
  importedAt: '2026-07-01T00:00:00Z',
  importedBy: 'e2e@example.com',
  note: null,
};

const EMPTY_SCHEMA_STATE = {
  versions: [],
  currentFields: [],
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
};

async function initApp(
  page: Page,
  schema: Record<string, unknown>,
  options: { schemaVersions?: number; documents?: Record<string, unknown>[] } = {},
): Promise<void> {
  await page.addInitScript(
    ({ schemaState, versions, documents }) => {
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
          documents: documents.length,
          protocolVersions: 1,
          schemaVersions: versions,
          pilotRuns: 0,
          evidenceRows: 0,
          dataRows: 0,
        },
        documents: {
          records: documents,
          studies: documents.map((doc) => ({
            studyId: doc.studyId,
            studyLabel: doc.filename,
            registrationId: null,
            createdAt: '2026-07-01T00:00:00Z',
            createdBy: 'e2e@example.com',
            note: null,
          })),
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
        schema: schemaState,
      };
    },
    {
      schemaState: schema,
      versions: options.schemaVersions ?? 0,
      documents: options.documents ?? [DOCUMENT],
    },
  );
  await page.goto('/app/app.html#/schema');
}

test('ドラフト前: サンプル論文セレクタとモデル選択を表示し、未選択の実行はエラー案内する', async ({ page }) => {
  await initApp(page, EMPTY_SCHEMA_STATE);

  await expect(page.locator('#schema-draft-form')).toBeVisible();
  await expect(page.locator('.schema__samples legend')).toContainText('0 / 3 本選択中');
  await expect(page.locator('#schema-sample-list input[type="checkbox"]')).toHaveCount(1);

  // 「その他（直接入力）」経由で単価表にないモデルを指定する（select + テキストの実弾検証）
  await page.locator('#schema-model').selectOption('__other__');
  await expect(page.locator('#schema-model-custom')).toBeVisible();
  await page.locator('#schema-model-custom').fill('gemini-test');
  await page.locator('#schema-model-custom').dispatchEvent('change');
  await page.locator('#schema-draft-run').click();
  await expect(page.locator('#schema-draft-error')).toContainText('1〜3 本選択');

  // 選択するとレジェンドのカウントが増える
  await page.locator('#schema-sample-list input[type="checkbox"]').check();
  await expect(page.locator('.schema__samples legend')).toContainText('1 / 3 本選択中');
});

test('ドラフト生成中: 経過時間つきの進捗表示', async ({ page }) => {
  await initApp(page, { ...EMPTY_SCHEMA_STATE, drafting: true, draftElapsedSeconds: 8 });
  await expect(page.locator('#schema-draft-progress')).toHaveText(
    'AI が表のデザインをドラフトしています…（8 秒経過）',
  );
});

test('エディタ: 行操作と検証エラー表示、確定ボタンの無効化', async ({ page }) => {
  await initApp(page, { ...EMPTY_SCHEMA_STATE, editorRows: [makeEditorRow()] });

  await expect(page.locator('#schema-editor-table tbody tr')).toHaveCount(1);
  await page.locator('#schema-add-row').click();
  await expect(page.locator('#schema-editor-table tbody tr')).toHaveCount(2);
  // 追加直後の空行は検証エラー（field_name 必須ほか）→ 確定ボタン無効
  await expect(page.locator('#schema-editor-errors')).toBeVisible();
  await expect(page.locator('#schema-confirm')).toBeDisabled();

  await page.locator('button[aria-label="2 行目を削除"]').click();
  await expect(page.locator('#schema-editor-table tbody tr')).toHaveCount(1);
  await expect(page.locator('#schema-confirm')).toBeEnabled();

  await page.locator('#schema-preset-binary').click();
  await expect(page.locator('#schema-editor-table tbody tr')).toHaveCount(3);

  // RoB 2 テンプレート挿入（判定 + 根拠の 2 行。entity_level は rob_domain）
  await page.locator('#schema-preset-rob2').click();
  await expect(page.locator('#schema-editor-table tbody tr')).toHaveCount(5);
  await expect(page.locator('input[aria-label="4 行目の field_name"]')).toHaveValue(
    'rob2_judgement',
  );
  await expect(page.locator('select[aria-label="4 行目の entity_level"]')).toHaveValue(
    'rob_domain',
  );

  // キャンセルでドラフト前へ戻る
  await page.locator('#schema-editor-cancel').click();
  await expect(page.locator('#schema-draft-form')).toBeVisible();
});

test('版として確定が SchemaVersions + SchemaFields の追記まで到達する', async ({ page }) => {
  const appendBodies: string[] = [];
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = route.request().url();
    if (route.request().method() === 'GET') {
      if (url.includes('Protocol')) {
        await route.fulfill({ json: { values: [PROTOCOL_HEADERS, PROTOCOL_ROW] } });
        return;
      }
      await route.fulfill({ json: { values: [SCHEMA_VERSIONS_HEADERS] } });
      return;
    }
    appendBodies.push(route.request().postData() ?? '');
    await route.fulfill({ json: {} });
  });
  await initApp(page, { ...EMPTY_SCHEMA_STATE, editorRows: [makeEditorRow()] });

  await page.locator('#schema-note').fill('初版');
  await page.locator('#schema-confirm').click();

  await expect(page.locator('.toast').last()).toHaveText('表のデザイン v1 を確定しました（1 項目）');
  await expect(page.locator('#schema-confirmed')).toBeVisible();
  await expect(page.locator('#schema-current-meta')).toContainText('現行版: v1');
  await expect(page.locator('#schema-current-table tbody tr')).toHaveCount(1);
  // SchemaVersions（1 行）と SchemaFields（1 行）の 2 回の追記
  expect(appendBodies.some((body) => body.includes('初版'))).toBe(true);
  expect(appendBodies.some((body) => body.includes('study_design'))).toBe(true);
});

test('確定済み: 現行版サマリから「新しい版を作る」でエディタへ引き継ぐ', async ({ page }) => {
  await initApp(
    page,
    {
      ...EMPTY_SCHEMA_STATE,
      versions: [
        {
          schemaVersion: 2,
          parentVersion: 1,
          protocolVersion: 1,
          createdByType: 'user_edit',
          createdAt: '2026-07-02T00:00:00Z',
          createdBy: 'e2e@example.com',
          note: '単位を修正',
        },
        {
          schemaVersion: 1,
          parentVersion: null,
          protocolVersion: 1,
          createdByType: 'ai_draft',
          createdAt: '2026-07-01T00:00:00Z',
          createdBy: 'e2e@example.com',
          note: null,
        },
      ],
      currentFields: [
        {
          schemaVersion: 2,
          fieldId: 'f-1',
          fieldIndex: 1,
          section: 'methods',
          fieldName: 'study_design',
          fieldLabel: '研究デザイン',
          entityLevel: 'study',
          dataType: 'text',
          unit: null,
          allowedValues: null,
          required: true,
          extractionInstruction: 'Report the design.',
          example: null,
          aiGenerated: true,
          note: null,
        },
      ],
    },
    { schemaVersions: 2 },
  );

  await expect(page.locator('#schema-current-meta')).toContainText('現行版: v2');
  await expect(page.locator('#schema-current-meta')).toContainText('手動編集');
  await expect(page.locator('text=改訂理由: 単位を修正')).toBeVisible();
  await expect(page.locator('#schema-history li')).toHaveCount(2);
  await expect(page.locator('#schema-history li').first()).toContainText('v1 から派生');

  await page.locator('#schema-new-version').click();
  await expect(page.locator('#schema-editor')).toBeVisible();
  await expect(
    page.locator('input[aria-label="1 行目の field_name"]'),
  ).toHaveValue('study_design');
});

test('アクセシビリティ違反がない（axe・ドラフト前）', async ({ page }) => {
  await initApp(page, EMPTY_SCHEMA_STATE);
  await expect(page.locator('#schema-draft-form')).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('アクセシビリティ違反がない（axe・エディタ）', async ({ page }) => {
  await initApp(page, { ...EMPTY_SCHEMA_STATE, editorRows: [makeEditorRow()] });
  await expect(page.locator('#schema-editor')).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
