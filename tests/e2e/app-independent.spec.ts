// 独立二重レビュー機能（issue #44 / docs/design-independent-dual-review.md）PR 2 の E2E。
// mode②（reviewer_independent）を seam で注入し、
//   ①検証画面に Evidence 由来表示（quote / ハイライト / accept ボタン）が一切出ないこと
//   ②値の直接入力 → StudyData / ResultsData の human_independent 行 upsert + Decisions 追記の実弾検証
//   ③axe
// を確認する。加えて counts を一切注入しない（reviewer 系ロールは loadProgressCounts を読まない盲検の
// ため常に初期値 0）ことで、guards.ts の永久ブロックバグ修正が本番相当の状態で効いていることも
// 併せて実証する。Picker はホスト済みページ + externally_connectable のため E2E 対象外（他 spec と同じ方針）
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SHEET_HEADERS } from '../../src/domain/sheetsSchema';

const PROJECT = {
  projectId: 'e2e-project',
  spreadsheetId: 'e2e-sheet',
  driveFolderId: 'e2e-folder',
  name: 'E2E プロジェクト',
};

/** app 実行に必要な最小 chrome API モック（Picker 関連の外部メッセージングは含めない） */
async function installChromeStub(page: Page, email: string): Promise<void> {
  await page.addInitScript((userEmail) => {
    const win = window as unknown as Record<string, unknown>;
    win.chrome = {
      storage: {
        local: {
          get: async () => ({}),
          set: async () => undefined,
          remove: async () => undefined,
        },
      },
      runtime: { id: 'e2e-extension-id', getURL: (p: string) => `/${p}` },
      tabs: { create: async () => ({ id: 1 }) },
      identity: {
        getAuthToken: (_opts: unknown, cb: (token?: string) => void) => {
          cb('e2e-token');
        },
        removeCachedAuthToken: (_details: unknown, cb: () => void) => {
          cb();
        },
        getProfileUserInfo: (_opts: unknown, cb: (info: unknown) => void) => {
          cb({ email: userEmail, id: '1' });
        },
      },
    };
  }, email);
}

const SCHEMA_VERSIONS_HEADERS = [...SHEET_HEADERS.SchemaVersions];
const SCHEMA_VERSION_ROW = ['1', '', '1', 'ai_draft', 't0', 'owner@example.com', ''];

const SCHEMA_FIELDS_HEADERS = [
  'schema_version', 'field_id', 'field_index', 'section', 'field_name', 'field_label',
  'entity_level', 'data_type', 'unit', 'allowed_values', 'required', 'extraction_instruction',
  'example', 'ai_generated', 'note',
];
const STUDY_FIELD_ROW = [
  '1', 'f-total', '1', 'results', 'mortality_pct', '死亡率', 'study', 'text', '', '',
  'TRUE', 'Report overall mortality.', '', 'FALSE', '',
];

const DECISIONS_HEADERS = [...SHEET_HEADERS.Decisions];
const STUDY_DATA_HEADERS = [...SHEET_HEADERS.StudyData];
const RESULTS_DATA_HEADERS = [...SHEET_HEADERS.ResultsData];

interface RouteRecorder {
  /** GET 以外（append / batchUpdate 等）の書き込み URL */
  appendUrls: string[];
  /** 実際にリクエストされた GET URL（Evidence / ExtractionRuns が読まれないことの検証に使う） */
  getUrls: string[];
  /** StudyData への書き込みリクエストの生 body（annotator_type の実値検証に使う） */
  studyDataBodies: string[];
}

async function setupRoutes(page: Page): Promise<RouteRecorder> {
  const appendUrls: string[] = [];
  const getUrls: string[] = [];
  const studyDataBodies: string[] = [];

  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (route.request().method() === 'GET') {
      getUrls.push(url);
      if (url.includes('fields=sheets.properties.title')) {
        // ArmStructures タブなし（v0.7 より前の既存プロジェクト）→ 未確定（空）として読める
        const titles = ['Meta', 'Documents', 'Studies', 'SchemaVersions', 'SchemaFields', 'Decisions'];
        await route.fulfill({ json: { sheets: titles.map((title) => ({ properties: { title } })) } });
      } else if (url.includes('/values/SchemaVersions')) {
        await route.fulfill({ json: { values: [SCHEMA_VERSIONS_HEADERS, SCHEMA_VERSION_ROW] } });
      } else if (url.includes('/values/SchemaFields')) {
        await route.fulfill({ json: { values: [SCHEMA_FIELDS_HEADERS, STUDY_FIELD_ROW] } });
      } else if (url.includes('/values/Decisions')) {
        await route.fulfill({ json: { values: [DECISIONS_HEADERS] } });
      } else if (url.includes('/values/StudyData')) {
        await route.fulfill({ json: { values: [STUDY_DATA_HEADERS] } });
      } else if (url.includes('/values/ResultsData')) {
        await route.fulfill({ json: { values: [RESULTS_DATA_HEADERS] } });
      } else {
        await route.fulfill({ json: { values: [] } });
      }
      return;
    }
    appendUrls.push(url);
    if (url.includes('StudyData')) {
      studyDataBodies.push(route.request().postData() ?? '');
    }
    await route.fulfill({ json: {} });
  });

  await page.route('https://www.googleapis.com/**', async (route) => {
    await route.fulfill({ json: {} });
  });

  return { appendUrls, getUrls, studyDataBodies };
}

