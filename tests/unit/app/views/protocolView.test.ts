// #/protocol view の描画テスト（ui-states.md §3 の各状態）。
// render は純粋関数のため、状態を組み立てて DOM を検証する
import { renderProtocolView } from '../../../../src/app/views/protocolView';
import type { ProtocolViewCallbacks, ViewContext } from '../../../../src/app/views/types';
import { createInitialState, type AppState } from '../../../../src/app/store';
import type { Protocol } from '../../../../src/domain/protocol';
import { setUiLanguage } from '../../../../src/lib/i18n';

function makeProtocol(version: number, overrides: Partial<Protocol> = {}): Protocol {
  return {
    version,
    frameworkType: null,
    researchQuestion: '',
    inclusionCriteria: null,
    exclusionCriteria: null,
    studyDesign: null,
    blockCount: 0,
    combinationExpression: '',
    sourceType: 'manual',
    sourceFilename: null,
    rawTextRef: null,
    rawTextPreview: 'P: 成人肺炎 プレビュー',
    rawTextInline: 'P: 成人肺炎 全文',
    createdAt: `2026-07-0${version}T00:00:00Z`,
    createdBy: 'tester@example.com',
    ...overrides,
  };
}

function makeCtx(): { ctx: ViewContext; callbacks: jest.Mocked<ProtocolViewCallbacks> } {
  const callbacks = {
    onSubmit: jest.fn(),
    onStartEdit: jest.fn(),
    onCancelEdit: jest.fn(),
    onSelectVersion: jest.fn(),
    onReload: jest.fn(),
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
      },
      protocol: callbacks,
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
      extract: {
        onToggleStudy: jest.fn(),
        onChangeModel: jest.fn(),
        onToggleField: jest.fn(),
        onToggleFieldSection: jest.fn(),
        onToggleFieldSectionCollapse: jest.fn(),
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

function makeState(patch: Partial<AppState['protocol']> = {}, withProject = true): AppState {
  const state = createInitialState();
  if (withProject) {
    state.currentProject = {
      projectId: 'p1',
      spreadsheetId: 's1',
      driveFolderId: 'f1',
      name: 'テスト SR',
    };
  }
  state.protocol = { ...state.protocol, ...patch };
  return state;
}

/** フォーム送信イベントを発火する（jsdom は requestSubmit 未実装のため直接 dispatch） */
function submitForm(view: HTMLElement): void {
  const form = view.querySelector('#protocol-form') as HTMLFormElement;
  form.dispatchEvent(new Event('submit', { cancelable: true }));
}

function setInlineText(view: HTMLElement, text: string): void {
  (view.querySelector('#protocol-inline') as HTMLTextAreaElement).value = text;
}

function selectFileMode(view: HTMLElement): void {
  const radio = view.querySelector(
    'input[name="protocol-source"][value="file"]',
  ) as HTMLInputElement;
  radio.checked = true;
  radio.dispatchEvent(new Event('change'));
}

/** jsdom の File には text()/arrayBuffer() が無いため補って生成する */
function makeFakeFile(name: string, content = 'file body'): File {
  const file = new File([content], name);
  Object.defineProperty(file, 'text', { value: async () => content });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new ArrayBuffer(content.length),
  });
  return file;
}

function attachFiles(view: HTMLElement, files: File[] | null): void {
  const input = view.querySelector('#protocol-file') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
}

function errorText(view: HTMLElement): string {
  return view.querySelector('#protocol-error')?.textContent ?? '';
}

