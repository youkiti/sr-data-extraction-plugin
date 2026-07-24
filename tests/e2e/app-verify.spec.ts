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

// relocate-quote（issue #94）: quote アンカリング失敗（anchor_status = failed）行。
// value は AI 抽出済みだが quote が本文（QUOTE）と一致しない（誤字混入を模す）
const FAILED_EVIDENCE_ROW = [
  'ev-1', 'run-1', 'study-1', 'f-total', 'doc-1', '-', '12', 'FALSE',
  'Mortalty was 12 percnt', '1', 'high', 'failed',
];

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

/**
 * 和文の最小 1 ページ PDF（issue #95 層 1 の E2E 実弾用）。
 * minimalPdf と異なり埋め込みフォント / CID フォントは使わない: 各文字を 1 バイトの
 * グリフコードに割り当て、/Encoding /Differences で（描画用に）Helvetica 標準フォントの
 * 既知グリフ名（a, b, c...）を割り当てつつ、フォント辞書の /ToUnicode には実際の和文
 * Unicode への対応を記した CMap ストリームを持たせる。pdfjs のテキスト抽出は /ToUnicode を
 * 直接読むため描画用グリフ名とは独立に和文テキストを復元できる一方、/Differences で
 * 実在するグリフ名を割り当てておくことで pdfjs 側の幅解決・描画パスが未定義グリフとして
 * 落ちるのを避ける（見た目はラテン文字の羅列になるが、E2E が検証するのはテキスト内容と
 * ハイライト矩形の位置のみ）。
 * 実際の和文 PDF（J-STAGE 等）は Adobe-Japan1 の CID フォント + 既定 CMap（loadPdf.ts の
 * cMapUrl）でテキスト抽出する点が異なるが、「pdfjs のテキスト層 → 正規化 → アンカリング →
 * ハイライト」という層 1 のアプリケーションコード側パイプラインは同一に通る
 */
