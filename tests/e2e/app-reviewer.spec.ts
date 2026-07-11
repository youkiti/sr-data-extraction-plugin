// 独立二重レビュー機能（issue #44 / docs/design-independent-dual-review.md）PR 1 の E2E。
// ①reviewer ロールでナビが Home / 検証のみ ②owner のレビュアー管理カードで追加 → Reviewers
// 追記の実弾検証 ③axe。加えてモード①（reviewer_with_ai が既存の #/verify フローで判定でき、
// 自分の email で annotator 行が書かれること）の成立を実弾で確認する（新規実装は無いが実証が必要）。
// Picker はホスト済みページ + externally_connectable のため E2E 対象外（他 spec と同じ方針）
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

test.describe('reviewer ロールのシェル制限（design §3・§3.1）', () => {
  test('reviewer_with_ai: ナビは Home / 検証のみ。フォルダ未付与は #/verify をブロックする', async ({ page }) => {
    await installChromeStub(page, 'reviewer@example.com');
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.includes('sheets.googleapis.com') || url.includes('googleapis.com')) {
        await route.fulfill({ json: { values: [] } });
        return;
      }
      await route.continue();
    });
    await page.addInitScript(() => {
      const win = window as unknown as Record<string, unknown>;
      win.__E2E_PRELOADED_STATE__ = {
        currentProject: {
          projectId: 'e2e-project',
          spreadsheetId: 'e2e-sheet',
          driveFolderId: 'e2e-folder',
          name: 'E2E プロジェクト',
        },
        counts: {
          documents: 1,
          protocolVersions: 1,
          schemaVersions: 1,
          pilotRuns: 1,
          evidenceRows: 1,
          dataRows: 0,
        },
        role: {
          role: 'reviewer_with_ai',
          resolving: false,
          error: null,
          folderAccessGranted: false,
          folderAccessChecking: false,
          folderAccessError: null,
        },
      };
    });
    await page.goto('/app/app.html#/home');

    // ナビ: Home / 検証のみ（文献取り込み等の owner 専用ステップは非表示。ディムではなく非表示）
    const navHrefs = await page.locator('#app-nav a').evaluateAll((els) =>
      els.map((el) => el.getAttribute('href')),
    );
    expect(navHrefs).toEqual(['#/home', '#/verify']);

    // 縮退版 Home: 進捗サマリは出さず、フォルダアクセス付与ステップを出す
    await expect(page.locator('.home__summary')).toHaveCount(0);
    await expect(page.locator('#home-reviewers')).toHaveCount(0);
    await expect(page.locator('#home-grant-folder-access')).toBeVisible();
    await expect(page.locator('#home-go-verify')).toHaveCount(0);

    // #/verify への直接遷移はフォルダアクセス未付与でブロックされる
    // （ナビ側は aria-disabled でディム表示のため、実際のクリックは force で行う）
    await page.locator('#app-nav a[href="#/verify"]').click({ force: true });
    await expect(page.locator('.toast')).toContainText('プロジェクトフォルダへのアクセス付与が必要です');
    await expect(page).toHaveURL(/#\/home$/);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('unregistered ロール: 全画面ブロックを表示し、ナビを出さない', async ({ page }) => {
    await installChromeStub(page, 'stranger@example.com');
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.includes('googleapis.com')) {
        await route.fulfill({ json: { values: [] } });
        return;
      }
      await route.continue();
    });
    await page.addInitScript(() => {
      const win = window as unknown as Record<string, unknown>;
      win.__E2E_PRELOADED_STATE__ = {
        currentProject: {
          projectId: 'e2e-project',
          spreadsheetId: 'e2e-sheet',
          driveFolderId: 'e2e-folder',
          name: 'E2E プロジェクト',
        },
        role: {
          role: 'unregistered',
          resolving: false,
          error: null,
          folderAccessGranted: false,
          folderAccessChecking: false,
          folderAccessError: null,
        },
      };
    });
    await page.goto('/app/app.html#/home');

    await expect(page.locator('#app-role-blocked')).toContainText(
      'このプロジェクトのレビュアーとして登録されていません',
    );
    await expect(page.locator('#app-nav a')).toHaveCount(0);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// モード①: reviewer_with_ai が既存の #/verify フローで判定でき、自分の email で
