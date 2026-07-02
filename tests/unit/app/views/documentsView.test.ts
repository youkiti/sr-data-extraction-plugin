// #/documents view の描画テスト（ui-states.md §3 の各状態）。
// render は純粋関数のため、状態を組み立てて DOM を検証する
import { renderDocumentsView } from '../../../../src/app/views/documentsView';
import type { DocumentsViewCallbacks, ViewContext } from '../../../../src/app/views/types';
import { createInitialState, type AppState } from '../../../../src/app/store';
import type { DocumentRecord } from '../../../../src/domain/document';

function makeDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: 'doc-1',
    studyLabel: 'Smith 2020',
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
  const callbacks = {
    onImport: jest.fn(),
    onReload: jest.fn(),
    onSaveStudyLabel: jest.fn(),
  };
  return { ctx: { documents: callbacks }, callbacks };
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

describe('renderDocumentsView', () => {
  test('著作権の注意書きを常時表示する（チェック UI は持たない）', () => {
    const { ctx } = makeCtx();
    const view = renderDocumentsView(makeState(), ctx);
    expect(view.textContent).toContain(
      '著作権フリー / 利用許諾済みの PDF のみ取り込んでください',
    );
    expect(view.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });

  test('プロジェクト未選択: ボタンは無効・一覧は描画しない', () => {
    const { ctx } = makeCtx();
    const view = renderDocumentsView(makeState({}, false), ctx);
    expect((view.querySelector('#documents-import') as HTMLButtonElement).disabled).toBe(true);
    expect((view.querySelector('#documents-reload') as HTMLButtonElement).disabled).toBe(true);
    expect(view.querySelector('#documents-loading')).toBeNull();
    expect(view.querySelector('#documents-table')).toBeNull();
  });

  test('未読込（records null）は読み込み中表示', () => {
    const { ctx } = makeCtx();
    const view = renderDocumentsView(makeState(), ctx);
    expect(view.querySelector('#documents-loading')?.textContent).toBe(
      '一覧を読み込んでいます…',
    );
  });

  test('読込失敗はエラーメッセージを表示する', () => {
    const { ctx } = makeCtx();
    const view = renderDocumentsView(makeState({ loadError: 'boom' }), ctx);
    expect(view.querySelector('#documents-load-error')?.textContent).toBe(
      '一覧を読み込めませんでした: boom',
    );
  });

  test('空状態（0 件）は取り込みへの導線テキストを表示する', () => {
    const { ctx } = makeCtx();
    const view = renderDocumentsView(makeState({ records: [] }), ctx);
    expect(view.querySelector('#documents-empty')?.textContent).toContain('まだ文献がありません');
  });

  test('取り込みボタン / 再読み込みボタンがコールバックを呼ぶ', () => {
    const { ctx, callbacks } = makeCtx();
    const view = renderDocumentsView(makeState({ records: [] }), ctx);
    (view.querySelector('#documents-import') as HTMLButtonElement).click();
    (view.querySelector('#documents-reload') as HTMLButtonElement).click();
    expect(callbacks.onImport).toHaveBeenCalledTimes(1);
    expect(callbacks.onReload).toHaveBeenCalledTimes(1);
  });

  test('取り込み中はボタンを無効化し、進捗行を 2 段階表示する', () => {
    const { ctx } = makeCtx();
    const view = renderDocumentsView(
      makeState({
        importing: true,
        importRows: [
          { sourceFileId: 's1', filename: 'a.pdf', status: 'copy', detail: null },
          { sourceFileId: 's2', filename: 'b.pdf', status: 'extract', detail: null },
          { sourceFileId: 's3', filename: 'c.pdf', status: 'queued', detail: null },
          { sourceFileId: 's4', filename: 'd.pdf', status: 'done', detail: null },
          { sourceFileId: 's5', filename: 'e.pdf', status: 'failed', detail: 'コピーに失敗: x' },
          { sourceFileId: 's6', filename: 'f.pdf', status: 'failed', detail: null },
        ],
      }),
      ctx,
    );
    expect((view.querySelector('#documents-import') as HTMLButtonElement).disabled).toBe(true);
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

  test('再読込中（records ありで loading）は読み込み中表示を出す', () => {
    const { ctx } = makeCtx();
    const view = renderDocumentsView(makeState({ records: [makeDoc()], loading: true }), ctx);
    expect(view.querySelector('#documents-loading')).not.toBeNull();
    expect(view.querySelector('#documents-table')).toBeNull();
  });

  test('一覧 N 件: text_status バッジ（ok/partial/no_text_layer + 注記）と列を描画する', () => {
    const { ctx } = makeCtx();
    const view = renderDocumentsView(
      makeState({
        records: [
          makeDoc(),
          makeDoc({ documentId: 'doc-2', filename: 'b.pdf', textStatus: 'partial' }),
          makeDoc({
            documentId: 'doc-3',
            filename: 'c.pdf',
            textStatus: 'no_text_layer',
            textRef: null,
            pageCount: null,
          }),
        ],
      }),
      ctx,
    );
    const table = view.querySelector('#documents-table');
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(view.querySelector('.documents__badge--ok')?.textContent).toBe('ok');
    expect(view.querySelector('.documents__badge--partial')?.textContent).toBe('partial');
    expect(view.querySelector('.documents__badge--no_text_layer')?.textContent).toBe(
      'no_text_layer',
    );
    // no_text_layer のみ注記（ui-states.md §3）
    expect(view.querySelectorAll('.documents__badge-note')).toHaveLength(1);
    expect(view.querySelector('.documents__badge-note')?.textContent).toBe(
      'pdf_native 抽出のみ・ハイライト不可',
    );
    // page_count null は「–」表示
    const cells = Array.from(table?.querySelectorAll('tbody tr:nth-child(3) td') ?? []);
    expect(cells[3]?.textContent).toBe('–');
  });

  test('study_label のインライン編集: change で保存コールバック、Enter は blur で確定へ寄せる', () => {
    const { ctx, callbacks } = makeCtx();
    const view = renderDocumentsView(makeState({ records: [makeDoc()] }), ctx);
    document.body.append(view);
    const input = view.querySelector('.documents__label-input') as HTMLInputElement;
    expect(input.value).toBe('Smith 2020');
    expect(input.getAttribute('aria-label')).toBe('smith2020.pdf の study_label');

    input.value = 'Smith 2020a';
    input.dispatchEvent(new Event('change'));
    expect(callbacks.onSaveStudyLabel).toHaveBeenCalledWith('doc-1', 'Smith 2020a');

    const blurSpy = jest.spyOn(input, 'blur');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(blurSpy).toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(blurSpy).toHaveBeenCalledTimes(1);
    view.remove();
  });
});