function minimalJaPdf(text: string): Buffer {
  const codePoints = [...text];
  const hex2 = (n: number): string => n.toString(16).padStart(2, '0');
  const hex4 = (n: number): string => n.toString(16).padStart(4, '0');
  const codes = codePoints.map((_, i) => i + 1);
  const contentHex = codes.map(hex2).join('');
  const bfChars = codePoints
    .map((ch, i) => `<${hex2(codes[i] as number)}> <${hex4(ch.codePointAt(0) as number)}>`)
    .join('\n');
  const toUnicodeCMap = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
1 begincodespacerange
<01> <${hex2(codes.length)}>
endcodespacerange
${codes.length} beginbfchar
${bfChars}
endbfchar
endcmap
CMapName currentdict /CMap defname
end
end`;
  const content = `BT /F1 12 Tf 72 720 Td <${contentHex}> Tj ET`;
  // 描画用のグリフ名（Helvetica 標準幅表に存在する a-z を周回で割り当てる。
  // ToUnicode があるため実テキストには影響しない）
  const glyphNames = 'abcdefghijklmnopqrstuvwxyz';
  const differences = codes
    .map((code, i) => `${code} /${glyphNames[i % glyphNames.length]}`)
    .join(' ');
  const objects = [
    '',
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /StandardEncoding /Differences [${differences}] >> /ToUnicode 6 0 R >>\nendobj\n`,
    `6 0 obj\n<< /Length ${toUnicodeCMap.length} >>\nstream\n${toUnicodeCMap}\nendstream\nendobj\n`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = pdf.length;
    pdf += objects[i] as string;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
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
    /**
     * 抽出テキスト（.txt）の内容。省略時は QUOTE（PDF 本体と同一内容という前提を再現する
     * 既定の挙動）。pdfBuilder で PDF 本体を差し替える場合（和文 PDF 等）は、実 PDF の
     * テキスト層と揃えるため個別に指定する（issue #95 層 1: minimalJaPdf との組で使う）
     */
    extractedText?: string;
    /**
     * 保存の競合検出（issue #64）の実弾テスト用: StudyData の GET をステートフルにする。
     * 1 回目（初回 bundle 読込）はヘッダのみ（自分の行なし）、2 回目以降（判定操作の
     * upsert 内の再読込 GET）は「別の場所で既に更新済み」の行を返す
     */
    studyDataConflictAfterFirstRead?: boolean;
  },
): Promise<RouteRecorder> {
  const appendUrls: string[] = [];
  const pdfFetchIds: string[] = [];
  let studyDataReads = 0;

  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (route.request().method() === 'GET') {
      if (url.includes('fields=sheets.properties.title')) {
        // ArmStructures タブなし（v0.7 より前の既存プロジェクト）→ 書き込み時にタブを作る
        const titles = ['Meta', 'Documents', 'SchemaFields', 'Evidence', 'Decisions'];
        await route.fulfill({
          json: { sheets: titles.map((title) => ({ properties: { title } })) },
        });
      } else if (url.includes('values:batchGet') && url.includes('Evidence')) {
        // Evidence タブのヘッダ拡張チェック（ensureEvidenceBboxColumns /
        // ensureEvidenceRelocatedFromColumn。relocate-quote。issue #94）。
        // 既にフルヘッダ（bbox 5 列 + relocated_from 込み）が書かれている想定にして
        // 拡張 PUT を no-op にする（app-pilot.spec.ts と同じスタブ）
        await route.fulfill({
          json: { valueRanges: [{ values: [[...SHEET_HEADERS.Evidence]] }] },
        });
      } else if (url.includes('/values/Evidence')) {
        await route.fulfill({ json: { values: [EVIDENCE_HEADERS, ...options.evidenceRows] } });
      } else if (url.includes('/values/ExtractionRuns')) {
        await route.fulfill({ json: { values: [RUNS_HEADERS, RUN_ROW] } });
      } else if (url.includes('/values/Decisions')) {
        await route.fulfill({ json: { values: [DECISIONS_HEADERS] } });
      } else if (url.includes('/values/StudyData')) {
        studyDataReads += 1;
        if (options.studyDataConflictAfterFirstRead === true && studyDataReads > 1) {
          await route.fulfill({
            json: {
              values: [
                STUDY_DATA_HEADERS,
                ['study-1', 'e2e@example.com', 'human_with_ai', '1', '', 't-other'],
              ],
            },
          });
        } else {
          await route.fulfill({ json: { values: [STUDY_DATA_HEADERS] } });
        }
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
        // PDF 本体と同じ本文（QUOTE、または extractedText 指定時はその内容）を返す
        // = 実 PDF の text 層と同一内容という前提を再現する
        await route.fulfill({ contentType: 'text/plain', body: options.extractedText ?? QUOTE });
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
  options: { apiKey?: string } = {},
): Promise<void> {
  await page.addInitScript(({ documents, apiKey }) => {
    const win = window as unknown as Record<string, unknown>;
    // apiKey が渡されたときだけ secrets.geminiApiKey を持たせる（relocate-quote の
    // LLM 呼び出し実弾テスト用。issue #94。未指定時は従来どおり常に空を返す）
    const stored: Record<string, unknown> =
      apiKey === null ? {} : { 'secrets.geminiApiKey': apiKey };
    win.chrome = {
      storage: {
        local: {
          get: async (keys: string | string[]) => {
            const wanted = Array.isArray(keys) ? keys : [keys];
            const found: Record<string, unknown> = {};
            for (const key of wanted) {
              if (key in stored) {
                found[key] = stored[key];
              }
            }
            return found;
          },
          set: async () => undefined,
          remove: async () => undefined,
        },
      },
      runtime: {
        // 認証は SW ブローカーへの sendMessage 経由（issue #129）
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
        documents: 2,
        protocolVersions: 1,
        schemaVersions: 1,
        pilotRuns: 1,
        evidenceRows: 2,
        dataRows: 0,
      },
      documents,
    };
  }, { documents: docs, apiKey: options.apiKey ?? null });
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

// スクロールリセットの回帰テスト（issue #192）: 判定保存の非同期ストア更新は route 全体を
// replaceChildren で作り直し、キャッシュ済みパネルが detach → reattach される。実ブラウザは
// このとき内側スクロールコンテナの位置を 0 にリセットするため、bootstrap の退避・復元
// （data-preserve-scroll）が効いていることを、判定 → Decisions 追記（保存完了）後の
// スクロール位置で確認する。承認後の自動送りによる scrollIntoView の影響を受けないよう、
// 未判定セルは 1 件だけにする（movedTo なし = 判定時のスクロール副作用なし）
test('判定保存（非同期ストア更新）の再描画でもペイン内のスクロール位置が保持される（issue #192）', async ({
  page,
}) => {
  const { appendUrls } = await setupRoutes(page, {
    schemaRows: [STUDY_FIELD_ROW],
    evidenceRows: [EVIDENCE_ROW_1, EVIDENCE_ROW_2],
  });
  await initApp(page, '#/verify?study=study-1');

  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.pdf-viewer__hl--unverified')).toHaveCount(1, { timeout: 15_000 });

  // リスト表示へ切替（報告の再現手順）+ fixture のセル数に依存せず決定的に
  // スクロール可能な高さへ制限する
  await page.locator('#verify-layout-toggle').click();
  await expect(page.locator('#verify-focus-card')).toHaveCount(0);
  await page.addStyleTag({
    content: '.verify__pane--form { max-height: 120px; } .pdf-viewer__scroller { max-height: 120px; }',
  });

  // 右ペイン / PDF ペインを中間位置へスクロールする。末尾（最大値）だと承認後に
  // セル内容が縮んで scrollHeight が減り、復元値が新しい最大値へクランプされて
  // 位置比較が成立しないため、縮小後も範囲内に収まる中間値を使う
  const formPane = page.locator('.verify__pane--form');
  const pdfScroller = page.locator('.pdf-viewer__scroller');
  const formScrollTop = await formPane.evaluate((node) => {
    node.scrollTop = 10_000;
    const max = node.scrollTop;
    node.scrollTop = Math.min(60, max);
    return node.scrollTop;
  });
  const viewerScrollTop = await pdfScroller.evaluate((node) => {
    node.scrollTop = 10_000;
    const max = node.scrollTop;
    node.scrollTop = Math.min(60, max);
    return node.scrollTop;
  });
  expect(formScrollTop).toBeGreaterThan(0);
  expect(viewerScrollTop).toBeGreaterThan(0);

  // 判定は DOM click で発火する（Playwright のクリックは画面外のボタンを可視化する
  // 自動スクロールを伴い、退避対象の位置そのものを動かしてしまうため）
  await page
    .locator('.verify__action--accept')
    .evaluate((node) => (node as HTMLElement).click());

  // 保存完了（Decisions 追記 = 非同期ストア更新の再描画が走った後）でも
  // 両ペインのスクロール位置が保持される
  await expect
    .poll(() => appendUrls.filter((url) => url.includes('Decisions') && url.includes(':append')).length)
    .toBeGreaterThan(0);
  await expect.poll(() => formPane.evaluate((node) => node.scrollTop)).toBe(formScrollTop);
  await expect.poll(() => pdfScroller.evaluate((node) => node.scrollTop)).toBe(viewerScrollTop);
});

// 和文アンカリング（issue #95 層 1）の E2E 実弾: 実 PDF（minimalJaPdf）を pdfjs が
// 実際にロードし、getTextContent が返す和文テキスト層に対して、アプリ側の
// 正規化（normalizeTextWithMap）→ アンカリング（collectOccurrences の indexOf 一致）→
// ハイライト（highlightMap）のパイプラインが実際に動くことを確認する。
// quote と抽出テキスト（.txt）・PDF 本体の 3 者を和文で揃え、Evidence の
// anchor_status='exact' が実際にハイライト矩形の描画まで到達することを見る
// （requirements.md §5 の段階的マッチングのうち exact / normalized は同一コード経路を通る）
test('和文 fixture: 抽出テキスト → アンカリング（exact）→ ハイライトが通る（issue #95 層 1）', async ({
  page,
}) => {
  const JA_QUOTE = '死亡率は12パーセントであった';
  const JA_STUDY_FIELD_ROW = [
    '1', 'f-total', '1', 'results', 'mortality_pct', '死亡率', 'study', 'text', '', '',
    'TRUE', '全体の死亡率を抽出する。', '', 'FALSE', '',
  ];
  const JA_EVIDENCE_ROW = [
    'ev-ja-1', 'run-1', 'study-1', 'f-total', 'doc-1', '-', '12', 'FALSE', JA_QUOTE, '1', 'high', 'exact',
  ];
  await setupRoutes(page, {
    schemaRows: [JA_STUDY_FIELD_ROW],
    evidenceRows: [JA_EVIDENCE_ROW, EVIDENCE_ROW_2],
    pdfBuilder: () => minimalJaPdf(JA_QUOTE),
    extractedText: JA_QUOTE,
  });
  await initApp(page, '#/verify');

  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.verify__cell-label')).toHaveText('死亡率');
  await expect(page.locator('.pdf-viewer__page-indicator')).toHaveText('1 / 1 ページ');

  // 和文 quote が実 PDF のテキスト層上で exact アンカリングされ、ハイライト矩形が
  // 描画されること（座標はダミーフォントの等幅近似だが、幅・高さが 0 でないことまで見る）
  const highlight = page.locator('.pdf-viewer__hl--unverified');
  await expect(highlight).toHaveCount(1, { timeout: 15_000 });
  const box = await highlight.evaluate((node) => {
    const rect = (node as HTMLElement).getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);

  // ハイライトクリック → フォームへジャンプ（英文と同じ導線が和文でも壊れないこと）
  await highlight.click();
  await expect(page.locator('#verify-focus-detail .verify__quote-jump')).toBeVisible();
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

  // 抽出指示の折りたたみ（issue #81）: with_ai レビューのセルカードは既定で畳んだ状態 →
  // 開くと extraction_instruction を表示する（独立入力モードの常時表示とは別に追加）
  const instructionToggle = page.locator('#verify-focus-detail .verify__instruction-toggle');
  await expect(instructionToggle).toBeVisible();
  await expect(instructionToggle).not.toHaveAttribute('open', '');
  await instructionToggle.locator('summary').click();
  await expect(instructionToggle).toHaveAttribute('open', '');
  await expect(instructionToggle.locator('.verify__instruction')).toHaveText('Report overall mortality.');

  const toggleOpenResults = await new AxeBuilder({ page }).analyze();
  expect(toggleOpenResults.violations).toEqual([]);

  // ユニット送りボタン（issue #82）: Shift+J/K と同じ着地ロジックをマウスでも実行できる。
  // 先頭ユニットのため前ボタンは disabled（折り返さない）、次ボタンは有効
  const prevUnitButton = page.locator('.focus-card__nav--prev');
  const nextUnitButton = page.locator('.focus-card__nav--next');
  await expect(prevUnitButton).toBeDisabled();
  await expect(nextUnitButton).toBeEnabled();
  await nextUnitButton.click();
  await expect(page.locator('#verify-focus-position')).toHaveText('ユニット 2 / 2（残り 2）');
  await expect(page.locator('#verify-focus-detail .verify__cell-label')).toHaveText('出版年');
  // 末尾ユニットのため次ボタンは disabled、前ボタンは有効
  await expect(nextUnitButton).toBeDisabled();
  await expect(prevUnitButton).toBeEnabled();
  await prevUnitButton.click();
  await expect(page.locator('#verify-focus-position')).toHaveText('ユニット 1 / 2（残り 2）');
  await expect(page.locator('#verify-focus-detail .verify__cell-label')).toHaveText('死亡率');

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

test('保存の競合検出（issue #64・楽観ロック）: 判定操作が競合を検出 → バナー表示 → 再読み込みで復帰', async ({
  page,
}) => {
  const { appendUrls } = await setupRoutes(page, {
    schemaRows: [STUDY_FIELD_ROW],
    evidenceRows: [EVIDENCE_ROW_1],
    // 初回 bundle 読込では自分の StudyData 行なし（studyRowUpdatedAt = null）。
    // 判定操作（upsert 内の再読込 GET）以降は「別の場所で既に更新済み」の行を返し、競合を再現する
    studyDataConflictAfterFirstRead: true,
  });
  await initApp(page, '#/verify?study=study-1');

  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#verify-conflict-warning')).toHaveCount(0);

  // 承認 → StudyData の upsert 内の再読込 GET が競合行を返す → AnnotationConflictError
  await page.locator('.verify__action--accept').click();
  await expect(page.locator('#verify-conflict-warning')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#verify-conflict-warning')).toContainText(
    '読み込み後に別の場所で更新されています',
  );
  // 競合はオフラインキューへ退避しない（#verify-queued は出ない）+ Decisions への追記も起きない
  await expect(page.locator('#verify-queued')).toHaveCount(0);
  expect(appendUrls.filter((url) => url.includes('Decisions') && url.includes(':append'))).toEqual([]);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  // 「再読み込み」→ バナーが消え、検証パネルが読み直される
  await page.locator('#verify-conflict-reload').click();
  await expect(page.locator('#verify-conflict-warning')).toHaveCount(0);
  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });
});

test('決定論的な数値整合性チェック（issue #65）: events > total で ⚠ バッジ + 警告文 → 修正で解消すると消える', async ({
  page,
}) => {
  // 二値プリセット項目（outcome_events / outcome_total）のみのスキーマ。outcome_result 項目が
  // あるスキーマは arm 未確定のうちアウトカムタブがディムされる（群構成確定が先に必要）
  const EVENTS_FIELD_ROW = [
    '1', 'f-out-events', '1', 'outcomes', 'outcome_events', 'イベント数（群別）', 'outcome_result',
    'integer', '', '', 'TRUE', 'Number of participants with the outcome event in this arm.', '', 'FALSE', '',
  ];
  const TOTAL_FIELD_ROW = [
    '1', 'f-out-total', '2', 'outcomes', 'outcome_total', '解析対象数（群別）', 'outcome_result',
    'integer', '', '', 'TRUE', 'Number of participants analysed for this outcome in this arm.', '', 'FALSE', '',
  ];
  // outcome_result レベルの entity_key 形式（requirements.md §3.3）: `outcome:<id>|arm:<n>`
  const OUTCOME_ENTITY_KEY = 'outcome:mortality|arm:1';
  const EVENTS_EVIDENCE_ROW = [
    'ev-events', 'run-1', 'study-1', 'f-out-events', 'doc-1', OUTCOME_ENTITY_KEY, '13', 'FALSE', QUOTE, '1', 'high', 'exact',
  ];
  const TOTAL_EVIDENCE_ROW = [
    'ev-total', 'run-1', 'study-1', 'f-out-total', 'doc-1', OUTCOME_ENTITY_KEY, '10', 'FALSE', QUOTE, '1', 'high', 'exact',
  ];
  const { appendUrls } = await setupRoutes(page, {
    schemaRows: [EVENTS_FIELD_ROW, TOTAL_FIELD_ROW],
    evidenceRows: [EVENTS_EVIDENCE_ROW, TOTAL_EVIDENCE_ROW],
  });
  await initApp(page, '#/verify?study=study-1');

  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });

  // 群構成の確定（AI ドラフトは Evidence の entity_key から arm:1 を検出済み）
  await expect(page.locator('.verify__arm-key')).toHaveText('arm:1');
  await page.locator('.verify__arm-name').fill('介入群');
  await page.locator('#verify-arm-confirm').click();

  // events(13) > total(10) は決定論的な数値整合性チェック（LLM 非依存）の違反 →
  // マトリクスの関与セル両方（イベント数・解析対象数）に ⚠ バッジが付く
  const matrixButtons = page.locator('#verify-focus-matrix .focus-card__matrix-btn');
  await expect(matrixButtons).toHaveCount(2, { timeout: 15_000 });
  await expect(page.locator('.verify__consistency-badge')).toHaveCount(2);
  await expect(matrixButtons.nth(0)).toHaveAttribute('title', /を超えています/);

  // 詳細ストリップ（初期フォーカス = イベント数）に警告メッセージ一覧を表示する
  await expect(page.locator('#verify-focus-detail .verify__cell-label')).toHaveText('イベント数（群別）');
  await expect(page.locator('#verify-consistency-warning')).toContainText(
    'イベント数（群別） (13) が解析対象数（群別） (10) を超えています',
  );

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  // 判定操作は増えない・ブロックしない（情報提示のみ）: 修正で矛盾を解消すると
  // セル状態変更の再描画経路でバッジ・警告が再計算されて消える
  await page.locator('#verify-focus-detail .verify__action--edit').click();
  await page.locator('#verify-focus-detail .verify__edit-input').fill('5');
  await page.locator('#verify-focus-detail .verify__edit-confirm').click();
  await expect(page.locator('.verify__consistency-badge')).toHaveCount(0);
  await expect(page.locator('.verify__consistency-warnings')).toHaveCount(0);
  await expect
    .poll(() => appendUrls.filter((url) => url.includes('Decisions') && url.includes(':append')).length)
    .toBeGreaterThan(0);
});

test('RoB 2 SQ アルゴリズム提案（issue #61）: 提案チップ表示 → 不一致警告 → AI 判定未確認バッジ', async ({
  page,
}) => {
  // Domain 1（randomization process）の SQ 3 問 + 判定の 4 項目のみのスキーマ
  // （rob_domain 以外の項目が無いため群構成カードは出ず、rob_domain タブが唯一のタブになる）
  const SQ1_1_FIELD_ROW = [
    '1', 'f-sq1-1', '1', 'risk_of_bias_rob2', 'rob2_sq1_1', 'RoB2 SQ1.1', 'rob_domain',
    'enum', '', 'y|py|pn|n|ni|na', 'FALSE', 'Was the allocation sequence random?', '', 'FALSE', '',
  ];
  const SQ1_2_FIELD_ROW = [
    '1', 'f-sq1-2', '2', 'risk_of_bias_rob2', 'rob2_sq1_2', 'RoB2 SQ1.2', 'rob_domain',
    'enum', '', 'y|py|pn|n|ni|na', 'FALSE',
    'Was the allocation sequence concealed until participants were enrolled?', '', 'FALSE', '',
  ];
  const SQ1_3_FIELD_ROW = [
    '1', 'f-sq1-3', '3', 'risk_of_bias_rob2', 'rob2_sq1_3', 'RoB2 SQ1.3', 'rob_domain',
    'enum', '', 'y|py|pn|n|ni|na', 'FALSE',
    'Did baseline differences suggest a problem with the randomization process?', '', 'FALSE', '',
  ];
  const ROB2_JUDGEMENT_FIELD_ROW = [
    '1', 'f-rob2-judgement', '4', 'risk_of_bias_rob2', 'rob2_judgement', 'RoB2 判定', 'rob_domain',
    'enum', '', 'low|some_concerns|high', 'TRUE', 'RoB 2 judgement for this domain.', '', 'FALSE', '',
  ];
  const D1_ENTITY_KEY = 'rob:d1_randomization';
  // SQ 1.1 = y・1.2 = y・1.3 = n → アルゴリズム提案は low（judgeDomain1Randomization）。
  // 一方 AI 自身の判定（rob2_judgement の Evidence 値）はあえて high にして不一致を再現する
  const SQ1_1_EVIDENCE = ['ev-sq1-1', 'run-1', 'study-1', 'f-sq1-1', 'doc-1', D1_ENTITY_KEY, 'y', 'FALSE', '', '', 'high', ''];
  const SQ1_2_EVIDENCE = ['ev-sq1-2', 'run-1', 'study-1', 'f-sq1-2', 'doc-1', D1_ENTITY_KEY, 'y', 'FALSE', '', '', 'high', ''];
  const SQ1_3_EVIDENCE = ['ev-sq1-3', 'run-1', 'study-1', 'f-sq1-3', 'doc-1', D1_ENTITY_KEY, 'n', 'FALSE', '', '', 'high', ''];
  const JUDGEMENT_EVIDENCE = [
    'ev-rob2-judgement', 'run-1', 'study-1', 'f-rob2-judgement', 'doc-1', D1_ENTITY_KEY, 'high', 'FALSE', '', '', 'high', '',
  ];

  await setupRoutes(page, {
    schemaRows: [SQ1_1_FIELD_ROW, SQ1_2_FIELD_ROW, SQ1_3_FIELD_ROW, ROB2_JUDGEMENT_FIELD_ROW],
    evidenceRows: [SQ1_1_EVIDENCE, SQ1_2_EVIDENCE, SQ1_3_EVIDENCE, JUDGEMENT_EVIDENCE],
  });
  await initApp(page, '#/verify?study=study-1');

  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });

  // rob_domain タブしか無いスキーマなので群構成カードは出ない（arm 依存項目が無いため）
  await expect(page.locator('#verify-arm-card')).toHaveCount(0);

  // フォーカスモードのマトリクスで RoB2 判定行を選択する
  const matrixButtons = page.locator('#verify-focus-matrix .focus-card__matrix-btn');
  await expect(matrixButtons).toHaveCount(4, { timeout: 15_000 });
  const judgementRow = page.locator('#verify-focus-matrix tr', { hasText: 'RoB2 判定' });
  await judgementRow.locator('.focus-card__matrix-btn').click();

  // マトリクスボタンには RoB 不一致バッジ（issue #65 の整合性バッジと同じパターン）
  await expect(judgementRow.locator('.verify__rob-badge')).toHaveCount(1);
  await expect(judgementRow.locator('.focus-card__matrix-btn')).toHaveAttribute(
    'title',
    'アルゴリズム提案 (low) と現在の判定 (high) が一致しません',
  );

  // 詳細ストリップ: 提案チップ + 不一致警告 + AI 判定・未確認バッジ
  await expect(page.locator('#verify-focus-detail .verify__cell-label')).toHaveText('RoB2 判定');
  await expect(page.locator('#verify-focus-detail .verify__rob-suggestion')).toHaveText(
    'アルゴリズム提案: low',
  );
  await expect(page.locator('#verify-rob-algorithm-warning')).toContainText(
    'アルゴリズム提案 (low) と現在の判定 (high) が一致しません',
  );
  await expect(page.locator('#verify-focus-detail .verify__rob-unconfirmed')).toHaveText(
    'AI 判定・未確認（まだ人が確認していません）',
  );

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  // 承認すると人間の判定が付き、AI 判定・未確認バッジは消える（不一致警告は情報提示のため残る —
  // 判定操作は増やさない・ブロックしない仕様どおり承認自体は可能）。
  // 承認直後は同一ユニット内の次の未判定セル（SQ1.1）へ自動送りされるため、
  // 判定行のバッジ消滅を確認するにはマトリクスから改めて判定行を選び直す
  await page.locator('#verify-focus-detail .verify__action--accept').click();
  await judgementRow.locator('.focus-card__matrix-btn').click();
  await expect(page.locator('#verify-focus-detail .verify__cell-label')).toHaveText('RoB2 判定');
  await expect(page.locator('#verify-focus-detail .verify__rob-unconfirmed')).toHaveCount(0);
});