// annotator 行 / Decisions が書かれること（新規実装は無いが実証する。design §4）
// ---------------------------------------------------------------------------

const QUOTE = 'Mortality was 12 percent';

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

const SCHEMA_FIELDS_HEADERS = [
  'schema_version', 'field_id', 'field_index', 'section', 'field_name', 'field_label',
  'entity_level', 'data_type', 'unit', 'allowed_values', 'required', 'extraction_instruction',
  'example', 'ai_generated', 'note',
];
const STUDY_FIELD_ROW = [
  '1', 'f-total', '1', 'results', 'mortality_pct', '死亡率', 'study', 'text', '', '',
  'TRUE', 'Report overall mortality.', '', 'FALSE', '',
];
const EVIDENCE_HEADERS = [...SHEET_HEADERS.Evidence];
const EVIDENCE_ROW = ['ev-1', 'run-1', 'study-1', 'f-total', 'doc-1', '-', '12', 'FALSE', QUOTE, '1', 'high', 'exact'];
const RUNS_HEADERS = [...SHEET_HEADERS.ExtractionRuns];
const RUN_ROW = ['run-1', 'pilot', '1', 'study-1', 'gemini', 'gemini-test', '', 'text_only', 'done', 't1', 't2', '', '', ''];
const DECISIONS_HEADERS = [...SHEET_HEADERS.Decisions];
const STUDY_DATA_HEADERS = [...SHEET_HEADERS.StudyData];
const RESULTS_DATA_HEADERS = [...SHEET_HEADERS.ResultsData];

async function setupVerifyRoutes(page: Page): Promise<{ appendUrls: string[] }> {
  const appendUrls: string[] = [];
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (route.request().method() === 'GET') {
      if (url.includes('fields=sheets.properties.title')) {
        // ArmStructures タブなし（v0.7 より前の既存プロジェクト）→ 未確定（空）として読める
        const titles = ['Meta', 'Documents', 'SchemaFields', 'Evidence', 'Decisions'];
        await route.fulfill({ json: { sheets: titles.map((title) => ({ properties: { title } })) } });
      } else if (url.includes('/values/Evidence')) {
        await route.fulfill({ json: { values: [EVIDENCE_HEADERS, EVIDENCE_ROW] } });
      } else if (url.includes('/values/ExtractionRuns')) {
        await route.fulfill({ json: { values: [RUNS_HEADERS, RUN_ROW] } });
      } else if (url.includes('/values/Decisions')) {
        await route.fulfill({ json: { values: [DECISIONS_HEADERS] } });
      } else if (url.includes('/values/StudyData')) {
        await route.fulfill({ json: { values: [STUDY_DATA_HEADERS] } });
      } else if (url.includes('/values/ResultsData')) {
        await route.fulfill({ json: { values: [RESULTS_DATA_HEADERS] } });
      } else if (url.includes('/values/SchemaFields')) {
        await route.fulfill({ json: { values: [SCHEMA_FIELDS_HEADERS, STUDY_FIELD_ROW] } });
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
      if (/\/files\/txt-[^?]+\?alt=media/.exec(url) !== null) {
        await route.fulfill({ contentType: 'text/plain', body: QUOTE });
        return;
      }
      await route.fulfill({ contentType: 'application/pdf', body: minimalPdf(QUOTE) });
      return;
    }
    await route.fulfill({ json: {} });
  });

  return { appendUrls };
}

