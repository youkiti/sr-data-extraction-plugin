// #/export（S10）のルート別 E2E（test-strategy.md §3 + ui-states.md §3）。
// 状態は __E2E_PRELOADED_STATE__ で注入し、Sheets / Drive は page.route で stub する。
// 形式選択 + サマリ + プレビュー → 生成（Drive upload + ExportLog 追記）→ 結果カード、
// および未検証セル残存時の警告ダイアログ（中止 / 続行）まで実弾で通す
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SHEET_HEADERS } from '../../src/domain/sheetsSchema';

// v0.10: Documents は study_id + document_role を持ち、study_label は Studies へ移設
const DOCUMENTS_HEADERS = [...SHEET_HEADERS.Documents];

const DOC_ROW_1 = [
  'doc-1', 'study-1', 'article', 'drive-1', 'src-1', 'smith2020.pdf', '', '',
  'https://drive.google.com/file/d/txt-1/view', 'ok', '1', '4000',
  '2026-07-01T00:00:00Z', 'e2e@example.com', '',
];

const DOC_ROW_2 = [
  'doc-2', 'study-2', 'article', 'drive-2', 'src-2', 'jones2021.pdf', '', '',
  'https://drive.google.com/file/d/txt-2/view', 'ok', '1', '4000',
  '2026-07-01T00:00:00Z', 'e2e@example.com', '',
];

// Studies タブ（v0.10）。エクスポートの study_label はここ由来
const STUDIES_HEADERS = [...SHEET_HEADERS.Studies];
const STUDY_META_ROW_1 = ['study-1', 'Smith 2020', '', '2026-07-01T00:00:00Z', 'e2e@example.com', ''];
const STUDY_META_ROW_2 = ['study-2', 'Jones 2021', '', '2026-07-01T00:00:00Z', 'e2e@example.com', ''];

const SCHEMA_VERSIONS_HEADERS = [
  'schema_version', 'parent_version', 'protocol_version', 'created_by_type', 'created_at',
  'created_by', 'note',
];

const SCHEMA_VERSION_ROW = ['1', '', '1', 'user_edit', '2026-07-01T00:00:00Z', 'e2e@example.com', ''];

const SCHEMA_FIELDS_HEADERS = [
  'schema_version', 'field_id', 'field_index', 'section', 'field_name', 'field_label',
  'entity_level', 'data_type', 'unit', 'allowed_values', 'required', 'extraction_instruction',
  'example', 'ai_generated', 'note',
];

const STUDY_FIELD_ROW = [
  '1', 'f-total', '1', 'results', 'mortality_pct', '死亡率', 'study', 'text', '', '',
  'TRUE', 'Report overall mortality.', '', 'FALSE', '',
];

const ARM_FIELD_ROW = [
  '1', 'f-arm-n', '2', 'outcomes', 'arm_n', '群の N', 'arm', 'integer', '', '',
  'TRUE', '群別 N を抽出', '', 'FALSE', '',
];

const STUDY_DATA_HEADERS = [...SHEET_HEADERS.StudyData, 'mortality_pct'];

const RESULTS_DATA_HEADERS = [...SHEET_HEADERS.ResultsData];

const EVIDENCE_HEADERS = [...SHEET_HEADERS.Evidence];

// Evidence は study_id（col 3）+ document_id（col 5）
const EVIDENCE_ROW_1 = ['ev-1', 'run-1', 'study-1', 'f-total', 'doc-1', '-', '12', 'FALSE', 'Mortality was 12 percent', '1', 'high', 'exact'];
const EVIDENCE_ROW_2 = ['ev-2', 'run-1', 'study-2', 'f-total', 'doc-2', '-', '9', 'FALSE', 'nowhere', '1', 'low', 'failed'];

const RUNS_HEADERS = [...SHEET_HEADERS.ExtractionRuns];

// Methods 記載例カード（issue #67）の {{model_id}} / {{provider}} 反映確認のため model_version を持つ
const RUN_ROW = [
  'run-1', 'full', '1', 'study-1,study-2', 'gemini', 'gemini-test', 'gemini-3.5-flash-001',
  'text_only', 'done', 't1', 't2', '', '', '',
];

const DECISIONS_HEADERS = [...SHEET_HEADERS.Decisions];

// Decisions は study_id キー（3 列目）
const DECISION_ROW = [
  '2026-07-02T00:00:00Z', 'e2e@example.com', 'study-1', 'f-total', '-', 'e2e@example.com',
  'human_with_ai', '1', 'accept', '12', '',
];

interface CapturedWrites {
  exportLogBodies: Array<{ values: string[][] }>;
  uploadCount: number;
}

/**
 * Sheets / Drive の stub を配線する。
 * unverifiedStudy = true で doc-1 の human 行 mortality_pct を空セル（未検証）にする
 */
