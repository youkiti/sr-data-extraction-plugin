// #/extract（S7）のルート別 E2E（test-strategy.md §3 + ui-states.md §3）。
// 状態は __E2E_PRELOADED_STATE__ で注入し、Sheets / Drive / Gemini は page.route で stub する。
// 未実行（未抽出の既定選択 + 抽出済みバッジ + コスト概算 + 確認ゲート）と、
// 実行 → 一部失敗（LLM 400）→ 再試行成功 → 完了までの本流を実弾で通す
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const RUNS_HEADERS = [
  'run_id', 'run_type', 'schema_version', 'document_ids', 'provider', 'requested_model',
  'model_version', 'input_mode', 'status', 'started_at', 'finished_at', 'tokens_in',
  'tokens_out', 'cost_estimate',
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

const STUDY_DATA_HEADERS = [
  'document_id', 'annotator', 'annotator_type', 'schema_version', 'run_id', 'updated_at',
];

const RESULTS_DATA_HEADERS = [
  'result_id', 'document_id', 'field_id', 'annotator', 'annotator_type', 'schema_version',
  'entity_key', 'run_id', 'value', 'not_reported', 'updated_at',
];

const DOC_OK = {
  documentId: 'doc-1',
  studyLabel: 'Smith 2020',
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

const DOC_FAIL = {
  ...DOC_OK,
  documentId: 'doc-2',
  studyLabel: 'Jones 2021',
  driveFileId: 'drive-2',
  filename: 'jones2021.pdf',
  textRef: 'https://drive.google.com/file/d/txt-2/view',
};

const DOC_NO_TEXT = {
  ...DOC_OK,
  documentId: 'doc-3',
  studyLabel: 'Scan 2019',
  filename: 'scan.pdf',
  textRef: null,
  textStatus: 'no_text_layer',
};

const SCHEMA_SLICE = {
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
};

interface InitOptions {
  documents?: Record<string, unknown>[];
  extract?: Record<string, unknown>;
  pilotRuns?: number;
  apiKey?: string;
}

async function initApp(page: Page, options: InitOptions = {}): Promise<void> {
  await page.addInitScript(
    ({ documents, extract, pilotRuns, apiKey, schema }) => {
      const win = window as unknown as Record<string, unknown>;
      const stored: Record<string, unknown> =
        apiKey === null ? {} : { 'secrets.geminiApiKey': apiKey };
      win.chrome = {
        storage: {
          local: {
            get: async (keys: string | string[]) => {
              const wanted = Array.isArray(keys) ? keys : [keys];
              const found: Record<string, unknown> = {};
              for (const key of wanted) {
                if (key in stored) {
                  found[key] = stored[key];
                }
              }
              return found;
            },
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
          schemaVersions: 1,
          pilotRuns,
          evidenceRows: 0,
          dataRows: 0,
        },
        documents: {
          records: documents,
          loading: false,
          loadError: null,
          importing: false,
          importRows: [],
        },
        schema,
        extract,
      };
    },
    {
      documents: options.documents ?? [DOC_OK, DOC_FAIL, DOC_NO_TEXT],
      extract: options.extract ?? {},
      pilotRuns: options.pilotRuns ?? 1,
      apiKey: options.apiKey ?? null,
      schema: SCHEMA_SLICE,
    },
  );
  await page.goto('/app/app.html#/extract');
}

test('未実行: 未抽出の既定選択 + 抽出済みバッジ + コスト概算 + 実行前バリデーション', async ({ page }) => {
  // ExtractionRuns に doc-2 の run が 1 件 → doc-2 は抽出済み（既定選択から外す）
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (route.request().method() === 'GET' && url.includes('ExtractionRuns')) {
      await route.fulfill({
        json: {
          values: [
            RUNS_HEADERS,
            ['run-0', 'pilot', '1', 'doc-2', 'gemini', 'gemini-test', '', 'text_only', 'done',
              't1', 't2', '', '', ''],
          ],
        },
      });
      return;
    }
    await route.fulfill({ json: { values: [] } });
  });

  await initApp(page, { pilotRuns: 0 });

  // パイロット未実施の警告バナー（ui-flow.md §4）
  await expect(page.locator('#extract-pilot-warning')).toContainText('パイロット抽出を推奨します');

  // 既定選択 = 未抽出の全件（doc-1 のみ）。抽出済みバッジ + no_text_layer は選択不可
  await expect(page.locator('#extract-documents li')).toHaveCount(3);
  const checkboxes = page.locator('#extract-documents input[type="checkbox"]');
  await expect(checkboxes.nth(0)).toBeChecked();
  await expect(checkboxes.nth(1)).not.toBeChecked();
  await expect(checkboxes.nth(2)).toBeDisabled();
  await expect(page.locator('.extract__doc-extracted')).toHaveText('抽出済み');
  await expect(page.locator('.extract__doc-note')).toContainText('テキスト層なし');

  // コスト概算。モデルは S6/S5 未入力のためプルダウンから選択（単価表のモデル → 金額表示）
  await page.locator('#extract-model').selectOption('gemini-2.0-flash');
  await expect(page.locator('#extract-estimate')).toContainText('コスト概算: $');
  await expect(page.locator('#extract-estimate')).toContainText('1 バッチ');

  // API キー未設定 → 確認カードを出さずインラインエラー（ui-states.md §3）
  await page.locator('#extract-run').click();
  await expect(page.locator('#extract-run-error')).toContainText('Gemini API キーが未設定です');
  await expect(page.locator('#extract-confirm')).toHaveCount(0);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('実行確認 → 一部失敗 → 再試行成功 → 完了（ExtractionRuns / Evidence 追記）', async ({ page }) => {
  const appendUrls: string[] = [];
  let geminiFailsForDoc2 = true;

  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (route.request().method() === 'GET') {
      if (url.includes('Protocol')) {
        await route.fulfill({ json: { values: [PROTOCOL_HEADERS, PROTOCOL_ROW] } });
      } else if (url.includes('StudyData')) {
        await route.fulfill({ json: { values: [STUDY_DATA_HEADERS] } });
      } else if (url.includes('ResultsData')) {
        await route.fulfill({ json: { values: [RESULTS_DATA_HEADERS] } });
      } else {
        await route.fulfill({ json: { values: [] } });
      }
      return;
    }
    appendUrls.push(url);
    await route.fulfill({ json: {} });
  });

  await page.route('https://www.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (url.includes('/upload/drive/v3/files')) {
      await route.fulfill({ json: { id: 'log-1', webViewLink: 'https://drive.example/log-1' } });
      return;
    }
    if (url.includes('/drive/v3/files?q=')) {
      const name = /name = '([^']+)'/.exec(url)?.[1] ?? 'folder';
      await route.fulfill({
        json: { files: [{ id: `${name}-id`, webViewLink: `https://drive.example/${name}` }] },
      });
      return;
    }
    if (url.includes('/drive/v3/files/txt-1?alt=media')) {
      await route.fulfill({ contentType: 'text/plain', body: 'Mortality was 12 percent' });
      return;
    }
    if (url.includes('/drive/v3/files/txt-2?alt=media')) {
      await route.fulfill({ contentType: 'text/plain', body: 'FAILDOC mortality was 9 percent' });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const body = route.request().postData() ?? '';
    if (body.includes('FAILDOC') && geminiFailsForDoc2) {
      // 400 は withRetry の再試行対象外 → このバッチだけ即失敗する
      await route.fulfill({ status: 400, json: { error: { message: 'bad request' } } });
      return;
    }
    await route.fulfill({
      json: {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    {
                      field_id: 'f-total',
                      entity_key: '-',
                      value: '12',
                      not_reported: false,
                      quote: 'Mortality was 12 percent',
                      page: 1,
                      confidence: 'high',
                    },
                  ]),
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
        modelVersion: 'gemini-test-001',
      },
    });
  });

  await initApp(page, {
    apiKey: 'e2e-api-key',
    extract: {
      selectionInitialized: true,
      selectedDocumentIds: ['doc-1', 'doc-2'],
      model: 'gemini-test',
      extractedDocumentIds: [],
    },
  });

  // 実行 → 確認カード（確認を経ずに実行は始まらない）
  await page.locator('#extract-run').click();
  await expect(page.locator('#extract-confirm')).toContainText(
    '対象 2 件をモデル gemini-test で抽出します。',
  );
  expect(appendUrls.filter((url) => url.includes('ExtractionRuns'))).toHaveLength(0);

  // キャンセル → カードが閉じる → もう一度開いて実行
  await page.locator('#extract-confirm-cancel').click();
  await expect(page.locator('#extract-confirm')).toHaveCount(0);
  await page.locator('#extract-run').click();
  await page.locator('#extract-confirm-run').click();

  // 完了（partial_failure）: 黄バナー + document 進捗リスト（完了 / 失敗）+ 再試行
  await expect(page.locator('#extract-partial-failure')).toContainText(
    '1 件の文献で失敗しました。再試行できます',
    { timeout: 15_000 },
  );
  const rows = page.locator('#extract-doc-list .extract__doc-row');
  await expect(rows.nth(0)).toContainText('完了');
  await expect(rows.nth(0)).toContainText('Smith 2020');
  await expect(rows.nth(1)).toContainText('失敗');
  await expect(rows.nth(1)).toContainText('api_error');
  await expect
    .poll(() => appendUrls.filter((url) => url.includes('ExtractionRuns!A1:append')).length)
    .toBe(1);
  expect(appendUrls.some((url) => url.includes('Evidence!A1:append'))).toBe(true);

  const partialAxe = await new AxeBuilder({ page }).analyze();
  expect(partialAxe.violations).toEqual([]);

  // 再試行（single_document）→ 全行完了 + バナー消滅 + 検証への導線
  geminiFailsForDoc2 = false;
  await page.locator('.extract__retry').click();
  await expect(page.locator('#extract-run-done')).toHaveText('一括抽出が完了しました。', {
    timeout: 15_000,
  });
  await expect(page.locator('#extract-partial-failure')).toHaveCount(0);
  await expect(rows.nth(1)).toContainText('完了');
  await expect
    .poll(() => appendUrls.filter((url) => url.includes('ExtractionRuns!A1:append')).length)
    .toBe(2);
  await expect(page.locator('#extract-verify-link')).toHaveAttribute('href', '#/verify');
});
