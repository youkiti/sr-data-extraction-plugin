import { renderExtractView } from '../../../../src/app/views/extractView';
import type { ExtractViewCallbacks, ViewContext } from '../../../../src/app/views/types';
import { createInitialState, type AppState, type ExtractState } from '../../../../src/app/store';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { ExtractionRun } from '../../../../src/domain/extractionRun';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { StudyRecord } from '../../../../src/domain/study';
import type { ExtractStudyRow } from '../../../../src/features/extraction/studyProgress';
import { planRun } from '../../../../src/features/extraction/planRun';

jest.mock('../../../../src/features/extraction/planRun', () => {
  const actual = jest.requireActual<typeof import('../../../../src/features/extraction/planRun')>(
    '../../../../src/features/extraction/planRun',
  );
  return { ...actual, planRun: jest.fn(actual.planRun) };
});

const planRunMock = planRun as jest.MockedFunction<typeof planRun>;

function makeCtx(): { ctx: ViewContext; callbacks: jest.Mocked<ExtractViewCallbacks> } {
  const callbacks = {
    onToggleStudy: jest.fn(),
    onChangeModel: jest.fn(),
    onRequestRun: jest.fn(),
    onConfirmRun: jest.fn(),
    onCancelConfirm: jest.fn(),
    onRetryStudy: jest.fn(),
    onReloadTargets: jest.fn(),
  };
  return {
    ctx: {
      home: { onReload: jest.fn() },
      documents: {
        onImport: jest.fn(),
        onImportFiles: jest.fn(),
        onReload: jest.fn(),
        onSaveStudyLabel: jest.fn(),
        onSaveRegistrationId: jest.fn(),
        onSaveDocumentRole: jest.fn(),
        onToggleStudySelection: jest.fn(),
        onOpenMerge: jest.fn(),
        onOpenMergeCandidate: jest.fn(),
        onIgnoreCandidate: jest.fn(),
        onUpdateMergeLabel: jest.fn(),
        onUpdateMergeRegistration: jest.fn(),
        onConfirmMerge: jest.fn(),
        onCancelMerge: jest.fn(),
      },
      protocol: {
        onSubmit: jest.fn(),
        onStartEdit: jest.fn(),
        onCancelEdit: jest.fn(),
        onSelectVersion: jest.fn(),
        onReload: jest.fn(),
      },
      schema: {
        onReload: jest.fn(),
        onToggleSample: jest.fn(),
        onChangeModel: jest.fn(),
        onRunDraft: jest.fn(),
        onEditRow: jest.fn(),
        onAddRow: jest.fn(),
        onRemoveRow: jest.fn(),
        onInsertPreset: jest.fn(),
        onConfirm: jest.fn(),
        onCancelEditor: jest.fn(),
        onStartNewVersion: jest.fn(),
      },
      pilot: {
        onToggleStudy: jest.fn(),
        onChangeModel: jest.fn(),
        onRun: jest.fn(),
        onSelectRun: jest.fn(),
        onReloadHistory: jest.fn(),
        onSelectVerifyStudy: jest.fn(),
        onRetryVerifyLoad: jest.fn(),
        onDecision: jest.fn(),
        onArmConfirm: jest.fn(),
        onChangeLayoutMode: jest.fn(),
      },
      extract: callbacks,
      verify: {
        onSelectStudy: jest.fn(),
        onRetryLoad: jest.fn(),
        onDecision: jest.fn(),
        onArmConfirm: jest.fn(),
        onChangeLayoutMode: jest.fn(),
      },
      dashboard: { onReload: jest.fn() },
      export: {
        onSelectFormat: jest.fn(),
        onGenerate: jest.fn(),
        onConfirmGenerate: jest.fn(),
        onCancelGenerate: jest.fn(),
        onDownload: jest.fn(),
        onReload: jest.fn(),
      },
    },
    callbacks,
  };
}

