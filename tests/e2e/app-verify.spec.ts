// #/verify（S8 単独画面）のルート別 E2E（test-strategy.md §3 + ui-states.md §3）。
// 状態は __E2E_PRELOADED_STATE__ で注入し、Sheets / Drive は page.route で stub する。
// 一覧（進捗チップ）→ ?doc= 直リンク / セレクタ切替（hash 同期）→ 2 ペイン検証 →
// 群構成の確定（arm 未確定ゲート → ArmStructures 追記）まで実 PDF の canvas 描画つきで通す
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SHEET_HEADERS } from '../../src/domain/sheetsSchema';

const QUOTE = 'Mortality was 12 percent';

const SCHEMA_FIELDS_HEADERS = [
  'schema_version', 'field_id', 'field_index', 'section', 'field_name', 'field_label',
  'entity_level', 'data_type', 'unit', 'allowed_values', 'required', 'extraction_instruction',
  'example', 'ai_generated', 'note',
];

const STUDY_FIELD_ROW = [
  '1', 'f-total', '1', 'results', 'mortality_pct', '死亡率', 'study', 'text', '', '',
  'TRUE', 'Report overall mortality.', '', 'FALSE', '',
];

const STUDY_FIELD_ROW_2 = [
  '1', 'f-country', '2', 'results', 'country', '国', 'study', 'text', '', '',
  'FALSE', 'Report the country.', '', 'FALSE', '',
];

const ARM_FIELD_ROW = [
  '1', 'f-arm-n', '2', 'outcomes', 'arm_n', '群の N', 'arm', 'integer', '', '',
  'TRUE', '群別 N を抽出', '', 'FALSE', '',
];

const OUTCOME_FIELD_ROW = [
  '1', 'f-out-event', '3', 'outcomes', 'event_count', 'イベント数', 'outcome_result', 'integer',
  '', '', 'TRUE', 'イベント数を抽出', '', 'FALSE', '',
];

const EVIDENCE_HEADERS = [...SHEET_HEADERS.Evidence];

// Evidence は study_id（col 3）+ document_id（col 5）の 2 キー構成。1 文書 = 1 study
const EVIDENCE_ROW_1 = ['ev-1', 'run-1', 'study-1', 'f-total', 'doc-1', '-', '12', 'FALSE', QUOTE, '1', 'high', 'exact'];
const EVIDENCE_ROW_2 = ['ev-2', 'run-1', 'study-2', 'f-total', 'doc-2', '-', '9', 'FALSE', '', '', '', ''];
const ARM_EVIDENCE_ROW = ['ev-3', 'run-1', 'study-1', 'f-arm-n', 'doc-1', 'arm:1', '50', 'FALSE', '', '', '', ''];

const RUNS_HEADERS = [...SHEET_HEADERS.ExtractionRuns];

const RUN_ROW = [
  'run-1', 'pilot', '1', 'study-1,study-2', 'gemini', 'gemini-test', '', 'text_only', 'done',
  't1', 't2', '', '', '',
];

const DECISIONS_HEADERS = [...SHEET_HEADERS.Decisions];

const STUDY_DATA_HEADERS = [...SHEET_HEADERS.StudyData];

const RESULTS_DATA_HEADERS = [...SHEET_HEADERS.ResultsData];

/**
 * テキスト層つきの最小 1 ページ PDF（app-pilot.spec.ts と同じ手組み構成）。
 * rotated 指定時は /Rotate 90 のページに 90 度回転したテキスト（表ページの典型）を置く
 */
