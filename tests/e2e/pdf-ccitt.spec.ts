// CCITTFaxDecode 圧縮スキャン PDF の白紙化回帰テスト（fix/pdf-wasm-assets）。
// pdfjs-dist 6.x は画像デコーダ（CCITTFax/JBIG2・JPEG2000・ICC）が wasm 実装になっており、
// `getDocument` に `wasmUrl`（+ dist/wasm/ への同梱）が無いと
// `#instantiateWasm: Ensure that the wasmUrl API parameter is provided` → `Jbig2Error` で
// 該当ページの画像デコードが失敗し、白紙になる（テキスト層は無事なためハイライトだけ出る症状）。
// 本 spec は既存 E2E（app-verify.spec.ts の「スキャン PDF（no_text_layer）」テスト）と同じ
// 作法（chrome スタブ + page.route での Sheets/Drive stub + dist/ 静的配信）を踏襲しつつ、
// 実 pdf.js（dist/ の実バンドル経由）で CCITT 圧縮画像を実際に canvas へ描画し、
// 「暗い画素の比率」という広い閾値で白紙化の回帰を検出する。
import { expect, test, type Page } from '@playwright/test';
import { SHEET_HEADERS } from '../../src/domain/sheetsSchema';

/**
 * CCITTFaxDecode（K=-1・BlackIs1 true）の 1bit 画像を持つ 240×120pt・1 ページの合成 PDF（base64）。
 * Pillow で生成した group4 TIFF（黒帯 2 本を描画）から手組みした最小 PDF で、著作権上の懸念が
 * ない合成物（803 バイト）。wasm 資産（jbig2.wasm 等）が正しく同梱・初期化されればデコードされた
 * 画像の黒画素率は約 33%、wasm 初期化に失敗すると（同梱漏れの回帰時）白紙 = 黒画素率 ≈0% になる
 * ことを実測済み
 */
const CCITT_FIXTURE_PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyNDAgMTIwXSAvUmVzb3VyY2VzIDw8IC9YT2JqZWN0IDw8IC9JbTAgNCAwIFIgPj4gPj4gL0NvbnRlbnRzIDUgMCBSID4+CmVuZG9iago0IDAgb2JqCjw8IC9UeXBlIC9YT2JqZWN0IC9TdWJ0eXBlIC9JbWFnZSAvV2lkdGggMjQwIC9IZWlnaHQgMTIwIC9Db2xvclNwYWNlIC9EZXZpY2VHcmF5IC9CaXRzUGVyQ29tcG9uZW50IDEgL0ZpbHRlciAvQ0NJVFRGYXhEZWNvZGUgL0RlY29kZVBhcm1zIDw8IC9LIC0xIC9Db2x1bW5zIDI0MCAvUm93cyAxMjAgL0JsYWNrSXMxIHRydWUgPj4gL0xlbmd0aCA2MCA+PgpzdHJlYW0KJqGSDJ//////yGhef///////////////////j//////5DRtZ///////////////////8f/////+ACACACmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvTGVuZ3RoIDMwID4+CnN0cmVhbQpxIDI0MCAwIDAgMTIwIDAgMCBjbSAvSW0wIERvIFEKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDUgMDAwMDAgbiAKMDAwMDAwMDU0MCAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjYyMAolJUVPRgo=';

const SCHEMA_FIELDS_HEADERS = [...SHEET_HEADERS.SchemaFields];
const EVIDENCE_HEADERS = [...SHEET_HEADERS.Evidence];
const RUNS_HEADERS = [...SHEET_HEADERS.ExtractionRuns];
const DECISIONS_HEADERS = [...SHEET_HEADERS.Decisions];
const STUDY_DATA_HEADERS = [...SHEET_HEADERS.StudyData];
const RESULTS_DATA_HEADERS = [...SHEET_HEADERS.ResultsData];

// entity_level=study の最小フィールド（app-verify.spec.ts の STUDY_FIELD_ROW と同一構成）
const STUDY_FIELD_ROW = [
  '1', 'f-total', '1', 'results', 'mortality_pct', '死亡率', 'study', 'text', '', '',
  'TRUE', 'Report overall mortality.', '', 'FALSE', '',
];

// #/verify の一覧（verifyService.latestRunEvidenceByStudy）は「Evidence が既知 run を
// 参照する study」だけを対象にするため、canvas 描画だけを見たい本 spec でも最小限の
// run 行 + Evidence 行を用意する（quote は空 = no_text_layer 文書なのでテキストアンカリング
// 対象外。ハイライト自体の検証は app-verify.spec.ts の役割で、本 spec は canvas 描画が主眼）
const RUN_ROW = [
  'run-1', 'pilot', '1', 'study-ccitt', 'gemini', 'gemini-test', '', 'pdf_native', 'done',
  't1', 't2', '', '', '',
];
const CCITT_EVIDENCE_ROW = [
  'ev-ccitt-1', 'run-1', 'study-ccitt', 'f-total', 'doc-ccitt', '-', '12', 'FALSE', '', '', '', '',
];

