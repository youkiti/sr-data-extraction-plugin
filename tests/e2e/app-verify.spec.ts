// #/verify（S8 単独画面）のルート別 E2E（test-strategy.md §3 + ui-states.md §3）。
// 状態は __E2E_PRELOADED_STATE__ で注入し、Sheets / Drive は page.route で stub する。
// 一覧（進捗チップ）→ ?study= 直リンク / セレクタ切替（hash 同期）→ 2 ペイン検証 →
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

// §7.4 PR4: no_text_layer 文書（bbox ハイライト）の Evidence 行。17 列（bbox 5 列込み）。
// anchor_status は空（pdf_native 経路はアンカリングしない）。bbox は 100/80/180/850（ymin/xmin/ymax/xmax）
const SCAN_EVIDENCE_ROW = [
  'ev-scan-1', 'run-1', 'study-scan', 'f-total', 'doc-scan', '-', '12', 'FALSE', QUOTE, '1', 'high', '',
  '1', '100', '80', '180', '850',
];

const RUNS_HEADERS = [...SHEET_HEADERS.ExtractionRuns];

const RUN_ROW = [
  'run-1', 'pilot', '1', 'study-1,study-2', 'gemini', 'gemini-test', '', 'text_only', 'done',
  't1', 't2', '', '', '',
];

const DECISIONS_HEADERS = [...SHEET_HEADERS.Decisions];

const STUDY_DATA_HEADERS = [...SHEET_HEADERS.StudyData];

const RESULTS_DATA_HEADERS = [...SHEET_HEADERS.ResultsData];

/**
 * 最小 1 ページ PDF の共通ビルダー（オブジェクト構造は固定・content stream だけ差し替える）。
 * minimalPdf（テキスト描画）と noTextPdf（矩形塗りのみ・§7.4 PR4 の bbox テスト用）が共有する
 */