test('estimate 別 RoB 評価の宣言（issue #109 PR2）: フォーム表示 → estimate + ドメイン選択 → 追加で空セル群 + Decisions 追記 → 重複エラー', async ({
  page,
}) => {
  // RoB 2 SQ テンプレート相当の D1（SQ 3 問 + 判定）+ outcome_result 1 項目のスキーマ。
  // outcome_result 項目があるため群構成は未確定（outcome タブはロック）だが、
  // rob_domain タブは群構成に依存せず検証・宣言できる
  const SQ1_1_FIELD_ROW = [
    '1', 'f-sq1-1', '1', 'risk_of_bias_rob2', 'rob2_sq1_1', 'RoB2 SQ1.1', 'rob_domain',
    'enum', '', 'y|py|pn|n|ni|na', 'FALSE', 'Was the allocation sequence random?', '', 'FALSE', '',
  ];
  const SQ1_2_FIELD_ROW = [
    '1', 'f-sq1-2', '2', 'risk_of_bias_rob2', 'rob2_sq1_2', 'RoB2 SQ1.2', 'rob_domain',
    'enum', '', 'y|py|pn|n|ni|na', 'FALSE',
    'Was the allocation sequence concealed until participants were enrolled?', '', 'FALSE', '',
  ];
  const SQ1_3_FIELD_ROW = [
    '1', 'f-sq1-3', '3', 'risk_of_bias_rob2', 'rob2_sq1_3', 'RoB2 SQ1.3', 'rob_domain',
    'enum', '', 'y|py|pn|n|ni|na', 'FALSE',
    'Did baseline differences suggest a problem with the randomization process?', '', 'FALSE', '',
  ];
  const ROB2_JUDGEMENT_FIELD_ROW = [
    '1', 'f-rob2-judgement', '4', 'risk_of_bias_rob2', 'rob2_judgement', 'RoB2 判定', 'rob_domain',
    'enum', '', 'low|some_concerns|high', 'TRUE', 'RoB 2 judgement for this domain.', '', 'FALSE', '',
  ];
  const EST_OUTCOME_FIELD_ROW = [
    '1', 'f-out-event', '5', 'outcomes', 'event_count', 'イベント数', 'outcome_result', 'integer',
    '', '', 'TRUE', 'イベント数を抽出', '', 'FALSE', '',
  ];
  const D1_ENTITY_KEY = 'rob:d1_randomization';
  const JUDGEMENT_EVIDENCE = [
    'ev-rob2-judgement', 'run-1', 'study-1', 'f-rob2-judgement', 'doc-1', D1_ENTITY_KEY, 'low', 'FALSE', '', '', 'high', '',
  ];
  const OUTCOME_EVIDENCE = [
    'ev-out', 'run-1', 'study-1', 'f-out-event', 'doc-1', 'outcome:death|arm:1', '12', 'FALSE', QUOTE, '1', 'high', 'exact',
  ];

  const { appendUrls } = await setupRoutes(page, {
    schemaRows: [
      SQ1_1_FIELD_ROW, SQ1_2_FIELD_ROW, SQ1_3_FIELD_ROW, ROB2_JUDGEMENT_FIELD_ROW, EST_OUTCOME_FIELD_ROW,
    ],
    evidenceRows: [JUDGEMENT_EVIDENCE, OUTCOME_EVIDENCE],
  });
  await initApp(page, '#/verify?study=study-1');

  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });

  // 初期タブ = rob_domain（outcome タブは群構成未確定でロック、rob はロックされない）
  await expect(page.locator('.verify__tab--active')).toHaveText('RoB');

  // 宣言フォーム: estimate セレクタは outcome_result インスタンス、
  // ドメインセレクタはテンプレート由来の全ドメイン（RoB 2 = D1〜D5 + overall）
  const form = page.locator('#verify-rob-est-add');
  await expect(form).toBeVisible();
  await expect(page.locator('#verify-rob-est-key option')).toHaveCount(1);
  await expect(page.locator('#verify-rob-est-key option').first()).toHaveText('death / 群 1');
  await expect(page.locator('#verify-rob-est-domain option')).toHaveCount(6);

  const formResults = await new AxeBuilder({ page }).analyze();
  expect(formResults.violations).toEqual([]);

  // estimate + ドメインを選んで追加 → 宣言イベントが Decisions へ追記される
  await page.locator('#verify-rob-est-key').selectOption('outcome:death|arm:1');
  await page.locator('#verify-rob-est-domain').selectOption('d1_randomization');
  await page.locator('#verify-rob-est-add-button').click();
  await expect
    .poll(() => appendUrls.filter((url) => url.includes('Decisions') && url.includes(':append')).length)
    .toBeGreaterThan(0);

  // 追加直後: estimate 別ユニットへフォーカスが移り、当該ドメインの判定 + SQ の
  // 空セル群（AI 抽出なし・手入力のみ）が現れて進捗分母に含まれる
  await expect(page.locator('#verify-focus-position')).toHaveText('ユニット 2 / 2（残り 2）');
  await expect(page.locator('.focus-card__heading')).toHaveText(
    'RoB: d1_randomization — death / 群 1',
  );
  await expect(page.locator('#verify-focus-matrix tbody tr')).toHaveCount(4);
  await expect(page.locator('#verify-focus-detail .verify__ai--none')).toHaveText(
    'AI 抽出なし（手入力のみ）',
  );
  await expect(page.locator('#verify-progress')).toContainText('判定済み 0 / 8');

  // 同じ組の再追加は保存せずエラー（role=alert）
  await page.locator('#verify-rob-est-add-button').click();
  await expect(page.locator('#verify-rob-est-error')).toHaveText(
    'entity_key rob:d1_randomization|outcome:death|arm:1 は既に宣言されています',
  );
});