describe('renderProtocolView', () => {
  test('プロジェクト未選択: 見出しと案内のみ表示し、フォームは出さない', () => {
    const { ctx } = makeCtx();
    const view = renderProtocolView(makeState({}, false), ctx);
    expect(view.querySelector('h2')?.textContent).toBe('プロトコル入力');
    expect(view.querySelector('#protocol-no-project')?.textContent).toContain(
      '先にプロジェクトを選択してください',
    );
    expect(view.querySelector('#protocol-form')).toBeNull();
  });

  test('読み込み中（records = null）: ローディング表示', () => {
    const { ctx } = makeCtx();
    const view = renderProtocolView(makeState(), ctx);
    expect(view.querySelector('#protocol-loading')?.textContent).toContain('読み込んでいます');
  });

  test('loading = true でもローディング表示', () => {
    const { ctx } = makeCtx();
    const view = renderProtocolView(makeState({ records: [], loading: true }), ctx);
    expect(view.querySelector('#protocol-loading')).not.toBeNull();
  });

  test('読み込み失敗: エラー文言と再読み込みボタン', () => {
    const { ctx, callbacks } = makeCtx();
    const view = renderProtocolView(makeState({ loadError: 'ネットワークエラー' }), ctx);
    expect(view.querySelector('#protocol-load-error')?.textContent).toBe(
      'プロトコルを読み込めませんでした: ネットワークエラー',
    );
    (view.querySelector('#protocol-reload') as HTMLButtonElement).click();
    expect(callbacks.onReload).toHaveBeenCalledTimes(1);
  });

  describe('新規フォーム（records = []）', () => {
    test('手入力モードが既定で、ファイルセクションは隠れている', () => {
      const { ctx } = makeCtx();
      const view = renderProtocolView(makeState({ records: [] }), ctx);
      expect((view.querySelector('#protocol-manual-section') as HTMLElement).hidden).toBe(false);
      expect((view.querySelector('#protocol-file-section') as HTMLElement).hidden).toBe(true);
      expect(view.querySelector('#protocol-submit')?.textContent).toBe('保存する');
      expect(view.querySelector('#protocol-cancel')).toBeNull();
    });

    test('ラジオ切替でセクションの表示が入れ替わる', () => {
      const { ctx } = makeCtx();
      const view = renderProtocolView(makeState({ records: [] }), ctx);
      selectFileMode(view);
      expect((view.querySelector('#protocol-manual-section') as HTMLElement).hidden).toBe(true);
      expect((view.querySelector('#protocol-file-section') as HTMLElement).hidden).toBe(false);

      const manualRadio = view.querySelector(
        'input[name="protocol-source"][value="manual"]',
      ) as HTMLInputElement;
      manualRadio.checked = true;
      manualRadio.dispatchEvent(new Event('change'));
      expect((view.querySelector('#protocol-manual-section') as HTMLElement).hidden).toBe(false);
    });

    test('手入力の送信で onSubmit に本文を渡す', () => {
      const { ctx, callbacks } = makeCtx();
      const view = renderProtocolView(makeState({ records: [] }), ctx);
      setInlineText(view, 'P: 成人肺炎');
      submitForm(view);
      expect(callbacks.onSubmit).toHaveBeenCalledWith({
        sourceType: 'manual',
        inlineText: 'P: 成人肺炎',
      });
      expect(errorText(view)).toBe('');
    });

    test('空本文（空白のみ）はエラーにして送信しない', () => {
      const { ctx, callbacks } = makeCtx();
      const view = renderProtocolView(makeState({ records: [] }), ctx);
      setInlineText(view, '  \n ');
      submitForm(view);
      expect(errorText(view)).toBe('本文を入力してください');
      expect(callbacks.onSubmit).not.toHaveBeenCalled();
    });

    test('ファイル未選択（空 FileList / files = null）はエラー', () => {
      const { ctx, callbacks } = makeCtx();
      const view = renderProtocolView(makeState({ records: [] }), ctx);
      selectFileMode(view);
      submitForm(view); // jsdom 既定の空 FileList
      expect(errorText(view)).toBe('プロトコルファイルを選択してください');

      attachFiles(view, null);
      submitForm(view);
      expect(errorText(view)).toBe('プロトコルファイルを選択してください');
      expect(callbacks.onSubmit).not.toHaveBeenCalled();
    });

    test('.md ファイルは markdown として遅延読み込みラッパ付きで送信する', async () => {
      const { ctx, callbacks } = makeCtx();
      const view = renderProtocolView(makeState({ records: [] }), ctx);
      selectFileMode(view);
      attachFiles(view, [makeFakeFile('protocol.md', '# 本文')]);
      submitForm(view);
      expect(callbacks.onSubmit).toHaveBeenCalledTimes(1);
      const input = callbacks.onSubmit.mock.calls[0]?.[0];
      expect(input).toMatchObject({ sourceType: 'markdown', file: { name: 'protocol.md' } });
      if (input?.sourceType === 'markdown') {
        await expect(input.file.text()).resolves.toBe('# 本文');
      }
    });

    test('.DOCX ファイル（大文字）は docx として送信する', async () => {
      const { ctx, callbacks } = makeCtx();
      const view = renderProtocolView(makeState({ records: [] }), ctx);
      selectFileMode(view);
      attachFiles(view, [makeFakeFile('Protocol.DOCX')]);
      submitForm(view);
      const input = callbacks.onSubmit.mock.calls[0]?.[0];
      expect(input).toMatchObject({ sourceType: 'docx', file: { name: 'Protocol.DOCX' } });
      if (input?.sourceType === 'docx') {
        await expect(input.file.arrayBuffer()).resolves.toBeInstanceOf(ArrayBuffer);
      }
    });

    test('未対応拡張子はエラー', () => {
      const { ctx, callbacks } = makeCtx();
      const view = renderProtocolView(makeState({ records: [] }), ctx);
      selectFileMode(view);
      attachFiles(view, [makeFakeFile('protocol.txt')]);
      submitForm(view);
      expect(errorText(view)).toBe('対応形式は .md / .markdown / .docx です');
      expect(callbacks.onSubmit).not.toHaveBeenCalled();
    });

    test('保存中: ボタン無効化・status 表示・下書き本文の復元', () => {
      const { ctx } = makeCtx();
      const view = renderProtocolView(
        makeState({ records: [], saving: true, draftText: '編集中の本文' }),
        ctx,
      );
      expect((view.querySelector('#protocol-submit') as HTMLButtonElement).disabled).toBe(true);
      expect(view.querySelector('#protocol-status')?.textContent).toContain('保存中');
      expect((view.querySelector('#protocol-inline') as HTMLTextAreaElement).value).toBe(
        '編集中の本文',
      );
    });

    test('保存失敗: saveError をエラー領域に表示する', () => {
      const { ctx } = makeCtx();
      const view = renderProtocolView(
        makeState({ records: [], saveError: 'Sheets への追記に失敗しました' }),
        ctx,
      );
      expect(errorText(view)).toBe('Sheets への追記に失敗しました');
    });
  });

  describe('読み取り専用（最新版サマリ）', () => {
    test('1 版のみ: サマリを表示し、バージョン切替は出さない', () => {
      const { ctx, callbacks } = makeCtx();
      const view = renderProtocolView(makeState({ records: [makeProtocol(1)] }), ctx);
      const summary = view.querySelector('#protocol-summary') as HTMLElement;
      expect(summary.textContent).toContain('v1');
      expect(summary.textContent).toContain('手入力');
      expect(summary.textContent).toContain('P: 成人肺炎 全文');
      expect(summary.textContent).toContain('—'); // 元ファイルなし
      expect(summary.textContent).toContain('tester@example.com');
      expect(view.querySelector('#protocol-version-select')).toBeNull();
      expect(view.querySelector('#protocol-old-note')).toBeNull();

      (view.querySelector('#protocol-edit') as HTMLButtonElement).click();
      expect(callbacks.onStartEdit).toHaveBeenCalledTimes(1);
      (view.querySelector('#protocol-reload') as HTMLButtonElement).click();
      expect(callbacks.onReload).toHaveBeenCalledTimes(1);
    });

    test('ファイル由来の版: ファイル名と Drive リンクを表示し、本文はプレビューへフォールバックする', () => {
      const { ctx } = makeCtx();
      const record = makeProtocol(1, {
        sourceType: 'markdown',
        sourceFilename: 'protocol.md',
        rawTextRef: 'https://drive.google.com/file/d/raw-1/view',
        rawTextInline: null,
      });
      const view = renderProtocolView(makeState({ records: [record] }), ctx);
      const summary = view.querySelector('#protocol-summary') as HTMLElement;
      expect(summary.textContent).toContain('Markdown（protocol.md）');
      expect(summary.textContent).toContain('P: 成人肺炎 プレビュー');
      const link = summary.querySelector('a') as HTMLAnchorElement;
      expect(link.textContent).toBe('Drive で開く');
      expect(link.getAttribute('href')).toBe('https://drive.google.com/file/d/raw-1/view');
    });

    test('本文もプレビューも無い版は — を表示する', () => {
      const { ctx } = makeCtx();
      const record = makeProtocol(1, { rawTextInline: null, rawTextPreview: null });
      const view = renderProtocolView(makeState({ records: [record] }), ctx);
      const dds = view.querySelectorAll('#protocol-summary dd');
      expect(dds[2]?.textContent).toBe('—'); // 本文
    });

    test('複数版: 切替 select を表示し、変更で onSelectVersion を呼ぶ', () => {
      const { ctx, callbacks } = makeCtx();
      const view = renderProtocolView(
        makeState({ records: [makeProtocol(2), makeProtocol(1)] }),
        ctx,
      );
      const select = view.querySelector('#protocol-version-select') as HTMLSelectElement;
      expect(select.options).toHaveLength(2);
      expect(select.value).toBe('2'); // 既定は最新
      select.value = '1';
      select.dispatchEvent(new Event('change'));
      expect(callbacks.onSelectVersion).toHaveBeenCalledWith(1);
    });

    test('古い版を選択中: 注記を表示し、サマリは選択版を描く', () => {
      const { ctx } = makeCtx();
      const view = renderProtocolView(
        makeState({
          records: [makeProtocol(2), makeProtocol(1, { rawTextInline: 'v1 の本文' })],
          selectedVersion: 1,
        }),
        ctx,
      );
      expect(view.querySelector('#protocol-old-note')?.textContent).toBe(
        '古い版を表示しています（最新: v2）',
      );
      expect(view.querySelector('#protocol-summary')?.textContent).toContain('v1 の本文');
      const select = view.querySelector('#protocol-version-select') as HTMLSelectElement;
      expect(select.value).toBe('1');
    });
  });

  describe('再入力フォーム（editing = true）', () => {
    test('送信ボタンは「新しい版として保存」でキャンセルボタンを持つ', () => {
      const { ctx, callbacks } = makeCtx();
      const view = renderProtocolView(
        makeState({ records: [makeProtocol(1)], editing: true }),
        ctx,
      );
      expect(view.querySelector('#protocol-readonly')).toBeNull();
      expect(view.querySelector('#protocol-submit')?.textContent).toBe('新しい版として保存');
      const cancel = view.querySelector('#protocol-cancel') as HTMLButtonElement;
      cancel.click();
      expect(callbacks.onCancelEdit).toHaveBeenCalledTimes(1);
    });

    test('保存中はキャンセルも無効化する', () => {
      const { ctx } = makeCtx();
      const view = renderProtocolView(
        makeState({ records: [makeProtocol(1)], editing: true, saving: true }),
        ctx,
      );
      expect((view.querySelector('#protocol-cancel') as HTMLButtonElement).disabled).toBe(true);
    });
  });
});

describe('renderProtocolView（表示言語 en。issue #93）', () => {
  afterEach(() => {
    setUiLanguage('ja');
  });

  test('見出し・フォーム・検証エラーが en で描画される', () => {
    setUiLanguage('en');
    const { ctx } = makeCtx();
    const view = renderProtocolView(makeState({ records: [] }), ctx);
    expect(view.querySelector('h2')?.textContent).toBe('Protocol input');
    expect(view.querySelector('#protocol-submit')?.textContent).toBe('Save');
    // 空本文の検証エラーも en
    submitForm(view);
    expect(view.querySelector('#protocol-error')?.textContent).toBe('Enter the protocol text');
  });

  test('読み取り専用サマリの用語ラベルが en で描画される', () => {
    setUiLanguage('en');
    const { ctx } = makeCtx();
    const view = renderProtocolView(
      makeState({ records: [makeProtocol(1)] }),
      ctx,
    );
    expect(view.textContent).toContain('Input format');
    expect(view.querySelector('#protocol-edit')?.textContent).toBe('Enter a new version');
  });
});