function minimalPdf(text: string, options: { rotated?: boolean } = {}): Buffer {
  const content = options.rotated
    ? `BT /F1 12 Tf 0 1 -1 0 100 72 Tm (${text}) Tj ET`
    : `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const rotateEntry = options.rotated ? ' /Rotate 90' : '';
  const objects = [
    '',
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]${rotateEntry} /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`,
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

/** Sheets / Drive の stub を配線し、書き込み URL を appendUrls へ記録する */
async function setupRoutes(
  page: Page,
  options: { schemaRows: string[][]; evidenceRows: string[][]; rotatedPdf?: boolean },
): Promise<string[]> {
  const appendUrls: string[] = [];

  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (route.request().method() === 'GET') {
      if (url.includes('fields=sheets.properties.title')) {
        // ArmStructures タブなし（v0.7 より前の既存プロジェクト）→ 書き込み時にタブを作る
        const titles = ['Meta', 'Documents', 'SchemaFields', 'Evidence', 'Decisions'];
        await route.fulfill({
          json: { sheets: titles.map((title) => ({ properties: { title } })) },
        });
      } else if (url.includes('/values/Evidence')) {
        await route.fulfill({ json: { values: [EVIDENCE_HEADERS, ...options.evidenceRows] } });
      } else if (url.includes('/values/ExtractionRuns')) {
        await route.fulfill({ json: { values: [RUNS_HEADERS, RUN_ROW] } });
      } else if (url.includes('/values/Decisions')) {
        await route.fulfill({ json: { values: [DECISIONS_HEADERS] } });
      } else if (url.includes('/values/StudyData')) {
        await route.fulfill({ json: { values: [STUDY_DATA_HEADERS] } });
      } else if (url.includes('/values/ResultsData')) {
        await route.fulfill({ json: { values: [RESULTS_DATA_HEADERS] } });
      } else if (url.includes('/values/SchemaFields')) {
        await route.fulfill({ json: { values: [SCHEMA_FIELDS_HEADERS, ...options.schemaRows] } });
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
    if (url.includes('alt=media')) {
      await route.fulfill({
        contentType: 'application/pdf',
        body: minimalPdf(QUOTE, { rotated: options.rotatedPdf }),
      });
      return;
    }
    await route.fulfill({ json: {} });
  });

  return appendUrls;
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
        dataRows: 0,
      },
      documents: {
        records: [
          {
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
          },
          {
            documentId: 'doc-2',
            studyId: 'study-2',
            documentRole: 'article',
            driveFileId: 'drive-2',
            sourceFileId: 'src-2',
            filename: 'jones2021.pdf',
            pmid: null,
            doi: null,
            textRef: 'https://drive.google.com/file/d/txt-2/view',
            textStatus: 'ok',
            pageCount: 1,
            charCount: 4000,
            importedAt: '2026-07-01T00:00:00Z',
            importedBy: 'e2e@example.com',
            note: null,
          },
        ],
        studies: [
          {
            studyId: 'study-1',
            studyLabel: 'Smith 2020',
            registrationId: null,
            createdAt: '2026-07-01T00:00:00Z',
            createdBy: 'e2e@example.com',
            note: null,
          },
          {
            studyId: 'study-2',
            studyLabel: 'Jones 2021',
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
    };
  });
  await page.goto(`/app/app.html${hash}`);
}

test('一覧 + 検証フロー: 進捗チップ → ハイライト → 承認 → Decisions 追記 → セレクタ切替の hash 同期', async ({ page }) => {
  const appendUrls = await setupRoutes(page, {
    schemaRows: [STUDY_FIELD_ROW],
    evidenceRows: [EVIDENCE_ROW_1, EVIDENCE_ROW_2],
  });
  await initApp(page, '#/verify');

  // 一覧: 進捗チップ付きのセレクタ + 先頭文献（doc-1）の自動読込
  const select = page.locator('#verify-doc');
  await expect(select).toBeVisible({ timeout: 15_000 });
  await expect(select.locator('option').nth(0)).toHaveText('smith2020.pdf（判定済み 0 / 1）');
  await expect(select.locator('option').nth(1)).toHaveText('jones2021.pdf（判定済み 0 / 1）');

  // 2 ペイン + 実 PDF の canvas 描画 + quote ハイライト
  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.verify__cell-label')).toHaveText('死亡率');
  await expect(page.locator('.pdf-viewer__page-indicator')).toHaveText('1 / 1 ページ');
  await expect(page.locator('.pdf-viewer__hl--unverified')).toHaveCount(1, { timeout: 15_000 });

  // 判定: 承認 → チップ更新 + Decisions 追記
  await page.locator('.verify__action--accept').click();
  await expect(page.locator('.verify__chip')).toHaveText('承認');
  await expect
    .poll(() => appendUrls.filter((url) => url.includes('Decisions') && url.includes(':append')).length)
    .toBeGreaterThan(0);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  // セレクタ切替 → URL クエリ同期（?doc=）→ 該当文献の検証データへ切替
  await select.selectOption('doc-2');
  await expect(page).toHaveURL(/#\/verify\?doc=doc-2$/);
  await expect(page.locator('.verify__ai-value')).toHaveText('9', { timeout: 15_000 });
});

test('承認クリック後に .verify__cell--focused が次の未判定セルへ自動遷移する', async ({ page }) => {
  await setupRoutes(page, {
    schemaRows: [STUDY_FIELD_ROW, STUDY_FIELD_ROW_2],
    evidenceRows: [EVIDENCE_ROW_1, EVIDENCE_ROW_2],
  });
  await initApp(page, '#/verify?doc=doc-1');

  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });
  const cells = page.locator('.verify__cell');
  await expect(cells).toHaveCount(2); // 死亡率 + 国（study の 2 セル）

  // 初期フォーカス = 最初の未判定セル（先頭 = 死亡率）
  await expect(cells.nth(0)).toHaveClass(/verify__cell--focused/);

  // 承認 → 次の未判定セル（国）へフォーカスが自動遷移する（j キー不要）
  await cells.nth(0).locator('.verify__action--accept').click();
  await expect(cells.nth(1)).toHaveClass(/verify__cell--focused/);
  await expect(cells.nth(0)).not.toHaveClass(/verify__cell--focused/);
});

