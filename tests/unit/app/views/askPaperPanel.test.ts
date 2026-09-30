import * as askPaperSkill from '../../../../src/features/verification/skills/askPaper';
import {
  renderAskPaperPanel,
  disposeAskPaperPanelCache,
} from '../../../../src/app/views/askPaperPanel';
import { createInitialState } from '../../../../src/app/store';
import { makeAskParams, makeAskTurn, makeCitation } from '../askPaperFixtures';
import { setUiLanguage } from '../../../../src/lib/i18n';

beforeEach(() => {
  disposeAskPaperPanelCache();
  setUiLanguage('ja');
});
function render(
  overrides: Partial<ReturnType<typeof createInitialState>['askPaper']> = {},
  withCallbacks = true,
) {
  const state = { ...createInitialState().askPaper, ...overrides };
  const onSend = jest.fn();
  const onCitation = jest.fn();
  const root = renderAskPaperPanel(
    state,
    makeAskParams(),
    withCallbacks ? { onSend } : undefined,
    onCitation,
  );
  document.body.replaceChildren(root);
  return {
    root,
    onSend,
    onCitation,
    input: root.querySelector('textarea') as HTMLTextAreaElement,
    send: root.querySelector('#ask-paper-send') as HTMLButtonElement,
  };
}

test('既定は閉じ、注意書き・入力ラベル・概算待ちを表示し、空欄は送信不可', () => {
  const { root, send } = render();
  expect(root).toMatchObject({ id: 'ask-paper', className: 'ask-paper', open: false });
  expect(root.querySelector('summary')?.textContent).toBe('論文に質問（AI）');
  expect(root.querySelector('.ask-paper__notice')?.textContent).toContain(
    '共有フォルダには保存しません',
  );
  expect(root.querySelector('textarea')?.getAttribute('aria-label')).toBe('論文への質問');
  expect(root.querySelector('#ask-paper-estimate')?.textContent).toBe('概算を準備しています…');
  expect(send.disabled).toBe(true);
  expect(root.querySelector('#ask-paper-log')?.children).toHaveLength(0);
});

test('入力・開閉状態は非フォーカス時の再描画でも残り、study ごとに独立する', () => {
  const first = render({ model: 'gemini-3.5-flash' });
  (first.root as HTMLDetailsElement).open = true;
  first.input.value = '人数を教えて';
  first.input.dispatchEvent(new Event('input'));
  expect(first.send.disabled).toBe(false);
  expect(first.root.querySelector('#ask-paper-estimate')?.textContent).toContain('約 $');
  const second = render({ model: 'unknown', conversations: { 'study-1': [makeAskTurn()] } });
  expect(second.input.value).toBe('人数を教えて');
  expect((second.root as HTMLDetailsElement).open).toBe(true);
  expect(second.root.querySelector('#ask-paper-estimate')?.textContent).toContain(
    '費用は概算できません',
  );
  const other = renderAskPaperPanel(
    createInitialState().askPaper,
    { ...makeAskParams(), studyId: 'other' },
    undefined,
    jest.fn(),
  );
  expect((other as HTMLDetailsElement).open).toBe(false);
  expect(other.querySelector('textarea')?.value).toBe('');
});

test('送信中はボタン無効・進捗表示、失敗は alert', () => {
  const { root, send, input, onSend } = render({ sending: true, error: 'API エラー' });
  input.value = '人数';
  input.dispatchEvent(new Event('input'));
  send.dispatchEvent(new Event('click'));
  expect(send.disabled).toBe(true);
  expect(onSend).not.toHaveBeenCalled();
  expect(root.querySelector('#ask-paper-progress')?.textContent).toBe('回答を待っています…');
  expect(root.querySelector('#ask-paper-error')?.getAttribute('role')).toBe('alert');
});