test('ROBINS-I SQ アルゴリズム提案（issue #61 PR2 = issue #87）: 提案チップ表示 → 不一致警告 → AI 判定未確認バッジ', async ({
  page,
}) => {
  // Domain 3（classification of interventions）の SQ 3 問 + 判定の 4 項目のみのスキーマ
  const SQ3_1_FIELD_ROW = [
    '1', 'f-sq3-1', '1', 'risk_of_bias_robins_i_sq', 'robins_i_sq3_1', 'ROBINS-I SQ3.1', 'rob_domain',
    'enum', '', 'y|py|pn|n|ni|na', 'FALSE', 'Were intervention groups clearly defined?', '', 'FALSE', '',
  ];
  const SQ3_2_FIELD_ROW = [
    '1', 'f-sq3-2', '2', 'risk_of_bias_robins_i_sq', 'robins_i_sq3_2', 'ROBINS-I SQ3.2', 'rob_domain',
    'enum', '', 'y|py|pn|n|ni|na', 'FALSE',
    'Was the information used to define intervention groups recorded at the start of the intervention?', '', 'FALSE', '',
  ];
  const SQ3_3_FIELD_ROW = [
    '1', 'f-sq3-3', '3', 'risk_of_bias_robins_i_sq', 'robins_i_sq3_3', 'ROBINS-I SQ3.3', 'rob_domain',
    'enum', '', 'y|py|pn|n|ni|na', 'FALSE',
    'Could classification of intervention status have been affected by knowledge of the outcome?', '', 'FALSE', '',
  ];
  const ROBINS_I_JUDGEMENT_FIELD_ROW = [
    '1', 'f-robins-i-judgement', '4', 'risk_of_bias_robins_i_sq', 'robins_i_judgement', 'ROBINS-I 判定', 'rob_domain',
    'enum', '', 'low|moderate|serious|critical|no_information', 'TRUE', 'ROBINS-I judgement for this domain.', '', 'FALSE', '',
  ];
  const D3_ENTITY_KEY = 'rob:d3_classification';
  // SQ 3.1 = n（介入群の定義が不明瞭）→ アルゴリズム提案は serious（judgeRobinsIDomain3Classification）。
  // 一方 AI 自身の判定（robins_i_judgement の Evidence 値）はあえて low にして不一致を再現する
  const SQ3_1_EVIDENCE = ['ev-sq3-1', 'run-1', 'study-1', 'f-sq3-1', 'doc-1', D3_ENTITY_KEY, 'n', 'FALSE', '', '', 'high', ''];
  const SQ3_2_EVIDENCE = ['ev-sq3-2', 'run-1', 'study-1', 'f-sq3-2', 'doc-1', D3_ENTITY_KEY, 'na', 'FALSE', '', '', 'high', ''];
  const SQ3_3_EVIDENCE = ['ev-sq3-3', 'run-1', 'study-1', 'f-sq3-3', 'doc-1', D3_ENTITY_KEY, 'na', 'FALSE', '', '', 'high', ''];
  const JUDGEMENT_EVIDENCE = [
    'ev-robins-i-judgement', 'run-1', 'study-1', 'f-robins-i-judgement', 'doc-1', D3_ENTITY_KEY, 'low', 'FALSE', '', '', 'high', '',
  ];

  await setupRoutes(page, {
    schemaRows: [SQ3_1_FIELD_ROW, SQ3_2_FIELD_ROW, SQ3_3_FIELD_ROW, ROBINS_I_JUDGEMENT_FIELD_ROW],
    evidenceRows: [SQ3_1_EVIDENCE, SQ3_2_EVIDENCE, SQ3_3_EVIDENCE, JUDGEMENT_EVIDENCE],
  });
  await initApp(page, '#/verify?study=study-1');

  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });

  // rob_domain タブしか無いスキーマなので群構成カードは出ない（arm 依存項目が無いため）
  await expect(page.locator('#verify-arm-card')).toHaveCount(0);

  // フォーカスモードのマトリクスで ROBINS-I 判定行を選択する
  const matrixButtons = page.locator('#verify-focus-matrix .focus-card__matrix-btn');
  await expect(matrixButtons).toHaveCount(4, { timeout: 15_000 });
  const judgementRow = page.locator('#verify-focus-matrix tr', { hasText: 'ROBINS-I 判定' });
  await judgementRow.locator('.focus-card__matrix-btn').click();

  // マトリクスボタンには RoB 不一致バッジ（issue #65 の整合性バッジと同じパターン）
  await expect(judgementRow.locator('.verify__rob-badge')).toHaveCount(1);
  await expect(judgementRow.locator('.focus-card__matrix-btn')).toHaveAttribute(
    'title',
    'アルゴリズム提案 (serious) と現在の判定 (low) が一致しません',
  );

  // 詳細ストリップ: 提案チップ + 不一致警告 + AI 判定・未確認バッジ
  await expect(page.locator('#verify-focus-detail .verify__cell-label')).toHaveText('ROBINS-I 判定');
  await expect(page.locator('#verify-focus-detail .verify__rob-suggestion')).toHaveText(
    'アルゴリズム提案: serious',
  );
  await expect(page.locator('#verify-rob-algorithm-warning')).toContainText(
    'アルゴリズム提案 (serious) と現在の判定 (low) が一致しません',
  );
  await expect(page.locator('#verify-focus-detail .verify__rob-unconfirmed')).toHaveText(
    'AI 判定・未確認（まだ人が確認していません）',
  );

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  // 承認すると人間の判定が付き、AI 判定・未確認バッジは消える（不一致警告は情報提示のため残る）
  await page.locator('#verify-focus-detail .verify__action--accept').click();
  await judgementRow.locator('.focus-card__matrix-btn').click();
  await expect(page.locator('#verify-focus-detail .verify__cell-label')).toHaveText('ROBINS-I 判定');
  await expect(page.locator('#verify-focus-detail .verify__rob-unconfirmed')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// quote の再特定（relocate-quote skill。issue #94）
// ---------------------------------------------------------------------------

/** relocate-quote skill の応答（{found, quote, page}）を Gemini 応答の形へ包んで stub する */
async function stubRelocateQuoteGemini(
  page: Page,
  response: { found: boolean; quote: string | null; page: number | null },
): Promise<void> {
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    await route.fulfill({
      json: {
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(response) }],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10 },
        modelVersion: 'gemini-test-001',
      },
    });
  });
}

