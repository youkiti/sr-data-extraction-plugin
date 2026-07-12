// #/extract（S7）のルート別 E2E（test-strategy.md §3 + ui-states.md §3）。
// 状態は __E2E_PRELOADED_STATE__ で注入し、Sheets / Drive / Gemini は page.route で stub する。
// 未実行（未抽出の既定選択 + 抽出済みバッジ + コスト概算 + 確認ゲート）と、
// 実行 → 一部失敗（LLM 400）→ 再試行成功 → 完了までの本流を実弾で通す
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SHEET_HEADERS } from '../../src/domain/sheetsSchema';

const RUNS_HEADERS = [...SHEET_HEADERS.ExtractionRuns];

const PROTOCOL_HEADERS = [
  'version', 'framework_type', 'research_question', 'inclusion_criteria', 'exclusion_criteria',
  'study_design', 'block_count', 'combination_expression', 'source_type', 'source_filename',
  'raw_text_ref', 'raw_text_preview', 'raw_text_inline', 'created_at', 'created_by',
];

const PROTOCOL_ROW = [
  '1', '', '', '', '', '', '0', '', 'manual', '', '', 'P: 成人肺炎', 'P: 成人肺炎',
  '2026-07-01T00:00:00Z', 'e2e@example.com',
];

const STUDY_DATA_HEADERS = [...SHEET_HEADERS.StudyData];

const RESULTS_DATA_HEADERS = [...SHEET_HEADERS.ResultsData];

// v0.10: 1 文書 = 1 study。document は study_id + document_role を持つ（study_label は Studies へ移設）
const DOC_OK = {
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

const DOC_FAIL = {
  ...DOC_OK,
  documentId: 'doc-2',
  studyId: 'study-2',
  driveFileId: 'drive-2',
  filename: 'jones2021.pdf',
  textRef: 'https://drive.google.com/file/d/txt-2/view',
};

const DOC_NO_TEXT = {
  ...DOC_OK,
  documentId: 'doc-3',
  studyId: 'study-3',
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
  schema?: Record<string, unknown>;
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
        schema,
        extract,
      };
    },
    {
      documents: options.documents ?? [DOC_OK, DOC_FAIL, DOC_NO_TEXT],
      extract: options.extract ?? {},
      pilotRuns: options.pilotRuns ?? 1,
      apiKey: options.apiKey ?? null,
      schema: options.schema ?? SCHEMA_SLICE,
    },
  );
  await page.goto('/app/app.html#/extract');
}

