// #/schema（S5）のルート別 E2E（test-strategy.md §3 フェーズ 2 + ui-states.md §3）。
// 状態は __E2E_PRELOADED_STATE__ で注入し、Sheets API は page.route で stub する。
// LLM 呼び出し（draft-schema skill）は unit テストで検証済みのため、E2E では
// フォーム検証・エディタ操作・確定フローの配線と各状態の描画を検証する
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SHEET_HEADERS } from '../../src/domain/sheetsSchema';
import { serializeSchemaExport } from '../../src/features/schema/schemaTransfer';

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
    maxQuotes: null,
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
  options: {
    schemaVersions?: number;
    documents?: Record<string, unknown>[];
    /** 陳腐化バナー（issue #197）検証用。指定時のみ protocol.records へ 1 件注入する */
    protocolVersion?: number;
  } = {},
): Promise<void> {
  await page.addInitScript(
    ({ schemaState, versions, documents, protocolVersion }) => {
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
            reviewSet: null,
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
        ...(protocolVersion === null
          ? {}
          : {
              protocol: {
                records: [
                  {
                    version: protocolVersion,
                    frameworkType: null,
                    researchQuestion: '',
                    inclusionCriteria: null,
                    exclusionCriteria: null,
                    studyDesign: null,
                    blockCount: 0,
                    combinationExpression: '',
                    sourceType: 'manual',
                    sourceFilename: null,
                    rawTextRef: null,
                    rawTextPreview: null,
                    rawTextInline: 'P: 成人肺炎',
                    createdAt: '2026-07-01T00:00:00Z',
                    createdBy: 'e2e@example.com',
                  },
                ],
              },
            }),
      };
    },
    {
      schemaState: schema,
      versions: options.schemaVersions ?? 0,
      documents: options.documents ?? [DOCUMENT],
      protocolVersion: options.protocolVersion ?? null,
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

  // RoB 2 テンプレート挿入（issue #103: まず事前設定ダイアログが開く。
  // スキップで従来どおり判定 + 根拠の 2 行。entity_level は rob_domain）
  await page.locator('#schema-preset-rob2').click();
  await expect(page.locator('#schema-preset-dialog')).toBeVisible();
  await expect(page.locator('#schema-editor-table tbody tr')).toHaveCount(3);
  await page.locator('#schema-prespec-skip').click();
  await expect(page.locator('#schema-preset-dialog')).toHaveCount(0);
  await expect(page.locator('#schema-editor-table tbody tr')).toHaveCount(5);
  await expect(page.locator('input[aria-label="4 行目の field_name"]')).toHaveValue(
    'rob2_judgement',
  );
  await expect(page.locator('select[aria-label="4 行目の entity_level"]')).toHaveValue(
    'rob_domain',
  );

  // QUADAS-3 テンプレート挿入（issue #88 + #103 PR3 + #109 PR3: ダイアログをスキップして
  // risk-of-bias 判定 + 根拠 + 適用可能性判定 + 根拠 + SQ 20 問 + Phase 3 flow 6 項目
  // + Phase 4 estimate 記述 7 項目 = 37 行）
  await page.locator('#schema-preset-quadas3').click();
  await expect(page.locator('#schema-preset-dialog')).toBeVisible();
  await page.locator('#schema-prespec-skip').click();
  await expect(page.locator('#schema-editor-table tbody tr')).toHaveCount(42);
  await expect(page.locator('input[aria-label="6 行目の field_name"]')).toHaveValue(
    'quadas3_rob_judgement',
  );
  await expect(page.locator('select[aria-label="6 行目の entity_level"]')).toHaveValue(
    'rob_domain',
  );
  // Phase 3 flow は study レベル・Phase 4 estimate 記述は outcome_result レベル（issue #109 PR3）
  await expect(page.locator('input[aria-label="30 行目の field_name"]')).toHaveValue(
    'quadas3_flow_diagram',
  );
  await expect(page.locator('select[aria-label="30 行目の entity_level"]')).toHaveValue('study');
  await expect(page.locator('input[aria-label="36 行目の field_name"]')).toHaveValue(
    'quadas3_est_participants',
  );
  await expect(page.locator('select[aria-label="36 行目の entity_level"]')).toHaveValue(
    'outcome_result',
  );

  // QUIPS テンプレート挿入（issue #88 + #103 PR3: ダイアログをスキップして従来どおり
  // 判定 + 根拠 + prompting item 12 問 = 14 行。overall は無い）
  await page.locator('#schema-preset-quips').click();
  await expect(page.locator('#schema-preset-dialog')).toBeVisible();
  await page.locator('#schema-prespec-skip').click();
  await expect(page.locator('#schema-editor-table tbody tr')).toHaveCount(56);
  await expect(page.locator('input[aria-label="43 行目の field_name"]')).toHaveValue(
    'quips_judgement',
  );

  // キャンセルでドラフト前へ戻る
  await page.locator('#schema-editor-cancel').click();
  await expect(page.locator('#schema-draft-form')).toBeVisible();
});

