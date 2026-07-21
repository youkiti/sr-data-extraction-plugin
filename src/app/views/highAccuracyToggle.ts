// S6 パイロット / S7 一括抽出の実行前画面に置く高精度読み取りモードのトグル
// （issue #176: テキスト層のある文書にもページ画像を併用添付する run 単位のオプトイン）。
// fieldSelectionChecklist.ts と同じ「#/pilot と #/extract は同時にマウントされないため
// 描画ロジックを共有し、id / class だけ画面別に prefix する」構成。
// 実行に効かせる値（provider 非対応時は無効化する「実効値」）は
// lib/llm/providerFactory.ts の resolveEffectiveHighAccuracyImages が一元判定する
// （UI の disabled 表示・コスト概算・実行の 3 箇所で判定を揃えるため）。
import { providerSupportsImageInput, resolveProviderId } from '../../lib/llm/providerFactory';
import { t } from '../../lib/i18n';
import { el } from '../ui/dom';

export interface HighAccuracyToggleProps {
  /** 'pilot' | 'extract'。id / class の prefix */
  idPrefix: string;
  /** state 上のチェックボックス値（provider 非対応でも保持したままにする。トグル自体は disabled 表示） */
  checked: boolean;
  /** requested_model。空文字はプロバイダ未確定として常に有効表示する（後続のモデル未選択検証に委ねる） */
  model: string;
  onChange(enabled: boolean): void;
}

/**
 * 選択中モデルのプロバイダが画像入力に対応しないため、高精度読み取りモードを選択できないか。
 * model が空文字（未選択）のときは判定不能のため false（= 選択可のまま。実行時は別途
 * モデル未選択のエラーで止まる）
 */
export function isHighAccuracyImagesDisabled(model: string): boolean {
  return model !== '' && !providerSupportsImageInput(resolveProviderId(model));
}

export function renderHighAccuracyToggle(props: HighAccuracyToggleProps): HTMLElement {
  const disabled = isHighAccuracyImagesDisabled(props.model);
  const checkboxId = `${props.idPrefix}-high-accuracy-images`;
  const checkbox = el('input', {
    attributes: { type: 'checkbox', id: checkboxId },
  });
  checkbox.checked = props.checked;
  checkbox.disabled = disabled;
  checkbox.addEventListener('change', () => props.onChange(checkbox.checked));

  const children: HTMLElement[] = [
    el('label', { className: `${props.idPrefix}__high-accuracy-choice` }, [
      checkbox,
      el('span', { text: t('extraction.highAccuracyLabel') }),
    ]),
    el('p', {
      className: `${props.idPrefix}__high-accuracy-warning`,
      text: t('extraction.highAccuracyWarning'),
    }),
  ];
  if (disabled) {
    children.push(
      el('p', {
        id: `${props.idPrefix}-high-accuracy-disabled`,
        className: `${props.idPrefix}__high-accuracy-disabled`,
        text: t('extraction.highAccuracyDisabledReason'),
      }),
    );
  }
  return el('div', { id: `${props.idPrefix}-high-accuracy`, className: `${props.idPrefix}__high-accuracy` }, children);
}
