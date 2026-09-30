// 担当セットの分割・検証対象の制限・裁定ペアを、ローカルの Sheets スタブで確認する。
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SHEET_HEADERS } from '../../src/domain/sheetsSchema';
import { STUDY_ENTITY_KEY } from '../../src/utils/entityKey';

const OWNER = 'owner@example.com';
const PROJECT = {
  projectId: 'p1',
  spreadsheetId: 'sheet-1',
  driveFolderId: 'folder-1',
  name: '担当セットの検証',
};

/** 認証とシート操作はすべてこのテストのブラウザ内・メモリ内で完結させる。 */
async function setup(
  page: Page,
  email: string,
  role: 'owner' | 'reviewer_with_ai',
  studySets: string[],
  reviewRows: string[][],
) {
  const tabs: Record<string, string[][]> = Object.fromEntries(
    Object.entries(SHEET_HEADERS).map(([name, header]) => [name, [[...header]]]),
  );
  tabs.Meta!.push(['p1', PROJECT.name, 'sheet-1', 'folder-1', '1.0', 't0', OWNER]);
  tabs.SchemaVersions!.push(['1', '', '1', 'user_edit', 't0', OWNER, '']);
  tabs.SchemaFields!.push([
    '1',
    'f-total',
    '1',
    'results',
    'mortality',
    '死亡率',
    'study',
    'text',
    '',
    '',
    'TRUE',
    '死亡率を抽出',
    '',
    'FALSE',
    '',
  ]);
  studySets.forEach((set, index) => {
    const id = `study-${index + 1}`;
    tabs.Studies!.push([id, `研究 ${index + 1}`, '', 't0', OWNER, '', set]);
    tabs.Documents!.push([
      `doc-${index + 1}`,
      id,
      'article',
      `pdf-${index + 1}`,
      '',
      `研究${index + 1}.pdf`,
      '',
      '',
      '',
      'ok',
      '1',
      '100',
      't0',
      OWNER,
      '',
      'FALSE',
      '',
      '',
      '',
    ]);
    tabs.Evidence!.push([
      `ev-${index + 1}`,
      'run-1',
      id,
      'f-total',
      `doc-${index + 1}`,
      STUDY_ENTITY_KEY,
      '12',
      'FALSE',
      '根拠',
      '1',
      'high',
      'exact',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
  });
  tabs.ReviewSets!.push(...reviewRows);
  tabs.ExtractionRuns!.push([
    'run-1',
    'full',
    '1',
    studySets.map((_, index) => `study-${index + 1}`).join(','),
    'gemini',
    'gemini-3.5-flash',
    '',
    'text_only',
    'done',
    't0',
    't0',
    '100',
    '50',
    '0.01',
  ]);
  const writes: Array<{
    url: string;
    body: { values?: string[][]; data?: Array<{ range: string; values: string[][] }> };
  }> = [];
  await page.addInitScript(
    ({ project, userEmail, projectRole, count }) => {
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
          getURL: (path: string) => `/${path}`,
          sendMessage: async (message: { type?: string }) =>
            message.type === 'auth:get-token'
              ? { ok: true, token: 'e2e-token' }
              : { ok: true, email: userEmail },
        },
        tabs: { create: async () => ({ id: 1 }) },
        identity: {
          getProfileUserInfo: (_options: unknown, callback: (info: unknown) => void) =>
            callback({ email: userEmail, id: '1' }),
        },
      };
      win.__E2E_PRELOADED_STATE__ = {
        currentProject: project,
        counts: {
          documents: count,
          protocolVersions: 1,
          schemaVersions: 1,
          pilotRuns: 1,
          evidenceRows: count,
          dataRows: 1,
        },
        role: {
          role: projectRole,
          resolving: false,
          error: null,
          folderAccessGranted: true,
          folderAccessChecking: false,
          folderAccessError: null,
        },
        reviewers: { assignments: [], loading: false },
        // seam のロード済み既定値を上書きして、署名者による fold も実際に通す。
        reviewSets: { sets: null },
      };
    },
    { project: PROJECT, userEmail: email, projectRole: role, count: studySets.length },
  );
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const request = route.request();
    const url = decodeURIComponent(request.url());
    if (request.method() === 'GET') {
      if (url.includes('/values:batchGet')) {
        const ranges = new URL(request.url()).searchParams.getAll('ranges');
        await route.fulfill({
          json: {
            valueRanges: ranges.map((range) => {
              const [tab, cells] = range.split('!');
              const values = tabs[tab!] ?? [];
              return { values: cells === '1:1' ? values.slice(0, 1) : values };
            }),
          },
        });
      } else if (url.includes('fields=sheets.properties.title')) {
        await route.fulfill({
          json: { sheets: Object.keys(tabs).map((title) => ({ properties: { title } })) },
        });
      } else {
        const tab = Object.keys(tabs).find((name) => url.includes(`/values/${name}`));
        await route.fulfill({ json: { values: tab === undefined ? [] : tabs[tab] } });
      }
      return;
    }
    const body = request.postDataJSON() as (typeof writes)[number]['body'];
    writes.push({ url, body });
    if (url.includes('values:batchUpdate')) {
      for (const item of body.data ?? []) {
        const match = /^Studies!A(\d+)$/.exec(item.range);
        if (match !== null) tabs.Studies![Number(match[1]) - 1] = item.values[0]!;
      }
    } else {
      const match = /\/values\/(\w+)!A1/.exec(url);
      if (match !== null) {
        const tab = match[1]!;
        if (url.includes(':append')) tabs[tab]!.push(...body.values!);
        else if (request.method() === 'PUT') tabs[tab]![0] = body.values![0]!;
      }
    }
    await route.fulfill({ json: {} });
  });
  await page.route('https://www.googleapis.com/**', async (route) => {
    await route.fulfill({ json: { md5Checksum: 'stub-md5', files: [] } });
  });
  return { tabs, writes };
}