test('回転ページ（/Rotate 90 の表ページ）でもハイライトが本文位置に重なる', async ({ page }) => {
  await setupRoutes(page, {
    schemaRows: [STUDY_FIELD_ROW],
    evidenceRows: [EVIDENCE_ROW_1, EVIDENCE_ROW_2],
    rotatedPdf: true,
  });
  await initApp(page, '#/verify?doc=doc-1');

  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });
  const highlight = page.locator('.pdf-viewer__hl--unverified');
  await expect(highlight).toHaveCount(1, { timeout: 15_000 });

  // 生座標の縦書き item（Tm [0 1 -1 0 100 72]・フォント 12pt）は、回転込みの写像で
  // 表示座標 left = 72 / top = 100 - 12 = 88 の「横長」矩形になる
  const box = await highlight.evaluate((node) => {
    const style = (node as HTMLElement).style;
    return {
      left: parseFloat(style.left),
      top: parseFloat(style.top),
      width: parseFloat(style.width),
      height: parseFloat(style.height),
    };
  });
  expect(Math.abs(box.left - 72)).toBeLessThan(2);
  expect(Math.abs(box.top - 88)).toBeLessThan(2);
  expect(box.width).toBeGreaterThan(box.height);
});

test('?doc= 直リンク + 群構成の確定: タブディム → 確定 → ArmStructures 追記 → arm タブ有効', async ({ page }) => {
  const appendUrls = await setupRoutes(page, {
    schemaRows: [STUDY_FIELD_ROW, ARM_FIELD_ROW, OUTCOME_FIELD_ROW],
    evidenceRows: [EVIDENCE_ROW_1, EVIDENCE_ROW_2, ARM_EVIDENCE_ROW],
  });
  await initApp(page, '#/verify?doc=doc-1');

  // ?doc= 直リンクで doc-1 が選択される
  await expect(page.locator('#verify-doc')).toHaveValue('doc-1', { timeout: 15_000 });
  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });

  // arm 未確定: arm タブがディムされ、確定カードが AI ドラフト（arm:1）を出す
  const armTab = page.locator('.verify__tab', { hasText: '群（arm）' });
  await expect(armTab).toBeDisabled();
  await expect(page.locator('#verify-arm-card .verify__arm-lead')).toContainText(
    'まず群構成を確定してください',
  );
  await expect(page.locator('.verify__arm-key')).toHaveText('arm:1');

  // 名称を入れて確定 → 楽観反映（要約 + タブ有効化）+ ArmStructures への追記（タブ作成込み）
  await page.locator('.verify__arm-name').fill('介入群');
  await page.locator('#verify-arm-confirm').click();
  await expect(page.locator('.verify__arm-summary')).toContainText('群構成: 1 群（version 1）');
  await expect(armTab).toBeEnabled();
  await expect
    .poll(() => appendUrls.filter((url) => url.includes(':batchUpdate')).length)
    .toBeGreaterThan(0);
  await expect
    .poll(() => appendUrls.filter((url) => url.includes('ArmStructures!A1:append')).length)
    .toBeGreaterThan(0);

  // arm タブへ切替 → arm セル（群の N）が検証できる
  await armTab.click();
  await expect(page.locator('.verify__group-heading')).toHaveText('群 1');
  await expect(page.locator('.verify__cell-label')).toHaveText('群の N');

  // outcome タブへ切替 → 人手で見落としアウトカムを宣言し、Evidence なしセルを表示
  const outcomeTab = page.locator('.verify__tab', { hasText: 'アウトカム' });
  await expect(outcomeTab).toBeEnabled();
  await outcomeTab.click();
  await expect(page.locator('#verify-outcome-add')).toBeVisible();
  await page.locator('#verify-outcome-key').fill('mortality_extra');
  await page.locator('#verify-outcome-time').fill('30d');
  const decisionsBefore = appendUrls.filter(
    (url) => url.includes('Decisions') && url.includes(':append'),
  ).length;
  await page.locator('#verify-outcome-add-button').click();
  await expect(page.locator('.verify__group-heading')).toHaveText('mortality_extra / 群 1 / 30d');
  await expect(page.locator('.verify__cell-label')).toHaveText('イベント数');
  await expect(page.locator('.verify__cell')).toContainText('AI 抽出なし');
  await expect
    .poll(
      () =>
        appendUrls.filter((url) => url.includes('Decisions') && url.includes(':append')).length,
    )
    .toBeGreaterThan(decisionsBefore);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