function buildOnePagePdf(content: string, rotated: boolean): Buffer {
  const rotateEntry = rotated ? ' /Rotate 90' : '';
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

/**
 * テキスト層つきの最小 1 ページ PDF（app-pilot.spec.ts と同じ手組み構成）。
 * rotated 指定時は /Rotate 90 のページに 90 度回転したテキスト（表ページの典型）を置く
 */
function minimalPdf(text: string, options: { rotated?: boolean } = {}): Buffer {
  const content = options.rotated
    ? `BT /F1 12 Tf 0 1 -1 0 100 72 Tm (${text}) Tj ET`
    : `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  return buildOnePagePdf(content, options.rotated ?? false);
}

/**
 * テキスト層なしの最小 1 ページ PDF（矩形塗りのみ・BT/ET を含めない。§7.4 PR4 の
 * bbox 座標ハイライト実弾テスト用。スキャン PDF を模す — pdfjs のテキスト抽出は
 * 0 件になるが、ページ寸法（MediaBox 612×792・回転 0）は通常どおり読める）
 */
function noTextPdf(): Buffer {
  return buildOnePagePdf('0.85 0.85 0.85 rg 100 600 300 80 re f', false);
}

/** Sheets / Drive の stub を配線した結果（書き込み URL・PDF バイナリの実 fetch 記録） */
interface RouteRecorder {
  appendUrls: string[];
  /**
   * `alt=media` で実際に PDF バイナリとして fetch された driveFileId の記録（fetch 順）。
   * 「表示していない文書の PDF を読まない」（issue #28 案3）の実弾検証に使う
   */
  pdfFetchIds: string[];
}

/**
 * Sheets / Drive の stub を配線する。
 * Drive の `alt=media` は文書の driveFileId（PDF 本体）と textRef のファイル ID（extracted_texts
 * の .txt）を区別して応答する（textRef は常に `txt-{documentId}` 形式。docRecord 参照）。
 * PDF 本体の fetch だけ pdfFetchIds へ記録する
 */
async function setupRoutes(
  page: Page,
  options: {
    schemaRows: string[][];
    evidenceRows: string[][];
    rotatedPdf?: boolean;
    /** PDF 本体の差し替え（§7.4 PR4: テキスト層なし PDF の bbox テスト用）。省略時は minimalPdf */
    pdfBuilder?: () => Buffer;
  },
): Promise<RouteRecorder> {
  const appendUrls: string[] = [];
  const pdfFetchIds: string[] = [];

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
      // extracted_texts（.txt）: docRecord の textRef は常に `txt-{documentId}` 形式のファイル ID
      const textMatch = /\/files\/txt-[^?]+\?alt=media/.exec(url);
      if (textMatch !== null) {
        // PDF 本体と同じ本文（QUOTE）を返す = 実 PDF の text 層と同一内容という前提を再現する
        await route.fulfill({ contentType: 'text/plain', body: QUOTE });
        return;
      }
      // PDF 本体: driveFileId は `drive-{n}` 形式
      const pdfMatch = /\/files\/(drive-[^?]+)\?alt=media/.exec(url);
      if (pdfMatch?.[1] !== undefined) {
        pdfFetchIds.push(pdfMatch[1]);
      }
      await route.fulfill({
        contentType: 'application/pdf',
        body: options.pdfBuilder ? options.pdfBuilder() : minimalPdf(QUOTE, { rotated: options.rotatedPdf }),
      });
      return;
    }
    await route.fulfill({ json: {} });
  });

  return { appendUrls, pdfFetchIds };
}

/**
 * 取り込み文書レコードの雛形（E2E 用の最小フィールド）。
 * overrides で個別フィールドを上書きできる（§7.4 PR4: no_text_layer 文書は
 * textStatus / textRef を上書きして使う）
 */
function docRecord(
  documentId: string,
  studyId: string,
  role: string,
  driveFileId: string,
  filename: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    documentId,
    studyId,
    documentRole: role,
    driveFileId,
    sourceFileId: `src-${documentId}`,
    filename,
    pmid: null,
    doi: null,
    textRef: `https://drive.google.com/file/d/txt-${documentId}/view`,
    textStatus: 'ok',
    pageCount: 1,
    charCount: 4000,
    importedAt: '2026-07-01T00:00:00Z',
    importedBy: 'e2e@example.com',
    note: null,
    ...overrides,
  };
}

function studyRecord(studyId: string, studyLabel: string): Record<string, unknown> {
  return {
    studyId,
    studyLabel,
    registrationId: null,
    createdAt: '2026-07-01T00:00:00Z',
    createdBy: 'e2e@example.com',
    note: null,
  };
}

function documentsSlice(
  records: Record<string, unknown>[],
  studies: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    records,
    studies,
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

/** 既定: 2 study × 1 文書ずつ */
function defaultDocuments(): Record<string, unknown> {
  return documentsSlice(
    [
      docRecord('doc-1', 'study-1', 'article', 'drive-1', 'smith2020.pdf'),
      docRecord('doc-2', 'study-2', 'article', 'drive-2', 'jones2021.pdf'),
    ],
    [studyRecord('study-1', 'Smith 2020'), studyRecord('study-2', 'Jones 2021')],
  );
}

/** v0.10 フェーズ 3: study-1 = 本論文 + 試験登録の 2 文書、study-2 = 1 文書 */
function multiDocDocuments(): Record<string, unknown> {
  return documentsSlice(
    [
      docRecord('doc-1', 'study-1', 'article', 'drive-1', 'smith2020.pdf'),
      docRecord('doc-1b', 'study-1', 'registration', 'drive-1b', 'nct01234567.pdf'),
      docRecord('doc-2', 'study-2', 'article', 'drive-2', 'jones2021.pdf'),
    ],
    [studyRecord('study-1', 'Smith 2020'), studyRecord('study-2', 'Jones 2021')],
  );
}

/**
 * §7.4 PR4: テキスト層なし（scan）study が 1 件だけの構成。
 * textStatus='no_text_layer' / textRef=null（no_text_layer の文書は text_ref を持たない。
 * requirements.md §3.2）
 */
function scanStudyDocuments(): Record<string, unknown> {
  return documentsSlice(
    [
      docRecord('doc-scan', 'study-scan', 'article', 'drive-scan', 'scan.pdf', {
        textStatus: 'no_text_layer',
        textRef: null,
      }),
    ],
    [studyRecord('study-scan', 'Scan 2026')],
  );
}

async function initApp(
  page: Page,
  hash: string,
  docs: Record<string, unknown> = defaultDocuments(),
): Promise<void> {
  await page.addInitScript((documents) => {
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
      documents,
    };
  }, docs);
  await page.goto(`/app/app.html${hash}`);
}