test('未実行: 未抽出の既定選択 + 抽出済みバッジ + 中断バナー + コスト概算 + 実行前バリデーション', async ({ page }) => {
  // ExtractionRuns に doc-2 の完了 run が 1 件 → doc-2 は抽出済み（既定選択から外す）。
  // doc-1 は running 行のみの中断 run → 未抽出のまま既定選択に含まれ、中断バナーが出る
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (route.request().method() === 'GET' && url.includes('ExtractionRuns')) {
      await route.fulfill({
        json: {
          values: [
            RUNS_HEADERS,
            // study_ids 列（4 列目）。study-2（doc-2）は完了 run で抽出済み。
            // study-1（doc-1）は running 行のみの中断 run → 未抽出のまま
            ['run-0', 'pilot', '1', 'study-2', 'gemini', 'gemini-test', '', 'text_only', 'done',
              't1', 't2', '', '', ''],
            ['run-1', 'full', '1', 'study-1', 'gemini', 'gemini-test', '', 'text_only', 'running',
              't3', '', '', '', ''],
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

  // 中断 run（running 行のみ）の残り文献バナー（requirements.md §3.2 の 2 行プロトコル）
  await expect(page.locator('#extract-interrupted-warning')).toContainText(
    '前回の抽出が途中で中断されています（未完了 1 件）',
  );

  // 既定選択 = 未抽出の全 study（study-1・study-3）。抽出済みバッジ + no_text_layer も
  // pdf_native で選択可（handoff-scanned-pdf-native-highlight.md §7.4 PR2）
  await expect(page.locator('#extract-studies > li')).toHaveCount(3);
  const checkboxes = page.locator('#extract-studies input[type="checkbox"]');
  await expect(checkboxes.nth(0)).toBeChecked();
  await expect(checkboxes.nth(1)).not.toBeChecked();
  await expect(checkboxes.nth(2)).toBeChecked();
  await expect(checkboxes.nth(2)).toBeEnabled();
  await expect(page.locator('.extract__doc-extracted')).toHaveText('抽出済み');
  // テキスト層が無い study は選択できるが pdf_native（画像送信）の注記が出る
  await expect(page.locator('.extract__doc-note').first()).toContainText(
    'テキスト層なし: ページ画像を LLM へ送信して抽出します',
  );

  // コスト概算。モデルは S6/S5 未入力のためプルダウンから選択（単価表のモデル → 金額表示）。
  // 既定選択が study-1（text_only）+ study-3（pdf_native）の 2 study = 2 バッチ
  await page.locator('#extract-model').selectOption('gemini-2.0-flash');
  await expect(page.locator('#extract-estimate')).toContainText('コスト概算: $');
  await expect(page.locator('#extract-estimate')).toContainText('2 バッチ');

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
      } else if (url.includes('values:batchGet') && url.includes('Evidence')) {
        // Evidence タブのヘッダ拡張チェック（ensureEvidenceBboxColumns。§7.4 PR3）。
        // 既にフルヘッダ（bbox 5 列込み）が書かれている想定にして拡張 PUT を no-op にする
        await route.fulfill({
          json: { valueRanges: [{ values: [[...SHEET_HEADERS.Evidence]] }] },
        });
      } else if (url.includes('values:batchGet') && url.includes('ExtractionRuns')) {
        // ExtractionRuns タブのヘッダ拡張チェック（ensureRunFieldIdsColumn。issue #80）。
        // 既にフルヘッダ（field_ids 込み 15 列）が書かれている想定にして拡張 PUT を no-op にする
        await route.fulfill({
          json: { valueRanges: [{ values: [[...SHEET_HEADERS.ExtractionRuns]] }] },
        });
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
      selectedStudyIds: ['study-1', 'study-2'],
      model: 'gemini-test',
      extractedStudyIds: [],
    },
  });

  // 実行 → 確認カード（確認を経ずに実行は始まらない）
  await page.locator('#extract-run').click();
  await expect(page.locator('#extract-confirm')).toContainText(
    '対象 2 試験をモデル gemini-test で抽出します。',
  );
  expect(appendUrls.filter((url) => url.includes('ExtractionRuns'))).toHaveLength(0);

  // キャンセル → カードが閉じる → もう一度開いて実行
  await page.locator('#extract-confirm-cancel').click();
  await expect(page.locator('#extract-confirm')).toHaveCount(0);
  await page.locator('#extract-run').click();
  await page.locator('#extract-confirm-run').click();

  // 完了（partial_failure）: 黄バナー + study 進捗リスト（完了 / 失敗）+ 再試行
  await expect(page.locator('#extract-partial-failure')).toContainText(
    '1 件の試験で失敗しました。再試行できます',
    { timeout: 15_000 },
  );
  const rows = page.locator('#extract-study-list .extract__doc-row');
  await expect(rows.nth(0)).toContainText('完了');
  await expect(rows.nth(0)).toContainText('smith2020.pdf');
  await expect(rows.nth(1)).toContainText('失敗');
  await expect(rows.nth(1)).toContainText('api_error');
  // 2 行プロトコル: run 1 回 = running 行 + 完了行の 2 追記
  await expect
    .poll(() => appendUrls.filter((url) => url.includes('ExtractionRuns!A1:append')).length)
    .toBe(2);
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
    .toBe(4); // full run + single_document run × 各 2 行
  await expect(page.locator('#extract-verify-link')).toHaveAttribute('href', '#/verify');
});

test('対象項目チェックリスト: 一部解除 → 確認カードに反映 → 実行 → ExtractionRuns の field_ids 列に記録される（issue #80）', async ({ page }) => {
  const appended: { url: string; body: unknown }[] = [];

  const TWO_FIELD_SCHEMA = {
    ...SCHEMA_SLICE,
    currentFields: [
      SCHEMA_SLICE.currentFields[0],
      {
        ...SCHEMA_SLICE.currentFields[0],
        fieldId: 'f-age',
        fieldIndex: 2,
        fieldName: 'age_mean',
        fieldLabel: '平均年齢',
      },
    ],
  };

  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (route.request().method() === 'GET') {
      if (url.includes('Protocol')) {
        await route.fulfill({ json: { values: [PROTOCOL_HEADERS, PROTOCOL_ROW] } });
      } else if (url.includes('StudyData')) {
        await route.fulfill({ json: { values: [STUDY_DATA_HEADERS] } });
      } else if (url.includes('ResultsData')) {
        await route.fulfill({ json: { values: [RESULTS_DATA_HEADERS] } });
      } else if (url.includes('values:batchGet') && url.includes('Evidence')) {
        await route.fulfill({
          json: { valueRanges: [{ values: [[...SHEET_HEADERS.Evidence]] }] },
        });
      } else if (url.includes('values:batchGet') && url.includes('ExtractionRuns')) {
        await route.fulfill({
          json: { valueRanges: [{ values: [[...SHEET_HEADERS.ExtractionRuns]] }] },
        });
      } else {
        await route.fulfill({ json: { values: [] } });
      }
      return;
    }
    appended.push({ url, body: route.request().postDataJSON() });
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
    await route.fulfill({ json: {} });
  });

  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
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
    documents: [DOC_OK],
    schema: TWO_FIELD_SCHEMA,
    extract: {
      selectionInitialized: true,
      selectedStudyIds: ['study-1'],
      model: 'gemini-test',
      extractedStudyIds: [],
    },
  });

  // 対象項目チェックリスト: 2 件表示（既定は全選択）→ 2 件目（平均年齢）を解除
  const fieldCheckboxes = page.locator('.extract__field-checkbox');
  await expect(fieldCheckboxes).toHaveCount(2);
  await expect(fieldCheckboxes.nth(0)).toBeChecked();
  await expect(fieldCheckboxes.nth(1)).toBeChecked();
  await expect(page.locator('#extract-field-summary')).toHaveText('対象項目: 全項目（2）');
  await fieldCheckboxes.nth(1).uncheck();
  await expect(page.locator('#extract-field-summary')).toHaveText('対象項目: 1 / 2');

  // 実行確認カードに選択数が反映される
  await page.locator('#extract-run').click();
  await expect(page.locator('#extract-confirm-fields')).toHaveText('対象項目: 1 / 2');

  await page.locator('#extract-confirm-run').click();
  await expect(page.locator('#extract-run-done')).toHaveText('一括抽出が完了しました。', {
    timeout: 15_000,
  });

  // ExtractionRuns の running 行・完了行の両方に field_ids（f-total のみ）が記録されている
  const runsAppends = appended.filter((entry) => entry.url.includes('ExtractionRuns!A1:append'));
  expect(runsAppends).toHaveLength(2);
  for (const entry of runsAppends) {
    const values = (entry.body as { values: unknown[][] }).values;
    const row = values[0] as unknown[];
    expect(row[row.length - 1]).toBe('f-total');
  }

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