function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  const documentId = overrides.documentId ?? 'doc-1';
  return {
    documentId,
    studyId: overrides.studyId ?? 'study-1',
    documentRole: 'article',
    driveFileId: 'drive-1',
    sourceFileId: 'src-1',
    filename: 'smith2020.pdf',
    pmid: null,
    doi: null,
    textRef: 'ref',
    textStatus: 'ok',
    pageCount: 10,
    charCount: 30000,
    importedAt: 't0',
    importedBy: 'me',
    note: null,
    ...overrides,
  };
}

function makeStudy(studyId: string, label = `試験-${studyId}`): StudyRecord {
  return {
    studyId,
    studyLabel: label,
    registrationId: null,
    createdAt: 't0',
    createdBy: 'me',
    note: null,
  };
}

/** documents から一意 study を導出する（既定 studies） */
function studiesFor(documents: readonly DocumentRecord[]): StudyRecord[] {
  return [...new Set(documents.map((d) => d.studyId))].map((id) => makeStudy(id));
}

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-1',
    fieldIndex: 1,
    section: 'methods',
    fieldName: 'sample_size_total',
    fieldLabel: '総サンプルサイズ',
    entityLevel: 'study',
    dataType: 'integer',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: '総 N を抽出',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

function makeRun(overrides: Partial<ExtractionRun> = {}): ExtractionRun {
  return {
    runId: 'run-1',
    runType: 'full',
    schemaVersion: 1,
    studyIds: ['study-1'],
    provider: 'gemini',
    requestedModel: 'gemini-test',
    modelVersion: null,
    inputMode: 'text_only',
    status: 'done',
    startedAt: 't1',
    finishedAt: 't2',
    tokensIn: null,
    tokensOut: null,
    costEstimate: null,
    ...overrides,
  };
}

function makeStudyRow(
  overrides: Partial<ExtractStudyRow> & Pick<ExtractStudyRow, 'studyId' | 'status'>,
): ExtractStudyRow {
  return { completedBatches: 0, totalBatches: 1, detail: null, ...overrides };
}

function makeState(
  options: {
    documents?: DocumentRecord[] | null;
    studies?: StudyRecord[] | null;
    documentsLoading?: boolean;
    documentsError?: string | null;
    fields?: SchemaField[] | null;
    pilotRuns?: number;
    extract?: Partial<ExtractState>;
  } = {},
): AppState {
  const state = createInitialState();
  state.currentProject = {
    projectId: 'p1',
    spreadsheetId: 's1',
    driveFolderId: 'f1',
    name: 'テスト SR',
  };
  state.counts = { ...state.counts, pilotRuns: options.pilotRuns ?? 1 };
  const records = options.documents === undefined ? [makeDocument()] : options.documents;
  const studies =
    options.studies !== undefined
      ? options.studies
      : records === null
        ? null
        : studiesFor(records);
  state.documents = {
    ...state.documents,
    records,
    studies,
    loading: options.documentsLoading ?? false,
    loadError: options.documentsError ?? null,
  };
  state.schema = {
    ...state.schema,
    currentFields: options.fields === undefined ? [makeField()] : options.fields,
  };
  state.extract = {
    ...state.extract,
    extractedStudyIds: [],
    selectedStudyIds: ['study-1'],
    model: 'gemini-test',
    ...(options.extract ?? {}),
  };
  return state;
}

function render(state: AppState): {
  root: HTMLElement;
  callbacks: jest.Mocked<ExtractViewCallbacks>;
} {
  const { ctx, callbacks } = makeCtx();
  const root = renderExtractView(state, ctx);
  document.body.replaceChildren(root);
  return { root, callbacks };
}

afterEach(() => {
  document.body.replaceChildren();
  planRunMock.mockClear();
});