test('エディタ: ↑ で上へ移動 → 表の並びが変わる（issue #230）', async ({ page }) => {
  // 初期状態から 2 行を積んでおく（セル入力の fill → change コミットは別々のラウンド
  // トリップになり、その間の再描画で入力前の値に巻き戻るレースが CI で露出したため、
  // 未コミットの DOM 値には依存しない構成にする）
  await initApp(page, {
    ...EMPTY_SCHEMA_STATE,
    editorRows: [makeEditorRow(), makeEditorRow({ fieldName: 'country' })],
  });

  await expect(page.locator('#schema-editor-table tbody tr')).toHaveCount(2);
  // 移動前の並び（study_design / country）を明示的に確認してから移動する
  await expect(page.locator('input[aria-label="1 行目の field_name"]')).toHaveValue(
    'study_design',
  );
  await expect(page.locator('input[aria-label="2 行目の field_name"]')).toHaveValue('country');

  await page.locator('button[aria-label="2 行目を上へ移動"]').click();
  // 移動後は 1 行目が country、2 行目が study_design になる
  await expect(page.locator('input[aria-label="1 行目の field_name"]')).toHaveValue('country');
  await expect(page.locator('input[aria-label="2 行目の field_name"]')).toHaveValue(
    'study_design',
  );
  // 移動後、先頭行の↑は disabled になるため、フォーカスは逆向き（↓）に戻る
  await expect(page.locator('button[aria-label="1 行目を下へ移動"]')).toBeFocused();
});

test('RoB 2 事前設定ダイアログ: rob2_sq の必須検証と adhering の SQ セット切替（issue #103）', async ({
  page,
}) => {
  await initApp(page, { ...EMPTY_SCHEMA_STATE, editorRows: [makeEditorRow()] });

  await page.locator('#schema-preset-rob2-sq').click();
  await expect(page.locator('#schema-preset-dialog')).toBeVisible();
  await expect(page.locator('#schema-prespec-design')).toContainText(
    'individually-randomized parallel-group trial',
  );
  // SQ 完全版は effect が必須のためスキップボタンが無い
  await expect(page.locator('#schema-prespec-skip')).toHaveCount(0);

  // effect 未選択のまま挿入 → 必須未充足エラー（行は挿入されない）
  await page.locator('#schema-prespec-confirm').click();
  await expect(page.locator('#schema-prespec-error')).toContainText('effect of interest');
  await expect(page.locator('#schema-editor-table tbody tr')).toHaveCount(1);

  // adhering を選ぶと deviation 種別チェックが現れ、未チェックのままはエラー
  await page.locator('#schema-prespec-effect-adhering').check();
  await expect(page.locator('#schema-prespec-deviations')).toBeVisible();
  await page.locator('#schema-prespec-confirm').click();
  await expect(page.locator('#schema-prespec-error')).toContainText('最低 1 つ');

  // 種別を 1 つチェックして挿入 → 判定 + 根拠 + SQ 21 問（adhering 版 D2 = 2.1〜2.6）の 23 行
  await page.locator('#schema-prespec-dev-non-adherence').check();
  await page.locator('#schema-prespec-confirm').click();
  await expect(page.locator('#schema-preset-dialog')).toHaveCount(0);
  await expect(page.locator('#schema-editor-table tbody tr')).toHaveCount(24);
  await expect(page.locator('input[aria-label="2 行目の field_name"]')).toHaveValue(
    'rob2_judgement',
  );
  // 抽出指示の冒頭に Review context（英文サマリ）が注入されている
  await expect(page.locator('textarea[aria-label="2 行目の抽出指示"]')).toHaveValue(
    /^Review context/,
  );

  // キャンセルで閉じられる（再挿入時のダイアログ復元も確認: note から adhering が初期選択される）
  await page.locator('#schema-preset-rob2-sq').click();
  await expect(page.locator('#schema-prespec-effect-adhering')).toBeChecked();
  await expect(page.locator('#schema-prespec-dev-non-adherence')).toBeChecked();
  await page.locator('#schema-prespec-cancel').click();
  await expect(page.locator('#schema-preset-dialog')).toHaveCount(0);
  await expect(page.locator('#schema-editor-table tbody tr')).toHaveCount(24);
});

