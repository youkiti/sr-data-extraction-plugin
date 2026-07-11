// #/documents view の描画テスト（ui-states.md §3 / requirements.md §4.5 v0.10）。
// render は純粋関数のため、状態を組み立てて DOM を検証する。
// S3 グルーピング UI（study グループ・role select・統合候補バナー・統合ダイアログ）を網羅する
import { renderDocumentsView } from '../../../../src/app/views/documentsView';
import type { DocumentsViewCallbacks, ViewContext } from '../../../../src/app/views/types';
import { createInitialState, type AppState } from '../../../../src/app/store';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { StudyRecord } from '../../../../src/domain/study';

function makeStudy(overrides: Partial<StudyRecord> = {}): StudyRecord {
  return {
    studyId: 'study-1',
    studyLabel: 'Smith 2020',
    registrationId: null,
    createdAt: '2026-07-02T00:00:00Z',
    createdBy: 'tester@example.com',
    note: null,
    ...overrides,
  };
}

function makeDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
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
    pageCount: 10,
    charCount: 20000,
    importedAt: '2026-07-02T00:00:00Z',
    importedBy: 'tester@example.com',
    note: null,
    ...overrides,
  };
}

function makeCtx(): { ctx: ViewContext; callbacks: jest.Mocked<DocumentsViewCallbacks> } {
  const callbacks: jest.Mocked<DocumentsViewCallbacks> = {
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
  };
  return {
    ctx: {
      home: {
    onReload: jest.fn(),
    onGrantFolderAccess: jest.fn(),
    onReloadReviewers: jest.fn(),
    onAddReviewer: jest.fn(),
    onConfirmReviewerChange: jest.fn(),
    onCancelReviewerChange: jest.fn(),
    onRevokeReviewer: jest.fn(),
    onCopyInvite: jest.fn(),
  },
      documents: callbacks,
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
      extract: {
        onToggleStudy: jest.fn(),
        onChangeModel: jest.fn(),
        onRequestRun: jest.fn(),
        onConfirmRun: jest.fn(),
        onCancelConfirm: jest.fn(),
        onRetryStudy: jest.fn(),
        onReloadTargets: jest.fn(),
      },
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
      adjudicate: {
        onSelectStudy: jest.fn(),
        onBackToList: jest.fn(),
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
      },
    },
    callbacks,
  };
}

function makeState(patch: Partial<AppState['documents']> = {}, withProject = true): AppState {
  const state = createInitialState();
  if (withProject) {
    state.currentProject = {
      projectId: 'p1',
      spreadsheetId: 's1',
      driveFolderId: 'f1',
      name: 'テスト SR',
    };
  }
  state.documents = { ...state.documents, ...patch };
  return state;
}