test('一覧 + 検証フロー: 進捗チップ → ハイライト → 承認 → Decisions 追記 → セレクタ切替の hash 同期', async ({ page }) => {
  const { appendUrls } = await setupRoutes(page, {
    schemaRows: [STUDY_FIELD_ROW],
    evidenceRows: [EVIDENCE_ROW_1, EVIDENCE_ROW_2],
  });
  await initApp(page, '#/verify');

  // 一覧: 進捗チップ付きのセレクタ + 先頭 study（study-1）の自動読込
  const select = page.locator('#verify-study');
  await expect(select).toBeVisible({ timeout: 15_000 });
  await expect(select.locator('option').nth(0)).toHaveText('Smith 2020（判定済み 0 / 1）');
  await expect(select.locator('option').nth(1)).toHaveText('Jones 2021（判定済み 0 / 1）');

  // 2 ペイン + 実 PDF の canvas 描画 + quote ハイライト
  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.verify__cell-label')).toHaveText('死亡率');
  await expect(page.locator('.pdf-viewer__page-indicator')).toHaveText('1 / 1 ページ');
  await expect(page.locator('.pdf-viewer__hl--unverified')).toHaveCount(1, { timeout: 15_000 });

  // 判定: 承認 → チップ更新 + Decisions 追記（フォーカスモードの詳細ストリップにスコープする。
  // 判定チップは matrix ボタン / 詳細ストリップ / 直近判定バーの 3 箇所に出るため）
  await page.locator('.verify__action--accept').click();
  await expect(page.locator('#verify-focus-detail .verify__chip')).toHaveText('承認');
  await expect
    .poll(() => appendUrls.filter((url) => url.includes('Decisions') && url.includes(':append')).length)
    .toBeGreaterThan(0);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  // セレクタ切替 → URL クエリ同期（?doc=）→ 該当文献の検証データへ切替
  await select.selectOption('study-2');
  await expect(page).toHaveURL(/#\/verify\?study=study-2$/);
  await expect(page.locator('.verify__ai-value')).toHaveText('9', { timeout: 15_000 });
});

test('承認クリック後にユニット内の次の未判定セルへ自動遷移する（フォーカスモードのマトリクス）', async ({ page }) => {
  await setupRoutes(page, {
    schemaRows: [STUDY_FIELD_ROW, STUDY_FIELD_ROW_2],
    evidenceRows: [EVIDENCE_ROW_1, EVIDENCE_ROW_2],
  });
  await initApp(page, '#/verify?study=study-1');

  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });
  // 死亡率 + 国は同じ section（results）のため同一ユニットの 2 行として出る
  const matrixButtons = page.locator('#verify-focus-matrix .focus-card__matrix-btn');
  await expect(matrixButtons).toHaveCount(2);

  // 初期フォーカス = 最初の未判定セル（先頭 = 死亡率）
  await expect(matrixButtons.nth(0)).toHaveClass(/focus-card__matrix-btn--focused/);
  await expect(page.locator('#verify-focus-detail .verify__cell-label')).toHaveText('死亡率');

  // 承認 → 同一ユニット内の次の未判定セル（国）へフォーカスが自動遷移する（j キー不要）
  await page.locator('#verify-focus-detail .verify__action--accept').click();
  await expect(matrixButtons.nth(1)).toHaveClass(/focus-card__matrix-btn--focused/);
  await expect(matrixButtons.nth(0)).not.toHaveClass(/focus-card__matrix-btn--focused/);
  await expect(page.locator('#verify-focus-detail .verify__cell-label')).toHaveText('国');
});