test('ROBINS-I 事前設定ダイアログ: robins_i_sq の必須検証と D4 排他切替（issue #103 PR2）', async ({
  page,
}) => {
  await initApp(page, { ...EMPTY_SCHEMA_STATE, editorRows: [makeEditorRow()] });

  await page.locator('#schema-preset-robins-i-sq').click();
  await expect(page.locator('#schema-preset-dialog')).toBeVisible();
  // SQ 完全版は effect が必須のためスキップボタンが無い
  await expect(page.locator('#schema-prespec-skip')).toHaveCount(0);

  // effect 未選択のまま挿入 → 必須未充足エラー（行は挿入されない）
  await page.locator('#schema-prespec-confirm').click();
  await expect(page.locator('#schema-prespec-error')).toContainText('effect of interest');
  await expect(page.locator('#schema-editor-table tbody tr')).toHaveCount(1);

  // starting and adhering を選び、confounders リストを入力して挿入
  // → D4 は 4.3〜4.6 のみ（判定 + 根拠 + SQ 32 問 = 34 行）
  await page.locator('#schema-prespec-ri-effect-adhering').check();
  const confounders = page.locator('#schema-prespec-ri-confounders');
  await confounders.fill('age\nseverity');
  // change イベント（blur 時発火）による store 更新 → 再描画を待ってから確定する
  // （再描画中に click が落ちるレースを避ける）
  await confounders.blur();
  await expect(page.locator('#schema-prespec-ri-confounders')).toHaveValue('age\nseverity');
  await page.locator('#schema-prespec-confirm').click();
  await expect(page.locator('#schema-preset-dialog')).toHaveCount(0);
  await expect(page.locator('#schema-editor-table tbody tr')).toHaveCount(35);
  await expect(page.locator('input[aria-label="2 行目の field_name"]')).toHaveValue(
    'robins_i_judgement',
  );
  await expect(page.locator('textarea[aria-label="2 行目の抽出指示"]')).toHaveValue(
    /^Review context/,
  );

  // 軽量版 robins_i はスキップで従来どおり 2 行（回帰なし）
  await page.locator('#schema-preset-robins-i').click();
  await expect(page.locator('#schema-preset-dialog')).toBeVisible();
  await page.locator('#schema-prespec-skip').click();
  await expect(page.locator('#schema-editor-table tbody tr')).toHaveCount(37);
});

test('QUADAS-3 事前設定ダイアログ: 全項目任意・Analysis / unit の SQ 4.3 注入（issue #103 PR3）', async ({
  page,
}) => {
  await initApp(page, { ...EMPTY_SCHEMA_STATE, editorRows: [makeEditorRow()] });

  await page.locator('#schema-preset-quadas3').click();
  await expect(page.locator('#schema-preset-dialog')).toBeVisible();
  // 全項目任意のためスキップボタンがあり、必須未充足エラーは発生しない
  await expect(page.locator('#schema-prespec-skip')).toHaveCount(1);

  const analysisUnit = page.locator('#schema-prespec-q3-analysis-unit');
  await analysisUnit.fill('per patient');
  // change イベント（blur 時発火）による store 更新 → 再描画を待ってから確定する
  await analysisUnit.blur();
  await expect(page.locator('#schema-prespec-q3-analysis-unit')).toHaveValue('per patient');
  await page.locator('#schema-prespec-confirm').click();
  await expect(page.locator('#schema-preset-dialog')).toHaveCount(0);
  await expect(page.locator('#schema-editor-table tbody tr')).toHaveCount(38);
  await expect(page.locator('input[aria-label="2 行目の field_name"]')).toHaveValue(
    'quadas3_rob_judgement',
  );
  await expect(page.locator('textarea[aria-label="2 行目の抽出指示"]')).toHaveValue(
    /^Review context/,
  );

  // 再挿入時は note からダイアログ初期値が復元される
  await page.locator('#schema-preset-quadas3').click();
  await expect(page.locator('#schema-prespec-q3-analysis-unit')).toHaveValue('per patient');
  await page.locator('#schema-prespec-cancel').click();
  await expect(page.locator('#schema-preset-dialog')).toHaveCount(0);
});