async function setupRoutes(page: Page, options: { unverifiedStudy?: boolean } = {}): Promise<CapturedWrites> {
  const captured: CapturedWrites = { exportLogBodies: [], uploadCount: 0 };
  // StudyData の 1 列目は study_id（v0.10）。study-1 の確定 annotator 行
  const studyRow = [
    'study-1', 'e2e@example.com', 'human_with_ai', '1', '', '2026-07-02T00:00:00Z',
    options.unverifiedStudy === true ? '' : '12',
  ];

  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (route.request().method() === 'GET') {
      if (url.includes('/values/Documents')) {
        await route.fulfill({ json: { values: [DOCUMENTS_HEADERS, DOC_ROW_1, DOC_ROW_2] } });
      } else if (url.includes('/values/Studies')) {
        await route.fulfill({ json: { values: [STUDIES_HEADERS, STUDY_META_ROW_1, STUDY_META_ROW_2] } });
      } else if (url.includes('/values/StudyData')) {
        await route.fulfill({ json: { values: [STUDY_DATA_HEADERS, studyRow] } });
      } else if (url.includes('/values/ResultsData')) {
        await route.fulfill({ json: { values: [RESULTS_DATA_HEADERS] } });
      } else if (url.includes('/values/Evidence')) {
        await route.fulfill({ json: { values: [EVIDENCE_HEADERS, EVIDENCE_ROW_1, EVIDENCE_ROW_2] } });
      } else if (url.includes('/values/Decisions')) {
        await route.fulfill({ json: { values: [DECISIONS_HEADERS, DECISION_ROW] } });
      } else if (url.includes('/values/ExtractionRuns')) {
        await route.fulfill({ json: { values: [RUNS_HEADERS, RUN_ROW] } });
      } else if (url.includes('/values/SchemaVersions')) {
        await route.fulfill({ json: { values: [SCHEMA_VERSIONS_HEADERS, SCHEMA_VERSION_ROW] } });
      } else if (url.includes('/values/SchemaFields')) {
        await route.fulfill({ json: { values: [SCHEMA_FIELDS_HEADERS, STUDY_FIELD_ROW, ARM_FIELD_ROW] } });
      } else {
        await route.fulfill({ json: { values: [] } });
      }
      return;
    }
    if (url.includes('/values/ExportLog')) {
      captured.exportLogBodies.push(route.request().postDataJSON() as { values: string[][] });
    }
    await route.fulfill({ json: {} });
  });

  await page.route('https://www.googleapis.com/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/upload/drive/v3/files')) {
      captured.uploadCount++;
      await route.fulfill({
        json: { id: 'csv-1', webViewLink: 'https://drive.google.com/file/d/csv-1/view' },
      });
      return;
    }
    if (route.request().method() === 'GET') {
      // ensureChildFolder の検索 → 既存なし（作成パスを通す）
      await route.fulfill({ json: { files: [] } });
      return;
    }
    // createFolder（exports/ の新規作成）
    await route.fulfill({ json: { id: 'exports-folder', webViewLink: 'https://drive/exports' } });
  });

  return captured;
}

async function initApp(page: Page, hash: string): Promise<void> {
  await page.addInitScript(() => {
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
        documents: 2,
        protocolVersions: 1,
        schemaVersions: 1,
        pilotRuns: 1,
        evidenceRows: 2,
        dataRows: 1, // #/export のガード（StudyData / ResultsData ≥ 1 行）
      },
    };
  });
  await page.goto(`/app/app.html${hash}`);
}

