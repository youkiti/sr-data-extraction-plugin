// #/pilot（S6）のルート別 E2E（test-strategy.md §3 フェーズ 2 + ui-states.md §3）。
// 状態は __E2E_PRELOADED_STATE__ で注入し、Sheets / Drive / Gemini は page.route で stub する。
// 実行フローでは最小構成の実 PDF（テキスト層つき 1 ページ）を Drive stub から配信し、
// 埋め込み検証 UI（S8 と同じ verificationPanel）の canvas 描画・ハイライト・判定まで通す
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SHEET_HEADERS } from '../../src/domain/sheetsSchema';

const QUOTE = 'Mortality was 12 percent';

// v0.10: 1 文書 = 1 study。document は study_id + document_role を持つ（study_label は Studies へ移設）
const DOCUMENT = {
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
};

const NO_TEXT_DOCUMENT = {
  ...DOCUMENT,
  documentId: 'doc-2',
  studyId: 'study-2',
  filename: 'scan.pdf',
  textRef: null,
  textStatus: 'no_text_layer',
};

const PROTOCOL_HEADERS = [
  'version', 'framework_type', 'research_question', 'inclusion_criteria', 'exclusion_criteria',
  'study_design', 'block_count', 'combination_expression', 'source_type', 'source_filename',
  'raw_text_ref', 'raw_text_preview', 'raw_text_inline', 'created_at', 'created_by',
];

const PROTOCOL_ROW = [
  '1', '', '', '', '', '', '0', '', 'manual', '', '', 'P: 成人肺炎', 'P: 成人肺炎',
  '2026-07-01T00:00:00Z', 'e2e@example.com',
];

const DECISIONS_HEADERS = [...SHEET_HEADERS.Decisions];

const STUDY_DATA_HEADERS = [...SHEET_HEADERS.StudyData];

const RESULTS_DATA_HEADERS = [...SHEET_HEADERS.ResultsData];

/** テキスト層つきの最小 1 ページ PDF（Helvetica 埋め込みなし・非圧縮） */
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

interface PilotStatePatch {
  [key: string]: unknown;
}

async function initApp(
  page: Page,
  options: {
    pilot?: PilotStatePatch;
    documents?: Record<string, unknown>[];
    apiKey?: string;
  } = {},
): Promise<void> {
  await page.addInitScript(
    ({ pilot, documents, apiKey }) => {
      const win = window as unknown as Record<string, unknown>;
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
          documents: documents.length,
          protocolVersions: 1,
          schemaVersions: 1,
          pilotRuns: 0,
          evidenceRows: 0,
          dataRows: 0,
        },
        documents: {
          records: documents,
          studies: documents.map((doc) => ({
            studyId: doc.studyId,
            studyLabel: doc.filename,
            registrationId: null,
            createdAt: '2026-07-01T00:00:00Z',
            createdBy: 'e2e@example.com',
            note: null,
          })),
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
        schema: {
          versions: [
            {
              schemaVersion: 1,
              parentVersion: null,
              protocolVersion: 1,
              createdByType: 'user_edit',
              createdAt: '2026-07-01T00:00:00Z',
              createdBy: 'e2e@example.com',
              note: null,
            },
          ],
          currentFields: [
            {
              schemaVersion: 1,
              fieldId: 'f-total',
              fieldIndex: 1,
              section: 'results',
              fieldName: 'mortality_pct',
              fieldLabel: '死亡率',
              entityLevel: 'study',
              dataType: 'text',
              unit: null,
              allowedValues: null,
              required: true,
              extractionInstruction: 'Report overall mortality.',
              example: null,
              aiGenerated: false,
              note: null,
            },
          ],
          loading: false,
          loadError: null,
          drafting: false,
          draftElapsedSeconds: 0,
          draftError: null,
          selectedDocumentIds: [],
          model: '',
          editorRows: null,
          editorErrors: [],
          editorOrigin: 'user_edit',
          confirming: false,
        },
        pilot,
      };
    },
    {
      pilot: {
        selectionInitialized: true,
        selectedStudyIds: ['study-1'],
        model: 'gemini-test',
        // 既定は履歴読込済み扱い（ExtractionRuns への実ネットワーク読込を抑止）。
        // 履歴復元シナリオのテストだけが history: null を渡して実読込を通す
        history: [],
        historyInitialized: true,
        ...(options.pilot ?? {}),
      },
      documents: options.documents ?? [DOCUMENT, NO_TEXT_DOCUMENT],
      apiKey: options.apiKey ?? null,
    },
  );
  await page.goto('/app/app.html#/pilot');
}