test('版として確定が SchemaVersions + SchemaFields の追記まで到達する', async ({ page }) => {
  const appendBodies: string[] = [];
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = route.request().url();
    if (route.request().method() === 'GET') {
      if (url.includes('batchGet') && url.includes('SchemaFields')) {
        await route.fulfill({ json: { valueRanges: [{ values: [[...SHEET_HEADERS.SchemaFields]] }] } });
        return;
      }
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
          maxQuotes: null,
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

const CONFIRMED_SCHEMA_STATE = {
  ...EMPTY_SCHEMA_STATE,
  versions: [
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
      maxQuotes: null,
      schemaVersion: 1,
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
};

test('確定済み: プロトコルが改訂されていると陳腐化バナーと再ドラフト導線を表示する（issue #197）', async ({
  page,
}) => {
  await initApp(page, CONFIRMED_SCHEMA_STATE, { schemaVersions: 1, protocolVersion: 2 });

  await expect(page.locator('#schema-confirmed')).toBeVisible();
  await expect(page.locator('#schema-stale-protocol')).toBeVisible();
  await expect(page.locator('#schema-stale-protocol')).toContainText('Protocol v1');
  await expect(page.locator('#schema-stale-protocol')).toContainText('v2');

  // 再ドラフトカードは版履歴の手前にあり、サンプル論文セレクタ・モデルセレクタを共有する
  await expect(page.locator('#schema-redraft-form')).toBeVisible();
  await expect(page.locator('#schema-redraft-run')).toBeVisible();
  await expect(page.locator('#schema-sample-list')).toBeVisible();
});

test('確定済み: 相談用ドキュメントを Google ドキュメントとして作成し、リンクを新しいタブで開く', async ({ page }) => {
  const uploads: string[] = [];
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    // 項目・実行履歴とも空の表（見出しのみ）を返す。パイロットなしの版として作る
    const header = route.request().url().includes('ExtractionRuns')
      ? [...SHEET_HEADERS.ExtractionRuns]
      : [...SHEET_HEADERS.SchemaFields];
    await route.fulfill({ json: { values: [header], valueRanges: [{ values: [header] }] } });
  });
  await page.route('https://www.googleapis.com/upload/drive/v3/files**', async (route) => {
    uploads.push(route.request().postData() ?? '');
    await route.fulfill({ json: { id: 'doc-1', webViewLink: 'https://docs.google.com/document/d/doc-1/edit' } });
  });
  await initApp(page, CONFIRMED_SCHEMA_STATE, { schemaVersions: 1 });

  await expect(page.locator('#schema-consult-doc')).toBeVisible();
  await expect(page.locator('#schema-consult-version')).toHaveValue('1');
  await page.locator('#schema-consult-create').click();

  const link = page.locator('#schema-consult-link');
  await expect(link).toHaveAttribute('href', 'https://docs.google.com/document/d/doc-1/edit');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener');
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toContain('application/vnd.google-apps.document');
  expect(uploads[0]).toContain('スキーマ v1 相談用');
  expect(uploads[0]).toContain('この版のパイロット抽出はありません');
  const results = await new AxeBuilder({ page }).include('#schema-consult-doc').analyze();
  expect(results.violations).toEqual([]);
});

test('確定済み: 前の版の内容に戻す → 差分を確認 → 戻し元を派生元として新しい版を確定する（issue #318）', async ({ page }) => {
  const fieldRow = (version: number, fieldId: string, fieldName: string, instruction: string): string[] => {
    const values: Record<string, string> = {
      schema_version: String(version),
      field_id: fieldId,
      field_index: '1',
      section: 'methods',
      field_name: fieldName,
      field_label: fieldName,
      entity_level: 'study',
      data_type: 'text',
      required: 'TRUE',
      extraction_instruction: instruction,
      ai_generated: 'TRUE',
    };
    return SHEET_HEADERS.SchemaFields.map((name) => values[name] ?? '');
  };
  const versionRow = (version: number, parent: string): string[] => [
    String(version), parent, '1', 'user_edit', '2026-07-01T00:00:00Z', 'e2e@example.com', '',
  ];
  const appendBodies: string[] = [];
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (route.request().method() !== 'GET') {
      appendBodies.push(route.request().postData() ?? '');
      await route.fulfill({ json: {} });
      return;
    }
    if (url.includes('batchGet') && url.includes('SchemaFields')) {
      await route.fulfill({ json: { valueRanges: [{ values: [[...SHEET_HEADERS.SchemaFields]] }] } });
    } else if (url.includes('SchemaFields')) {
      await route.fulfill({
        json: {
          values: [
            [...SHEET_HEADERS.SchemaFields],
            fieldRow(1, 'f-1', 'study_design', 'Old instruction.'),
            fieldRow(2, 'f-1', 'study_design', 'New instruction.'),
            fieldRow(2, 'f-2', 'age', 'Report age.'),
          ],
        },
      });
    } else if (url.includes('Protocol')) {
      await route.fulfill({ json: { values: [PROTOCOL_HEADERS, PROTOCOL_ROW] } });
    } else {
      await route.fulfill({ json: { values: [SCHEMA_VERSIONS_HEADERS, versionRow(1, ''), versionRow(2, '1')] } });
    }
  });
  const field = (fieldId: string, fieldName: string, instruction: string): Record<string, unknown> => ({
    maxQuotes: null,
    multiSelect: null,
    schemaVersion: 2,
    fieldId,
    fieldIndex: 1,
    section: 'methods',
    fieldName,
    fieldLabel: fieldName,
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: instruction,
    example: null,
    aiGenerated: true,
    note: null,
  });
  const version = (schemaVersion: number, parentVersion: number | null): Record<string, unknown> => ({
    schemaVersion,
    parentVersion,
    protocolVersion: 1,
    createdByType: 'user_edit',
    createdAt: '2026-07-01T00:00:00Z',
    createdBy: 'e2e@example.com',
    note: null,
  });
  await initApp(
    page,
    {
      ...EMPTY_SCHEMA_STATE,
      versions: [version(2, 1), version(1, null)],
      currentFields: [field('f-1', 'study_design', 'New instruction.'), field('f-2', 'age', 'Report age.')],
    },
    { schemaVersions: 2 },
  );

  await expect(page.locator('#schema-revert-version')).toHaveValue('1');
  const axe = await new AxeBuilder({ page }).include('#schema-revert').analyze();
  expect(axe.violations).toEqual([]);
  await page.locator('#schema-revert-start').click();

  await expect(page.locator('#schema-redraft-review h3')).toHaveText('v1 に戻す差分を確認');
  await expect(page.locator('#schema-redraft-summary')).toHaveText(
    '戻し元にだけある項目 0 件 / 変更 1 件 / 最新版にだけある項目 1 件 / 変更なし 0 件',
  );
  await expect(page.locator('#schema-redraft-removed input')).toBeChecked();
  const reviewAxe = await new AxeBuilder({ page }).include('#schema-redraft-review').analyze();
  expect(reviewAxe.violations).toEqual([]);
  await page.locator('#schema-redraft-apply').click();

  await expect(page.locator('#schema-note')).toHaveValue('v1 の内容に戻す');
  await page.locator('#schema-confirm').click();
  await expect(page.locator('.toast').last()).toHaveText('表のデザイン v3 を確定しました（1 項目）');
  await expect(page.locator('#schema-current-meta')).toContainText('現行版: v3');
  // SchemaVersions へは派生元 = v1 と改訂理由、SchemaFields へは v1 の抽出指示と同じ field_id で追記する
  const versionAppend = appendBodies.find((body) => body.includes('v1 の内容に戻す'));
  expect(versionAppend).toBeDefined();
  expect(JSON.parse(versionAppend as string).values[0].slice(0, 2)).toEqual([3, 1]);
  const fieldsAppend = appendBodies.find((body) => body.includes('Old instruction.'));
  expect(fieldsAppend).toContain('f-1');
  expect(fieldsAppend).not.toContain('age');
});

