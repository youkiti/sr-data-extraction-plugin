// #/protocol（S4）のルート別 E2E（test-strategy.md §3 フェーズ 2 + ui-states.md §3）。
// 状態は __E2E_PRELOADED_STATE__ で注入し、Sheets / Drive API は page.route で stub する。
// docx パース（mammoth）はバンドル済みだが、E2E ではファイル実体を扱わず
// 手入力の保存フローで配線を検証する（パーサ単体は unit テストで検証済み）
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PROTOCOL_HEADERS = [
  'version', 'framework_type', 'research_question', 'inclusion_criteria', 'exclusion_criteria',
  'study_design', 'block_count', 'combination_expression', 'source_type', 'source_filename',
  'raw_text_ref', 'raw_text_preview', 'raw_text_inline', 'created_at', 'created_by',
];

function makeRecord(version: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version,
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
    rawTextPreview: `v${version} のプレビュー`,
    rawTextInline: `v${version} の本文`,
    createdAt: `2026-07-0${version}T00:00:00Z`,
    createdBy: 'e2e@example.com',
    ...overrides,
  };
}

async function initApp(
  page: Page,
  protocol: Record<string, unknown>,
  protocolVersions = 0,
): Promise<void> {
  await page.addInitScript(
    ({ protocolState, versions }) => {
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
          documents: 3,
          protocolVersions: versions,
          schemaVersions: 0,
          pilotRuns: 0,
          evidenceRows: 0,
          dataRows: 0,
        },
        protocol: protocolState,
      };
    },
    { protocolState: protocol, versions: protocolVersions },
  );
  await page.goto('/app/app.html#/protocol');
}

const EMPTY_STATE = {
  records: [],
  loading: false,
  loadError: null,
  saving: false,
  saveError: null,
  editing: false,
  selectedVersion: null,
  draftText: '',
};

test('空状態: 手入力フォームと入力方法ラジオを表示する', async ({ page }) => {
  await initApp(page, EMPTY_STATE);

  await expect(page.locator('#protocol-form')).toBeVisible();
  await expect(page.locator('#protocol-inline')).toBeVisible();
  await expect(page.locator('#protocol-file-section')).toBeHidden();
  await expect(page.locator('#protocol-submit')).toHaveText('保存する');
  await expect(page.locator('#protocol-cancel')).toHaveCount(0);
});

test('入力方法の切替でファイルセクションが現れる', async ({ page }) => {
  await initApp(page, EMPTY_STATE);

  await page.locator('input[name="protocol-source"][value="file"]').check();
  await expect(page.locator('#protocol-file-section')).toBeVisible();
  await expect(page.locator('#protocol-manual-section')).toBeHidden();
  await expect(page.locator('#protocol-file')).toHaveAttribute('accept', '.md,.markdown,.docx');
});

test('空本文の送信はインラインエラーにして保存しない', async ({ page }) => {
  await initApp(page, EMPTY_STATE);

  await page.locator('#protocol-submit').click();
  await expect(page.locator('#protocol-error')).toHaveText('本文を入力してください');
  await expect(page.locator('#protocol-form')).toBeVisible();
});

test('手入力の保存が Sheets 追記（GET + POST）まで到達し読み取り専用へ遷移する', async ({ page }) => {
  let appendBody: string | null = null;
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { values: [PROTOCOL_HEADERS] } });
      return;
    }
    appendBody = route.request().postData();
    await route.fulfill({ json: {} });
  });
  await page.route('https://www.googleapis.com/drive/v3/files**', async (route) => {
    await route.fulfill({
      json: {
        files: [
          { id: 'folder-raw', webViewLink: 'https://drive.google.com/drive/folders/folder-raw' },
        ],
      },
    });
  });
  await initApp(page, EMPTY_STATE);

  await page.locator('#protocol-inline').fill('P: 成人肺炎\nI: 抗菌薬 A');
  await page.locator('#protocol-submit').click();

  await expect(page.locator('.toast').last()).toHaveText('プロトコル v1 を保存しました');
  await expect(page.locator('#protocol-readonly')).toBeVisible();
  await expect(page.locator('#protocol-summary')).toContainText('v1');
  await expect(page.locator('#protocol-summary')).toContainText('P: 成人肺炎');
  expect(appendBody).toContain('P: 成人肺炎');
});

test('読み取り専用: サマリ・版切替・古い版の注記を表示する', async ({ page }) => {
  await initApp(
    page,
    {
      ...EMPTY_STATE,
      records: [
        makeRecord(2, {
          sourceType: 'markdown',
          sourceFilename: 'protocol.md',
          rawTextRef: 'https://drive.google.com/file/d/raw-2/view',
          rawTextInline: null,
        }),
        makeRecord(1),
      ],
    },
    2,
  );

  const summary = page.locator('#protocol-summary');
  await expect(summary).toContainText('v2');
  await expect(summary).toContainText('Markdown（protocol.md）');
  await expect(summary.locator('a')).toHaveText('Drive で開く');

  // 古い版へ切替 → 注記 + v1 の本文
  await page.locator('#protocol-version-select').selectOption('1');
  await expect(page.locator('#protocol-old-note')).toContainText('最新: v2');
  await expect(page.locator('#protocol-summary')).toContainText('v1 の本文');
});

test('「新しい版を入力」でフォームへ、キャンセルで読み取り専用へ戻る', async ({ page }) => {
  await initApp(page, { ...EMPTY_STATE, records: [makeRecord(1)] }, 1);

  await page.locator('#protocol-edit').click();
  await expect(page.locator('#protocol-form')).toBeVisible();
  await expect(page.locator('#protocol-submit')).toHaveText('新しい版として保存');

  await page.locator('#protocol-cancel').click();
  await expect(page.locator('#protocol-readonly')).toBeVisible();
});

test('アクセシビリティ違反がない（axe・フォーム）', async ({ page }) => {
  await initApp(page, EMPTY_STATE);
  await expect(page.locator('#protocol-form')).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('アクセシビリティ違反がない（axe・読み取り専用）', async ({ page }) => {
  await initApp(page, { ...EMPTY_STATE, records: [makeRecord(2), makeRecord(1)] }, 2);
  await expect(page.locator('#protocol-readonly')).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
