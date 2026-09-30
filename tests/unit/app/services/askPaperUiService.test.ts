import {
  renderAskPaperPanel,
  disposeAskPaperPanelCache,
} from '../../../../src/app/views/askPaperPanel';
import { captureFocusState, restoreFocusState } from '../../../../src/app/ui/preserveFocus';
import { sendAskPaperQuestion } from '../../../../src/app/services/askPaperUiService';
import { askPaper, type AskPaperDeps } from '../../../../src/app/services/askPaperService';
import { createInitialState, createStore } from '../../../../src/app/store';
import { loadDefaultModel, FACTORY_DEFAULT_MODEL } from '../../../../src/lib/storage/settingsStore';
import { makeAskParams, makeAskTurn } from '../askPaperFixtures';

jest.mock('../../../../src/app/services/askPaperService', () => ({ askPaper: jest.fn() }));
jest.mock('../../../../src/lib/storage/settingsStore', () => ({
  ...jest.requireActual('../../../../src/lib/storage/settingsStore'),
  loadDefaultModel: jest.fn(async () => null),
}));
const ask = jest.mocked(askPaper);
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
  const deps: AskPaperDeps = {
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