const IMPORT_FILE = serializeSchemaExport(
  [
    {
      maxQuotes: null,
      multiSelect: { exclusiveValues: ['NA'], freeTextValues: ['Other'] },
      schemaVersion: 4,
      fieldId: 'other-project-id',
      fieldIndex: 1,
      section: 'methods',
      fieldName: 'data_source',
      fieldLabel: 'データの取得元',
      entityLevel: 'study',
      dataType: 'enum',
      unit: null,
      allowedValues: 'Students|Faculty|Other|NA',
      required: true,
      extractionInstruction: 'Select all sources.',
      example: null,
      aiGenerated: true,
      note: null,
    },
  ],
  {
    projectName: '別の SR',
    schemaVersion: 4,
    exportedAt: '2026-09-30T00:00:00Z',
    exportedBy: 'other@example.com',
    extractPromptVersion: 12,
    appVersion: '0.13.0',
  },
);

test('スキーマのファイル: 確定済みの版を JSON で書き出す（issue #316）', async ({ page }) => {
  await initApp(page, CONFIRMED_SCHEMA_STATE, { schemaVersions: 1 });
  await expect(page.locator('#schema-transfer')).toBeVisible();
  await expect(page.locator('#schema-export-version')).toHaveValue('1');
  const axe = await new AxeBuilder({ page }).include('#schema-transfer').analyze();
  expect(axe.violations).toEqual([]);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#schema-export-file').click()]);
  expect(download.suggestedFilename()).toMatch(/^schema-v1-E2E-\d{4}-\d{2}-\d{2}\.json$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const json = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  expect(json.format).toBe('sr-data-extraction-schema');
  expect(json.source).toMatchObject({ projectName: 'E2E プロジェクト', schemaVersion: 1, exportedBy: 'e2e@example.com' });
  expect(json.fields.map((field: { fieldName: string }) => field.fieldName)).toEqual(['study_design']);
  expect(json.fields[0]).not.toHaveProperty('fieldId');
});

test('スキーマのファイル: 版が無いプロジェクトはエディタへ直接読み込み、出所を改訂理由にして確定する（issue #316）', async ({ page }) => {
  const appendBodies: string[] = [];
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = route.request().url();
    if (route.request().method() === 'GET') {
      if (url.includes('batchGet') && url.includes('SchemaFields')) {
        await route.fulfill({ json: { valueRanges: [{ values: [[...SHEET_HEADERS.SchemaFields]] }] } });
      } else if (url.includes('Protocol')) {
        await route.fulfill({ json: { values: [PROTOCOL_HEADERS, PROTOCOL_ROW] } });
      } else {
        await route.fulfill({ json: { values: [SCHEMA_VERSIONS_HEADERS] } });
      }
      return;
    }
    appendBodies.push(route.request().postData() ?? '');
    await route.fulfill({ json: {} });
  });
  await initApp(page, EMPTY_SCHEMA_STATE);
  await page.locator('#schema-draft-import #schema-import-file').setInputFiles({
    name: 'schema.json',
    mimeType: 'application/json',
    buffer: Buffer.from(IMPORT_FILE, 'utf-8'),
  });
  await expect(page.locator('.toast').last()).toHaveText('ファイルから 1 項目を読み込みました');
  await expect(page.locator('#schema-note')).toHaveValue('別の SR の v4（2026-09-30）から読み込み');
  await page.locator('#schema-confirm').click();
  await expect(page.locator('#schema-current-meta')).toContainText('現行版: v1');
  const fieldsAppend = appendBodies.find((body) => body.includes('data_source'));
  expect(fieldsAppend).toBeDefined();
  expect(fieldsAppend).not.toContain('other-project-id');
  expect(fieldsAppend).toContain('Other');
  expect(appendBodies.some((body) => body.includes('別の SR の v4'))).toBe(true);
});