describe('読み込み中 / 失敗', () => {
  test('文献・抽出済み run の読み込み中は #extract-loading を出す', () => {
    for (const state of [
      makeState({ documents: null }),
      makeState({ documentsLoading: true }),
      makeState({ extract: { extractedStudyIds: null } }),
      makeState({ extract: { extractedStudyIds: null, loading: true } }),
    ]) {
      const { root } = render(state);
      expect(root.querySelector('#extract-loading')?.textContent).toBe(
        '抽出対象を読み込んでいます…',
      );
      expect(root.querySelector('#extract-run')).toBeNull();
    }
  });

  test('読み込み失敗（documents / runs どちらでも）は #extract-load-error + 再読み込み', () => {
    const fromDocuments = render(makeState({ documentsError: 'ネットワークエラー' }));
    expect(fromDocuments.root.querySelector('#extract-load-error')?.textContent).toContain(
      'ネットワークエラー',
    );
    fromDocuments.root.querySelector<HTMLButtonElement>('#extract-reload')?.click();
    expect(fromDocuments.callbacks.onReloadTargets).toHaveBeenCalledTimes(1);

    const fromRuns = render(makeState({ extract: { loadError: 'runs 読めない' } }));
    expect(fromRuns.root.querySelector('#extract-load-error')?.textContent).toContain(
      'runs 読めない',
    );
  });
});