function documentsSlice(): Record<string, unknown> {
  return {
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
        textRef: null,
        textStatus: 'no_text_layer',
        pageCount: 1,
        charCount: 0,
        importedAt: '2026-07-01T00:00:00Z',
        importedBy: 'owner@example.com',
        note: null,
      },
    ],
    studies: [
      {
        studyId: 'study-1',
        studyLabel: 'Smith 2020',
        registrationId: null,
        createdAt: '2026-07-01T00:00:00Z',
        createdBy: 'owner@example.com',
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
  };
}

async function initApp(page: Page): Promise<void> {
  await installChromeStub(page, 'reviewer2@example.com');
  // addInitScript のコールバックはブラウザ側で実行されるため、Node 側のヘルパ関数
  // （documentsSlice）はここでは呼べない。値を事前に計算して引数として渡す
  await page.addInitScript(
    (data: { project: typeof PROJECT; documents: Record<string, unknown> }) => {
      const win = window as unknown as Record<string, unknown>;
      win.__E2E_PRELOADED_STATE__ = {
        currentProject: data.project,
        // counts は一切注入しない（reviewer 系ロールは loadProgressCounts を読まない盲検のため常に
        // 初期値 0。#/verify のガードがこの状態でも許可されることが guards.ts のバグ修正の実弾検証）
        role: {
          role: 'reviewer_independent',
          resolving: false,
          error: null,
          folderAccessGranted: true,
          folderAccessChecking: false,
          folderAccessError: null,
        },
        documents: data.documents,
      };
    },
    { project: PROJECT, documents: documentsSlice() },
  );
  await page.goto('/app/app.html#/verify');
}

test('独立入力モード: Evidence 由来表示が一切出ず、値の直接入力で human_independent 行 + Decisions 追記まで実弾検証', async ({
  page,
}) => {
  const { appendUrls, getUrls, studyDataBodies } = await setupRoutes(page);
  await initApp(page);

  // ① 検証画面は開けるが、AI 抽出前提の要素は一切出ない
  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.verify__cell-label')).toHaveText('死亡率');
  await expect(page.locator('.verify__quote')).toHaveCount(0);
  await expect(page.locator('.verify__ai')).toHaveCount(0);
  await expect(page.locator('.verify__action--accept')).toHaveCount(0);
  await expect(page.locator('.verify__action--reject')).toHaveCount(0);
  await expect(page.locator('.pdf-viewer__hl')).toHaveCount(0);
  // 代わりにスキーマの抽出指示を表示する（AI 出力ではないため表示可）
  await expect(page.locator('.verify__instruction')).toHaveText('Report overall mortality.');
  // 独立入力モードの冒頭説明も AI 抽出を前提にしない文言になる
  await expect(page.locator('.view__lead')).toContainText('AI 抽出は行われません');

  // Evidence / ExtractionRuns は一切読まれない（design §5.1: AI 抽出の有無を見せない）
  expect(getUrls.some((url) => url.includes('/values/Evidence'))).toBe(false);
  expect(getUrls.some((url) => url.includes('/values/ExtractionRuns'))).toBe(false);

  // ② 値の直接入力（action='edit'）→ StudyData（human_independent）+ Decisions 追記
  await page.locator('.verify__action--edit').click();
  const input = page.locator('.verify__edit-input');
  await expect(input).toHaveValue(''); // AI 値の流用なし = 空欄から入力する
  await input.fill('15');
  await page.locator('.verify__edit-confirm').click();

  await expect
    .poll(() => appendUrls.filter((url) => url.includes('Decisions') && url.includes(':append')).length)
    .toBeGreaterThan(0);
  await expect
    .poll(() => appendUrls.filter((url) => url.includes('StudyData') && url.includes(':append')).length)
    .toBeGreaterThan(0);
  expect(studyDataBodies.some((body) => body.includes('human_independent'))).toBe(true);
  expect(studyDataBodies.some((body) => body.includes('"15"'))).toBe(true);

  // ③ axe
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('独立入力モード: 確定済みスキーマが無ければ AI 抽出前提ではない空状態メッセージを出す', async ({ page }) => {
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (route.request().method() === 'GET') {
      if (url.includes('fields=sheets.properties.title')) {
        const titles = ['Meta', 'Documents', 'Studies', 'SchemaVersions', 'SchemaFields'];
        await route.fulfill({ json: { sheets: titles.map((title) => ({ properties: { title } })) } });
        return;
      }
      if (url.includes('/values/SchemaVersions')) {
        await route.fulfill({ json: { values: [SCHEMA_VERSIONS_HEADERS] } }); // 確定版なし
        return;
      }
      await route.fulfill({ json: { values: [] } });
      return;
    }
    await route.fulfill({ json: {} });
  });
  await initApp(page);

  await expect(page.locator('#verify-empty')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#verify-empty')).toContainText('オーナーが表のデザイン（スキーマ）を確定するまで');
  await expect(page.locator('#verify-empty')).not.toContainText('AI 抽出');
});