test('未実行: 文献セレクタ（no_text_layer は既定選択されないが選択可）+ コスト概算 + API キー未設定エラー', async ({ page }) => {
  await initApp(page);

  await expect(page.locator('#pilot-documents > li')).toHaveCount(2);
  const checkboxes = page.locator('#pilot-documents input[type="checkbox"]');
  await expect(checkboxes.nth(0)).toBeChecked();
  // パイロットの既定選択はテキスト層あり優先のまま（変更なし）だが、
  // pdf_native 対応によりテキスト層なし study も手動選択できる（無効化しない）
  await expect(checkboxes.nth(1)).not.toBeChecked();
  await expect(checkboxes.nth(1)).toBeEnabled();
  await expect(page.locator('.pilot__doc-note').first()).toContainText(
    'テキスト層なし: ページ画像を LLM へ送信して抽出します',
  );

  // 注入した非カタログモデル（gemini-test）は「その他（直接入力）」+ テキスト充填で復元される
  await expect(page.locator('#pilot-model')).toHaveValue('__other__');
  await expect(page.locator('#pilot-model-custom')).toBeVisible();
  await expect(page.locator('#pilot-model-custom')).toHaveValue('gemini-test');

  // コスト概算（単価表にないモデル → 概算不可 + トークン数）
  await expect(page.locator('#pilot-estimate')).toContainText('概算不可（単価表にないモデル）');
  await expect(page.locator('#pilot-estimate')).toContainText('1 バッチ');

  // API キー未設定 → インラインエラー（ui-states.md §3）
  await page.locator('#pilot-run').click();
  await expect(page.locator('#pilot-run-error')).toContainText('Gemini API キーが未設定です');

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('実行 → 完了 → 埋め込み検証 UI（ハイライト + 判定 + Decisions 追記）', async ({ page }) => {
  const appendUrls: string[] = [];

  // Sheets: 読み出しはタブ別ヘッダ、書き込みは記録のみ
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (route.request().method() === 'GET') {
      if (url.includes('Protocol')) {
        await route.fulfill({ json: { values: [PROTOCOL_HEADERS, PROTOCOL_ROW] } });
      } else if (url.includes('Decisions')) {
        await route.fulfill({ json: { values: [DECISIONS_HEADERS] } });
      } else if (url.includes('StudyData')) {
        await route.fulfill({ json: { values: [STUDY_DATA_HEADERS] } });
      } else if (url.includes('ResultsData')) {
        await route.fulfill({ json: { values: [RESULTS_DATA_HEADERS] } });
      } else if (url.includes('values:batchGet') && url.includes('Evidence')) {
        // Evidence タブのヘッダ拡張チェック（ensureEvidenceBboxColumns。§7.4 PR3）。
        // 既にフルヘッダ（bbox 5 列込み）が書かれている想定にして拡張 PUT を no-op にする
        await route.fulfill({
          json: { valueRanges: [{ values: [[...SHEET_HEADERS.Evidence]] }] },
        });
      } else if (url.includes('values:batchGet') && url.includes('ExtractionRuns')) {
        // ExtractionRuns タブのヘッダ拡張チェック（ensureRunFieldIdsColumn。issue #80）。
        // 既にフルヘッダ（field_ids 込み 15 列）が書かれている想定にして拡張 PUT を no-op にする
        await route.fulfill({
          json: { valueRanges: [{ values: [[...SHEET_HEADERS.ExtractionRuns]] }] },
        });
      } else {
        await route.fulfill({ json: { values: [] } });
      }
      return;
    }
    appendUrls.push(url);
    await route.fulfill({ json: {} });
  });

  // Drive: フォルダ解決 / extracted_texts / PDF 実体 / ログ保存
  await page.route('https://www.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (url.includes('/upload/drive/v3/files')) {
      await route.fulfill({ json: { id: 'log-1', webViewLink: 'https://drive.example/log-1' } });
      return;
    }
    if (url.includes('/drive/v3/files?q=')) {
      const name = /name = '([^']+)'/.exec(url)?.[1] ?? 'folder';
      await route.fulfill({
        json: { files: [{ id: `${name}-id`, webViewLink: `https://drive.example/${name}` }] },
      });
      return;
    }
    if (url.includes('/drive/v3/files/txt-1?alt=media')) {
      await route.fulfill({ contentType: 'text/plain', body: QUOTE });
      return;
    }
    if (url.includes('/drive/v3/files/drive-1?alt=media')) {
      await route.fulfill({ contentType: 'application/pdf', body: minimalPdf(QUOTE) });
      return;
    }
    await route.fulfill({ json: {} });
  });

  // Gemini: 構造化出力（extract-data skill の応答）
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    await route.fulfill({
      json: {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    {
                      field_id: 'f-total',
                      entity_key: '-',
                      value: '12',
                      not_reported: false,
                      quote: QUOTE,
                      page: 1,
                      confidence: 'high',
                    },
                  ]),
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
        modelVersion: 'gemini-test-001',
      },
    });
  });

  await initApp(page, { apiKey: 'e2e-api-key' });

  await page.locator('#pilot-run').click();

  // 完了: サマリ + 再パイロット導線
  await expect(page.locator('#pilot-run-done')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#pilot-revise-schema')).toHaveAttribute('href', '#/schema');

  // 埋め込み検証 UI: 2 ペイン + タブ + セル + 未検証チップ（フォーカスモードの詳細ストリップに
  // スコープする。判定チップは matrix ボタン / 詳細ストリップの 2 箇所に出るため）
  await expect(page.locator('.verify__panes')).toBeVisible();
  await expect(page.locator('.verify__tab--active')).toHaveText('Study');
  await expect(page.locator('.verify__cell-label')).toHaveText('死亡率');
  await expect(page.locator('#verify-focus-detail .verify__chip')).toHaveText('未検証');

  // PDF ビューア: canvas 描画 + quote ハイライト（overlay DOM の存在で検証。test-strategy.md §2.2）
  await expect(page.locator('.pdf-viewer__page-indicator')).toHaveText('1 / 1 ページ');
  await expect(page.locator('.pdf-viewer__hl--unverified')).toHaveCount(1, { timeout: 15_000 });

  // 判定: 承認 → チップ更新 + ハイライトが検証済み色 + Decisions 追記
  await page.locator('.verify__action--accept').click();
  await expect(page.locator('#verify-focus-detail .verify__chip')).toHaveText('承認');
  await expect(page.locator('.pdf-viewer__hl--verified')).toHaveCount(1);
  await expect
    .poll(() => appendUrls.filter((url) => url.includes('Decisions') && url.includes(':append')).length)
    .toBeGreaterThan(0);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('履歴からの復元: 過去のパイロット結果を自動読込 → 検証 UI が戻る', async ({ page }) => {
  const EXTRACTION_RUNS_HEADERS = [...SHEET_HEADERS.ExtractionRuns];
  // study_ids 列（4 列目）= study-1（doc-1 の所属試験）。読み手は studyIds → documents へ写像する
  const RUN_ROW = [
    'run-1', 'pilot', '1', 'study-1', 'gemini', 'gemini-test', 'gemini-test-001', 'text_only',
    'done', '2026-07-05T00:00:00Z', '2026-07-05T00:01:00Z', '100', '20', '0.01',
  ];
  const EVIDENCE_HEADERS = [...SHEET_HEADERS.Evidence];
  // Evidence は study_id（col 3）+ document_id（col 5）の 2 キー構成
  const EVIDENCE_ROW = ['ev-1', 'run-1', 'study-1', 'f-total', 'doc-1', '-', '12', 'FALSE', QUOTE, '1', 'high', 'exact'];
  const SCHEMA_FIELDS_HEADERS = [
    'schema_version', 'field_id', 'field_index', 'section', 'field_name', 'field_label',
    'entity_level', 'data_type', 'unit', 'allowed_values', 'required', 'extraction_instruction',
    'example', 'ai_generated', 'note',
  ];
  const SCHEMA_FIELD_ROW = [
    '1', 'f-total', '1', 'results', 'mortality_pct', '死亡率', 'study', 'text', '', '', 'TRUE',
    'Report overall mortality.', '', 'FALSE', '',
  ];
  const ARM_STRUCTURES_HEADERS = [...SHEET_HEADERS.ArmStructures];

  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (route.request().method() !== 'GET') {
      await route.fulfill({ json: {} });
      return;
    }
    if (url.includes('ExtractionRuns')) {
      await route.fulfill({ json: { values: [EXTRACTION_RUNS_HEADERS, RUN_ROW] } });
    } else if (url.includes('Evidence')) {
      await route.fulfill({ json: { values: [EVIDENCE_HEADERS, EVIDENCE_ROW] } });
    } else if (url.includes('SchemaFields')) {
      await route.fulfill({ json: { values: [SCHEMA_FIELDS_HEADERS, SCHEMA_FIELD_ROW] } });
    } else if (url.includes('Decisions')) {
      await route.fulfill({ json: { values: [DECISIONS_HEADERS] } });
    } else if (url.includes('StudyData')) {
      await route.fulfill({ json: { values: [STUDY_DATA_HEADERS] } });
    } else if (url.includes('ResultsData')) {
      await route.fulfill({ json: { values: [RESULTS_DATA_HEADERS] } });
    } else if (url.includes('ArmStructures')) {
      await route.fulfill({ json: { values: [ARM_STRUCTURES_HEADERS] } });
    } else {
      await route.fulfill({ json: { values: [] } });
    }
  });

  await page.route('https://www.googleapis.com/**', async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (url.includes('/drive/v3/files/txt-1?alt=media')) {
      await route.fulfill({ contentType: 'text/plain', body: QUOTE });
      return;
    }
    if (url.includes('/drive/v3/files/drive-1?alt=media')) {
      await route.fulfill({ contentType: 'application/pdf', body: minimalPdf(QUOTE) });
      return;
    }
    if (url.includes('/drive/v3/files?q=')) {
      const name = /name = '([^']+)'/.exec(url)?.[1] ?? 'folder';
      await route.fulfill({
        json: { files: [{ id: `${name}-id`, webViewLink: `https://drive.example/${name}` }] },
      });
      return;
    }
    await route.fulfill({ json: {} });
  });

  // history: null で入場 → loadPilotHistory（readPilotRuns）→ 最新 run の自動読込を通す
  await initApp(page, { pilot: { history: null, historyInitialized: false, run: null } });

  // 履歴一覧 + 自動読込で結果サマリ・検証 UI が復元される（「最初から」にならない）
  await expect(page.locator('#pilot-run-done')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#pilot-history li')).toHaveCount(1);
  await expect(page.locator('.pilot__history-current')).toHaveText('表示中');
  await expect(page.locator('.verify__panes')).toBeVisible();
  await expect(page.locator('.verify__cell-label')).toHaveText('死亡率');
  await expect(page.locator('.pdf-viewer__hl--unverified')).toHaveCount(1, { timeout: 15_000 });

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
