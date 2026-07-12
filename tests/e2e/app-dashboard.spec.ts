// #/dashboard（S9）のルート別 E2E（test-strategy.md §3 + ui-states.md §3）。
// 状態は __E2E_PRELOADED_STATE__ で注入し、Sheets / Drive は page.route で stub する。
// マトリクス（document × section + anchor 失敗率 / not_reported 率）→ セルクリックで
// `#/verify?study=&entity=` へ → ?entity= ディープリンクの着地（タブ切替 + セルフォーカス）まで通す
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SHEET_HEADERS } from '../../src/domain/sheetsSchema';

const QUOTE = 'Mortality was 12 percent';

// Studies タブ（v0.10）。study_label は Documents から移設され、ダッシュボードのラベルは Studies 由来
const STUDIES_HEADERS = [...SHEET_HEADERS.Studies];
const STUDY_ROW_1 = ['study-1', 'Smith 2020', '', '2026-07-01T00:00:00Z', 'e2e@example.com', ''];
const STUDY_ROW_2 = ['study-2', 'Jones 2021', '', '2026-07-01T00:00:00Z', 'e2e@example.com', ''];

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

const EVIDENCE_HEADERS = [...SHEET_HEADERS.Evidence];

// Evidence は study_id（col 3）+ document_id（col 5）。1 文書 = 1 study。
// doc-1: study（exact）+ arm（not_reported・アンカリング対象外）/ doc-2: study（failed）
const EVIDENCE_ROW_1 = ['ev-1', 'run-1', 'study-1', 'f-total', 'doc-1', '-', '12', 'FALSE', QUOTE, '1', 'high', 'exact'];
const EVIDENCE_ROW_2 = ['ev-2', 'run-1', 'study-2', 'f-total', 'doc-2', '-', '9', 'FALSE', 'nowhere', '1', 'low', 'failed'];
const ARM_EVIDENCE_ROW = ['ev-3', 'run-1', 'study-1', 'f-arm-n', 'doc-1', 'arm:1', '', 'TRUE', '', '', '', ''];

const RUNS_HEADERS = [...SHEET_HEADERS.ExtractionRuns];

const RUN_ROW = [
  'run-1', 'full', '1', 'study-1,study-2', 'gemini', 'gemini-test', '', 'text_only', 'done',
  't1', 't2', '', '', '',
];

const DECISIONS_HEADERS = [...SHEET_HEADERS.Decisions];

const ARM_STRUCTURES_HEADERS = [...SHEET_HEADERS.ArmStructures];

// ?entity= ディープリンクの着地先タブは群構成確定済みでないとロックされる（ui-states.md §3）。
// ArmStructures は study_id キー（v0.10）
const ARM_STRUCTURE_ROW = [
  'study-1', '1', 'arm:1', '介入群', 'e2e@example.com', 'human_with_ai', 't0', '',
];

const STUDY_DATA_HEADERS = [...SHEET_HEADERS.StudyData];

const RESULTS_DATA_HEADERS = [...SHEET_HEADERS.ResultsData];

/** テキスト層つきの最小 1 ページ PDF（app-verify.spec.ts と同じ手組み構成） */
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

