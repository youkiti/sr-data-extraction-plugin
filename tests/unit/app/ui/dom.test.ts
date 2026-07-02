import { el } from '../../../../src/app/ui/dom';

describe('el', () => {
  test('タグのみで生成できる（オプション省略）', () => {
    const node = el('div');
    expect(node.tagName).toBe('DIV');
    expect(node.className).toBe('');
  });

  test('className / id / text / attributes を設定する', () => {
    const node = el('p', {
      className: 'note',
      id: 'note-1',
      text: 'こんにちは',
      attributes: { 'aria-live': 'polite', role: 'status' },
    });
    expect(node.className).toBe('note');
    expect(node.id).toBe('note-1');
    expect(node.textContent).toBe('こんにちは');
    expect(node.getAttribute('aria-live')).toBe('polite');
    expect(node.getAttribute('role')).toBe('status');
  });

  test('子要素（HTMLElement / 文字列）を追加する', () => {
    const child = el('span', { text: 'child' });
    const node = el('div', {}, [child, ' and text']);
    expect(node.children).toHaveLength(1);
    expect(node.textContent).toBe('child and text');
  });
});