test('形式選択 + サマリ + プレビュー → 生成で Drive 保存 + ExportLog 追記 + 結果カード', async ({ page }) => {
  const captured = await setupRoutes(page);
  await initApp(page, '#/export');

  // 通常表示: 形式ラジオ（既定 = study_wide）+ サマリ + プレビュー
  const formats = page.locator('#export-format');
  await expect(formats).toBeVisible({ timeout: 15_000 });
  await expect(formats.locator('input[type=radio]')).toHaveCount(3);
  const summary = page.locator('#export-summary');
  await expect(summary).toContainText('データ行数');
  await expect(summary).toContainText('1');
  await expect(summary).toContainText('未検証セル数');
  // doc-2（Jones 2021）は human 行がなく確定 annotator を特定できない → 除外警告
  await expect(page.locator('#export-skipped')).toContainText('Jones 2021');
  const preview = page.locator('#export-preview');
  await expect(preview.locator('thead th')).toHaveText(['study_label', 'mortality_pct']);
  await expect(preview.locator('tbody')).toContainText('Smith 2020');

  // 形式切替: audit はプレビュー列と未検証セル数（判定 0 件セル = ev-2 の 1 件）が追随する。
  // 列数 28 = 従来 22 列 + bbox 5 列（§7.4 PR3）+ study_id 1 列（issue #60 D-1）
  await formats.locator('input[value=audit]').check();
  await expect(preview.locator('thead th').first()).toHaveText('study_label');
  await expect(preview.locator('thead th')).toHaveCount(28);
  await expect(summary).toContainText('未検証セル数');
  await formats.locator('input[value=study_wide]').check();
  await expect(preview.locator('thead th')).toHaveCount(2);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  // 生成（study_wide は未検証 0 件 → 警告なしで即実行）
  await page.locator('#export-generate').click();
  const resultCard = page.locator('#export-result');
  await expect(resultCard).toBeVisible({ timeout: 15_000 });
  await expect(resultCard).toContainText('を Drive に保存しました（ExportLog に記録済み）。');
  await expect(resultCard).toContainText('study_wide_');
  await expect(page.locator('#export-result-link')).toHaveAttribute(
    'href',
    'https://drive.google.com/file/d/csv-1/view',
  );

  // ExportLog へ 1 行追記されている（format / schema_version / document_count / file_ref）
  expect(captured.uploadCount).toBe(1);
  expect(captured.exportLogBodies).toHaveLength(1);
  const logRow = captured.exportLogBodies[0]?.values[0] as unknown as (string | number)[];
  expect(logRow[1]).toBe('study_wide');
  expect(logRow[2]).toBe(1);
  expect(logRow[3]).toBe(1);
  expect(logRow[4]).toBe('https://drive.google.com/file/d/csv-1/view');
  expect(logRow[6]).toBe('e2e@example.com');
});

test('未検証セル残存の警告ダイアログ: 中止 → 生成なし / 続行 → 生成完了', async ({ page }) => {
  const captured = await setupRoutes(page, { unverifiedStudy: true });
  await initApp(page, '#/export');

  await expect(page.locator('#export-format')).toBeVisible({ timeout: 15_000 });

  // 生成 → 警告ダイアログ（study_wide の空セル 1 件。続行を経ずに生成は始まらない）
  await page.locator('#export-generate').click();
  const warning = page.locator('#export-warning');
  await expect(warning).toBeVisible();
  await expect(warning).toHaveAttribute('role', 'alertdialog');
  await expect(page.locator('#export-warning-title')).toHaveText('未検証の項目が 1 件あります。');

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  // 中止 → ダイアログが閉じ、Drive 書き込みは発生しない
  await page.locator('#export-warning-cancel').click();
  await expect(warning).toBeHidden();
  expect(captured.uploadCount).toBe(0);
  expect(captured.exportLogBodies).toHaveLength(0);

  // 再度生成 → 続行 → Drive 保存 + ExportLog 追記まで到達する
  await page.locator('#export-generate').click();
  await expect(warning).toBeVisible();
  await page.locator('#export-warning-continue').click();
  await expect(page.locator('#export-result')).toBeVisible({ timeout: 15_000 });
  expect(captured.uploadCount).toBe(1);
  expect(captured.exportLogBodies).toHaveLength(1);
  expect(captured.exportLogBodies[0]?.values[0]?.[1]).toBe('study_wide');
});

test('論文 Methods 記載例カード（issue #67）: 実績値反映 → 言語切替 → コピー', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-write', 'clipboard-read']);
  await setupRoutes(page);
  await initApp(page, '#/export');

  await expect(page.locator('#export-format')).toBeVisible({ timeout: 15_000 });

  const card = page.locator('#export-methods');
  await expect(card).toBeVisible();
  const textArea = card.locator('#methods-text');
  // 既定 = English・単一レビュアー。ExtractionRuns（run_type=full）の実績値が反映されている
  await expect(textArea).toHaveValue(/^Data extraction\. Data were extracted using/);
  await expect(textArea).toHaveValue(/gemini-3\.5-flash-001/);
  await expect(textArea).toHaveValue(/accessed via the Gemini API/);
  // n_sample 等は自動反映しないため注意書きが出る
  await expect(card.locator('#methods-unresolved-note')).toContainText(
    '{{ }} の箇所はご自身の情報に置き換えてください',
  );
  await expect(card.locator('#methods-lang-en')).toHaveAttribute('aria-pressed', 'true');

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  // 日本語タブへ切替 → 本文が日本語になる
  await card.locator('#methods-lang-ja').click();
  await expect(card.locator('#methods-lang-ja')).toHaveAttribute('aria-pressed', 'true');
  await expect(textArea).toHaveValue(/^データ抽出\. データ抽出には/);
  await expect(textArea).toHaveValue(/gemini-3\.5-flash-001/);

  // コピー → トースト表示
  await card.locator('#methods-copy').click();
  await expect(page.locator('.toast')).toContainText('コピーしました');
});
