// 保存の競合検出バナー（issue #64）。#/verify 単独画面と #/pilot 埋め込み検証パネルで共有する
// （同一 annotator の 2 コンテキストからの上書きを検出したときに出す。同時に 1 画面しか
// 出ないため id を共有してよい）。extract-interrupted-warning と同じ「文言 + 再読み込み」構成
import { el } from '../ui/dom';

/**
 * 競合検出バナー本体。message は AnnotationConflictError のメッセージをそのまま渡す。
 * onReload は表示中データ束の再読込（呼び出し側が study/run のコンテキストを解決して渡す）
 */
export function renderConflictWarning(message: string, onReload: () => void): HTMLElement {
  const reload = el('button', {
    id: 'verify-conflict-reload',
    text: '再読み込み',
    attributes: { type: 'button' },
  });
  reload.addEventListener('click', () => onReload());
  return el(
    'div',
    {
      id: 'verify-conflict-warning',
      className: 'verify__conflict-warning',
      attributes: { role: 'alert' },
    },
    [el('p', { text: message }), reload],
  );
}