test('スキーマのファイル: 版があるプロジェクトは差分を確認してから読み込む。読めないファイルは理由を出す（issue #316）', async ({ page }) => {
  await initApp(page, CONFIRMED_SCHEMA_STATE, { schemaVersions: 1 });
  const input = page.locator('#schema-transfer #schema-import-file');
  await input.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('nope') });
  await expect(page.locator('#schema-import-error')).toHaveText('JSON として読めませんでした。');
  await input.setInputFiles({ name: 'schema.json', mimeType: 'application/json', buffer: Buffer.from(IMPORT_FILE, 'utf-8') });
  await expect(page.locator('#schema-redraft-review h3')).toHaveText('ファイルから読み込む差分を確認');
  await expect(page.locator('#schema-import-source')).toHaveText('ファイル: 別の SR の v4（2026-09-30）');
  await expect(page.locator('#schema-redraft-removed input')).not.toBeChecked();
  const axe = await new AxeBuilder({ page }).include('#schema-redraft-review').analyze();
  expect(axe.violations).toEqual([]);
  await page.locator('#schema-redraft-apply').click();
  await expect(page.locator('#schema-note')).toHaveValue('別の SR の v4（2026-09-30）から読み込み');
});

test('差分承認画面: 追加は既定チェック・削除候補は既定未チェックで描画され、反映でエディタへ遷移する（issue #197）', async ({
  page,
}) => {
  const currentField = {
    maxQuotes: null,
    schemaVersion: 1,
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
  };
  const addedRow = makeEditorRow({ fieldName: 'country', fieldLabel: '対象国' });
  await initApp(page, {
    ...CONFIRMED_SCHEMA_STATE,
    redraft: {
      diff: {
        added: [{ row: addedRow }],
        changed: [],
        removed: [{ current: currentField }],
        unchanged: [],
        protectedFields: [],
        currentEntries: [{ kind: 'removed', item: { current: currentField } }],
      },
      selection: { added: { country: true }, changed: {}, removed: { study_design: false } },
    },
  });

  await expect(page.locator('#schema-redraft-review')).toBeVisible();
  const addedCheckbox = page.locator('#schema-redraft-added input[type="checkbox"]');
  await expect(addedCheckbox).toBeChecked();
  const removedCheckbox = page.locator('#schema-redraft-removed input[type="checkbox"]');
  await expect(removedCheckbox).not.toBeChecked();

  await page.locator('#schema-redraft-apply').click();
  await expect(page.locator('#schema-redraft-review')).toHaveCount(0);
  await expect(page.locator('#schema-editor')).toBeVisible();
  // 追加（既定チェック）は反映され、削除候補（既定未チェック）は残る
  await expect(page.locator('#schema-editor-table tbody tr')).toHaveCount(2);
});

