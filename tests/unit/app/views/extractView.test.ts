import { renderExtractView } from '../../../../src/app/views/extractView';
import type { ExtractViewCallbacks, ViewContext } from '../../../../src/app/views/types';
import { createInitialState, type AppState, type ExtractState } from '../../../../src/app/store';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { ExtractionRun } from '../../../../src/domain/extractionRun';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { StudyRecord } from '../../../../src/domain/study';
import type { ExtractStudyRow } from '../../../../src/features/extraction/studyProgress';
import { planRun } from '../../../../src/features/extraction/planRun';
import { setUiLanguage } from '../../../../src/lib/i18n';

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
    onToggleAllStudies: jest.fn(),
    onChangeModel: jest.fn(),
    onToggleField: jest.fn(),
    onToggleFieldSection: jest.fn(),
    onToggleFieldSectionCollapse: jest.fn(),
    onToggleHighAccuracyImages: jest.fn(),
    onRequestRun: jest.fn(),
    onConfirmRun: jest.fn(),
    onCancelConfirm: jest.fn(),
    onRetryStudy: jest.fn(),
    onReloadTargets: jest.fn(),
  };
  return {
    ctx: {
      home: {
    onReload: jest.fn(),
    onGrantFolderAccess: jest.fn(),
    onSkipMissingFiles: jest.fn(),
    onReloadReviewers: jest.fn(),
    onAddReviewer: jest.fn(),
    onConfirmReviewerChange: jest.fn(),
    onCancelReviewerChange: jest.fn(),
    onRevokeReviewer: jest.fn(),
    onCopyInvite: jest.fn(),
  },
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
        onTiabOpen: jest.fn(),
        onTiabClose: jest.fn(),
        onTiabPreview: jest.fn(),
        onTiabApply: jest.fn(),
        onTiabGrantAccess: jest.fn(),
        onTiabHandoffImport: jest.fn(),
        onTiabHandoffDismiss: jest.fn(),
        onOpenExcludeStudy: jest.fn(),
        onOpenExcludeDocument: jest.fn(),
        onUpdateExclusionDialog: jest.fn(),
        onCancelExclusion: jest.fn(),
        onConfirmExclusion: jest.fn(),
        onRestoreStudy: jest.fn(),
        onRestoreDocument: jest.fn(),
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
        onUpdatePresetDialog: jest.fn(),
        onConfirmPresetDialog: jest.fn(),
        onSkipPresetDialog: jest.fn(),
        onCancelPresetDialog: jest.fn(),
        onConfirm: jest.fn(),
        onCancelEditor: jest.fn(),
        onStartNewVersion: jest.fn(),
      },
      pilot: {
        onToggleStudy: jest.fn(),
        onChangeModel: jest.fn(),
        onToggleField: jest.fn(),
        onToggleFieldSection: jest.fn(),
        onToggleFieldSectionCollapse: jest.fn(),
        onToggleHighAccuracyImages: jest.fn(),
        onRun: jest.fn(),
        onSelectRun: jest.fn(),
        onReloadHistory: jest.fn(),
        onSelectVerifyStudy: jest.fn(),
        onRetryVerifyLoad: jest.fn(),
        onDecision: jest.fn(),
        onArmConfirm: jest.fn(),
        onChangeLayoutMode: jest.fn(),
        onReloadVerification: jest.fn(),
        onRelocateQuote: jest.fn(),
      },
      extract: callbacks,
      verify: {
        onSelectStudy: jest.fn(),
        onRetryLoad: jest.fn(),
        onDecision: jest.fn(),
        onArmConfirm: jest.fn(),
        onChangeLayoutMode: jest.fn(),
        onReloadVerification: jest.fn(),
        onRelocateQuote: jest.fn(),
      },
      dashboard: { onReload: jest.fn() },
      export: {
        onSelectFormat: jest.fn(),
        onGenerate: jest.fn(),
        onConfirmGenerate: jest.fn(),
        onCancelGenerate: jest.fn(),
        onDownload: jest.fn(),
        onReload: jest.fn(),
        onChangeMethodsLanguage: jest.fn(),
        onChangeMethodsWorkflow: jest.fn(),
        onCopyMethods: jest.fn(),
      },
      adjudicate: {
        onSelectStudy: jest.fn(),
        onBackToList: jest.fn(),
        onSelectPair: jest.fn(),
        onArmMappingChange: jest.fn(),
        onRetryLoad: jest.fn(),
        onArmDraftChange: jest.fn(),
        onArmDraftAdd: jest.fn(),
        onArmDraftRemove: jest.fn(),
        onConfirmArms: jest.fn(),
        onAcceptAllMatches: jest.fn(),
        onChooseA: jest.fn(),
        onChooseB: jest.fn(),
        onCustomValue: jest.fn(),
        onNotReported: jest.fn(),
        onSkip: jest.fn(),
        onUnskip: jest.fn(),
        onUndo: jest.fn(),
        onToggleMismatchOnly: jest.fn(),
        onLoadAgreement: jest.fn(),
        onDownloadAgreementCsv: jest.fn(),
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
    excluded: false,
    exclusionReason: null,
    exclusionNote: null,
    excludedAt: null,
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
    fieldIds: null,
    warnings: null,
    ...overrides,
  };
}