test('owner は校正 1 件と 1 グループへ分割し、seed と研究の割当を保存する', async ({ page }) => {
  const { writes } = await setup(page, OWNER, 'owner', ['', '', '', ''], []);
  await page.goto('/app/app.html#/home');
  await expect(page.locator('#review-sets-split')).toBeVisible();
  await page.locator('#review-sets-calibration').fill('1');
  await page.locator('#review-sets-groups').fill('1');
  await page.locator('#review-sets-split').click();
  await expect(page.locator('#review-sets-list')).toBeVisible();
  const batch = writes.find(
    (write) =>
      write.url.includes('values:batchUpdate') &&
      write.body.data?.some((item) => item.range.startsWith('Studies!')),
  )!;
  const assigned = batch.body.data!.map((item) => item.values[0]![6]);
  expect(assigned.filter((set) => set === 'calibration')).toHaveLength(1);
  expect(assigned.filter((set) => set === 'group-1')).toHaveLength(3);
  const append = writes.find((write) => write.url.includes('/values/ReviewSets!A1:append'))!;
  expect(append.body.values!.map((row) => row[0])).toEqual(['calibration', 'group-1']);
  const seed = append.body.values![0]![2]!;
  expect(seed).toMatch(/^\d+$/);
  expect(append.body.values![1]![2]).toBe(seed);
  const memberships = new Map(append.body.values!.flatMap((row) => row[5]!.split(';').filter(Boolean).map((id) => [id, row[0]])));
  for (const item of batch.body.data!) expect(memberships.get(item.values[0]![0]!)).toBe(item.values[0]![6]);
  expect(memberships.size).toBe(4);
  await expect(page.locator('#review-sets-seed')).toContainText(seed);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('reviewer の検証一覧は校正と担当グループだけで、非 owner の追記を無視する', async ({
  page,
}) => {
  await setup(
    page,
    'r1@example.com',
    'reviewer_with_ai',
    ['calibration', 'group-1', 'group-2'],
    [
      ['calibration', '', '42', OWNER, 't0', 'study-1'],
      ['group-1', 'r1@example.com;r2@example.com', '42', OWNER, 't0', 'study-2'],
      ['group-2', 'r3@example.com;r4@example.com', '42', OWNER, 't0', 'study-3'],
      ['group-2', 'r1@example.com', '', 'r1@example.com', 't1', ''],
    ],
  );
  await page.goto('/app/app.html#/verify');
  await expect(page.locator('#verify-study option')).toHaveCount(2);
  expect(
    await page
      .locator('#verify-study option')
      .evaluateAll((options) =>
        options.map((option) => (option as HTMLOptionElement).value).filter(Boolean),
      ),
  ).toEqual(['study-1', 'study-2']);
});

test('担当ペアが完了済みなら第三者の判定があっても ready で担当外の注記を表示する', async ({
  page,
}) => {
  const { tabs } = await setup(
    page,
    OWNER,
    'owner',
    ['group-1'],
    [['group-1', 'r1@example.com;r2@example.com', '42', OWNER, 't0', 'study-1']],
  );
  tabs.StudyData = [[...SHEET_HEADERS.StudyData, 'mortality']];
  for (const email of ['r1@example.com', 'r2@example.com', 'r3@example.com']) {
    tabs.StudyData.push(['study-1', email, 'human_with_ai', '1', '', 't0', '12']);
    tabs.Decisions!.push([
      't0',
      email,
      'study-1',
      'f-total',
      STUDY_ENTITY_KEY,
      email,
      'human_with_ai',
      '1',
      'accept',
      '12',
      '',
    ]);
  }
  await page.goto('/app/app.html#/adjudicate');
  const row = page.locator('.adjudicate__list-row[data-study-id="study-1"]');
  await expect(row).toBeVisible();
  await expect(row.locator('.adjudicate__pair-select')).toHaveCount(0);
  await expect(row.locator('.adjudicate__outside-note')).toContainText('r3@example.com');
  await expect(row.locator('button')).toBeEnabled();
});


test('Studies の担当列を書き換えても担当外は表示せず owner に食い違いを警告する', async ({ page, context }) => {
  const rows = [
    ['calibration', '', '42', OWNER, 't0', 'study-1'],
    ['group-1', 'r1@example.com;r2@example.com', '42', OWNER, 't0', 'study-2'],
    ['group-2', 'r3@example.com;r4@example.com', '42', OWNER, 't0', 'study-3'],
  ];
  const { tabs } = await setup(page, 'r1@example.com', 'reviewer_with_ai', ['calibration', 'group-1', 'group-2'], rows);
  tabs.Studies![3]![6] = 'calibration';
  await page.goto('/app/app.html#/verify?study=study-3');
  await expect(page.locator('#verify-study option')).toHaveCount(2);
  await expect(page.locator('#verify-study option[value="study-3"]')).toHaveCount(0);
  await page.goto('/app/app.html#/home');
  await expect(page.locator('#home-assigned-progress')).toBeVisible();
  await expect(page.locator('#review-sets-mismatch')).toHaveCount(0);
  const ownerPage = await context.newPage();
  await setup(ownerPage, OWNER, 'owner', tabs.Studies!.slice(1).map((row) => row[6]!), rows);
  await ownerPage.goto('/app/app.html#/home');
  await expect(ownerPage.locator('#review-sets-mismatch')).toHaveText('Studies の担当列が担当セットの記録と食い違う study が 1 件あります（担当セットの記録を優先しています）');
});