test('クリック・Ctrl/Cmd+Enterで送信し、IMEと通常のEnterは無視する', () => {
  const { input, send, onSend } = render();
  input.value = '  人数  ';
  input.dispatchEvent(new Event('input'));
  for (const init of [
    { key: 'Enter', ctrlKey: true, isComposing: true },
    { key: 'Enter', ctrlKey: true, keyCode: 229 },
    { key: 'Enter' },
    { key: 'a', ctrlKey: true },
  ]) {
    input.dispatchEvent(new KeyboardEvent('keydown', init));
  }
  expect(onSend).not.toHaveBeenCalled();
  send.click();
  for (const init of [
    { key: 'Enter', ctrlKey: true },
    { key: 'Enter', metaKey: true },
  ]) {
    const event = new KeyboardEvent('keydown', { ...init, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  }
  expect(onSend).toHaveBeenCalledTimes(3);
  expect(onSend).toHaveBeenCalledWith({
    studyId: 'study-1',
    documents: makeAskParams().documents,
    fields: makeAskParams().fields,
    question: '人数',
  });
});

test('コールバックなしでも送信操作は例外にしない', () => {
  const { input, send } = render({}, false);
  input.value = '人数';
  input.dispatchEvent(new Event('input'));
  expect(() => send.click()).not.toThrow();
});

test('照合済み引用だけがボタンになり、正しいページへジャンプできる', () => {
  const citation = makeCitation({ anchoredPage: 8 });
  const { root, onCitation } = render({
    conversations: {
      'study-1': [
        makeAskTurn({
          citations: [
            citation,
            makeCitation({ highlightable: false, anchoredPage: null, page: 2 }),
            makeCitation({ highlightable: false, anchoredPage: null, page: null }),
          ],
        }),
      ],
    },
  });
  const button = root.querySelector('.ask-paper__citation') as HTMLButtonElement;
  expect(button.textContent).toBe('p.8: 対象者は120人であった。');
  button.click();
  expect(onCitation).toHaveBeenCalledWith(citation);
  expect(root.querySelectorAll('.ask-paper__citation--unanchored')).toHaveLength(2);
  expect(root.textContent).toContain('本文で確認できません');
  expect(root.textContent).toContain('p.?:');
  expect(root.querySelector('.ask-paper__warning')).toBeNull();
  expect(root.querySelector('.ask-paper__question')?.textContent).toBe('何人？');
  expect(root.querySelectorAll('button')).toHaveLength(2); // 送信と引用のみ。値反映の導線を持たない。
});

test('全引用未照合なら回答先頭に警告、未発見なら専用文言を表示する', () => {
  const { root } = render({
    conversations: {
      'study-1': [
        makeAskTurn({ anchoredCount: 0, citations: [] }),
        makeAskTurn({ found: false, citations: [], anchoredCount: 0 }),
      ],
    },
  });
  expect(root.querySelector('.ask-paper__answer')?.firstElementChild?.className).toBe(
    'ask-paper__warning',
  );
  expect(root.querySelector('.ask-paper__warning')?.textContent).toBe(
    '引用を本文で確認できませんでした。回答をそのまま信用しないでください',
  );
  expect(root.querySelectorAll('.ask-paper__warning')).toHaveLength(1);
  expect(root.textContent).toContain('本文に該当する記述が見つかりませんでした');
});

test('本文と定義の概算は入力のたびに連結せず、参照変更時だけ再計算する', () => {
  const builder = jest.spyOn(askPaperSkill, 'buildAskPaperDocumentPrefix');
  const params = makeAskParams();
  const state = { ...createInitialState().askPaper, model: 'gemini-3.5-flash' };
  const root = renderAskPaperPanel(state, params, undefined, jest.fn());
  const input = root.querySelector('textarea') as HTMLTextAreaElement;
  for (const question of ['人数', '人数は', '人数は何人？']) {
    input.value = question;
    input.dispatchEvent(new Event('input'));
  }
  expect(builder).toHaveBeenCalledTimes(1);
  renderAskPaperPanel(state, params, undefined, jest.fn());
  expect(builder).toHaveBeenCalledTimes(1);
  renderAskPaperPanel(state, { ...params, fields: [...params.fields] }, undefined, jest.fn());
  expect(builder).toHaveBeenCalledTimes(2);
  renderAskPaperPanel(state, { ...params, documents: [...params.documents] }, undefined, jest.fn());
  expect(builder).toHaveBeenCalledTimes(3);
  builder.mockRestore();
});
