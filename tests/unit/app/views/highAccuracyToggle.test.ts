// 高精度読み取りモードのトグル（issue #176）の単体テスト
// - isHighAccuracyImagesDisabled: モデル未選択 / プロバイダ対応可否での判定
// - renderHighAccuracyToggle: checked / disabled の反映、onChange の配線、disabled 時の理由表示
//
// 現行 3 プロバイダ（gemini / openrouter / openai_compatible）はいずれも画像入力に対応するため、
// 実際のモデル文字列だけでは disabled=true を再現できない。将来 supportsImageInput=false の
// プロバイダが追加された場合の防御的分岐（要件: 「supportsImageInput が false のプロバイダでは
// 選択不可」）を実際に検証するため、providerSupportsImageInput だけをモックして非対応ケースを再現する
// （istanbul ignore で握りつぶさず、実際にロジックを通す）。
import {
  isHighAccuracyImagesDisabled,
  renderHighAccuracyToggle,
} from '../../../../src/app/views/highAccuracyToggle';
import { providerSupportsImageInput } from '../../../../src/lib/llm/providerFactory';

jest.mock('../../../../src/lib/llm/providerFactory', () => {
  const actual = jest.requireActual('../../../../src/lib/llm/providerFactory');
  return { ...actual, providerSupportsImageInput: jest.fn(actual.providerSupportsImageInput) };
});

const mockedSupports = providerSupportsImageInput as jest.MockedFunction<
  typeof providerSupportsImageInput
>;

describe('isHighAccuracyImagesDisabled', () => {
  it('モデル未選択（空文字）は判定不能のため false（プロバイダ確認はしない）', () => {
    expect(isHighAccuracyImagesDisabled('')).toBe(false);
    expect(mockedSupports).not.toHaveBeenCalled();
  });

  it('選択中プロバイダが画像入力に対応していれば false（現行 3 プロバイダは全対応）', () => {
    expect(isHighAccuracyImagesDisabled('gemini-2.5-pro')).toBe(false);
    expect(isHighAccuracyImagesDisabled('qwen/qwen3-235b-a22b-2507')).toBe(false);
  });

  it('選択中プロバイダが画像入力に非対応なら true（将来の非対応プロバイダを想定した防御的分岐）', () => {
    mockedSupports.mockReturnValueOnce(false);
    expect(isHighAccuracyImagesDisabled('gemini-2.5-pro')).toBe(true);
  });
});

describe('renderHighAccuracyToggle', () => {
  it('通常時: idPrefix でチェックボックス id を組み立て、checked を反映し、変更で onChange を呼ぶ', () => {
    const onChange = jest.fn();
    const el = renderHighAccuracyToggle({
      idPrefix: 'pilot',
      checked: true,
      model: 'gemini-2.5-pro',
      onChange,
    });
    expect(el.id).toBe('pilot-high-accuracy');
    const checkbox = el.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.id).toBe('pilot-high-accuracy-images');
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(false);

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith(false);

    // 対応プロバイダのため disabled 理由は出さない
    expect(el.querySelector('#pilot-high-accuracy-disabled')).toBeNull();
  });

  it('非対応プロバイダ選択時: チェックボックスを disabled にし、理由文言を表示する', () => {
    mockedSupports.mockReturnValueOnce(false);
    const el = renderHighAccuracyToggle({
      idPrefix: 'extract',
      checked: true,
      model: 'gemini-2.5-pro',
      onChange: jest.fn(),
    });
    const checkbox = el.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
    const reason = el.querySelector('#extract-high-accuracy-disabled');
    expect(reason?.textContent).toContain('画像入力に対応していません');
  });
});
