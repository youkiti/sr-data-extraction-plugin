// `#/adjudicate`（S12。docs/design-independent-dual-review.md §6・§9 PR3）のルート別 E2E。
// owner 視点で、2 名の human annotator（reviewer-a / reviewer-b）分のデータを seam で注入し:
//   ① study 一覧のゲート（未完了 study のディム表示。値・判定内訳は見せない）
//   ② 群構成一致の「このまま採用」1 クリック → ArmStructures へ annotator='consensus' で追記
//   ③ 一致セルの一括採用 → StudyData / ResultsData / Decisions へ annotator='consensus' で追記
//   ④ 不一致セルの個別裁定（A を採用）→ StudyData 追記 + Decisions（action='edit'）追記
//   ⑤ axe
// を実弾（Sheets stub への書き込み URL・body の検証）で確認する。
// PDF 参照ペインは簡略版（PDF 表示 + テキスト検索のみ。Evidence ハイライトは省略）のため、
// 実 PDF 配信は canvas 描画の疎通確認のみに使う（他 spec と同じ最小 PDF ヘルパ）
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SHEET_HEADERS, SHEET_TABS } from '../../src/domain/sheetsSchema';

const PROJECT = {
  projectId: 'e2e-project',
  spreadsheetId: 'e2e-sheet',
  driveFolderId: 'e2e-folder',
  name: 'E2E プロジェクト',
};

const OWNER = 'owner@example.com';
const REVIEWER_A = 'reviewer-a@example.com';
const REVIEWER_B = 'reviewer-b@example.com';

/**
 * app 実行に必要な最小 chrome API モック（Picker 関連の外部メッセージングは含めない）。
 * storage.local は他 spec の使い捨てモック（常に空返却）と異なり、ページ内の実データを保持する
 * 実装にしている（issue #63: オフラインキュー退避 → 復帰後再送の E2E 検証には、`lib/storage/
 * offlineQueue.ts` の enqueue → flush が同一データを往復する必要があるため）
 */