describe('未実行（setup）', () => {
  test('パイロット未実施は警告バナー、実施済みは出さない', () => {
    const warned = render(makeState({ pilotRuns: 0 }));
    expect(warned.root.querySelector('#extract-pilot-warning')?.textContent).toContain(
      'パイロット抽出を推奨します',
    );
    const ok = render(makeState({ pilotRuns: 2 }));
    expect(ok.root.querySelector('#extract-pilot-warning')).toBeNull();
  });

  test('中断 run の残り study があるときは中断バナー（再抽出済みは数えず、実行中は出さない）', () => {
    const interrupted = render(
      makeState({ extract: { interruptedStudyIds: ['study-1', 'study-2'] } }),
    );
    expect(interrupted.root.querySelector('#extract-interrupted-warning')?.textContent).toContain(
      '前回の抽出が途中で中断されています（未完了 2 件）',
    );

    const partiallyRecovered = render(
      makeState({
        extract: { interruptedStudyIds: ['study-1', 'study-2'], extractedStudyIds: ['study-1'] },
      }),
    );
    expect(
      partiallyRecovered.root.querySelector('#extract-interrupted-warning')?.textContent,
    ).toContain('未完了 1 件');

    const recovered = render(
      makeState({
        extract: { interruptedStudyIds: ['study-1'], extractedStudyIds: ['study-1'] },
      }),
    );
    expect(recovered.root.querySelector('#extract-interrupted-warning')).toBeNull();

    const running = render(
      makeState({ extract: { interruptedStudyIds: ['study-1'], running: true } }),
    );
    expect(running.root.querySelector('#extract-interrupted-warning')).toBeNull();
  });

  test('試験 0 件は案内文', () => {
    const { root } = render(makeState({ documents: [], studies: [] }));
    expect(root.querySelector('#extract-documents-empty')?.textContent).toContain(
      'まだ試験がありません',
    );
  });

  test('チェックリスト: 選択状態・抽出済みバッジ・テキスト層なし study も選択可（pdf_native 注記） + 切替コールバック', () => {
    const docs = [
      makeDocument({ documentId: 'doc-1', studyId: 'study-1' }),
      makeDocument({ documentId: 'doc-2', studyId: 'study-2', filename: 'done.pdf' }),
      makeDocument({
        documentId: 'doc-3',
        studyId: 'study-3',
        filename: 'scan.pdf',
        textStatus: 'no_text_layer',
      }),
    ];
    const { root, callbacks } = render(
      makeState({ documents: docs, extract: { extractedStudyIds: ['study-2'] } }),
    );
    const checkboxes = root.querySelectorAll<HTMLInputElement>(
      '#extract-studies input[type="checkbox"]',
    );
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes[0]?.checked).toBe(true);
    expect(checkboxes[1]?.checked).toBe(false);
    // pdf_native 対応によりテキスト層なし study も選択可（無効化しない）
    expect(checkboxes[2]?.disabled).toBe(false);
    expect(root.querySelectorAll('.extract__doc-extracted')).toHaveLength(1);
    expect(root.querySelector('.extract__doc-note')?.textContent).toContain(
      'テキスト層なし: ページ画像を LLM へ送信して抽出します',
    );
    // 配下文書のロール + ファイル名を表示
    expect(root.querySelector('.extract__doc-filename')?.textContent).toBe('smith2020.pdf');
    expect(root.querySelector('.extract__doc-role')?.textContent).toBe('本論文');

    checkboxes[1]!.click();
    expect(callbacks.onToggleStudy).toHaveBeenCalledWith('study-2', true);

    checkboxes[2]!.click();
    expect(callbacks.onToggleStudy).toHaveBeenCalledWith('study-3', true);
  });

  test('モデル変更・実行ボタンのコールバック + インラインエラー表示', () => {
    const { root, callbacks } = render(
      makeState({ extract: { runError: 'モデルを選択してください（「その他」で直接入力も可）' } }),
    );
    const model = root.querySelector<HTMLSelectElement>('#extract-model');
    model!.value = '__other__';
    model!.dispatchEvent(new Event('change'));
    const custom = root.querySelector<HTMLInputElement>('#extract-model-custom');
    custom!.value = ' gemini-x ';
    custom!.dispatchEvent(new Event('change'));
    expect(callbacks.onChangeModel).toHaveBeenCalledWith('gemini-x');

    expect(root.querySelector('#extract-run-error')?.textContent).toContain('モデルを選択');

    root.querySelector<HTMLButtonElement>('#extract-run')?.click();
    expect(callbacks.onRequestRun).toHaveBeenCalledTimes(1);
  });

  test('コスト概算: 選択 0 件は案内、選択ありは planRun の結果と警告を出す', () => {
    const empty = render(makeState({ extract: { selectedStudyIds: [] } }));
    expect(empty.root.querySelector('#extract-estimate')?.textContent).toContain(
      '対象 study を選択すると表示されます',
    );

    const docs = [
      makeDocument({ documentId: 'doc-1', studyId: 'study-1' }),
      makeDocument({
        documentId: 'doc-2',
        studyId: 'study-2',
        textStatus: 'no_text_layer',
      }),
    ];
    const { root } = render(
      makeState({ documents: docs, extract: { selectedStudyIds: ['study-1', 'study-2'] } }),
    );
    const estimate = root.querySelector('#extract-estimate');
    expect(estimate?.textContent).toContain('概算不可（単価表にないモデル）');
    // テキスト層なし study も pdf_native の画像入力バッチとして計画に含まれる（2 study = 2 バッチ）
    expect(estimate?.textContent).toContain('2 バッチ');
    expect(estimate?.textContent).toContain('注意:'); // pdf_native（画像入力）の warning
    expect(estimate?.textContent).toContain('プロトコル本文ぶんは概算に含まれません');
  });

  test('単価表にあるモデルは金額を表示し、モデル未入力は unknown で概算する', () => {
    const priced = render(makeState({ extract: { model: 'gemini-2.5-pro' } }));
    expect(priced.root.querySelector('#extract-estimate')?.textContent).toMatch(
      /コスト概算: \$\d+\.\d{4}/,
    );

    render(makeState({ extract: { model: '' } }));
    expect(planRunMock).toHaveBeenCalledWith(expect.objectContaining({ model: 'unknown' }));
  });

  test('スキーマ未読込は概算を出さず、planRun が例外を投げたらエラー表示', () => {
    const noFields = render(makeState({ fields: null }));
    expect(noFields.root.querySelector('#extract-estimate')?.textContent).toContain(
      '対象 study を選択すると表示されます',
    );

    planRunMock.mockImplementation(() => {
      throw new Error('概算バグ');
    });
    const { root } = render(makeState({}));
    expect(root.querySelector('#extract-estimate')?.textContent).toContain(
      'コスト概算を計算できません: 概算バグ',
    );

    planRunMock.mockImplementation(() => {
      throw '文字列エラー';
    });
    const nonError = render(makeState({}));
    expect(nonError.root.querySelector('#extract-estimate')?.textContent).toContain(
      'コスト概算を計算できません: 文字列エラー',
    );
  });
});