test('フォーカスモード: マトリクス表示 → 判定の自動送り → ユニット送り → 直近判定の undo → リスト表示切替', async ({
  page,
}) => {
  // results（死亡率・国）と design（出版年）の 2 section = 2 ユニットを作り、
  // ユニット内送り・ユニット完了 → 次ユニット送りの双方を 1 本のシナリオで確認する
  const STUDY_FIELD_ROW_YEAR = [
    '1', 'f-year', '3', 'design', 'pub_year', '出版年', 'study', 'text', '', '',
    'FALSE', 'Report the publication year.', '', 'FALSE', '',
  ];
  const COUNTRY_EVIDENCE_ROW = [
    'ev-1c', 'run-1', 'study-1', 'f-country', 'doc-1', '-', 'Japan', 'FALSE', QUOTE, '1', 'high', 'exact',
  ];
  const YEAR_EVIDENCE_ROW = [
    'ev-1y', 'run-1', 'study-1', 'f-year', 'doc-1', '-', '2020', 'FALSE', QUOTE, '1', 'high', 'exact',
  ];
  await setupRoutes(page, {
    schemaRows: [STUDY_FIELD_ROW, STUDY_FIELD_ROW_2, STUDY_FIELD_ROW_YEAR],
    evidenceRows: [EVIDENCE_ROW_1, COUNTRY_EVIDENCE_ROW, YEAR_EVIDENCE_ROW],
  });
  await initApp(page, '#/verify?study=study-1');

  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });

  // 既定表示 = フォーカスモード（マトリクス + 位置 + 詳細ストリップ）
  await expect(page.locator('#verify-focus-card')).toBeVisible();
  await expect(page.locator('#verify-focus-position')).toHaveText('ユニット 1 / 2（残り 2）');
  await expect(page.locator('#verify-focus-matrix tbody tr')).toHaveCount(2); // results（死亡率 + 国）
  await expect(page.locator('#verify-focus-detail .verify__cell-label')).toHaveText('死亡率');

  const focusResults = await new AxeBuilder({ page }).analyze();
  expect(focusResults.violations).toEqual([]);

  // 承認 → 同一ユニット内の次の未判定セル（国）へ自動送り。ユニット位置はまだ変わらない
  await page.locator('#verify-focus-detail .verify__action--accept').click();
  await expect(page.locator('#verify-focus-detail .verify__cell-label')).toHaveText('国');
  await expect(page.locator('#verify-focus-position')).toHaveText('ユニット 1 / 2（残り 2）');

  // 承認 → ユニット完了 → 次の未判定ユニット（design セクション）の先頭セルへ自動送り
  await page.locator('#verify-focus-detail .verify__action--accept').click();
  await expect(page.locator('#verify-focus-position')).toHaveText('ユニット 2 / 2（残り 1）');
  await expect(page.locator('#verify-focus-detail .verify__cell-label')).toHaveText('出版年');
  await expect(page.locator('#verify-focus-matrix tbody tr')).toHaveCount(1); // design（出版年のみ）

  // 承認 → 全ユニット判定済み
  await page.locator('#verify-focus-detail .verify__action--accept').click();
  await expect(page.locator('#verify-focus-position')).toHaveText('ユニット 2 / 2（残り 0）');

  // 直近判定バー（ユニットをまたいでも直近判定セルへ z / クリックで戻せる）
  const recentBar = page.locator('#verify-focus-recent');
  await expect(recentBar).toContainText('出版年');
  await recentBar.locator('.focus-card__recent-undo').click();
  await expect(page.locator('#verify-focus-position')).toHaveText('ユニット 2 / 2（残り 1）');
  await expect(page.locator('#verify-focus-recent')).toHaveCount(0);

  // リスト表示へ切替 → パネルを作り直さず即時に従来 UI（判定済みブロック等）へ変わる
  const layoutToggle = page.locator('#verify-layout-toggle');
  await expect(layoutToggle).toHaveAttribute('aria-pressed', 'true');
  await layoutToggle.click();
  await expect(layoutToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#verify-focus-card')).toHaveCount(0);
  await expect(page.locator('.verify__group-heading').first()).toBeVisible();
  // 死亡率・国（判定済みブロックのコンパクト行）+ 出版年（未判定の通常カード）= 3 件
  await expect(page.locator('.verify__cell')).toHaveCount(3);

  const listResults = await new AxeBuilder({ page }).analyze();
  expect(listResults.violations).toEqual([]);
});