test('「AI で再特定」成功: LLM が本文と一致する quote を返すと Evidence が追記されハイライトへ切り替わる（issue #94）', async ({
  page,
}) => {
  const recorder = await setupRoutes(page, {
    schemaRows: [STUDY_FIELD_ROW],
    evidenceRows: [FAILED_EVIDENCE_ROW],
  });
  await stubRelocateQuoteGemini(page, { found: true, quote: QUOTE, page: 1 });
  await initApp(page, '#/verify?study=study-1', defaultDocuments(), { apiKey: 'e2e-api-key' });

  const relocateButton = page.locator('.verify__quote-relocate');
  await expect(relocateButton).toBeVisible();
  await expect(page.locator('.verify__quote-unanchored')).toBeVisible();
  await relocateButton.click();
  await expect(relocateButton).toHaveText('AI で再特定中…');
  await expect(relocateButton).toBeDisabled();

  // 成功: unanchored フォールバックが消え、通常のハイライト UI（ジャンプ）へ切り替わる
  await expect(page.locator('.verify__quote-jump')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.verify__quote-relocate')).toHaveCount(0);
  await expect(page.locator('.verify__quote-unanchored')).toHaveCount(0);
  await expect(page.locator('.pdf-viewer__hl')).toHaveCount(1);

  // Evidence タブへの追記（relocated_from 付きの新行）と LLMApiLog（purpose=relocate_quote）の
  // 記録が実際に発生している
  expect(recorder.appendUrls.some((url) => url.includes('Evidence!A1:append'))).toBe(true);
  expect(recorder.appendUrls.some((url) => url.includes('LLMApiLog!A1:append'))).toBe(true);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('「AI で再特定」not_found: LLM が found:false を返すと案内メッセージを表示し Evidence は追記されない（issue #94）', async ({
  page,
}) => {
  const recorder = await setupRoutes(page, {
    schemaRows: [STUDY_FIELD_ROW],
    evidenceRows: [FAILED_EVIDENCE_ROW],
  });
  await stubRelocateQuoteGemini(page, { found: false, quote: null, page: null });
  await initApp(page, '#/verify?study=study-1', defaultDocuments(), { apiKey: 'e2e-api-key' });

  await page.locator('.verify__quote-relocate').click();
  await expect(page.locator('.verify__quote-relocate-not-found')).toHaveText(
    'AI でも見つかりませんでした。本文内検索をお試しください',
  );
  // 再度有効になり、従来の「本文内を検索」フォールバックも引き続き使える
  await expect(page.locator('.verify__quote-relocate')).toBeEnabled();
  await expect(page.locator('.verify__quote-search')).toBeVisible();
  expect(recorder.appendUrls.some((url) => url.includes('Evidence!A1:append'))).toBe(false);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('表示言語の切替: 読込済みの検証パネルが同一 study のまま新言語で再構築される（issue #93）', async ({
  page,
}) => {
  await setupRoutes(page, {
    schemaRows: [STUDY_FIELD_ROW],
    evidenceRows: [EVIDENCE_ROW_1, EVIDENCE_ROW_2],
  });
  await initApp(page, '#/verify?study=study-1');

  // ja でパネルが読み込まれる（判定ボタン + 左ペインの表示切替 = 生成時に文言解決される部分）
  await expect(page.locator('.verify__action--accept').first()).toHaveText('承認 (a)');
  await expect(page.locator('.verify__view-toggle-btn').nth(1)).toHaveText('抽出テキスト');

  // Options で en へ切替 → 同一 study の #/verify へ戻る（VerificationData の参照は変わらず、
  // alreadyShown ガードで再読込もされない = 言語スタンプによるキャッシュ再生成の検証経路）
  await page.locator('#app-open-options').click();
  await page.locator('#ui-language').selectOption('en');
  await expect(page.locator('#app-content .settings__header h2')).toHaveText('Settings');
  await page.locator('#app-nav a[href="#/verify"]').click();
  await expect(page.locator('.verify__action--accept').first()).toHaveText('Accept (a)');
  await expect(page.locator('.verify__view-toggle-btn').nth(1)).toHaveText('Extracted text');

  // ja へ復帰しても同様に作り直される
  await page.locator('#app-open-options').click();
  await page.locator('#ui-language').selectOption('ja');
  await page.locator('#app-nav a[href="#/verify"]').click();
  await expect(page.locator('.verify__action--accept').first()).toHaveText('承認 (a)');
});

// --- flow 図（mermaid）プレビュー（issue #109 PR5・ui-states.md §3） -----------------
// QUADAS-3 テンプレートの `quadas3_flow_diagram`（予約 field_name 規約）のセルカードに
// 「図をプレビュー」トグルが出て、開くと同梱 mermaid の遅延チャンクが実際にロードされ
// SVG が描画されることを実弾で確認する（値は AI 抽出済み Evidence として注入 = テンプレート
// 挿入後にモック抽出した状態の seam）

const MERMAID_SOURCE = 'flowchart TD\n  A[Enrolled 100] -->|Excluded 10| B[Analyzed 90]';

const FLOW_FIELD_ROW = [
  '1', 'f-flow', '2', 'risk_of_bias_quadas3', 'quadas3_flow_diagram',
  'QUADAS-3 フロー図（mermaid）', 'study', 'text', '', '',
  'FALSE', 'Construct the participant flow as mermaid flowchart TD source.', '', 'FALSE', '',
];

const FLOW_EVIDENCE_ROW = [
  'ev-flow', 'run-1', 'study-1', 'f-flow', 'doc-1', '-', MERMAID_SOURCE, 'FALSE', QUOTE,
  '1', 'high', 'exact',
];

test('flow 図（mermaid）プレビュー: 対象セルだけにトグルが出て、開くと遅延チャンクで SVG が描画される（issue #109）', async ({
  page,
}) => {
  await setupRoutes(page, {
    schemaRows: [STUDY_FIELD_ROW, FLOW_FIELD_ROW],
    evidenceRows: [EVIDENCE_ROW_1, FLOW_EVIDENCE_ROW],
  });
  await initApp(page, '#/verify?study=study-1');
  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });

  // 非対象セル（死亡率）にはプレビュートグルが出ない
  await expect(page.locator('#verify-focus-detail .verify__cell-label')).toHaveText('死亡率');
  await expect(page.locator('.verify__mermaid-toggle')).toHaveCount(0);

  // 次ユニット（risk_of_bias_quadas3 section）の flow 図セルへ移動するとトグルが出る（既定は畳んだ状態）
  await page.locator('.focus-card__nav--next').click();
  await expect(page.locator('#verify-focus-detail .verify__cell-label')).toHaveText(
    'QUADAS-3 フロー図（mermaid）',
  );
  const toggle = page.locator('#verify-focus-detail .verify__mermaid-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toHaveAttribute('open', '');

  // 開くと mermaid の遅延チャンク（dist/chunks/）がロードされ、SVG が描画される
  await toggle.locator('summary').click();
  await expect(toggle).toHaveAttribute('open', '');
  await expect(page.locator('.verify__mermaid-preview svg')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.verify__mermaid-error')).toHaveCount(0);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('flow 図（mermaid）プレビュー: 構文エラーはメッセージへフォールバックし、編集保存は警告のみでブロックしない（issue #109）', async ({
  page,
}) => {
  const badFlowEvidence = [
    'ev-flow-bad', 'run-1', 'study-1', 'f-flow', 'doc-1', '-', 'not a mermaid diagram', 'FALSE',
    QUOTE, '1', 'high', 'exact',
  ];
  const { appendUrls } = await setupRoutes(page, {
    schemaRows: [FLOW_FIELD_ROW],
    evidenceRows: [badFlowEvidence],
  });
  await initApp(page, '#/verify?study=study-1');
  await expect(page.locator('.verify__panes')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#verify-focus-detail .verify__cell-label')).toHaveText(
    'QUADAS-3 フロー図（mermaid）',
  );

  // 開く → 構文エラーのフォールバック表示（ソーステキスト = AI 値の表示は従来どおり残る）
  const toggle = page.locator('#verify-focus-detail .verify__mermaid-toggle');
  await toggle.locator('summary').click();
  await expect(page.locator('.verify__mermaid-error')).toContainText(
    'mermaid の構文エラーのため描画できません', { timeout: 15_000 },
  );
  await expect(page.locator('#verify-focus-detail .verify__ai-value')).toHaveText(
    'not a mermaid diagram',
  );

  // 編集保存: 構文エラーでも保存はブロックされず（Decisions 追記 + 判定チップ更新）、警告だけが出る
  await page.locator('#verify-focus-detail .verify__action--edit').click();
  await page.locator('.verify__edit-input').fill('still not mermaid');
  await page.locator('.verify__edit-confirm').click();
  await expect(page.locator('#verify-focus-detail .verify__chip')).toHaveText('修正');
  await expect(page.locator('.verify__mermaid-warning')).toContainText(
    'mermaid の構文エラーがあります', { timeout: 15_000 },
  );
  await expect
    .poll(() => appendUrls.filter((url) => url.includes('Decisions') && url.includes(':append')).length)
    .toBeGreaterThan(0);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