function makeStudyRow(
  overrides: Partial<ExtractStudyRow> & Pick<ExtractStudyRow, 'studyId' | 'status'>,
): ExtractStudyRow {
  return { completedBatches: 0, totalBatches: 1, detail: null, failureKind: null, ...overrides };
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

  describe('全選択/全解除トグル（issue #180）', () => {
    function docsFor(ids: string[]): DocumentRecord[] {
      return ids.map((studyId) => makeDocument({ documentId: `doc-${studyId}`, studyId }));
    }

    test('未抽出が一部だけ選択済みなら「未抽出をすべて選択」を表示し、click で未抽出 id + true を渡す', () => {
      const docs = docsFor(['study-1', 'study-2', 'study-3']);
      const { root, callbacks } = render(
        makeState({
          documents: docs,
          extract: {
            extractedStudyIds: ['study-3'],
            selectedStudyIds: ['study-1'], // study-2（未抽出）は未選択
          },
        }),
      );
      const toggle = root.querySelector<HTMLButtonElement>('#extract-studies-toggle');
      expect(toggle?.textContent).toBe('未抽出をすべて選択');
      toggle?.click();
      expect(callbacks.onToggleAllStudies).toHaveBeenCalledWith(['study-1', 'study-2'], true);
    });

    test('未抽出がすべて選択済みなら「全解除」を表示し、click で未抽出 id + false を渡す', () => {
      const docs = docsFor(['study-1', 'study-2', 'study-3']);
      const { root, callbacks } = render(
        makeState({
          documents: docs,
          extract: {
            extractedStudyIds: ['study-3'],
            selectedStudyIds: ['study-1', 'study-2'],
          },
        }),
      );
      const toggle = root.querySelector<HTMLButtonElement>('#extract-studies-toggle');
      expect(toggle?.textContent).toBe('全解除');
      toggle?.click();
      expect(callbacks.onToggleAllStudies).toHaveBeenCalledWith(['study-1', 'study-2'], false);
    });

    test('抽出済み study があるときは #extract-studies-note に件数を表示し、無いときは出さない', () => {
      const docs = docsFor(['study-1', 'study-2', 'study-3']);
      const withExtracted = render(
        makeState({
          documents: docs,
          extract: { extractedStudyIds: ['study-2', 'study-3'], selectedStudyIds: ['study-1'] },
        }),
      );
      expect(withExtracted.root.querySelector('#extract-studies-note')?.textContent).toBe(
        '抽出済みの 2 件は全選択に含まれません',
      );

      const noneExtracted = render(
        makeState({
          documents: docs,
          extract: { extractedStudyIds: [], selectedStudyIds: ['study-1'] },
        }),
      );
      expect(noneExtracted.root.querySelector('#extract-studies-note')).toBeNull();
    });

    test('study が 0 件のときは #extract-documents-empty を出しトグルは無い', () => {
      const { root } = render(makeState({ documents: [], studies: [] }));
      expect(root.querySelector('#extract-documents-empty')).not.toBeNull();
      expect(root.querySelector('#extract-studies-toggle')).toBeNull();
    });
  });

  test('抽出済みバッジ: サブセット run が直近なら「直近 run は n/m 項目」を添える（issue #80）', () => {
    const docs = [makeDocument({ documentId: 'doc-1', studyId: 'study-1' })];
    const { root } = render(
      makeState({
        documents: docs,
        extract: {
          extractedStudyIds: ['study-1'],
          fieldSubsetBadges: { 'study-1': { selected: 2, total: 5 } },
        },
      }),
    );
    expect(root.querySelector('.extract__doc-extracted')?.textContent).toBe(
      '抽出済み（直近 run は 2/5 項目）',
    );
  });

  test('対象項目チェックリスト: 選択・section 全選択/全解除・折りたたみのコールバック配線（issue #80）', () => {
    const fields = [
      makeField({ fieldId: 'f-1', section: 'methods', fieldLabel: '対象年齢', fieldName: 'age' }),
      makeField({ fieldId: 'f-2', section: 'results', fieldLabel: '死亡率', fieldName: 'mortality' }),
    ];
    const { root, callbacks } = render(makeState({ fields }));
    expect(root.querySelector('#extract-fields')).not.toBeNull();

    const checkbox = root.querySelector<HTMLInputElement>('.extract__field-checkbox');
    checkbox!.checked = false;
    checkbox!.dispatchEvent(new Event('change'));
    expect(callbacks.onToggleField).toHaveBeenCalledWith('f-1', false);

    root.querySelector<HTMLButtonElement>('.extract__field-section-toggle')?.click();
    expect(callbacks.onToggleFieldSection).toHaveBeenCalledWith(['f-1'], false);

    root.querySelector<HTMLButtonElement>('.extract__field-collapse')?.click();
    expect(callbacks.onToggleFieldSectionCollapse).toHaveBeenCalledWith('methods');
  });

  test('対象項目チェックリスト: スキーマ未読込・空のときは出さない', () => {
    for (const fields of [null, [] as SchemaField[]]) {
      const { root } = render(makeState({ fields }));
      expect(root.querySelector('#extract-fields')).toBeNull();
    }
  });

  test('選択 0 件は実行ボタンを disabled にする', () => {
    const fields = [makeField()];
    const { root } = render(
      makeState({ fields, extract: { selectedFieldIds: [] } }),
    );
    expect(root.querySelector<HTMLButtonElement>('#extract-run')?.disabled).toBe(true);
    expect(root.querySelector('#extract-field-error')).not.toBeNull();
  });

  // 画像非対応モデルの実行ブロック
  describe('画像非対応モデルの実行ブロック', () => {
    function scanDocs(): DocumentRecord[] {
      return [
        makeDocument({
          documentId: 'doc-scan',
          studyId: 'study-1',
          textStatus: 'no_text_layer',
        }),
      ];
    }

    test('画像入力 study + 画像非対応と実測済みのモデル（unsupported）は実行ボタンを disabled にし警告を出す', () => {
      const { root } = render(
        makeState({
          documents: scanDocs(),
          extract: { model: 'qwen/qwen3-235b-a22b-2507' },
        }),
      );
      expect(root.querySelector<HTMLButtonElement>('#extract-run')?.disabled).toBe(true);
      const warning = root.querySelector('#extract-image-unsupported-warning');
      expect(warning?.textContent).toContain('qwen/qwen3-235b-a22b-2507');
      expect(warning?.textContent).toContain('画像入力');
    });

    test('画像入力 study が無ければ非対応モデルでも disabled にしない', () => {
      const { root } = render(
        makeState({
          documents: [makeDocument({ documentId: 'doc-1', studyId: 'study-1' })],
          extract: { model: 'qwen/qwen3-235b-a22b-2507' },
        }),
      );
      expect(root.querySelector<HTMLButtonElement>('#extract-run')?.disabled).toBe(false);
      expect(root.querySelector('#extract-image-unsupported-warning')).toBeNull();
    });

    test('unknown（カタログに実測が無い）モデルは disabled にしない', () => {
      const { root } = render(
        makeState({
          documents: scanDocs(),
          extract: { model: 'mystery-model' },
        }),
      );
      expect(root.querySelector<HTMLButtonElement>('#extract-run')?.disabled).toBe(false);
      expect(root.querySelector('#extract-image-unsupported-warning')).toBeNull();
    });

    test('supported（Gemini 系）モデルは disabled にしない', () => {
      const { root } = render(
        makeState({
          documents: scanDocs(),
          extract: { model: 'gemini-2.5-pro' },
        }),
      );
      expect(root.querySelector<HTMLButtonElement>('#extract-run')?.disabled).toBe(false);
      expect(root.querySelector('#extract-image-unsupported-warning')).toBeNull();
    });
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

  test('コスト概算: 対象項目 0 件は案内文（issue #80）', () => {
    const { root } = render(makeState({ extract: { selectedFieldIds: [] } }));
    expect(root.querySelector('#extract-estimate')?.textContent).toBe(
      'コスト概算: 対象項目を選択すると表示されます',
    );
  });

  test('単価表にあるモデルは金額を表示し、モデル未入力は unknown で概算する', () => {
    const priced = render(makeState({ extract: { model: 'gemini-2.5-pro' } }));
    expect(priced.root.querySelector('#extract-estimate')?.textContent).toMatch(
      /コスト概算: \$\d+\.\d{4}/,
    );

    render(makeState({ extract: { model: '' } }));
    expect(planRunMock).toHaveBeenCalledWith(expect.objectContaining({ model: 'unknown' }));
  });

  test('コスト概算: モデル未選択 + テキスト層なし文献選択時は unknown 警告を出さない（レビュー指摘）', () => {
    const docs = [
      makeDocument({ documentId: 'doc-scan', studyId: 'study-1', textStatus: 'no_text_layer' }),
    ];
    const { root } = render(
      makeState({ documents: docs, extract: { selectedStudyIds: ['study-1'], model: '' } }),
    );
    const estimate = root.querySelector('#extract-estimate');
    // ダミーのモデル名 'unknown' を「画像対応が不明なモデルが選ばれている」と誤検出しない
    expect(estimate?.textContent).not.toContain('画像入力に対応しているか分かっていません');
    // pdf_native（画像入力）自体の warning は引き続き出る
    expect(estimate?.textContent).toContain('注意:');
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
    // 全選択時は「全項目（m）」（issue #80）
    expect(root.querySelector('#extract-confirm-fields')?.textContent).toBe('対象項目: 全項目（1）');
    expect(root.querySelector<HTMLButtonElement>('#extract-run')?.disabled).toBe(true);

    root.querySelector<HTMLButtonElement>('#extract-confirm-run')?.click();
    expect(callbacks.onConfirmRun).toHaveBeenCalledTimes(1);
    root.querySelector<HTMLButtonElement>('#extract-confirm-cancel')?.click();
    expect(callbacks.onCancelConfirm).toHaveBeenCalledTimes(1);
  });

  test('サブセット選択時は「n / m」を表示する（issue #80）', () => {
    const fields = [makeField({ fieldId: 'f-1' }), makeField({ fieldId: 'f-2' })];
    const { root } = render(
      makeState({ fields, extract: { confirming: true, selectedFieldIds: ['f-1'] } }),
    );
    expect(root.querySelector('#extract-confirm-fields')?.textContent).toBe('対象項目: 1 / 2');
  });

  test('スキーマ未読込（null）でも落ちない（防御分岐）', () => {
    const { root } = render(makeState({ fields: null, extract: { confirming: true } }));
    expect(root.querySelector('#extract-confirm-fields')?.textContent).toBe('対象項目: 全項目（0）');
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

  // 失敗理由のヒント（実データ抽出の失敗ヒント。ExtractStudyRow.failureKind → t() で翻訳）
  describe('失敗理由のヒント', () => {
    test.each([
      ['timeout', 'モデルが応答を返しきれずタイムアウトしました。別のモデル（flash 系など）での再実行を検討してください'],
      ['image_unsupported', 'このモデルは画像入力に対応していません。Gemini 系モデルを選び直してください'],
      ['output_limit', '出力が長すぎて打ち切られました'],
      ['content_filter', 'コンテンツフィルタにより応答が打ち切られました'],
      ['malformed', '応答が JSON として壊れていました。別のモデルを試してください'],
    ] as const)('failureKind=%s は対応するヒントを表示する', (failureKind, expectedSubstring) => {
      const { root } = render(
        makeState({
          extract: {
            run: makeRun({ status: 'partial_failure' }),
            studyRows: [
              makeStudyRow({ studyId: 'study-1', status: 'failed', detail: 'x', failureKind }),
            ],
          },
        }),
      );
      expect(root.querySelector('.extract__doc-hint')?.textContent).toContain(expectedSubstring);
    });

    test('output_limit のヒントは「再試行ボタン」ではなく対象項目チェックリストでの再実行を案内する', () => {
      const { root } = render(
        makeState({
          extract: {
            run: makeRun({ status: 'partial_failure' }),
            studyRows: [
              makeStudyRow({
                studyId: 'study-1',
                status: 'failed',
                detail: 'x',
                failureKind: 'output_limit',
              }),
            ],
          },
        }),
      );
      const hint = root.querySelector('.extract__doc-hint')?.textContent ?? '';
      expect(hint).toContain('対象項目');
      // 「再試行ボタン」の存在自体には触れてよいが、それを使うよう積極的に勧めてはいけない
      // （retryExtractStudy は lastRunFieldIds を引き継ぐため項目を絞れない）
      expect(hint).not.toMatch(/再試行ボタン(を|で)(押|クリック|使)/);
    });

    test('failureKind が null（不明）のときはヒントを出さない（憶測で誘導しない）', () => {
      const { root } = render(
        makeState({
          extract: {
            run: makeRun({ status: 'partial_failure' }),
            studyRows: [
              makeStudyRow({ studyId: 'study-1', status: 'failed', detail: 'x', failureKind: null }),
            ],
          },
        }),
      );
      expect(root.querySelector('.extract__doc-hint')).toBeNull();
    });

    test('言語切替後はヒントも再翻訳される（コードを保持して View で翻訳している証明）', () => {
      const state = makeState({
        extract: {
          run: makeRun({ status: 'partial_failure' }),
          studyRows: [
            makeStudyRow({
              studyId: 'study-1',
              status: 'failed',
              detail: 'x',
              failureKind: 'timeout',
            }),
          ],
        },
      });
      const { root: jaRoot } = render(state);
      expect(jaRoot.querySelector('.extract__doc-hint')?.textContent).toContain('タイムアウト');

      setUiLanguage('en');
      try {
        const { ctx } = makeCtx();
        const enRoot = renderExtractView(state, ctx);
        expect(enRoot.querySelector('.extract__doc-hint')?.textContent).toContain('timed out');
      } finally {
        setUiLanguage('ja');
      }
    });
  });

  test('arm 欠落警告（issue #106）: done でも黄バナー #extract-arm-warnings を出し、study_label と項目名で欠落を列挙する', () => {
    const { root } = render(
      makeState({
        studies: [makeStudy('study-1', 'Smith 2020')],
        fields: [
          makeField({ fieldId: 'f-arm', fieldName: 'sample_size', entityLevel: 'arm' }),
        ],
        extract: {
          run: makeRun(),
          studyRows: [makeStudyRow({ studyId: 'study-1', status: 'done' })],
          armWarnings: [
            {
              kind: 'arm_completeness',
              studyId: 'study-1',
              section: null,
              expectedArmKeys: ['arm:1', 'arm:2'],
              missingItems: [
                { armKey: 'arm:2', fieldId: 'f-arm' },
                { armKey: 'arm:2', fieldId: 'f-unknown' }, // 現行スキーマに無い id は素通し
              ],
            },
          ],
        },
      }),
    );
    const banner = root.querySelector('#extract-arm-warnings');
    expect(banner?.getAttribute('role')).toBe('status');
    expect(banner?.textContent).toContain('群（arm）の欠落の可能性が 1 件検出されました');
    expect(banner?.textContent).toContain(
      'Smith 2020: arm:2 × sample_size、arm:2 × f-unknown が応答に含まれていません',
    );
    // done のバナーと共存する（status は warning で変わらない設計判断）
    expect(root.querySelector('#extract-run-done')).not.toBeNull();
  });

  test('arm 欠落警告: partial_failure と共存し、section 付きバッチは scope を併記。スキーマ未読込でも id で表示する', () => {
    const { root } = render(
      makeState({
        studies: [makeStudy('study-2')],
        fields: null,
        extract: {
          run: makeRun({ status: 'partial_failure' }),
          studyRows: [makeStudyRow({ studyId: 'study-2', status: 'failed', detail: 'x' })],
          armWarnings: [
            {
              kind: 'arm_completeness',
              studyId: 'study-unknown', // studies に無い study は id のまま表示
              section: 'population',
              expectedArmKeys: ['arm:1', 'arm:2'],
              missingItems: [{ armKey: 'arm:2', fieldId: 'f-arm' }],
            },
          ],
        },
      }),
    );
    const banner = root.querySelector('#extract-arm-warnings');
    expect(root.querySelector('#extract-partial-failure')).not.toBeNull();
    expect(banner?.textContent).toContain(
      'study-unknown（section: population）: arm:2 × f-arm が応答に含まれていません',
    );
  });

  test('arm 欠落警告が 0 件ならバナーを出さない', () => {
    const { root } = render(
      makeState({
        extract: {
          run: makeRun(),
          studyRows: [makeStudyRow({ studyId: 'study-1', status: 'done' })],
          armWarnings: [],
        },
      }),
    );
    expect(root.querySelector('#extract-arm-warnings')).toBeNull();
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

describe('renderExtractView（表示言語 en。issue #93）', () => {
  afterEach(() => {
    setUiLanguage('ja');
  });

  test('見出し・実行ボタン・読み込みエラーが en で描画される', () => {
    setUiLanguage('en');
    const { ctx } = makeCtx();
    const view = renderExtractView(makeState(), ctx);
    expect(view.querySelector('h2')?.textContent).toBe('Full extraction');
    expect(view.querySelector('#extract-run')?.textContent).toBe('Run full extraction');

    const errorView = renderExtractView(makeState({ documentsError: 'HTTP 500' }), ctx);
    expect(errorView.querySelector('#extract-load-error')?.textContent).toBe(
      'Failed to load extraction targets: HTTP 500',
    );
  });
});
