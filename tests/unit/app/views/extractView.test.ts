import { renderExtractView } from '../../../../src/app/views/extractView';
import type { ExtractViewCallbacks, ViewContext } from '../../../../src/app/views/types';
import { createInitialState, type AppState, type ExtractState } from '../../../../src/app/store';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { ExtractionRun } from '../../../../src/domain/extractionRun';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { ExtractDocRow } from '../../../../src/features/extraction/docProgress';
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
    onToggleDocument: jest.fn(),
    onChangeModel: jest.fn(),
    onRequestRun: jest.fn(),
    onConfirmRun: jest.fn(),
    onCancelConfirm: jest.fn(),
    onRetryDocument: jest.fn(),
    onReloadTargets: jest.fn(),
  };
  return {
    ctx: {
      home: { onReload: jest.fn() },
      documents: { onImport: jest.fn(), onReload: jest.fn(), onSaveStudyLabel: jest.fn() },
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
        onToggleDocument: jest.fn(),
        onChangeModel: jest.fn(),
        onRun: jest.fn(),
        onSelectRun: jest.fn(),
        onReloadHistory: jest.fn(),
        onSelectVerifyDocument: jest.fn(),
        onRetryVerifyLoad: jest.fn(),
        onDecision: jest.fn(),
        onArmConfirm: jest.fn(),
      },
      extract: callbacks,
      verify: {
        onSelectDocument: jest.fn(),
        onRetryLoad: jest.fn(),
        onDecision: jest.fn(),
        onArmConfirm: jest.fn(),
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
  return {
    documentId: 'doc-1',
    studyLabel: 'Smith 2020',
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
    documentIds: ['doc-1'],
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

function makeDocRow(
  overrides: Partial<ExtractDocRow> & Pick<ExtractDocRow, 'documentId' | 'status'>,
): ExtractDocRow {
  return { completedBatches: 0, totalBatches: 1, detail: null, ...overrides };
}

function makeState(
  options: {
    documents?: DocumentRecord[] | null;
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
  state.documents = {
    ...state.documents,
    records: options.documents === undefined ? [makeDocument()] : options.documents,
    loading: options.documentsLoading ?? false,
    loadError: options.documentsError ?? null,
  };
  state.schema = {
    ...state.schema,
    currentFields: options.fields === undefined ? [makeField()] : options.fields,
  };
  state.extract = {
    ...state.extract,
    extractedDocumentIds: [],
    selectedDocumentIds: ['doc-1'],
    model: 'gemini-test',
    ...(options.extract ?? {}),
  };
  return state;
}

function render(state: AppState): { root: HTMLElement; callbacks: jest.Mocked<ExtractViewCallbacks> } {
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
      makeState({ extract: { extractedDocumentIds: null } }),
      makeState({ extract: { extractedDocumentIds: null, loading: true } }),
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

  test('中断 run の残り文献があるときは中断バナー（再抽出済みは数えず、実行中は出さない）', () => {
    const interrupted = render(
      makeState({ extract: { interruptedDocumentIds: ['doc-1', 'doc-2'] } }),
    );
    expect(
      interrupted.root.querySelector('#extract-interrupted-warning')?.textContent,
    ).toContain('前回の抽出が途中で中断されています（未完了 2 件）');

    // 別 run で再抽出済みの文献は未完了に数えない
    const partiallyRecovered = render(
      makeState({
        extract: { interruptedDocumentIds: ['doc-1', 'doc-2'], extractedDocumentIds: ['doc-1'] },
      }),
    );
    expect(
      partiallyRecovered.root.querySelector('#extract-interrupted-warning')?.textContent,
    ).toContain('未完了 1 件');

    // 全件再抽出済みならバナーは消える
    const recovered = render(
      makeState({
        extract: { interruptedDocumentIds: ['doc-1'], extractedDocumentIds: ['doc-1'] },
      }),
    );
    expect(recovered.root.querySelector('#extract-interrupted-warning')).toBeNull();

    // 実行中（再開の実行を開始した後）は出さない
    const running = render(
      makeState({ extract: { interruptedDocumentIds: ['doc-1'], running: true } }),
    );
    expect(running.root.querySelector('#extract-interrupted-warning')).toBeNull();
  });

  test('文献 0 件は案内文', () => {
    const { root } = render(makeState({ documents: [] }));
    expect(root.querySelector('#extract-documents-empty')?.textContent).toContain(
      'まだ文献がありません',
    );
  });

  test('チェックリスト: 選択状態・抽出済みバッジ・no_text_layer は選択不可 + 切替コールバック', () => {
    const docs = [
      makeDocument(),
      makeDocument({ documentId: 'doc-2', filename: 'done.pdf' }),
      makeDocument({ documentId: 'doc-3', filename: 'scan.pdf', textStatus: 'no_text_layer' }),
    ];
    const { root, callbacks } = render(
      makeState({ documents: docs, extract: { extractedDocumentIds: ['doc-2'] } }),
    );
    const checkboxes = root.querySelectorAll<HTMLInputElement>(
      '#extract-documents input[type="checkbox"]',
    );
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes[0]?.checked).toBe(true);
    expect(checkboxes[1]?.checked).toBe(false);
    expect(checkboxes[2]?.disabled).toBe(true);
    expect(root.querySelectorAll('.extract__doc-extracted')).toHaveLength(1);
    expect(root.querySelector('.extract__doc-note')?.textContent).toContain('テキスト層なし');

    checkboxes[1]!.click();
    expect(callbacks.onToggleDocument).toHaveBeenCalledWith('doc-2', true);
  });

  test('モデル変更・実行ボタンのコールバック + インラインエラー表示', () => {
    const { root, callbacks } = render(
      makeState({ extract: { runError: 'モデルを選択してください（「その他」で直接入力も可）' } }),
    );
    // 「その他」の直接入力は trim してコールバックへ渡る（modelSelect ウィジェット）
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

  test('コスト概算: 選択 0 本は案内、選択ありは planRun の結果と警告を出す', () => {
    const empty = render(makeState({ extract: { selectedDocumentIds: [] } }));
    expect(empty.root.querySelector('#extract-estimate')?.textContent).toContain(
      '対象文献を選択すると表示されます',
    );

    const docs = [makeDocument(), makeDocument({ documentId: 'doc-2', textStatus: 'no_text_layer' })];
    const { root } = render(
      makeState({ documents: docs, extract: { selectedDocumentIds: ['doc-1', 'doc-2'] } }),
    );
    const estimate = root.querySelector('#extract-estimate');
    expect(estimate?.textContent).toContain('概算不可（単価表にないモデル）');
    expect(estimate?.textContent).toContain('1 バッチ');
    expect(estimate?.textContent).toContain('注意:'); // no_text_layer スキップの warning
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
      '対象文献を選択すると表示されます',
    );

    planRunMock.mockImplementation(() => {
      throw new Error('概算バグ');
    });
    const { root } = render(makeState({}));
    expect(root.querySelector('#extract-estimate')?.textContent).toContain(
      'コスト概算を計算できません: 概算バグ',
    );

    // Error 以外の throw も文字列化して表示する
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
    expect(card?.textContent).toContain('対象 1 件をモデル gemini-test で抽出します。');
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
  test('progress 未着は準備中、着信後はバッチ進捗 + document 進捗リスト。setup は出さない', () => {
    const preparing = render(makeState({ extract: { running: true, progress: null } }));
    expect(preparing.root.querySelector('.extract__progress-text')?.textContent).toBe(
      '実行準備中…',
    );
    // docRows 未着（準備中）は文献サマリも出さない
    expect(preparing.root.querySelector('#extract-doc-summary')).toBeNull();
    expect(preparing.root.querySelector('#extract-run')).toBeNull();

    const { root } = render(
      makeState({
        extract: {
          running: true,
          progress: {
            totalBatches: 4,
            completedBatches: 1,
            documentId: 'doc-1',
            section: null,
            failure: null,
          },
          docRows: [
            makeDocRow({
              documentId: 'doc-1',
              status: 'running',
              completedBatches: 1,
              totalBatches: 2,
            }),
            makeDocRow({ documentId: 'doc-x', status: 'queued', totalBatches: 2 }),
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

    // 全体の中の現在位置: 文献サマリ + 処理中の文献（i 本目 + 文献内バッチ進捗）
    expect(root.querySelector('#extract-doc-summary')?.textContent).toBe('文献: 完了 0 / 全 2 本');
    expect(root.querySelector('#extract-current-doc')?.textContent).toBe(
      '処理中: Smith 2020（1 本目・バッチ 1/2）',
    );

    const rows = root.querySelectorAll('#extract-doc-list .extract__doc-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('実行中');
    expect(rows[0]?.textContent).toContain('Smith 2020'); // study_label 解決
    expect(rows[0]?.classList.contains('extract__doc-row--running')).toBe(true);
    expect(rows[0]?.querySelector('.extract__doc-batches')?.textContent).toBe('バッチ 1/2');
    expect(rows[1]?.textContent).toContain('待機中');
    expect(rows[1]?.textContent).toContain('doc-x'); // 未知 document は id 表示
    expect(rows[1]?.querySelector('.extract__doc-batches')).toBeNull(); // 待機中は併記しない
    // 実行中は再試行ボタンを出さない
    expect(root.querySelector('.extract__retry')).toBeNull();
  });

  test('失敗行があれば文献サマリに失敗数を併記し、running 行がなければ処理中は出さない', () => {
    const { root } = render(
      makeState({
        extract: {
          running: true,
          progress: {
            totalBatches: 4,
            completedBatches: 2,
            documentId: 'doc-2',
            section: null,
            failure: null,
          },
          docRows: [
            makeDocRow({
              documentId: 'doc-1',
              status: 'done',
              completedBatches: 1,
              totalBatches: 1,
            }),
            makeDocRow({
              documentId: 'doc-2',
              status: 'failed',
              completedBatches: 1,
              detail: 'api_error（500）',
            }),
            makeDocRow({ documentId: 'doc-3', status: 'queued', totalBatches: 2 }),
          ],
        },
      }),
    );
    expect(root.querySelector('#extract-doc-summary')?.textContent).toBe(
      '文献: 完了 1 / 失敗 1 / 全 3 本',
    );
    expect(root.querySelector('#extract-current-doc')).toBeNull();
  });

  test('総バッチ数 0 の progress は 0% 表示、総数 0 の running 行はバッチ併記なし（再試行プレースホルダ）', () => {
    const { root } = render(
      makeState({
        extract: {
          running: true,
          progress: {
            totalBatches: 0,
            completedBatches: 0,
            documentId: 'doc-1',
            section: null,
            failure: null,
          },
          docRows: [
            makeDocRow({ documentId: 'doc-1', status: 'running', totalBatches: 0 }),
          ],
        },
      }),
    );
    expect(root.querySelector('.extract__progress-text')?.textContent).toBe(
      '0 / 0 バッチ完了（0%）',
    );
    expect(root.querySelector('.extract__doc-batches')).toBeNull();
    expect(root.querySelector('#extract-current-doc')?.textContent).toBe(
      '処理中: Smith 2020（1 本目・バッチ 0/0）',
    );
  });
});

describe('完了サマリ', () => {
  test('done は完了メッセージ + 検証への導線（破棄があれば注記）', () => {
    const { root } = render(
      makeState({
        extract: {
          run: makeRun(),
          docRows: [makeDocRow({ documentId: 'doc-1', status: 'done' })],
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
    // 完了後は setup も再表示して再実行できる
    expect(root.querySelector('#extract-run')).not.toBeNull();
  });

  test('破棄 0 件の done は注記を出さない', () => {
    const { root } = render(
      makeState({
        extract: {
          run: makeRun(),
          docRows: [makeDocRow({ documentId: 'doc-1', status: 'done' })],
          rejectedCount: 0,
        },
      }),
    );
    expect(root.querySelector('.extract__rejected-note')).toBeNull();
  });

  test('partial_failure は黄バナー + 失敗行の再試行ボタン（詳細つき）', () => {
    const { root, callbacks } = render(
      makeState({
        extract: {
          run: makeRun({ status: 'partial_failure' }),
          docRows: [
            makeDocRow({ documentId: 'doc-1', status: 'done' }),
            makeDocRow({ documentId: 'doc-2', status: 'failed', detail: 'api_error（500）' }),
          ],
          rejectedCount: 1,
        },
      }),
    );
    const banner = root.querySelector('#extract-partial-failure');
    expect(banner?.textContent).toContain('1 件の文献で失敗しました。再試行できます');
    expect(banner?.textContent).toContain('応答要素の破棄: 1 件');
    expect(root.querySelector('.extract__doc-detail')?.textContent).toBe('api_error（500）');

    const retry = root.querySelector<HTMLButtonElement>('.extract__retry');
    expect(retry?.disabled).toBe(false);
    retry?.click();
    expect(callbacks.onRetryDocument).toHaveBeenCalledWith('doc-2');
  });

  test('再試行中は再試行・実行ボタンとも無効化する', () => {
    const { root } = render(
      makeState({
        extract: {
          run: makeRun({ status: 'partial_failure' }),
          docRows: [
            makeDocRow({ documentId: 'doc-1', status: 'running' }),
            makeDocRow({ documentId: 'doc-2', status: 'failed', detail: 'api_error（500）' }),
          ],
          retryingDocumentId: 'doc-1',
        },
      }),
    );
    expect(root.querySelector<HTMLButtonElement>('.extract__retry')?.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('#extract-run')?.disabled).toBe(true);
  });
});