/** Sheets / Drive の stub を配線する（ArmStructures タブは確定済みの群構成を返す） */
async function setupRoutes(page: Page): Promise<void> {
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (route.request().method() === 'GET') {
      if (url.includes('fields=sheets.properties.title')) {
        const titles = ['Meta', 'Documents', 'SchemaFields', 'Evidence', 'Decisions', 'ArmStructures'];
        await route.fulfill({
          json: { sheets: titles.map((title) => ({ properties: { title } })) },
        });
      } else if (url.includes('/values/Evidence')) {
        await route.fulfill({
          json: { values: [EVIDENCE_HEADERS, EVIDENCE_ROW_1, EVIDENCE_ROW_2, ARM_EVIDENCE_ROW] },
        });
      } else if (url.includes('/values/ExtractionRuns')) {
        await route.fulfill({ json: { values: [RUNS_HEADERS, RUN_ROW] } });
      } else if (url.includes('/values/Studies')) {
        await route.fulfill({ json: { values: [STUDIES_HEADERS, STUDY_ROW_1, STUDY_ROW_2] } });
      } else if (url.includes('/values/Decisions')) {
        await route.fulfill({ json: { values: [DECISIONS_HEADERS] } });
      } else if (url.includes('/values/StudyData')) {
        await route.fulfill({ json: { values: [STUDY_DATA_HEADERS] } });
      } else if (url.includes('/values/ResultsData')) {
        // 楽観ロックの期待値取得（issue #64）のため loadVerificationBundle が ResultsData も読む
        await route.fulfill({ json: { values: [RESULTS_DATA_HEADERS] } });
      } else if (url.includes('/values/ArmStructures')) {
        await route.fulfill({ json: { values: [ARM_STRUCTURES_HEADERS, ARM_STRUCTURE_ROW] } });
      } else if (url.includes('/values/SchemaFields')) {
        await route.fulfill({ json: { values: [SCHEMA_FIELDS_HEADERS, STUDY_FIELD_ROW, ARM_FIELD_ROW] } });
      } else {
        await route.fulfill({ json: { values: [] } });
      }
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.route('https://www.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (url.includes('alt=media')) {
      await route.fulfill({ contentType: 'application/pdf', body: minimalPdf(QUOTE) });
      return;
    }
    await route.fulfill({ json: {} });
  });
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
        evidenceRows: 3,
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

test('マトリクス表示 → セルクリックで #/verify?study=&entity= へ遷移する', async ({ page }) => {
  await setupRoutes(page);
  await initApp(page, '#/dashboard');

  // サマリ: 検証進捗（0 / 3）+ anchor 失敗率（failed 1 / 対象 2）+ not_reported 率（1 / 3）
  const summary = page.locator('#dashboard-summary');
  await expect(summary).toBeVisible({ timeout: 15_000 });
  await expect(summary).toContainText('検証進捗');
  await expect(summary).toContainText('0 / 3（0%）');
  await expect(summary).toContainText('anchor 失敗率');
  await expect(summary).toContainText('1 / 2（50%）');
  await expect(summary).toContainText('not_reported 率');
  await expect(summary).toContainText('1 / 3（33%）');
  // AI 採用率（人の判定から算出）。判定 0 件なので率は「—」
  await expect(summary).toContainText('AI 採用率（人が無修正で承認）');
  await expect(summary).toContainText('AI 精度内訳');

  // マトリクス: 列 = section の和集合 + AI 採用率、行 = study（行見出しに進捗）
  const matrix = page.locator('#dashboard-matrix');
  await expect(matrix.locator('thead th')).toHaveText([
    '研究', 'results', 'outcomes', 'AI 採用率', 'anchor 失敗率', 'not_reported 率',
  ]);
  const row1 = matrix.locator('tbody tr').nth(0);
  await expect(row1.locator('th')).toHaveText('Smith 2020（0 / 2）');
  const row2 = matrix.locator('tbody tr').nth(1);
  // doc-2 に arm インスタンスは無い → outcomes セルは「—」でリンクなし
  await expect(row2.locator('td').nth(1)).toHaveText('—');
  // td: results / outcomes / AI 採用率 / anchor 失敗率 / not_reported 率
  await expect(row2.locator('td').nth(3)).toHaveText('1 / 1（100%）');

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  // セルクリック → ?doc=&entity= ディープリンクで検証画面へ
  const cellLink = row1.locator('a').first();
  await expect(cellLink).toHaveAttribute('href', '#/verify?study=study-1&entity=-');
  await cellLink.click();
  await expect(page).toHaveURL(/#\/verify\?study=study-1&entity=-$/);
  await expect(page.locator('#verify-study')).toHaveValue('study-1', { timeout: 15_000 });
  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });
});

test('?entity= 直リンクで該当 entity のタブへ切替え、先頭セルへフォーカスする', async ({ page }) => {
  await setupRoutes(page);
  await initApp(page, '#/verify?study=study-1&entity=arm:1');

  await expect(page.locator('#verify-study')).toHaveValue('study-1', { timeout: 15_000 });
  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });

  // 群構成は確定済み（stub の ArmStructures）→ arm タブへ切替わり、先頭セルがフォーカスされる
  const armTab = page.locator('.verify__tab', { hasText: '群（arm）' });
  await expect(armTab).toHaveAttribute('aria-selected', 'true');
  const focused = page.locator('.verify__cell--focused');
  await expect(focused.locator('.verify__cell-label')).toHaveText('群の N');

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
