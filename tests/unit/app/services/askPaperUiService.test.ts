import {
  renderAskPaperPanel,
  disposeAskPaperPanelCache,
} from '../../../../src/app/views/askPaperPanel';
import { captureFocusState, restoreFocusState } from '../../../../src/app/ui/preserveFocus';
import { sendAskPaperQuestion } from '../../../../src/app/services/askPaperUiService';
import { askPaper, type AskPaperDeps } from '../../../../src/app/services/askPaperService';
import { createInitialState, createStore } from '../../../../src/app/store';
import { loadDefaultModel, FACTORY_DEFAULT_MODEL } from '../../../../src/lib/storage/settingsStore';
import { installChromeMock } from '../../../setup/chrome-mock';
import { askPaperUsedStudiesStorageKey } from '../../../../src/lib/storage/askPaperStore';
import type { ProfileDeps } from '../../../../src/lib/google/identity';
import { makeAskParams, makeAskTurn } from '../askPaperFixtures';

jest.mock('../../../../src/app/services/askPaperService', () => ({ askPaper: jest.fn() }));
jest.mock('../../../../src/lib/storage/settingsStore', () => ({
  ...jest.requireActual('../../../../src/lib/storage/settingsStore'),
  loadDefaultModel: jest.fn(async () => null),
}));
const ask = jest.mocked(askPaper);
beforeEach(() => {
  installChromeMock();
});
function setup() {
  const initial = createInitialState();
  initial.currentProject = {
    projectId: 'p1',
    spreadsheetId: 'sheet-1',
    driveFolderId: 'folder',
    name: 'SR',
  };
  initial.role.role = 'owner';
  const store = createStore(initial);
  const deps: AskPaperDeps & { profile: ProfileDeps } = {
    profile: { getProfileUserInfo: async () => ({ email: 'owner@example.com', id: 'owner' }) },
    google: { fetch: jest.fn(), getAccessToken: jest.fn() },
    loadApiKey: jest.fn(),
    buildProvider: jest.fn(),
  };
  ask.mockResolvedValue({ status: 'answered', turn: makeAskTurn() });
  return { store, deps };
}

test('送信開始時から印を付け、既定モデルを解決し、回答をstudy別に保持する', async () => {
  const { store, deps } = setup();
  let resolve: (value: Awaited<ReturnType<typeof askPaper>>) => void = () => undefined;
  ask.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const promise = sendAskPaperQuestion(store, deps, makeAskParams());
  expect(store.getState().askPaper).toMatchObject({ sending: true, usedStudyIds: ['study-1'] });
  await Promise.resolve();
  await Promise.resolve();
  resolve({ status: 'answered', turn: makeAskTurn() });
  await promise;
  expect(store.getState().askPaper).toMatchObject({
    sending: false,
    model: FACTORY_DEFAULT_MODEL,
    conversations: { 'study-1': [makeAskTurn()] },
  });
  expect(loadDefaultModel).toHaveBeenCalled();
  expect(ask).toHaveBeenCalledWith(
    expect.objectContaining({ spreadsheetId: 'sheet-1', history: [] }),
    expect.anything(),
  );
  expect(await ask.mock.calls[0]?.[1].loadDefaultModel?.()).toBe(FACTORY_DEFAULT_MODEL);
  await sendAskPaperQuestion(store, deps, makeAskParams());
  expect(store.getState().askPaper.usedStudyIds).toEqual(['study-1']);
  expect(store.getState().askPaper.conversations['study-1']).toHaveLength(2);
  expect(ask.mock.calls[1]?.[0].history).toEqual([makeAskTurn()]);
});

test('注入したOptionsモデルを使い、失敗しても印を保持する', async () => {
  const { store, deps } = setup();
  deps.loadDefaultModel = async () => 'custom';
  ask.mockResolvedValue({ status: 'error', message: 'APIキー未設定' });
  await sendAskPaperQuestion(store, deps, makeAskParams());
  expect(store.getState().askPaper).toMatchObject({
    sending: false,
    model: 'custom',
    error: 'APIキー未設定',
    usedStudyIds: ['study-1'],
    conversations: {},
  });
});

test.each([new Error('設定読込失敗'), '設定読込失敗'])(
  '設定解決中の例外でも送信状態を戻す: %s',
  async (error) => {
    const { store, deps } = setup();
    deps.loadDefaultModel = async () => {
      throw error;
    };
    await sendAskPaperQuestion(store, deps, makeAskParams());
    expect(store.getState().askPaper).toMatchObject({ sending: false, error: '設定読込失敗' });
  },
);