/** Sheets / Drive の stub を配線する */
async function setupCcittRoutes(page: Page): Promise<void> {
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (route.request().method() === 'GET') {
      if (url.includes('fields=sheets.properties.title')) {
        const titles = ['Meta', 'Documents', 'SchemaFields', 'Evidence', 'Decisions'];
        await route.fulfill({
          json: { sheets: titles.map((title) => ({ properties: { title } })) },
        });
      } else if (url.includes('values:batchGet') && url.includes('Evidence')) {
        // ensureEvidenceBboxColumns 等のヘッダ拡張チェックを no-op にする（既にフルヘッダ想定）
        await route.fulfill({ json: { valueRanges: [{ values: [EVIDENCE_HEADERS] }] } });
      } else if (url.includes('/values/Evidence')) {
        await route.fulfill({ json: { values: [EVIDENCE_HEADERS, CCITT_EVIDENCE_ROW] } });
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
    await route.fulfill({ json: {} });
  });

  await page.route('https://www.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (url.includes('alt=media')) {
      // 文書は no_text_layer（text_ref なし）のため extracted_texts の fetch は起きない想定だが、
      // 念のため PDF 本体（driveFileId = drive-ccitt）以外は空応答にしておく
      if (/\/files\/drive-ccitt\?alt=media/.exec(url) !== null) {
        await route.fulfill({
          contentType: 'application/pdf',
          body: Buffer.from(CCITT_FIXTURE_PDF_BASE64, 'base64'),
        });
        return;
      }
      await route.fulfill({ contentType: 'text/plain', body: '' });
      return;
    }
    await route.fulfill({ json: {} });
  });
}

/** app.html を起動し、CCITT スキャン文書 1 件だけの study を state 注入する */
async function initCcittApp(page: Page): Promise<void> {
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
        documents: 1,
        protocolVersions: 1,
        schemaVersions: 1,
        pilotRuns: 0,
        // #/verify の入場ガード（guards.ts）は owner ロールに evidenceRows >= 1 を要求する。
        // 本 spec は Evidence 0 件のまま canvas 描画だけを見るため、ガードだけ満たす目的で 1 とする
        evidenceRows: 1,
        dataRows: 0,
      },
      documents: {
        records: [
          {
            documentId: 'doc-ccitt',
            studyId: 'study-ccitt',
            documentRole: 'article',
            driveFileId: 'drive-ccitt',
            sourceFileId: 'src-doc-ccitt',
            filename: 'ccitt-scan.pdf',
            pmid: null,
            doi: null,
            textRef: null,
            textStatus: 'no_text_layer',
            pageCount: 1,
            charCount: 0,
            importedAt: '2026-07-01T00:00:00Z',
            importedBy: 'e2e@example.com',
            note: null,
          },
        ],
        studies: [
          {
            studyId: 'study-ccitt',
            studyLabel: 'CCITT Scan 2026',
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
  await page.goto('/app/app.html#/verify?study=study-ccitt');
}

/**
 * canvas 上の「暗い・不透明」な画素の比率を計算する。
 * 未描画（透明）の canvas は r=g=b=a=0 になるため、alpha を見ずに輝度だけで判定すると
 * 「白紙（未同梱の回帰）」と「未描画（描画待ち）」を区別できない。alpha > 0（不透明）の
 * 画素だけを分母・分子に数えることで、白紙化の回帰（不透明な白 = 暗画素 0%）と
 * 描画待ち（透明 = 集計対象外）を正しく区別する
 */
async function darkOpaquePixelRatio(canvas: import('@playwright/test').Locator): Promise<number> {
  return canvas.evaluate((node) => {
    const el = node as HTMLCanvasElement;
    const ctx = el.getContext('2d');
    if (ctx === null || el.width === 0 || el.height === 0) {
      return 0;
    }
    const { data } = ctx.getImageData(0, 0, el.width, el.height);
    let opaqueCount = 0;
    let darkCount = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const a = data[i + 3] ?? 0;
      if (a === 0) {
        continue;
      }
      opaqueCount += 1;
      if ((r + g + b) / 3 < 128) {
        darkCount += 1;
      }
    }
    return opaqueCount === 0 ? 0 : darkCount / opaqueCount;
  });
}

test('CCITTFaxDecode 圧縮のスキャン PDF が白紙化しない（実 pdf.js 描画・wasm 資産の同梱回帰検知）', async ({
  page,
}) => {
  await setupCcittRoutes(page);
  await initCcittApp(page);

  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });
  // no_text_layer 文書はバナー表示になる（既存 E2E と同じ確認だが、ここでは canvas 描画が主眼）
  await expect(page.locator('.verify__banner')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.pdf-viewer__page-indicator')).toHaveText('1 / 1 ページ', {
    timeout: 15_000,
  });

  const canvas = page.locator('.pdf-viewer__canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });

  // wasm 資産が同梱・初期化されれば黒画素率 ≈33%（2 本の黒帯）。未同梱の回帰時は白紙 = ≈0% のまま
  // 描画完了まで変動するため、広い閾値（10%）を超えるまで poll する（screenshot 完全一致は使わない）
  await expect
    .poll(async () => darkOpaquePixelRatio(canvas), { timeout: 15_000 })
    .toBeGreaterThan(0.1);
});

test('pdfjs の画像デコーダ wasm / 標準フォント / ICC プロファイルが dist/ に同梱され HTTP 200 で取得できる', async ({
  page,
}) => {
  // web_accessible_resources を追加していないが、拡張自身のページ（chrome-extension://）からの
  // 取得のため到達できる（E2E では dist/ 静的配信 = 同一オリジンでこれを模す）
  for (const assetPath of [
    '/wasm/jbig2.wasm',
    '/wasm/openjpeg.wasm',
    '/wasm/qcms_bg.wasm',
    '/standard_fonts/LiberationSans-Regular.ttf',
    '/iccs/CGATS001Compat-v2-micro.icc',
  ]) {
    const response = await page.request.get(assetPath);
    expect(response.status(), `${assetPath} の取得`).toBe(200);
  }
  // pdf.sandbox 用の quickjs-eval.* は本拡張が使わないため同梱から除外している（webpack.config.js）
  const quickjsResponse = await page.request.get('/wasm/quickjs-eval.wasm');
  expect(quickjsResponse.status()).toBe(404);
});