describe('実行確認カード', () => {
  test('confirming 中はカードを出し、実行 / キャンセルを委譲する。実行ボタンは無効', () => {
    const { root, callbacks } = render(makeState({ extract: { confirming: true } }));
    const card = root.querySelector('#extract-confirm');
    expect(card?.getAttribute('role')).toBe('alertdialog');
    expect(card?.textContent).toContain('対象 1 試験をモデル gemini-test で抽出します。');
    expect(root.querySelector<HTMLButtonElement>('#extract-run')?.disabled).toBe(true);

    root.querySelector<HTMLButtonElement>('#extract-confirm-run')?.click();
    expect(callbacks.onConfirmRun).toHaveBeenCalledTimes(1);
    root.querySelector<HTMLButtonElement>('#extract-confirm-cancel')?.click();
    expect(callbacks.onCancelConfirm).toHaveBeenCalledTimes(1);
  });

  test('confirming でなければカードは出さない', () => {
    const { root } = render(makeState({}));
    expect(root.querySelector('#extract-confirm')).toBeNull();
  });
});

describe('実行中', () => {
  test('progress 未着は準備中、着信後はバッチ進捗 + study 進捗リスト。setup は出さない', () => {
    const preparing = render(makeState({ extract: { running: true, progress: null } }));
    expect(preparing.root.querySelector('.extract__progress-text')?.textContent).toBe(
      '実行準備中…',
    );
    expect(preparing.root.querySelector('#extract-doc-summary')).toBeNull();
    expect(preparing.root.querySelector('#extract-run')).toBeNull();

    const { root } = render(
      makeState({
        // study-x は Studies に無い → ラベルは studyId フォールバックで表示される
        studies: [makeStudy('study-1', '試験A')],
        extract: {
          running: true,
          progress: {
            totalBatches: 4,
            completedBatches: 1,
            studyId: 'study-1',
            section: null,
            failure: null,
          },
          studyRows: [
            makeStudyRow({
              studyId: 'study-1',
              status: 'running',
              completedBatches: 1,
              totalBatches: 2,
            }),
            makeStudyRow({ studyId: 'study-x', status: 'queued', totalBatches: 2 }),
          ],
        },
      }),
    );
    expect(root.querySelector('.extract__progress-text')?.textContent).toBe(
      '1 / 4 バッチ完了（25%）',
    );
    const bar = root.querySelector<HTMLProgressElement>('#extract-progress');
    expect(bar?.max).toBe(4);
    expect(bar?.value).toBe(1);

    expect(root.querySelector('#extract-doc-summary')?.textContent).toBe('試験: 完了 0 / 全 2 件');
    expect(root.querySelector('#extract-current-doc')?.textContent).toBe(
      '処理中: 試験A（1 件目・バッチ 1/2）',
    );

    const rows = root.querySelectorAll('#extract-study-list .extract__doc-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('実行中');
    expect(rows[0]?.textContent).toContain('試験A'); // study_label で表示
    expect(rows[0]?.classList.contains('extract__doc-row--running')).toBe(true);
    expect(rows[0]?.querySelector('.extract__doc-batches')?.textContent).toBe('バッチ 1/2');
    expect(rows[1]?.textContent).toContain('待機中');
    expect(rows[1]?.textContent).toContain('study-x'); // Studies に無い → studyId 表示
    expect(rows[1]?.querySelector('.extract__doc-batches')).toBeNull();
    expect(root.querySelector('.extract__retry')).toBeNull();
  });

  test('失敗行があれば試験サマリに失敗数を併記し、running 行がなければ処理中は出さない', () => {
    const { root } = render(
      makeState({
        studies: [
          makeStudy('study-1'),
          makeStudy('study-2'),
          makeStudy('study-3'),
        ],
        extract: {
          running: true,
          progress: {
            totalBatches: 4,
            completedBatches: 2,
            studyId: 'study-2',
            section: null,
            failure: null,
          },
          studyRows: [
            makeStudyRow({
              studyId: 'study-1',
              status: 'done',
              completedBatches: 1,
              totalBatches: 1,
            }),
            makeStudyRow({
              studyId: 'study-2',
              status: 'failed',
              completedBatches: 1,
              detail: 'api_error（500）',
            }),
            makeStudyRow({ studyId: 'study-3', status: 'queued', totalBatches: 2 }),
          ],
        },
      }),
    );
    expect(root.querySelector('#extract-doc-summary')?.textContent).toBe(
      '試験: 完了 1 / 失敗 1 / 全 3 件',
    );
    expect(root.querySelector('#extract-current-doc')).toBeNull();
  });

  test('総バッチ数 0 の progress は 0% 表示、総数 0 の running 行はバッチ併記なし（再試行プレースホルダ）', () => {
    const { root } = render(
      makeState({
        studies: [makeStudy('study-1', '試験A')],
        extract: {
          running: true,
          progress: {
            totalBatches: 0,
            completedBatches: 0,
            studyId: 'study-1',
            section: null,
            failure: null,
          },
          studyRows: [makeStudyRow({ studyId: 'study-1', status: 'running', totalBatches: 0 })],
        },
      }),
    );
    expect(root.querySelector('.extract__progress-text')?.textContent).toBe(
      '0 / 0 バッチ完了（0%）',
    );
    expect(root.querySelector('.extract__doc-batches')).toBeNull();
    expect(root.querySelector('#extract-current-doc')?.textContent).toBe(
      '処理中: 試験A（1 件目・バッチ 0/0）',
    );
  });
});

describe('完了サマリ', () => {
  test('done は完了メッセージ + 検証への導線（破棄があれば注記）', () => {
    const { root } = render(
      makeState({
        extract: {
          run: makeRun(),
          studyRows: [makeStudyRow({ studyId: 'study-1', status: 'done' })],
          rejectedCount: 2,
        },
      }),
    );
    expect(root.querySelector('#extract-run-done')?.textContent).toBe('一括抽出が完了しました。');
    expect(root.querySelector('.extract__rejected-note')?.textContent).toContain(
      '応答要素の破棄: 2 件',
    );
    expect(root.querySelector('#extract-verify-link')?.getAttribute('href')).toBe('#/verify');
    expect(root.querySelector('#extract-partial-failure')).toBeNull();
    expect(root.querySelector('#extract-run')).not.toBeNull();
  });

  test('破棄 0 件の done は注記を出さない', () => {
    const { root } = render(
      makeState({
        extract: {
          run: makeRun(),
          studyRows: [makeStudyRow({ studyId: 'study-1', status: 'done' })],
          rejectedCount: 0,
        },
      }),
    );
    expect(root.querySelector('.extract__rejected-note')).toBeNull();
  });

  test('partial_failure は黄バナー + 失敗行の再試行ボタン（詳細つき）', () => {
    const { root, callbacks } = render(
      makeState({
        studies: [makeStudy('study-1'), makeStudy('study-2')],
        extract: {
          run: makeRun({ status: 'partial_failure' }),
          studyRows: [
            makeStudyRow({ studyId: 'study-1', status: 'done' }),
            makeStudyRow({ studyId: 'study-2', status: 'failed', detail: 'api_error（500）' }),
          ],
          rejectedCount: 1,
        },
      }),
    );
    const banner = root.querySelector('#extract-partial-failure');
    expect(banner?.textContent).toContain('1 件の試験で失敗しました。再試行できます');
    expect(banner?.textContent).toContain('応答要素の破棄: 1 件');
    expect(root.querySelector('.extract__doc-detail')?.textContent).toBe('api_error（500）');

    const retry = root.querySelector<HTMLButtonElement>('.extract__retry');
    expect(retry?.disabled).toBe(false);
    retry?.click();
    expect(callbacks.onRetryStudy).toHaveBeenCalledWith('study-2');
  });

  test('再試行中は再試行・実行ボタンとも無効化する', () => {
    const { root } = render(
      makeState({
        studies: [makeStudy('study-1'), makeStudy('study-2')],
        extract: {
          run: makeRun({ status: 'partial_failure' }),
          studyRows: [
            makeStudyRow({ studyId: 'study-1', status: 'running' }),
            makeStudyRow({ studyId: 'study-2', status: 'failed', detail: 'api_error（500）' }),
          ],
          retryingStudyId: 'study-1',
        },
      }),
    );
    expect(root.querySelector<HTMLButtonElement>('.extract__retry')?.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('#extract-run')?.disabled).toBe(true);
  });
});