test.each(['project', 'role', 'sending', 'empty'] as const)(
  '無効な送信は実行しない: %s',
  async (kind) => {
    const { store, deps } = setup();
    const params = makeAskParams();
    if (kind === 'project') store.setState({ currentProject: null });
    if (kind === 'role')
      store.setState({ role: { ...store.getState().role, role: 'reviewer_independent' } });
    if (kind === 'sending')
      store.setState({ askPaper: { ...store.getState().askPaper, sending: true } });
    if (kind === 'empty') params.question = '  ';
    await sendAskPaperQuestion(store, deps, params);
    expect(ask).not.toHaveBeenCalled();
  },
);

test.each(['answered', 'error'] as const)(
  '下書きは成功時だけ消し、フォーカス復元でも戻らない: %s',
  async (status) => {
    disposeAskPaperPanelCache();
    const { store, deps } = setup();
    const params = makeAskParams();
    const renderPanel = (): void => {
      const focus = captureFocusState(document);
      document.body.replaceChildren(
        renderAskPaperPanel(store.getState().askPaper, params, undefined, jest.fn()),
      );
      restoreFocusState(document, focus);
    };
    renderPanel();
    const input = document.querySelector('textarea') as HTMLTextAreaElement;
    input.value = '何人？';
    input.focus();
    const otherParams = { ...params, studyId: 'other' };
    const other = renderAskPaperPanel(store.getState().askPaper, otherParams, undefined, jest.fn());
    (other.querySelector('textarea') as HTMLTextAreaElement).value = '別の質問';
    store.subscribe(renderPanel);
    ask.mockResolvedValue(
      status === 'answered'
        ? { status: 'answered', turn: makeAskTurn() }
        : { status: 'error', message: 'API エラー' },
    );
    await sendAskPaperQuestion(store, deps, params);
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe(
      status === 'answered' ? '' : '何人？',
    );
    expect(
      (
        renderAskPaperPanel(
          store.getState().askPaper,
          otherParams,
          undefined,
          jest.fn(),
        ).querySelector('textarea') as HTMLTextAreaElement
      ).value,
    ).toBe('別の質問');
  },
);

test('送信ごとにOptionsを読み直し、次の質問と概算のモデルを更新する', async () => {
  const { store, deps } = setup();
  const load = jest.fn().mockResolvedValueOnce('old-model').mockResolvedValueOnce('new-model');
  deps.loadDefaultModel = load;
  await sendAskPaperQuestion(store, deps, makeAskParams());
  expect(await ask.mock.calls[0]?.[1].loadDefaultModel?.()).toBe('old-model');
  await sendAskPaperQuestion(store, deps, makeAskParams());
  expect(await ask.mock.calls[1]?.[1].loadDefaultModel?.()).toBe('new-model');
  expect(store.getState().askPaper.model).toBe('new-model');
  expect(load).toHaveBeenCalledTimes(2);
});

