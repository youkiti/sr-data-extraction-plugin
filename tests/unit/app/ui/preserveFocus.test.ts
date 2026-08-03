// ストア再描画をまたぐ入力中（未コミット）の値・キャレット位置の退避・復元（issue #232）。
// preserveScroll.test.ts と同じ体裁: モジュール単体の分岐を全部踏む
import { captureFocusState, restoreFocusState, type FocusSnapshot } from '../../../../src/app/ui/preserveFocus';

afterEach(() => {
  document.body.replaceChildren();
});

describe('captureFocusState', () => {
  test('activeElement が無い document では null を返す', () => {
    const detachedDoc = document.implementation.createHTMLDocument('t');
    detachedDoc.body.remove();
    expect(captureFocusState(detachedDoc)).toBeNull();
  });

  test('フォーカス対象が無ければ（body がアクティブ）null を返す', () => {
    document.body.focus();
    expect(captureFocusState(document)).toBeNull();
  });

  test('チェックボックス（テキスト系でない input）はフォーカス中でも対象外', () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'cb';
    document.body.append(checkbox);
    checkbox.focus();
    expect(captureFocusState(document)).toBeNull();
  });

  test('type 未指定の input はテキスト系として扱う', () => {
    const input = document.createElement('input');
    input.id = 'no-type';
    input.value = 'abc';
    document.body.append(input);
    input.focus();
    const snapshot = captureFocusState(document);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.tagName).toBe('INPUT');
    expect(snapshot?.value).toBe('abc');
  });

  test('textarea はテキスト系として対象になる', () => {
    const textarea = document.createElement('textarea');
    textarea.id = 'ta';
    textarea.value = 'メモ';
    document.body.append(textarea);
    textarea.setSelectionRange(1, 2, 'forward');
    textarea.focus();
    const snapshot = captureFocusState(document);
    expect(snapshot).toEqual({
      element: textarea,
      tagName: 'TEXTAREA',
      keyType: 'id',
      restoreKey: 'ta',
      value: 'メモ',
      selectionStart: 1,
      selectionEnd: 2,
      selectionDirection: 'forward',
    });
  });

  test('id があれば id を復元キーにする', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'with-id';
    input.setAttribute('aria-label', '無視されるはずのラベル');
    document.body.append(input);
    input.focus();
    const snapshot = captureFocusState(document);
    expect(snapshot?.keyType).toBe('id');
    expect(snapshot?.restoreKey).toBe('with-id');
  });

  test('id が無く aria-label があればそれを復元キーにする', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('aria-label', '1 行目の field_name');
    document.body.append(input);
    input.focus();
    const snapshot = captureFocusState(document);
    expect(snapshot?.keyType).toBe('ariaLabel');
    expect(snapshot?.restoreKey).toBe('1 行目の field_name');
  });

  test('id も aria-label も無ければ復元できないため null', () => {
    const input = document.createElement('input');
    input.type = 'text';
    document.body.append(input);
    input.focus();
    expect(captureFocusState(document)).toBeNull();
  });
});