function mount(view: HTMLElement): HTMLElement {
  document.body.append(view);
  return view;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('renderDocumentsView', () => {
  test('LLM 送信に関する注意書きを常時表示する（チェック UI は持たない）', () => {
    const { ctx } = makeCtx();
    const view = renderDocumentsView(makeState(), ctx);
    expect(view.textContent).toContain(
      '取り込んだ PDF が外部へ送信されるのは LLM API への抽出リクエストのみです',
    );
  });

  test('プロジェクト未選択: ボタンは無効・一覧 / バナー / ダイアログは描画しない', () => {
    const { ctx } = makeCtx();
    const view = renderDocumentsView(
      makeState({ records: [makeDoc()], studies: [makeStudy()] }, false),
      ctx,
    );
    expect((view.querySelector('#documents-import') as HTMLButtonElement).disabled).toBe(true);
    expect((view.querySelector('#documents-reload') as HTMLButtonElement).disabled).toBe(true);
    expect((view.querySelector('#documents-local-import') as HTMLButtonElement).disabled).toBe(true);
    expect(
      view.querySelector('#documents-dropzone')?.classList.contains('documents__dropzone--disabled'),
    ).toBe(true);
    expect(view.querySelector('#documents-loading')).toBeNull();
    expect(view.querySelector('#documents-list')).toBeNull();
    expect(view.querySelector('.documents__candidate')).toBeNull();
    expect(view.querySelector('#merge-dialog')).toBeNull();
  });

  test('未読込（records null）は読み込み中表示', () => {
    const { ctx } = makeCtx();
    const view = renderDocumentsView(makeState(), ctx);
    expect(view.querySelector('#documents-loading')?.textContent).toBe(
      '一覧を読み込んでいます…',
    );
  });

  test('records ありでも studies null なら読み込み中表示', () => {
    const { ctx } = makeCtx();
    const view = renderDocumentsView(makeState({ records: [makeDoc()], studies: null }), ctx);
    expect(view.querySelector('#documents-loading')).not.toBeNull();
  });

  test('再読込中（records / studies ありで loading）は読み込み中表示を出す', () => {
    const { ctx } = makeCtx();
    const view = renderDocumentsView(
      makeState({ records: [makeDoc()], studies: [makeStudy()], loading: true }),
      ctx,
    );
    expect(view.querySelector('#documents-loading')).not.toBeNull();
    expect(view.querySelector('#documents-list')).toBeNull();
  });

  test('読込失敗はエラーメッセージを表示する', () => {
    const { ctx } = makeCtx();
    const view = renderDocumentsView(makeState({ loadError: 'boom' }), ctx);
    expect(view.querySelector('#documents-load-error')?.textContent).toBe(
      '一覧を読み込めませんでした: boom',
    );
  });

  test('空状態（アクティブ study 0 件）は取り込みへの導線テキストを表示する', () => {
    const { ctx } = makeCtx();
    const view = renderDocumentsView(makeState({ records: [], studies: [] }), ctx);
    expect(view.querySelector('#documents-empty')?.textContent).toContain('まだ文献がありません');
  });

  test('取り込みボタン / 再読み込みボタンがコールバックを呼ぶ', () => {
    const { ctx, callbacks } = makeCtx();
    const view = renderDocumentsView(makeState({ records: [], studies: [] }), ctx);
    (view.querySelector('#documents-import') as HTMLButtonElement).click();
    (view.querySelector('#documents-reload') as HTMLButtonElement).click();
    expect(callbacks.onImport).toHaveBeenCalledTimes(1);
    expect(callbacks.onReload).toHaveBeenCalledTimes(1);
  });

  test('ローカル選択ボタンは隠しファイル入力を開き、input change で onImportFiles を呼ぶ', () => {
    const { ctx, callbacks } = makeCtx();
    const view = mount(renderDocumentsView(makeState({ records: [], studies: [] }), ctx));

    const input = view.querySelector('#documents-file-input') as HTMLInputElement;
    expect(input.hidden).toBe(true);
    expect(input.getAttribute('accept')).toBe('application/pdf');
    expect(input.multiple).toBe(true);

    const localButton = view.querySelector('#documents-local-import') as HTMLButtonElement;
    // ローカルであることを明示する文言（絵文字つき）
    expect(localButton.textContent).toBe('💻 PC からファイルを選択');
    const clickSpy = jest.spyOn(input, 'click');
    localButton.click();
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    expect(callbacks.onImportFiles).toHaveBeenCalledWith([file]);
    // 同じファイルを連続選択できるよう input.value をリセットする
    expect(input.value).toBe('');
  });

  test('input change でファイルが 0 件なら onImportFiles を呼ばない', () => {
    const { ctx, callbacks } = makeCtx();
    const view = mount(renderDocumentsView(makeState({ records: [], studies: [] }), ctx));
    const input = view.querySelector('#documents-file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    input.dispatchEvent(new Event('change'));
    expect(callbacks.onImportFiles).not.toHaveBeenCalled();
  });

  test('input change で files が null（未選択キャンセル）でも例外にならず呼ばない', () => {
    const { ctx, callbacks } = makeCtx();
    const view = mount(renderDocumentsView(makeState({ records: [], studies: [] }), ctx));
    const input = view.querySelector('#documents-file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: null, configurable: true });
    input.dispatchEvent(new Event('change'));
    expect(callbacks.onImportFiles).not.toHaveBeenCalled();
  });

  test('ドロップゾーン: dragover/dragenter は preventDefault + ハイライト、dragleave で解除', () => {
    const { ctx } = makeCtx();
    const view = mount(renderDocumentsView(makeState({ records: [], studies: [] }), ctx));
    const zone = view.querySelector('#documents-dropzone') as HTMLElement;
    expect(zone.querySelector('.documents__dropzone-prompt')?.textContent).toBe(
      'PDF をここにドラッグ&ドロップ',
    );
    expect(zone.querySelector('.documents__dropzone-or')?.textContent).toBe('または');
    // ドロップゾーン内にローカル選択ボタン + 隠し input を集約する
    expect(zone.querySelector('#documents-local-import')).not.toBeNull();
    expect(zone.querySelector('#documents-file-input')).not.toBeNull();

    const overEvent = new Event('dragover', { cancelable: true });
    zone.dispatchEvent(overEvent);
    expect(overEvent.defaultPrevented).toBe(true);
    expect(zone.classList.contains('documents__dropzone--dragover')).toBe(true);

    zone.dispatchEvent(new Event('dragleave'));
    expect(zone.classList.contains('documents__dropzone--dragover')).toBe(false);

    const enterEvent = new Event('dragenter', { cancelable: true });
    zone.dispatchEvent(enterEvent);
    expect(enterEvent.defaultPrevented).toBe(true);
    expect(zone.classList.contains('documents__dropzone--dragover')).toBe(true);
  });

  test('ドロップゾーン: disabled 中の dragover/dragenter はハイライトしない（preventDefault のみ）', () => {
    const { ctx } = makeCtx();
    const view = mount(renderDocumentsView(makeState({ importing: true }), ctx));
    const zone = view.querySelector('#documents-dropzone') as HTMLElement;

    const overEvent = new Event('dragover', { cancelable: true });
    zone.dispatchEvent(overEvent);
    expect(overEvent.defaultPrevented).toBe(true);
    expect(zone.classList.contains('documents__dropzone--dragover')).toBe(false);

    const enterEvent = new Event('dragenter', { cancelable: true });
    zone.dispatchEvent(enterEvent);
    expect(zone.classList.contains('documents__dropzone--dragover')).toBe(false);
  });

  test('ドロップゾーン: dataTransfer が無い drop（ブラウザ既定動作以外の発火）は無視する', () => {
    const { ctx, callbacks } = makeCtx();
    const view = mount(renderDocumentsView(makeState({ records: [], studies: [] }), ctx));
    const zone = view.querySelector('#documents-dropzone') as HTMLElement;

    const dropEvent = new Event('drop', { cancelable: true });
    zone.dispatchEvent(dropEvent);

    expect(dropEvent.defaultPrevented).toBe(true);
    expect(callbacks.onImportFiles).not.toHaveBeenCalled();
  });

  test('ドロップゾーン: drop で dataTransfer.files を onImportFiles へ渡し preventDefault する', () => {
    const { ctx, callbacks } = makeCtx();
    const view = mount(renderDocumentsView(makeState({ records: [], studies: [] }), ctx));
    const zone = view.querySelector('#documents-dropzone') as HTMLElement;

    const file = new File(['x'], 'dropped.pdf', { type: 'application/pdf' });
    const dropEvent = new Event('drop', { cancelable: true });
    Object.defineProperty(dropEvent, 'dataTransfer', { value: { files: [file] } });
    zone.dispatchEvent(dropEvent);

    expect(dropEvent.defaultPrevented).toBe(true);
    expect(callbacks.onImportFiles).toHaveBeenCalledWith([file]);
    expect(zone.classList.contains('documents__dropzone--dragover')).toBe(false);
  });

  test('ドロップゾーン: importing || !hasProject の間は disabled クラス + ドロップ無視', () => {
    const { ctx, callbacks } = makeCtx();
    const view = mount(renderDocumentsView(makeState({ importing: true }), ctx));
    const zone = view.querySelector('#documents-dropzone') as HTMLElement;
    expect(zone.classList.contains('documents__dropzone--disabled')).toBe(true);

    const file = new File(['x'], 'dropped.pdf', { type: 'application/pdf' });
    const dropEvent = new Event('drop', { cancelable: true });
    Object.defineProperty(dropEvent, 'dataTransfer', { value: { files: [file] } });
    zone.dispatchEvent(dropEvent);

    expect(dropEvent.defaultPrevented).toBe(true); // ブラウザ既定動作（ファイルを開く）だけは常に防ぐ
    expect(callbacks.onImportFiles).not.toHaveBeenCalled();
  });

  test('取り込み中はボタンを無効化し、進捗行を 2 段階表示する', () => {
    const { ctx } = makeCtx();
    const view = renderDocumentsView(
      makeState({
        importing: true,
        importRows: [
          { key: 's1', filename: 'a.pdf', status: 'copy', detail: null },
          { key: 's2', filename: 'b.pdf', status: 'extract', detail: null },
          { key: 's3', filename: 'c.pdf', status: 'queued', detail: null },
          { key: 's4', filename: 'd.pdf', status: 'done', detail: null },
          { key: 's5', filename: 'e.pdf', status: 'failed', detail: 'コピーに失敗: x' },
          { key: 's6', filename: 'f.pdf', status: 'failed', detail: null },
        ],
      }),
      ctx,
    );
    expect((view.querySelector('#documents-import') as HTMLButtonElement).disabled).toBe(true);
    expect((view.querySelector('#documents-reload') as HTMLButtonElement).disabled).toBe(true);
    expect((view.querySelector('#documents-local-import') as HTMLButtonElement).disabled).toBe(true);
    const rows = Array.from(view.querySelectorAll('#documents-progress li'));
    expect(rows.map((row) => row.textContent)).toEqual([
      'a.pdfコピー中…',
      'b.pdfテキスト抽出中…',
      'c.pdf待機中',
      'd.pdf完了',
      'e.pdf失敗（コピーに失敗: x）',
      'f.pdf失敗',
    ]);
    expect(rows[4]?.querySelector('.documents__progress-status--failed')).not.toBeNull();
  });

  test('一覧: study グループごとに study_label / registration_id 入力・チェックボックス・文書行を描画する', () => {
    const { ctx } = makeCtx();
    const view = mount(
      renderDocumentsView(
        makeState({
          records: [
            makeDoc(),
            makeDoc({
              documentId: 'doc-2',
              studyId: 'study-2',
              documentRole: 'registration',
              filename: 'jones2021.pdf',
              textStatus: 'no_text_layer',
              textRef: null,
              pageCount: null,
            }),
          ],
          studies: [
            makeStudy(),
            makeStudy({ studyId: 'study-2', studyLabel: 'Jones 2021', registrationId: 'NCT999' }),
          ],
        }),
        ctx,
      ),
    );

    const groups = Array.from(view.querySelectorAll('.documents__study-group'));
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.getAttribute('data-study-id'))).toEqual(['study-1', 'study-2']);

    // study_label 入力（値）
    const labels = Array.from(
      view.querySelectorAll<HTMLInputElement>('.documents__label-input'),
    );
    expect(labels.map((i) => i.value)).toEqual(['Smith 2020', 'Jones 2021']);

    // registration_id 入力（null は空文字、値ありはそのまま）
    const regs = Array.from(
      view.querySelectorAll<HTMLInputElement>('.documents__registration-input'),
    );
    expect(regs.map((i) => i.value)).toEqual(['', 'NCT999']);

    // 統合対象チェックボックス
    const checks = Array.from(
      view.querySelectorAll<HTMLInputElement>('.documents__study-check'),
    );
    expect(checks).toHaveLength(2);
    expect(checks.every((c) => c.checked === false)).toBe(true);
    expect(checks[0]?.getAttribute('aria-label')).toBe('Smith 2020 を統合対象にする');

    // role select（値 = documentRole・選択肢 = 6 ロール）
    const selects = Array.from(
      view.querySelectorAll<HTMLSelectElement>('.documents__role-select'),
    );
    expect(selects).toHaveLength(2);
    expect(selects[0]?.value).toBe('article');
    expect(selects[1]?.value).toBe('registration');
    expect(selects[0]?.querySelectorAll('option')).toHaveLength(6);
    expect(
      Array.from(selects[0]?.querySelectorAll('option') ?? []).map((o) => o.getAttribute('value')),
    ).toEqual(['article', 'registration', 'protocol', 'abstract', 'supplement', 'other']);
    expect(selects[0]?.getAttribute('aria-label')).toBe('smith2020.pdf の document_role');

    // ファイル名
    const filenames = Array.from(view.querySelectorAll('.documents__doc-filename')).map(
      (n) => n.textContent,
    );
    expect(filenames).toEqual(['smith2020.pdf', 'jones2021.pdf']);

    // text_status バッジ（ok / no_text_layer + 注記）
    expect(view.querySelector('.documents__badge--ok')?.textContent).toBe('ok');
    expect(view.querySelector('.documents__badge--no_text_layer')?.textContent).toBe(
      'no_text_layer',
    );
    expect(view.querySelectorAll('.documents__badge-note')).toHaveLength(1);
    expect(view.querySelector('.documents__badge-note')?.textContent).toBe(
      'pdf_native 抽出のみ・ハイライト不可',
    );

    // ページ数（数値 / null → –）
    const doc1Cells = Array.from(
      groups[0]?.querySelectorAll('.documents__doc-row td') ?? [],
    );
    expect(doc1Cells[3]?.textContent).toBe('10');
    const doc2Cells = Array.from(
      groups[1]?.querySelectorAll('.documents__doc-row td') ?? [],
    );
    expect(doc2Cells[3]?.textContent).toBe('–');
  });

  test('統合ボタンは選択 2 件未満で無効', () => {
    const { ctx } = makeCtx();
    const view = renderDocumentsView(
      makeState({
        records: [makeDoc()],
        studies: [makeStudy()],
        selectedStudyIds: ['study-1'],
      }),
      ctx,
    );
    expect((view.querySelector('#documents-merge') as HTMLButtonElement).disabled).toBe(true);
  });

  test('統合ボタンは選択 2 件以上で有効・クリックで onOpenMerge を呼ぶ・選択済みはチェック済み', () => {
    const { ctx, callbacks } = makeCtx();
    const view = mount(
      renderDocumentsView(
        makeState({
          records: [makeDoc(), makeDoc({ documentId: 'doc-2', studyId: 'study-2' })],
          studies: [makeStudy(), makeStudy({ studyId: 'study-2', studyLabel: 'Jones 2021' })],
          selectedStudyIds: ['study-1', 'study-2'],
        }),
        ctx,
      ),
    );
    const merge = view.querySelector('#documents-merge') as HTMLButtonElement;
    expect(merge.disabled).toBe(false);
    merge.click();
    expect(callbacks.onOpenMerge).toHaveBeenCalledTimes(1);

    const checks = Array.from(
      view.querySelectorAll<HTMLInputElement>('.documents__study-check'),
    );
    expect(checks.every((c) => c.checked)).toBe(true);
  });

  test('インライン編集: study_label / registration_id / role select / チェックボックスが各コールバックを呼ぶ', () => {
    const { ctx, callbacks } = makeCtx();
    const view = mount(
      renderDocumentsView(makeState({ records: [makeDoc()], studies: [makeStudy()] }), ctx),
    );

    // study_label: change で確定
    const label = view.querySelector('.documents__label-input') as HTMLInputElement;
    label.value = 'Smith 2020a';
    label.dispatchEvent(new Event('change'));
    expect(callbacks.onSaveStudyLabel).toHaveBeenCalledWith('study-1', 'Smith 2020a');

    // Enter は blur へ寄せる / 他キーは無視（inlineInput の分岐）
    const blurSpy = jest.spyOn(label, 'blur');
    label.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    label.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(blurSpy).toHaveBeenCalledTimes(1);

    // registration_id
    const reg = view.querySelector('.documents__registration-input') as HTMLInputElement;
    reg.value = 'NCT12345';
    reg.dispatchEvent(new Event('change'));
    expect(callbacks.onSaveRegistrationId).toHaveBeenCalledWith('study-1', 'NCT12345');

    // document_role
    const select = view.querySelector('.documents__role-select') as HTMLSelectElement;
    select.value = 'protocol';
    select.dispatchEvent(new Event('change'));
    expect(callbacks.onSaveDocumentRole).toHaveBeenCalledWith('doc-1', 'protocol');

    // 統合対象チェックボックス
    const check = view.querySelector('.documents__study-check') as HTMLInputElement;
    check.checked = true;
    check.dispatchEvent(new Event('change'));
    expect(callbacks.onToggleStudySelection).toHaveBeenCalledWith('study-1', true);
  });

  test('統合候補バナー: registration_id 一致の複数アクティブ study で表示し、各ボタンが対象 studyIds を渡す', () => {
    const { ctx, callbacks } = makeCtx();
    const view = mount(
      renderDocumentsView(
        makeState({
          records: [
            makeDoc({ documentId: 'doc-a', studyId: 'study-a' }),
            makeDoc({ documentId: 'doc-b', studyId: 'study-b' }),
          ],
          studies: [
            makeStudy({ studyId: 'study-a', studyLabel: 'A 2020', registrationId: 'NCT001' }),
            makeStudy({ studyId: 'study-b', studyLabel: 'B 2020', registrationId: 'NCT001' }),
          ],
        }),
        ctx,
      ),
    );
    const banner = view.querySelector('.documents__candidate');
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute('data-registration')).toBe('NCT001');
    expect(banner?.getAttribute('role')).toBe('note');
    expect(banner?.textContent).toContain('同じ登録番号「NCT001」の試験が 2 件あります');

    (view.querySelector('.documents__candidate-merge') as HTMLButtonElement).click();
    expect(callbacks.onOpenMergeCandidate).toHaveBeenCalledWith(['study-a', 'study-b']);

    (view.querySelector('.documents__candidate-ignore') as HTMLButtonElement).click();
    expect(callbacks.onIgnoreCandidate).toHaveBeenCalledWith(['study-a', 'study-b']);
  });

  test('無視済みの統合候補（sorted-join キーが ignoredCandidateKeys にある）はバナーを出さない', () => {
    const { ctx } = makeCtx();
    const view = renderDocumentsView(
      makeState({
        records: [
          makeDoc({ documentId: 'doc-a', studyId: 'study-a' }),
          makeDoc({ documentId: 'doc-b', studyId: 'study-b' }),
        ],
        studies: [
          makeStudy({ studyId: 'study-a', registrationId: 'NCT001' }),
          makeStudy({ studyId: 'study-b', registrationId: 'NCT001' }),
        ],
        ignoredCandidateKeys: ['study-a|study-b'],
      }),
      ctx,
    );
    expect(view.querySelector('.documents__candidate')).toBeNull();
  });

  test('統合ダイアログ: role=alertdialog を描画し、入力が更新コールバックを呼ぶ', () => {
    const { ctx, callbacks } = makeCtx();
    const view = mount(
      renderDocumentsView(
        makeState({
          mergeDialog: {
            studyIds: ['study-a', 'study-b'],
            label: 'Smith 2020',
            registrationId: 'NCT001',
            hasExtractedData: false,
          },
        }),
        ctx,
      ),
    );
    const dialog = view.querySelector('#merge-dialog');
    expect(dialog?.getAttribute('role')).toBe('alertdialog');
    expect(dialog?.textContent).toContain('2 件の試験を 1 つにまとめます');

    const label = view.querySelector('#merge-label') as HTMLInputElement;
    expect(label.value).toBe('Smith 2020');
    label.value = '統合後ラベル';
    label.dispatchEvent(new Event('input'));
    expect(callbacks.onUpdateMergeLabel).toHaveBeenCalledWith('統合後ラベル');

    const reg = view.querySelector('#merge-registration') as HTMLInputElement;
    expect(reg.value).toBe('NCT001');
    reg.value = 'NCT002';
    reg.dispatchEvent(new Event('input'));
    expect(callbacks.onUpdateMergeRegistration).toHaveBeenCalledWith('NCT002');

    // hasExtractedData=false のとき警告・merging=false のとき有効
    expect(view.querySelector('#merge-warning')).toBeNull();
    expect((view.querySelector('#merge-confirm') as HTMLButtonElement).disabled).toBe(false);
    expect((view.querySelector('#merge-cancel') as HTMLButtonElement).disabled).toBe(false);

    (view.querySelector('#merge-confirm') as HTMLButtonElement).click();
    expect(callbacks.onConfirmMerge).toHaveBeenCalledTimes(1);
    (view.querySelector('#merge-cancel') as HTMLButtonElement).click();
    expect(callbacks.onCancelMerge).toHaveBeenCalledTimes(1);
  });

  test('統合ダイアログ: hasExtractedData で警告・merging でボタン無効・mergeError でアラート', () => {
    const { ctx } = makeCtx();
    const view = renderDocumentsView(
      makeState({
        mergeDialog: {
          studyIds: ['study-a', 'study-b'],
          label: 'Smith 2020',
          registrationId: 'NCT001',
          hasExtractedData: true,
        },
        merging: true,
        mergeError: '統合に失敗しました',
      }),
      ctx,
    );
    expect(view.querySelector('#merge-warning')?.getAttribute('role')).toBe('alert');
    expect(view.querySelector('#merge-warning')?.textContent).toContain('未抽出に戻ります');
    expect((view.querySelector('#merge-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect((view.querySelector('#merge-cancel') as HTMLButtonElement).disabled).toBe(true);
    const error = view.querySelector('#merge-dialog .documents__error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toBe('統合に失敗しました');
  });
});