test('回答待ちに入力した次の質問は成功後も消さない', async () => {
  disposeAskPaperPanelCache();
  const { store, deps } = setup();
  const params = makeAskParams();
  let resolve: (result: Awaited<ReturnType<typeof askPaper>>) => void = () => undefined;
  ask.mockImplementation(
    async () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const renderPanel = (): void => {
    document.body.replaceChildren(
      renderAskPaperPanel(store.getState().askPaper, params, undefined, jest.fn()),
    );
  };
  renderPanel();
  (document.querySelector('textarea') as HTMLTextAreaElement).value = params.question;
  store.subscribe(renderPanel);
  const pending = sendAskPaperQuestion(store, deps, params);
  while (ask.mock.calls.length === 0) await Promise.resolve();
  (document.querySelector('textarea') as HTMLTextAreaElement).value = '次の質問';
  resolve({ status: 'answered', turn: makeAskTurn() });
  await pending;
  expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('次の質問');
});

test('送信は質問済みIDのみを保存し、保存失敗でも質問と判定用の印は保持する', async () => {
  const chromeMock = installChromeMock();
  const { store, deps } = setup();
  await sendAskPaperQuestion(store, deps, makeAskParams());
  expect(
    chromeMock.storage.local.data[askPaperUsedStudiesStorageKey('sheet-1', 'owner@example.com')],
  ).toEqual(['study-1']);
  expect(JSON.stringify(chromeMock.storage.local.data)).not.toContain('何人');
  expect(JSON.stringify(chromeMock.storage.local.data)).not.toContain('120人');
  chromeMock.storage.local.set.mockRejectedValueOnce(new Error('保存失敗'));
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  await sendAskPaperQuestion(store, deps, { ...makeAskParams(), studyId: 'study-2' });
  expect(ask).toHaveBeenCalledTimes(2);
  expect(store.getState().askPaper.usedStudyIds).toContain('study-2');
  expect(warning).toHaveBeenCalled();
  warning.mockRestore();
});

describe('AI へ送る前の同意（issue #381）', () => {
  test('キャンセルなら質問済みの印も付けず、質問を送らない', async () => {
    const { store, deps } = setup();
    deps.loadApiKey = jest.fn(async () => 'key');
    deps.ensureAiDataConsent = jest.fn(async () => false);
    const before = store.getState().askPaper;
    await sendAskPaperQuestion(store, deps, makeAskParams());
    expect(deps.ensureAiDataConsent).toHaveBeenCalledWith('gemini');
    expect(ask).not.toHaveBeenCalled();
    expect(store.getState().askPaper).toEqual(before);
  });

  test('同意なら従来どおり送る', async () => {
    const { store, deps } = setup();
    deps.loadApiKey = jest.fn(async () => 'key');
    deps.loadDefaultModel = async () => 'claude-sonnet-4-5';
    deps.ensureAiDataConsent = jest.fn(async () => true);
    await sendAskPaperQuestion(store, deps, makeAskParams());
    expect(deps.ensureAiDataConsent).toHaveBeenCalledWith('anthropic');
    expect(ask).toHaveBeenCalledTimes(1);
    expect(store.getState().askPaper.usedStudyIds).toEqual(['study-1']);
  });

  test('API キー未設定・接続方式の食い違いでは同意を求めず、askPaper のエラー表示に任せる', async () => {
    const { store, deps } = setup();
    const ensureAiDataConsent = jest.fn(async () => false);
    deps.ensureAiDataConsent = ensureAiDataConsent;
    deps.loadApiKey = jest.fn(async () => null);
    await sendAskPaperQuestion(store, deps, makeAskParams());
    deps.loadApiKey = jest.fn(async () => 'key');
    deps.loadLlmConnectionSettings = async () => ({
      provider: 'anthropic', openAiCompatibleEndpoint: null, azureOpenAiEndpoint: null, localLlmEndpoint: null,
    });
    await sendAskPaperQuestion(store, deps, makeAskParams());
    deps.loadLlmConnectionSettings = async () => {
      throw new Error('storage');
    };
    await sendAskPaperQuestion(store, deps, makeAskParams());
    expect(ensureAiDataConsent).not.toHaveBeenCalled();
    expect(ask).toHaveBeenCalledTimes(2);
    expect(store.getState().askPaper).toMatchObject({ sending: false, error: 'storage' });
  });
});

test('設定の初回読み込みが失敗したら再読み込みせず、未同意の質問を送らない', async () => {
  const { store, deps } = setup();
  deps.loadDefaultModel = jest.fn()
    .mockRejectedValueOnce(new Error('設定読み込み失敗'))
    .mockResolvedValue(FACTORY_DEFAULT_MODEL);
  deps.ensureAiDataConsent = jest.fn(async () => true);
  await sendAskPaperQuestion(store, deps, makeAskParams());
  expect(deps.loadDefaultModel).toHaveBeenCalledTimes(1);
  expect(deps.ensureAiDataConsent).not.toHaveBeenCalled();
  expect(ask).not.toHaveBeenCalled();
  expect(store.getState().askPaper).toMatchObject({
    sending: false, error: '設定読み込み失敗', usedStudyIds: [], conversations: {},
  });
});

test('同意待ちの再送信を止め、同意後の質問と会話を一件だけにする', async () => {
  const { store, deps } = setup();
  let resolveConsent!: (value: boolean) => void;
  deps.loadApiKey = jest.fn(async () => 'key');
  deps.ensureAiDataConsent = jest.fn(() => new Promise<boolean>((resolve) => {
    resolveConsent = resolve;
  }));
  const pending = sendAskPaperQuestion(store, deps, makeAskParams());
  expect(store.getState().askPaper).toMatchObject({ sending: true, usedStudyIds: [] });
  await sendAskPaperQuestion(store, deps, makeAskParams());
  while (!resolveConsent) await Promise.resolve();
  expect(deps.ensureAiDataConsent).toHaveBeenCalledTimes(1);
  resolveConsent(true);
  await pending;
  expect(ask).toHaveBeenCalledTimes(1);
  expect(store.getState().askPaper.sending).toBe(false);
  expect(store.getState().askPaper.conversations['study-1']).toHaveLength(1);
});

test('同意確認が例外を返したら送信中を解除し、質問済みの印を付けない', async () => {
  const { store, deps } = setup();
  deps.loadApiKey = jest.fn(async () => 'key');
  deps.ensureAiDataConsent = jest.fn(async () => { throw new Error('同意確認失敗'); });
  await sendAskPaperQuestion(store, deps, makeAskParams());
  expect(ask).not.toHaveBeenCalled();
  expect(store.getState().askPaper).toMatchObject({
    sending: false, error: '同意確認失敗', usedStudyIds: [],
  });
});
