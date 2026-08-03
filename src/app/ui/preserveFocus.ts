// 入力中（未コミット）の値・キャレット位置を再描画をまたいで保持する（issue #232）。
// schemaView 等のセル入力は change イベントでしかストアへコミットされない
// （input.addEventListener('change', ...)）。ストア更新のたびに bootstrap の
// store.subscribe が route 全体を replaceChildren で作り直すため、入力中の <input> /
// <textarea> は毎回新しいノードに差し替わり、value がストア由来の値へ巻き戻る
// = 入力途中の文字が消える。preserveScroll.ts（issue #192）と同じ seam に、
// 同じ流儀で「フォーカス中のテキスト系入力」の退避・復元を足す

/** 復元キーの種別。id があれば id、無ければ aria-label を使う */
type RestoreKeyType = 'id' | 'ariaLabel';

/** captureFocusState / restoreFocusState が対象にする要素（テキスト系のみ） */
type TextEditableElement = HTMLInputElement | HTMLTextAreaElement;

export interface FocusSnapshot {
  /** 退避時の要素参照。復元時に「同一インスタンスが再接続されただけ」かどうかの判定に使う */
  element: Element;
  /** 復元時にタグ名の一致を要求する（id 流用・aria-label 重複による誤復元を防ぐ） */
  tagName: string;
  keyType: RestoreKeyType;
  restoreKey: string;
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  /**
   * text 系 input / textarea に限って記録するため実行時には null にならない
   * （selectionDirection が null になるのは selection 非対応の input type のときだけ）
   */
  selectionDirection: SelectionDirection;
}

/** textarea、または type が text / 未指定の input だけを対象にする */
function isTextEditable(element: Element): element is TextEditableElement {
  if (element instanceof HTMLTextAreaElement) {
    return true;
  }
  return element instanceof HTMLInputElement && element.type === 'text';
}

/** 再描画前に呼ぶ: フォーカス中のテキスト系入力の値・キャレット位置・復元キーを退避する */
export function captureFocusState(doc: Document): FocusSnapshot | null {
  const active = doc.activeElement;
  if (active === null || !isTextEditable(active)) {
    return null;
  }
  const id = active.id;
  const ariaLabel = active.getAttribute('aria-label');
  if (id === '' && ariaLabel === null) {
    // 復元キーが無い要素は復元先を特定できないため退避しない
    return null;
  }
  return {
    element: active,
    tagName: active.tagName,
    keyType: id !== '' ? 'id' : 'ariaLabel',
    restoreKey: id !== '' ? id : (ariaLabel as string),
    value: active.value,
    selectionStart: active.selectionStart,
    selectionEnd: active.selectionEnd,
    selectionDirection: active.selectionDirection as SelectionDirection,
  };
}

/**
 * 復元先ノードを探す。CSS セレクタ文字列は組み立てない
 * （aria-label は日本語で引用符等が入りうるためエスケープ事故になる）。
 * id は doc.getElementById、aria-label は input / textarea を総当たりして属性値を文字列比較する。
 * どちらもタグ名が一致しないものは対象外
 */
function findRestoreTarget(doc: Document, snapshot: FocusSnapshot): TextEditableElement | null {
  if (snapshot.keyType === 'id') {
    const node = doc.getElementById(snapshot.restoreKey);
    if (node === null || node.tagName !== snapshot.tagName) {
      return null;
    }
    return node as TextEditableElement;
  }
  const candidates = doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
  for (const candidate of Array.from(candidates)) {
    if (
      candidate.tagName === snapshot.tagName &&
      candidate.getAttribute('aria-label') === snapshot.restoreKey
    ) {
      return candidate;
    }
  }
  return null;
}

/**
 * .value をプログラムから代入すると、ブラウザ内部の「前回の change 以降にユーザーが
 * 変更した」フラグがクリアされる。そのため復元後に 1 文字も追加入力せずフォーカスを外すと
 * native の change が発火せず、値が一度もストアへ入らないまま次の再描画で静かに消える。
 * change が一度も来ないまま blur したときだけ、合成 change を発火してコミット経路
 * （onCommit 配線）へ載せる。native の change が先に来ていれば二重コミットしない
 */
function armCommitGuarantee(node: TextEditableElement, originalValue: string): void {
  let committed = false;
  const handleChange = (): void => {
    committed = true;
  };
  const handleBlur = (): void => {
    node.removeEventListener('change', handleChange);
    if (!committed && node.value !== originalValue) {
      node.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };
  node.addEventListener('change', handleChange, { once: true });
  node.addEventListener('blur', handleBlur, { once: true });
}

/**
 * 再描画後に呼ぶ: 復元先ノードが見つかり、かつ退避時と別インスタンス（= 作り直された）の
 * ときだけ、値・キャレット位置・フォーカスを復元する。同一インスタンスがそのまま
 * 再接続された場合は何もしない（preserveScroll の isConnected 判定と同じ考え方）
 */
export function restoreFocusState(doc: Document, snapshot: FocusSnapshot | null): void {
  if (snapshot === null) {
    return;
  }
  const node = findRestoreTarget(doc, snapshot);
  if (node === null) {
    return;
  }
  if (node === snapshot.element) {
    return;
  }
  const originalValue = node.value;
  if (originalValue !== snapshot.value) {
    node.value = snapshot.value;
    armCommitGuarantee(node, originalValue);
  }
  try {
    node.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd, snapshot.selectionDirection);
  } catch {
    // 環境によっては setSelectionRange が対応外で throw しうるため握りつぶす
  }
  node.focus({ preventScroll: true });
}