describe('restoreFocusState', () => {
  test('snapshot が null なら何もしない', () => {
    expect(() => restoreFocusState(document, null)).not.toThrow();
  });

  test('id 検索で該当ノードが無ければ何もしない', () => {
    const snapshot: FocusSnapshot = {
      element: document.createElement('input'),
      tagName: 'INPUT',
      keyType: 'id',
      restoreKey: 'missing-id',
      value: 'x',
      selectionStart: 0,
      selectionEnd: 0,
      selectionDirection: 'none',
    };
    expect(() => restoreFocusState(document, snapshot)).not.toThrow();
  });

  test('id 検索でタグ名が一致しなければ復元しない', () => {
    const div = document.createElement('div');
    div.id = 'mismatch';
    document.body.append(div);
    const snapshot: FocusSnapshot = {
      element: document.createElement('input'),
      tagName: 'INPUT',
      keyType: 'id',
      restoreKey: 'mismatch',
      value: 'x',
      selectionStart: 0,
      selectionEnd: 0,
      selectionDirection: 'none',
    };
    restoreFocusState(document, snapshot);
    expect(div.textContent).toBe('');
  });

  test('aria-label 検索で該当ノードが無ければ何もしない', () => {
    const snapshot: FocusSnapshot = {
      element: document.createElement('textarea'),
      tagName: 'TEXTAREA',
      keyType: 'ariaLabel',
      restoreKey: 'no-such-label',
      value: 'x',
      selectionStart: 0,
      selectionEnd: 0,
      selectionDirection: 'none',
    };
    expect(() => restoreFocusState(document, snapshot)).not.toThrow();
  });

  test('aria-label 検索はタグ名が一致しない候補を読み飛ばし、一致する候補を復元する', () => {
    const wrongTag = document.createElement('input');
    wrongTag.type = 'text';
    wrongTag.setAttribute('aria-label', 'dup-label');
    const rightTag = document.createElement('textarea');
    rightTag.setAttribute('aria-label', 'dup-label');
    rightTag.value = 'from-store';
    document.body.append(wrongTag, rightTag);

    const snapshot: FocusSnapshot = {
      element: document.createElement('textarea'), // 退避時の別インスタンス
      tagName: 'TEXTAREA',
      keyType: 'ariaLabel',
      restoreKey: 'dup-label',
      value: 'typed value',
      selectionStart: 2,
      selectionEnd: 4,
      selectionDirection: 'none',
    };
    restoreFocusState(document, snapshot);
    expect(rightTag.value).toBe('typed value');
    expect(wrongTag.value).toBe(''); // 触れられていない
  });

  test('復元先が退避時と同一インスタンスなら何もしない（再接続だけで作り直されていない）', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'same-instance';
    input.value = 'original';
    document.body.append(input);
    const snapshot: FocusSnapshot = {
      element: input, // 同一参照
      tagName: 'INPUT',
      keyType: 'id',
      restoreKey: 'same-instance',
      value: 'typed',
      selectionStart: 0,
      selectionEnd: 0,
      selectionDirection: 'none',
    };
    restoreFocusState(document, snapshot);
    expect(input.value).toBe('original'); // 上書きされない
  });

  test('現在値がスナップショットと同じなら値は上書きせず、合成 change も仕掛けない', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'same-value';
    input.value = 'kept';
    document.body.append(input);
    const changeSpy = jest.fn();
    input.addEventListener('change', changeSpy);

    const snapshot: FocusSnapshot = {
      element: document.createElement('input'), // 別インスタンス（作り直された想定）
      tagName: 'INPUT',
      keyType: 'id',
      restoreKey: 'same-value',
      value: 'kept',
      selectionStart: 0,
      selectionEnd: 0,
      selectionDirection: 'none',
    };
    restoreFocusState(document, snapshot);
    input.dispatchEvent(new Event('blur'));
    expect(changeSpy).not.toHaveBeenCalled();
    expect(input.value).toBe('kept');
  });

  test('値・キャレット位置・フォーカスを復元し、無変更で blur すると合成 change でコミットされる', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'target';
    input.value = 'from-store';
    document.body.append(input);
    const changeSpy = jest.fn();
    input.addEventListener('change', changeSpy);

    const snapshot: FocusSnapshot = {
      element: document.createElement('input'),
      tagName: 'INPUT',
      keyType: 'id',
      restoreKey: 'target',
      value: 'typed-in-progress',
      selectionStart: 3,
      selectionEnd: 6,
      selectionDirection: 'backward',
    };
    restoreFocusState(document, snapshot);
    expect(input.value).toBe('typed-in-progress');
    expect(input.selectionStart).toBe(3);
    expect(input.selectionEnd).toBe(6);
    expect(input.selectionDirection).toBe('backward');
    expect(document.activeElement).toBe(input);

    input.dispatchEvent(new Event('blur'));
    expect(changeSpy).toHaveBeenCalledTimes(1);
  });

  test('native の change が先に飛べば合成 change を追加送出しない（二重コミット防止）', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'target2';
    input.value = 'from-store';
    document.body.append(input);

    const snapshot: FocusSnapshot = {
      element: document.createElement('input'),
      tagName: 'INPUT',
      keyType: 'id',
      restoreKey: 'target2',
      value: 'typed',
      selectionStart: 0,
      selectionEnd: 0,
      selectionDirection: 'none',
    };
    restoreFocusState(document, snapshot);

    const changeSpy = jest.fn();
    input.addEventListener('change', changeSpy);
    input.value = 'typed-more'; // ユーザーが追加入力した想定
    input.dispatchEvent(new Event('change', { bubbles: true })); // native change が先に来る
    input.dispatchEvent(new Event('blur'));
    expect(changeSpy).toHaveBeenCalledTimes(1); // 合成 change の追加送出なし
  });

  test('setSelectionRange が throw しても復元処理は継続し、フォーカスは戻る', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'throwing';
    input.value = 'kept';
    document.body.append(input);
    input.setSelectionRange = jest.fn(() => {
      throw new Error('unsupported');
    });
    const focusSpy = jest.spyOn(input, 'focus');

    const snapshot: FocusSnapshot = {
      element: document.createElement('input'),
      tagName: 'INPUT',
      keyType: 'id',
      restoreKey: 'throwing',
      value: 'typed',
      selectionStart: 1,
      selectionEnd: 2,
      selectionDirection: 'none',
    };
    expect(() => restoreFocusState(document, snapshot)).not.toThrow();
    expect(input.value).toBe('typed');
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
  });
});