test('回転ページ（/Rotate 90 の表ページ）でもハイライトが本文位置に重なる', async ({ page }) => {
  await setupRoutes(page, {
    schemaRows: [STUDY_FIELD_ROW],
    evidenceRows: [EVIDENCE_ROW_1, EVIDENCE_ROW_2],
    rotatedPdf: true,
  });
  await initApp(page, '#/verify?study=study-1');

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

test('?study= 直リンク + 群構成の確定: タブディム → 確定 → ArmStructures 追記 → arm タブ有効', async ({ page }) => {
  const { appendUrls } = await setupRoutes(page, {
    schemaRows: [STUDY_FIELD_ROW, ARM_FIELD_ROW, OUTCOME_FIELD_ROW],
    evidenceRows: [EVIDENCE_ROW_1, EVIDENCE_ROW_2, ARM_EVIDENCE_ROW],
  });
  await initApp(page, '#/verify?study=study-1');

  // ?study= 直リンクで doc-1 が選択される
  await expect(page.locator('#verify-study')).toHaveValue('study-1', { timeout: 15_000 });
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

  // arm タブへ切替 → フォーカスモードのユニット見出し（section 名）+ 群列ラベル + セルが検証できる
  // （arm タブのユニットは section 単位・群が列になる。ui-flow.md §7）
  await armTab.click();
  await expect(page.locator('.focus-card__heading')).toHaveText('outcomes');
  await expect(page.locator('#verify-focus-matrix thead th').nth(1)).toHaveText('介入群');
  await expect(page.locator('#verify-focus-detail .verify__cell-label')).toHaveText('群の N');

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
  // outcome_result のユニットは outcome × time の組ごと（群は列へ横結合される。ui-flow.md §7）
  await expect(page.locator('.focus-card__heading')).toHaveText('mortality_extra ／ 時点: 30d');
  await expect(page.locator('#verify-focus-detail .verify__cell-label')).toHaveText('イベント数');
  await expect(page.locator('#verify-focus-detail .verify__cell')).toContainText('AI 抽出なし');
  await expect
    .poll(
      () =>
        appendUrls.filter((url) => url.includes('Decisions') && url.includes(':append')).length,
    )
    .toBeGreaterThan(decisionsBefore);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('左ペイン表示切替: 抽出テキストへ切替 → 出所文書 / ページ番号 / mark 強調の文脈 → 根拠クリックでスニペットが変わる', async ({
  page,
}) => {
  // f-country の quote は同一 PDF 本文（QUOTE）の部分文字列にして、1 ページ PDF のままでも
  // クリックで異なるスニペットが表示されることを確認できるようにする
  const COUNTRY_EVIDENCE_ROW = [
    'ev-1c', 'run-1', 'study-1', 'f-country', 'doc-1', '-', 'Japan', 'FALSE', '12 percent', '1', 'high', 'exact',
  ];
  await setupRoutes(page, {
    schemaRows: [STUDY_FIELD_ROW, STUDY_FIELD_ROW_2],
    evidenceRows: [EVIDENCE_ROW_1, COUNTRY_EVIDENCE_ROW],
  });
  await initApp(page, '#/verify?study=study-1');

  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });
  // f-country の quote（'12 percent'）は f-total の quote の部分文字列のため、page 1 に
  // 2 件のハイライトが出る（死亡率の全文 + 国の部分文字列）
  await expect(page.locator('.pdf-viewer__hl--unverified')).toHaveCount(2, { timeout: 15_000 });

  // 抽出テキストへ切替
  const textModeButton = page.locator('.verify__view-toggle-btn', { hasText: '抽出テキスト' });
  await textModeButton.click();
  await expect(textModeButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.verify__pdf-body')).toBeHidden();
  await expect(page.locator('.verify__text-body')).toBeVisible();

  // 初期フォーカス（死亡率）の出所文書 / ページ番号 / mark 強調 + 前後文脈
  await expect(page.locator('.text-viewer__doc-label')).toContainText('smith2020.pdf');
  await expect(page.locator('.text-viewer__doc-label')).toContainText('本論文');
  await expect(page.locator('.text-viewer__page')).toHaveText('1 ページ');
  await expect(page.locator('mark.text-viewer__mark')).toHaveText(QUOTE);

  // 別セル（国）へフォーカス（フォーカスモードのマトリクス経由） → 同じ PDF 本文の別範囲
  // （部分文字列）のスニペットへ差し替わる
  const countryRow = page
    .locator('#verify-focus-matrix tbody tr')
    .filter({ has: page.locator('th', { hasText: '国' }) });
  await countryRow.locator('.focus-card__matrix-btn').click();
  await expect(page.locator('mark.text-viewer__mark')).toHaveText('12 percent');

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('複数文書 study: 文書切替タブ + 別文書由来のセルへフォーカスで出所 PDF へ自動切替', async ({
  page,
}) => {
  await setupRoutes(page, {
    schemaRows: [STUDY_FIELD_ROW, STUDY_FIELD_ROW_2],
    // ev-1（死亡率）= 本論文（doc-1）、ev-1b（国）= 試験登録（doc-1b）。同一 study の 2 文書
    evidenceRows: [
      EVIDENCE_ROW_1,
      ['ev-1b', 'run-1', 'study-1', 'f-country', 'doc-1b', '-', 'Japan', 'FALSE', QUOTE, '1', 'high', 'exact'],
      EVIDENCE_ROW_2,
    ],
  });
  await initApp(page, '#/verify?study=study-1', multiDocDocuments());

  // 進捗チップは study 単位（study-1 は 2 セル）
  await expect(page.locator('#verify-study')).toHaveValue('study-1', { timeout: 15_000 });
  await expect(page.locator('#verify-study option').nth(0)).toHaveText('Smith 2020（判定済み 0 / 2）');

  // 文書切替タブ: 本論文（active）+ 試験登録の 2 枚
  const docTabs = page.locator('.verify__doc-tabs .verify__doc-tab');
  await expect(docTabs).toHaveCount(2, { timeout: 15_000 });
  await expect(docTabs.nth(0)).toContainText('本論文');
  await expect(docTabs.nth(0)).toContainText('smith2020.pdf');
  await expect(docTabs.nth(1)).toContainText('試験登録');
  await expect(docTabs.nth(0)).toHaveClass(/verify__doc-tab--active/);

  // 初期は本論文（doc-1）を表示し、死亡率の quote がハイライトされる
  await expect(page.locator('.pdf-viewer__hl--unverified')).toHaveCount(1, { timeout: 15_000 });

  // 国（f-country・出所 = 試験登録）のセルへフォーカス（フォーカスモードのマトリクス経由）
  // → 試験登録タブが active になる
  const countryRow = page
    .locator('#verify-focus-matrix tbody tr')
    .filter({ has: page.locator('th', { hasText: '国' }) });
  await countryRow.locator('.focus-card__matrix-btn').click();
  await expect(docTabs.nth(1)).toHaveClass(/verify__doc-tab--active/, { timeout: 15_000 });
  await expect(docTabs.nth(0)).not.toHaveClass(/verify__doc-tab--active/);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('複数文書 study: 初期表示では 2 文書目の PDF バイナリを fetch せず、タブ切替で初めて fetch される（issue #28 案3）', async ({
  page,
}) => {
  const { pdfFetchIds } = await setupRoutes(page, {
    schemaRows: [STUDY_FIELD_ROW, STUDY_FIELD_ROW_2],
    evidenceRows: [
      EVIDENCE_ROW_1,
      ['ev-1b', 'run-1', 'study-1', 'f-country', 'doc-1b', '-', 'Japan', 'FALSE', QUOTE, '1', 'high', 'exact'],
      EVIDENCE_ROW_2,
    ],
  });
  await initApp(page, '#/verify?study=study-1', multiDocDocuments());

  // 初期表示（本論文 doc-1 が active）: 本論文の PDF（drive-1）だけが fetch され、
  // 試験登録（doc-1b・drive-1b）はまだ fetch されない
  const docTabs = page.locator('.verify__doc-tabs .verify__doc-tab');
  await expect(docTabs).toHaveCount(2, { timeout: 15_000 });
  await expect(page.locator('.pdf-viewer__page-indicator')).toBeVisible({ timeout: 15_000 });
  expect(pdfFetchIds).toContain('drive-1');
  expect(pdfFetchIds).not.toContain('drive-1b');

  // 試験登録タブへ切替えると、そのときになって初めて drive-1b が fetch される
  await docTabs.nth(1).click();
  await expect
    .poll(() => pdfFetchIds.includes('drive-1b'), { timeout: 15_000 })
    .toBe(true);
});

test('スキャン PDF（no_text_layer）: AI 推定 bbox ハイライト → クリックでセルフォーカス → 承認 → Decisions 追記（§7.4 PR4）', async ({
  page,
}) => {
  const { appendUrls } = await setupRoutes(page, {
    schemaRows: [STUDY_FIELD_ROW],
    evidenceRows: [SCAN_EVIDENCE_ROW],
    pdfBuilder: noTextPdf,
  });
  await initApp(page, '#/verify?study=study-scan', scanStudyDocuments());

  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });

  // (a) no_text_layer + bbox あり: バナーは「AI が推定した座標ハイライト」文言になる
  await expect(page.locator('.verify__banner')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.verify__banner')).toContainText('AI が推定した座標ハイライト');

  // (b) PDF canvas 描画後、bbox 由来のハイライトが 1 件現れ、座標は
  // bboxToDisplayRect（xmin=80/ymin=100/ymax=180/xmax=850・ページ 612×792・scale 1）の
  // 計算値と一致する（許容誤差 ±1px）
  const highlight = page.locator('.pdf-viewer__hl');
  await expect(highlight).toHaveCount(1, { timeout: 15_000 });
  const box = await highlight.evaluate((node) => {
    const style = (node as HTMLElement).style;
    return {
      left: parseFloat(style.left),
      top: parseFloat(style.top),
      width: parseFloat(style.width),
      height: parseFloat(style.height),
    };
  });
  expect(Math.abs(box.left - 48.96)).toBeLessThan(1);
  expect(Math.abs(box.top - 79.2)).toBeLessThan(1);
  expect(Math.abs(box.width - 471.24)).toBeLessThan(1);
  expect(Math.abs(box.height - 63.36)).toBeLessThan(1);

  // (d) セルカードに「ハイライトへ移動」が出る（「ハイライト位置を特定できません」は出ない）
  await expect(page.locator('#verify-focus-detail .verify__quote-jump')).toBeVisible();
  await expect(page.locator('#verify-focus-detail .verify__quote-unanchored')).toHaveCount(0);

  // (c) ハイライトをクリック → 対応セル（死亡率）がフォーカスされる
  await highlight.click();
  await expect(page.locator('#verify-focus-detail .verify__cell-label')).toHaveText('死亡率');

  // (e) 承認 → Decisions への append が記録される
  await page.locator('#verify-focus-detail .verify__action--accept').click();
  await expect(page.locator('#verify-focus-detail .verify__chip')).toHaveText('承認');
  await expect
    .poll(() => appendUrls.filter((url) => url.includes('Decisions') && url.includes(':append')).length)
    .toBeGreaterThan(0);

  // (f) axe 違反 0
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