async function installChromeStub(page: Page, email: string): Promise<void> {
  await page.addInitScript((userEmail) => {
    const win = window as unknown as Record<string, unknown>;
    const localData: Record<string, unknown> = {};
    win.chrome = {
      storage: {
        local: {
          get: async (key: string) => (key in localData ? { [key]: localData[key] } : {}),
          set: async (items: Record<string, unknown>) => {
            Object.assign(localData, items);
          },
          remove: async (key: string) => {
            delete localData[key];
          },
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

/** テキスト層つきの最小 1 ページ PDF（他 spec と同じ手組み構成） */
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

const SCHEMA_VERSIONS_HEADERS = [...SHEET_HEADERS.SchemaVersions];
const SCHEMA_VERSION_ROW = ['1', '', '1', 'ai_draft', 't0', OWNER, ''];

const SCHEMA_FIELDS_HEADERS = [
  'schema_version', 'field_id', 'field_index', 'section', 'field_name', 'field_label',
  'entity_level', 'data_type', 'unit', 'allowed_values', 'required', 'extraction_instruction',
  'example', 'ai_generated', 'note',
];
// study レベル 2 項目（mortality_pct = 一致・mean_age = 不一致）+ arm レベル 1 項目（arm_name = 一致）
const FIELD_MORTALITY = ['1', 'f-mortality', '1', 'results', 'mortality_pct', '死亡率', 'study', 'text', '', '', 'FALSE', '死亡率を抽出', '', 'FALSE', ''];
const FIELD_AGE = ['1', 'f-age', '2', 'population', 'mean_age', '平均年齢', 'study', 'text', '', '', 'FALSE', '平均年齢を抽出', '', 'FALSE', ''];
const FIELD_ARM = ['1', 'f-arm', '3', 'arms', 'arm_name', '群名', 'arm', 'text', '', '', 'FALSE', '群名を抽出', '', 'FALSE', ''];

const STUDY_DATA_HEADERS = [...SHEET_HEADERS.StudyData, 'mortality_pct', 'mean_age'];
// study-1: 両者そろい、mortality は一致・age は不一致 → ゲート ready
const STUDY_DATA_ROW_A1 = ['study-1', REVIEWER_A, 'human_with_ai', '1', '', 't0', '12', '45'];
const STUDY_DATA_ROW_B1 = ['study-1', REVIEWER_B, 'human_with_ai', '1', '', 't0', '12', '50'];
// study-2: reviewer-a のみ → pair=waiting（両者の検証完了待ち）
const STUDY_DATA_ROW_A2 = ['study-2', REVIEWER_A, 'human_with_ai', '1', '', 't0', '', ''];

const RESULTS_DATA_HEADERS = [...SHEET_HEADERS.ResultsData];
const RESULTS_ROW_A = ['r-a', 'study-1', 'f-arm', REVIEWER_A, 'human_with_ai', '1', 'arm:1', '', '介入群', 'FALSE', 't0'];
const RESULTS_ROW_B = ['r-b', 'study-1', 'f-arm', REVIEWER_B, 'human_with_ai', '1', 'arm:1', '', '介入群', 'FALSE', 't0'];

const ARM_STRUCTURES_HEADERS = [...SHEET_HEADERS.ArmStructures];
const ARM_ROW_A = ['study-1', '1', 'arm:1', '介入群', REVIEWER_A, 'human_with_ai', 't0', ''];
const ARM_ROW_B = ['study-1', '1', 'arm:1', '介入群', REVIEWER_B, 'human_with_ai', 't0', ''];

const DECISIONS_HEADERS = [...SHEET_HEADERS.Decisions];
function decisionRow(
  fieldId: string,
  entityKey: string,
  annotator: string,
  action: string,
  value: string,
  note = '',
): string[] {
  return ['t0', annotator, 'study-1', fieldId, entityKey, annotator, 'human_with_ai', '1', action, value, note];
}
// study-1 の両者が study レベル 2 項目 + arm レベル 1 項目をすべて判定済み（ゲート 100%）。
// f-age（平均年齢）の B 側判定には note を付ける（issue #63: 裁定 PDF ペインでの note 表示の確認用）
const STUDY1_DECISIONS = [
  decisionRow('f-mortality', '-', REVIEWER_A, 'accept', '12'),
  decisionRow('f-mortality', '-', REVIEWER_B, 'accept', '12'),
  decisionRow('f-age', '-', REVIEWER_A, 'accept', '45'),
  decisionRow('f-age', '-', REVIEWER_B, 'edit', '50', 'Table 2 と本文で数値不一致、Table 2 を採用'),
  decisionRow('f-arm', 'arm:1', REVIEWER_A, 'accept', '介入群'),
  decisionRow('f-arm', 'arm:1', REVIEWER_B, 'accept', '介入群'),
];

// issue #63: 裁定 PDF ペインの Evidence ハイライト表示の確認用（表示する run = ExtractionRuns の
// 既知 run のうち study-1 の最新）。quote は minimalPdf の埋め込みテキスト「Smith 2020」と一致させる
const EXTRACTION_RUNS_HEADERS = [...SHEET_HEADERS.ExtractionRuns];
const EXTRACTION_RUN_ROW = [
  'run-1', 'full', '1', 'study-1', 'gemini', 'gemini-3.5-flash', '', 'text_only', 'done', 't0', 't0', '100', '50', '0.01',
];
const EVIDENCE_HEADERS = [...SHEET_HEADERS.Evidence];
const EVIDENCE_ROW_AGE = [
  'ev-age', 'run-1', 'study-1', 'f-age', 'doc-1', '-', '45', 'FALSE', 'Smith 2020', '1', 'high', 'exact', '', '', '', '', '',
];

interface RouteRecorder {
  /** POST（append）の書き込み URL + body */
  appends: { url: string; body: Record<string, unknown> }[];
}

interface SetupRoutesOptions {
  /**
   * issue #63: オフラインキュー退避 → 復帰後再送の E2E 検証用。マッチする最初の :append 呼び出し
   * だけをネットワーク失敗（route.abort）にし、以降は通常どおり成功させる
   */
  failFirstAppendMatching?: RegExp;
}

async function setupRoutes(page: Page, options: SetupRoutesOptions = {}): Promise<RouteRecorder> {
  const appends: { url: string; body: Record<string, unknown> }[] = [];
  let failedOnce = false;

  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    const method = route.request().method();
    if (method === 'GET') {
      if (url.includes('fields=sheets.properties.title')) {
        await route.fulfill({ json: { sheets: SHEET_TABS.map((title) => ({ properties: { title } })) } });
      } else if (url.includes('/values/SchemaVersions')) {
        await route.fulfill({ json: { values: [SCHEMA_VERSIONS_HEADERS, SCHEMA_VERSION_ROW] } });
      } else if (url.includes('/values/SchemaFields')) {
        await route.fulfill({ json: { values: [SCHEMA_FIELDS_HEADERS, FIELD_MORTALITY, FIELD_AGE, FIELD_ARM] } });
      } else if (url.includes('/values/StudyData')) {
        await route.fulfill({ json: { values: [STUDY_DATA_HEADERS, STUDY_DATA_ROW_A1, STUDY_DATA_ROW_B1, STUDY_DATA_ROW_A2] } });
      } else if (url.includes('/values/ResultsData')) {
        await route.fulfill({ json: { values: [RESULTS_DATA_HEADERS, RESULTS_ROW_A, RESULTS_ROW_B] } });
      } else if (url.includes('/values/ArmStructures')) {
        await route.fulfill({ json: { values: [ARM_STRUCTURES_HEADERS, ARM_ROW_A, ARM_ROW_B] } });
      } else if (url.includes('/values/Decisions')) {
        await route.fulfill({ json: { values: [DECISIONS_HEADERS, ...STUDY1_DECISIONS] } });
      } else if (url.includes('/values/ExtractionRuns')) {
        await route.fulfill({ json: { values: [EXTRACTION_RUNS_HEADERS, EXTRACTION_RUN_ROW] } });
      } else if (url.includes('/values/Evidence')) {
        await route.fulfill({ json: { values: [EVIDENCE_HEADERS, EVIDENCE_ROW_AGE] } });
      } else {
        await route.fulfill({ json: { values: [] } });
      }
      return;
    }
    if (url.includes(':append')) {
      if (!failedOnce && options.failFirstAppendMatching?.test(url)) {
        failedOnce = true;
        await route.abort('failed');
        return;
      }
      const postData = route.request().postData() ?? '{}';
      appends.push({ url, body: JSON.parse(postData) as Record<string, unknown> });
    }
    await route.fulfill({ json: {} });
  });

  await page.route('https://www.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (url.includes('alt=media')) {
      await route.fulfill({ contentType: 'application/pdf', body: minimalPdf('Smith 2020') });
      return;
    }
    await route.fulfill({ json: {} });
  });

  return { appends };
}

function docRecord(documentId: string, studyId: string, driveFileId: string, filename: string): Record<string, unknown> {
  return {
    documentId,
    studyId,
    documentRole: 'article',
    driveFileId,
    sourceFileId: `src-${documentId}`,
    filename,
    pmid: null,
    doi: null,
    textRef: null,
    textStatus: 'ok',
    pageCount: 1,
    charCount: 100,
    importedAt: '2026-07-01T00:00:00Z',
    importedBy: OWNER,
    note: null,
  };
}

function studyRecord(studyId: string, studyLabel: string): Record<string, unknown> {
  return { studyId, studyLabel, registrationId: null, createdAt: '2026-07-01T00:00:00Z', createdBy: OWNER, note: null };
}

function documentsSlice(): Record<string, unknown> {
  return {
    records: [docRecord('doc-1', 'study-1', 'drive-1', 'smith2020.pdf'), docRecord('doc-2', 'study-2', 'drive-2', 'jones2021.pdf')],
    studies: [studyRecord('study-1', 'Smith 2020'), studyRecord('study-2', 'Jones 2021')],
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
  await installChromeStub(page, OWNER);
  await page.addInitScript(
    (data: { project: typeof PROJECT; documents: Record<string, unknown> }) => {
      const win = window as unknown as Record<string, unknown>;
      win.__E2E_PRELOADED_STATE__ = {
        currentProject: data.project,
        // owner として振る舞う（role 省略時の既定。§1）。counts は home 集計の噪音を避けるため読込済み扱いにする
        home: { countsLoaded: true, countsLoading: false, countsError: null },
        documents: data.documents,
      };
    },
    { project: PROJECT, documents: documentsSlice() },
  );
  await page.goto('/app/app.html#/adjudicate');
}

test('study 一覧のゲート → 群構成の一致採用 → 一致セル一括採用 → 個別裁定（A 採用）まで実弾検証 + axe', async ({ page }) => {
  const { appends } = await setupRoutes(page);
  await initApp(page);

  // ① study 一覧: study-1 は「裁定を開始」可、study-2 は両者の検証完了待ちでディム + ボタン無し
  await expect(page.locator('#adjudicate-list')).toBeVisible({ timeout: 15_000 });
  const rows = page.locator('#adjudicate-list tbody tr');
  await expect(rows).toHaveCount(2);
  const study2Row = page.locator('tr', { hasText: 'Jones 2021' });
  await expect(study2Row).toHaveClass(/adjudicate__list-row--dimmed/);
  await expect(study2Row).toContainText('両者の検証完了待ちです');
  await expect(study2Row.locator('button')).toHaveCount(0);
  const study1Row = page.locator('tr[data-study-id="study-1"]');
  await expect(study1Row).not.toHaveClass(/adjudicate__list-row--dimmed/);
  await expect(study1Row).toContainText(`A（${REVIEWER_A}）: 3/3`);
  await expect(study1Row).toContainText(`B（${REVIEWER_B}）: 3/3`);

  // study-1 を開く
  await study1Row.locator('.adjudicate__open-button').click();
  await expect(page).toHaveURL(/#\/adjudicate\?study=study-1$/);
  await expect(page.locator('#adjudicate-working')).toBeVisible();

  // ② 群構成: 一致しているので「このまま採用」1 クリックで確定
  await expect(page.locator('#adjudicate-arm-card')).toContainText('一致しています');
  await page.locator('#adjudicate-arm-adopt').click();
  await expect
    .poll(() => appends.filter((a) => a.url.includes('ArmStructures') && a.url.includes(':append')).length)
    .toBeGreaterThan(0);
  const armAppend = appends.find((a) => a.url.includes('ArmStructures'));
  const armValues = armAppend?.body['values'] as unknown[][];
  expect(armValues[0]).toEqual(['study-1', 1, 'arm:1', '介入群', 'consensus', 'consensus', expect.any(String), expect.any(String)]);
  await expect(page.locator('#adjudicate-arm-card')).toContainText('確定済み');

  // ③ 一致セルの一括採用（study レベル mortality_pct + arm レベル arm_name の 2 セル）
  await expect(page.locator('#adjudicate-summary')).toContainText('一致 2 件 / 不一致 1 件');
  await page.locator('#adjudicate-accept-all').click();
  await expect
    .poll(() => appends.filter((a) => a.url.includes('StudyData') && a.url.includes(':append')).length)
    .toBeGreaterThan(0);
  await expect
    .poll(() => appends.filter((a) => a.url.includes('ResultsData') && a.url.includes(':append')).length)
    .toBeGreaterThan(0);
  const studyDataAppend = appends.find((a) => a.url.includes('StudyData'));
  const studyDataRow = (studyDataAppend?.body['values'] as unknown[][])[0] as unknown[];
  expect(studyDataRow.slice(0, 3)).toEqual(['study-1', 'consensus', 'consensus']);
  expect(studyDataRow).toContain('12'); // mortality_pct の一致値
  const resultsDataAppend = appends.find((a) => a.url.includes('ResultsData'));
  const resultsDataRow = (resultsDataAppend?.body['values'] as unknown[][])[0] as unknown[];
  expect(resultsDataRow).toEqual(
    // run_id は null → 空文字に変換されて送信される（appendRows の既存挙動）
    expect.arrayContaining(['study-1', 'f-arm', 'consensus', 'consensus', 1, 'arm:1', '', '介入群', false]),
  );
  const decisionsAppendsAfterBulk = appends.filter((a) => a.url.includes('Decisions') && a.url.includes(':append'));
  expect(decisionsAppendsAfterBulk.length).toBeGreaterThan(0);
  const bulkDecisionRows = decisionsAppendsAfterBulk[0]?.body['values'] as unknown[][];
  expect(bulkDecisionRows).toHaveLength(2); // mortality + arm_name の 2 件
  expect(bulkDecisionRows.every((row) => row[5] === 'consensus' && row[8] === 'accept')).toBe(true);

  // ④ 不一致セル（mean_age）の個別裁定: 既定「不一致のみ」フィルタで唯一表示されているセル
  await expect(page.locator('.adjudicate__cell-row--mismatch')).toHaveCount(1);
  await expect(page.locator('.adjudicate__cell-row--mismatch')).toContainText('平均年齢');
  const decisionsAppendCountBeforeChoice = appends.filter((a) => a.url.includes('Decisions') && a.url.includes(':append')).length;
  await page.locator('.adjudicate__action--choose-a').click();
  await expect
    .poll(() => appends.filter((a) => a.url.includes('Decisions') && a.url.includes(':append')).length)
    .toBeGreaterThan(decisionsAppendCountBeforeChoice);
  await expect(page.locator('.adjudicate__cell-row--edit')).toContainText('確定値: 45');
  const lastStudyDataAppend = appends.filter((a) => a.url.includes('StudyData') && a.url.includes(':append')).slice(-1)[0];
  const lastStudyDataRow = (lastStudyDataAppend?.body['values'] as unknown[][])[0] as unknown[];
  expect(lastStudyDataRow).toContain('45');
  const lastDecisionAppend = appends.filter((a) => a.url.includes('Decisions') && a.url.includes(':append')).slice(-1)[0];
  const lastDecisionRows = lastDecisionAppend?.body['values'] as unknown[][];
  expect(lastDecisionRows[0]?.[8]).toBe('edit');
  expect(lastDecisionRows[0]?.[5]).toBe('consensus');
  expect(lastDecisionRows[0]?.[1]).toBe(OWNER); // decided_by = 裁定者

  // ⑤ axe
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('レビュアー間一致度カード: 一致率・κ・不一致一覧の計算 → CSV 保存 + axe（issue #66）', async ({ page }) => {
  await setupRoutes(page);
  await initApp(page);

  // study-1（ready ペア）のみが対象。study-2（waiting）は含まれない
  await expect(page.locator('#adjudicate-list')).toBeVisible({ timeout: 15_000 });
  const card = page.locator('#adjudicate-agreement-card');
  await expect(card.locator('#agreement-load')).toBeVisible();
  await expect(card.locator('#agreement-table')).toHaveCount(0);
  await card.locator('#agreement-load').click();

  // 全体: study-1 の 3 セル中 2 一致（死亡率・群名は一致、平均年齢は不一致）
  // po=2/3≈66.7%、pe=2/9 → κ=(2/3-2/9)/(1-2/9)=(4/9)/(7/9)=4/7≈0.57
  await expect(card.locator('#agreement-summary-line')).toContainText('対象研究 1 件');
  await expect(card.locator('#agreement-summary-line')).toContainText('66.7%');
  await expect(card.locator('#agreement-summary-line')).toContainText('0.57');

  const rows = card.locator('#agreement-table tbody tr');
  await expect(rows).toHaveCount(3);
  // 死亡率: 完全一致・単一カテゴリのため κ は定義できず「—」
  await expect(rows.nth(0)).toContainText('死亡率');
  await expect(rows.nth(0)).toContainText('1 (100.0%)');
  await expect(rows.nth(0)).toContainText('—');
  // 平均年齢: 完全不一致（45 vs 50）→ po=0・pe=0 → κ=0.00
  await expect(rows.nth(1)).toContainText('平均年齢');
  await expect(rows.nth(1)).toContainText('0 (0.0%)');
  await expect(rows.nth(1)).toContainText('0.00');
  // 群名（arm レベル）: 完全一致・単一カテゴリのため κ は「—」
  await expect(rows.nth(2)).toContainText('群名');
  await expect(rows.nth(2)).toContainText('1 (100.0%)');

  // 不一致セル一覧には平均年齢（45 / 50）のみが載る
  const disagreements = card.locator('#agreement-disagreements');
  await expect(disagreements).toContainText('平均年齢');
  await expect(disagreements).toContainText('45');
  await expect(disagreements).toContainText('50');
  await expect(disagreements.locator('tbody tr')).toHaveCount(1);

  // CSV ローカル保存（Blob → <a download> クリック）
  const [summaryDownload] = await Promise.all([
    page.waitForEvent('download'),
    card.locator('#agreement-csv-summary').click(),
  ]);
  expect(summaryDownload.suggestedFilename()).toMatch(/^agreement_summary_\d{8}-\d{6}\.csv$/);
  const [disagreementsDownload] = await Promise.all([
    page.waitForEvent('download'),
    card.locator('#agreement-csv-disagreements').click(),
  ]);
  expect(disagreementsDownload.suggestedFilename()).toMatch(/^agreement_disagreements_\d{8}-\d{6}\.csv$/);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('セル選択 → PDF に AI 根拠のハイライトを表示 + 判定者の note を表示する（issue #63）', async ({ page }) => {
  await setupRoutes(page);
  await initApp(page);

  await expect(page.locator('#adjudicate-list')).toBeVisible({ timeout: 15_000 });
  const study1Row = page.locator('tr[data-study-id="study-1"]');
  await study1Row.locator('.adjudicate__open-button').click();
  await expect(page.locator('#adjudicate-working')).toBeVisible();

  // 「不一致のみ」フィルタを外し、一致セル（死亡率 = AI 根拠なし）と不一致セル（平均年齢 = AI 根拠あり）
  // の両方を表示する
  await page.locator('#adjudicate-filter-mismatch').uncheck();
  const mortalityRow = page.locator('#adjudicate-cells tbody tr', { hasText: '死亡率' });
  const ageRow = page.locator('#adjudicate-cells tbody tr', { hasText: '平均年齢' });

  // 死亡率には AI 根拠（Evidence）が無いため「根拠を表示」ボタンを出さない（従来どおりハイライトなし）
  await expect(mortalityRow.locator('.adjudicate__evidence-button')).toHaveCount(0);

  // 平均年齢には AI 根拠があるため「根拠を表示」ボタンを出す + B の判定 note を表示する
  await expect(ageRow.locator('.adjudicate__evidence-button')).toBeVisible();
  await expect(ageRow.locator('.adjudicate__cell-note')).toContainText(
    'B のメモ: Table 2 と本文で数値不一致、Table 2 を採用',
  );

  // 「根拠を表示」クリック → 出所文書（doc-1）の PDF ペインへ根拠ハイライトが表示される
  await ageRow.locator('.adjudicate__evidence-button').click();
  await expect(page.locator('.pdf-viewer__hl')).toBeVisible({ timeout: 15_000 });

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('裁定書き込みの失敗 → オフラインキューへ退避 → 次の裁定操作の成功時にまとめて再送する（issue #63）', async ({
  page,
}) => {
  const { appends } = await setupRoutes(page, { failFirstAppendMatching: /StudyData/ });
  await initApp(page);

  await expect(page.locator('#adjudicate-list')).toBeVisible({ timeout: 15_000 });
  const study1Row = page.locator('tr[data-study-id="study-1"]');
  await study1Row.locator('.adjudicate__open-button').click();
  await expect(page.locator('#adjudicate-working')).toBeVisible();

  // オフライン退避前はバナー無し
  await expect(page.locator('#adjudicate-queued')).toHaveCount(0);

  // 不一致セル（平均年齢）を A 採用 → StudyData への即時保存が失敗 → オフラインキューへ退避する。
  // 失敗しても人間の判断は確定済みとして扱われ、セルは楽観反映で「裁定済み（編集）」になる
  await page.locator('.adjudicate__action--choose-a').click();
  await expect(page.locator('#adjudicate-queued')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#adjudicate-queued')).toContainText('オフライン: 1 件キュー中');
  await expect(page.locator('.adjudicate__cell-row--edit')).toContainText('確定値: 45');
  // 失敗した書き込みは appends に記録されない（route.abort で ProjectRecorder へ到達しない）
  expect(appends.filter((a) => a.url.includes('StudyData'))).toHaveLength(0);

  // 一致セル（死亡率）を一括採用 → 今度は StudyData への書き込みが成功し、
  // 成功をきっかけにキューに残っていた平均年齢の退避分もあわせて再送される
  await page.locator('#adjudicate-accept-all').click();
  await expect(page.locator('#adjudicate-queued')).toHaveCount(0, { timeout: 15_000 });

  // StudyData への append が 2 回（一括採用ぶん + 退避分の再送ぶん）成功したことを確認する
  await expect
    .poll(() => appends.filter((a) => a.url.includes('StudyData') && a.url.includes(':append')).length)
    .toBeGreaterThanOrEqual(2);
  // 再送された Decisions にも平均年齢（f-age）の edit 裁定が含まれる
  const decisionsAppends = appends.filter((a) => a.url.includes('Decisions') && a.url.includes(':append'));
  const ageDecisionRows = decisionsAppends.flatMap((a) => a.body['values'] as unknown[][]).filter((row) => row[3] === 'f-age');
  expect(ageDecisionRows.length).toBeGreaterThan(0);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