test('アクセシビリティ違反がない（axe・ドラフト前）', async ({ page }) => {
  await initApp(page, EMPTY_SCHEMA_STATE);
  await expect(page.locator('#schema-draft-form')).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('field クエリの項目へフォーカスし、不明な ID は無視する', async ({ page }) => {
  const field = { ...makeEditorRow({ fieldId: 'field / 1' }), schemaVersion: 1, fieldIndex: 1 };
  await initApp(page, { ...EMPTY_SCHEMA_STATE, currentFields: [field],
    editorRows: [makeEditorRow({ fieldId: 'field / 1' })] });
  await page.evaluate(() => { location.hash = '#/schema?field=field%20%2F%201'; });
  await expect(page.locator('[data-schema-field="field / 1"]')).toBeFocused();
  await expect(page.locator('.schema__pilot-misses')).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#/schema?field=missing'; });
  await expect(page.locator('#schema-editor')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('アクセシビリティ違反がない（axe・エディタ）', async ({ page }) => {
  await initApp(page, { ...EMPTY_SCHEMA_STATE, editorRows: [makeEditorRow()] });
  await expect(page.locator('#schema-editor')).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('アクセシビリティ違反がない（axe・RoB 事前設定ダイアログ。issue #103）', async ({ page }) => {
  await initApp(page, { ...EMPTY_SCHEMA_STATE, editorRows: [makeEditorRow()] });
  await page.locator('#schema-preset-rob2-sq').click();
  await page.locator('#schema-prespec-effect-adhering').check();
  await expect(page.locator('#schema-prespec-deviations')).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