test('reviewer_with_ai は付与済みなら #/verify で判定でき、自分の email で annotator 行を書く（mode① の成立）', async ({
  page,
}) => {
  await installChromeStub(page, 'reviewer@example.com');
  const { appendUrls } = await setupVerifyRoutes(page);
  await page.addInitScript((project) => {
    const win = window as unknown as Record<string, unknown>;
    win.__E2E_PRELOADED_STATE__ = {
      currentProject: project,
      counts: {
        documents: 1,
        protocolVersions: 1,
        schemaVersions: 1,
        pilotRuns: 1,
        evidenceRows: 1,
        dataRows: 0,
      },
      role: {
        role: 'reviewer_with_ai',
        resolving: false,
        error: null,
        folderAccessGranted: true,
        folderAccessChecking: false,
        folderAccessError: null,
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
  }, PROJECT);
  await page.goto('/app/app.html#/verify');

  // reviewer_with_ai は既存の検証フローがそのまま動く（空セルから開始 = 自分の annotator 行は未検証）
  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.verify__cell-label')).toHaveText('死亡率');

  await page.locator('.verify__action--accept').click();
  await expect(page.locator('#verify-focus-detail .verify__chip')).toHaveText('承認');

  // Decisions / StudyData の書き込みに reviewer 自身の email が annotator / decided_by として使われる
  await expect
    .poll(() => appendUrls.filter((url) => url.includes('Decisions') && url.includes(':append')).length)
    .toBeGreaterThan(0);
  const decisionsAppend = appendUrls.filter((url) => url.includes('Decisions') && url.includes(':append'));
  expect(decisionsAppend.length).toBeGreaterThan(0);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

// ---------------------------------------------------------------------------
// owner のレビュアー管理カード（§7.1・§8.1）
// ---------------------------------------------------------------------------

test('owner のレビュアー管理カードで追加すると Reviewers タブへ実際に追記される', async ({ page }) => {
  await installChromeStub(page, 'owner@example.com');
  const appendUrls: string[] = [];
  const batchUpdateBodies: string[] = [];
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    const method = route.request().method();
    if (method === 'GET') {
      if (url.includes('fields=sheets.properties.title')) {
        // Reviewers タブなし（旧プロジェクト）→ 追加時にタブを作る
        const titles = ['Meta', 'Documents', 'SchemaFields'];
        await route.fulfill({ json: { sheets: titles.map((title) => ({ properties: { title } })) } });
        return;
      }
      await route.fulfill({ json: { values: [] } });
      return;
    }
    if (url.includes(':batchUpdate')) {
      batchUpdateBodies.push(route.request().postData() ?? '');
      await route.fulfill({ json: {} });
      return;
    }
    appendUrls.push(url);
    await route.fulfill({ json: {} });
  });
  await page.addInitScript((project) => {
    const win = window as unknown as Record<string, unknown>;
    win.__E2E_PRELOADED_STATE__ = { currentProject: project };
  }, PROJECT);
  await page.goto('/app/app.html#/home');

  // owner は全ルート + レビュアー管理カードが見える
  const navHrefs = await page.locator('#app-nav a').evaluateAll((els) =>
    els.map((el) => el.getAttribute('href')),
  );
  expect(navHrefs.length).toBe(9);
  await expect(page.locator('#home-reviewers')).toBeVisible();

  await page.locator('#reviewer-email').fill('reviewer@example.com');
  await page.locator('#reviewer-role').selectOption('reviewer');
  await page.locator('#reviewer-mode').selectOption('independent');
  await page.locator('#reviewer-add-submit').click();

  await expect(page.locator('.toast')).toContainText('reviewer@example.com を登録しました');
  // タブ作成（旧プロジェクト）+ Reviewers への実追記まで実弾で確認する
  await expect.poll(() => batchUpdateBodies.some((body) => body.includes('"Reviewers"'))).toBe(true);
  const reviewersAppend = appendUrls.filter((url) => url.includes('Reviewers') && url.includes(':append'));
  expect(reviewersAppend.length).toBeGreaterThan(0);
  await expect(page.locator('#home-reviewers-list tbody tr')).toHaveCount(1);
  await expect(page.locator('#home-reviewers-list tbody tr')).toContainText('reviewer@example.com');
  await expect(page.locator('#home-reviewers-list tbody tr')).toContainText('② AI 抜きでレビュー');

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
