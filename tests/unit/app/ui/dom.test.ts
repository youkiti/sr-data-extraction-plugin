import { el, svgIcon } from '../../../../src/app/ui/dom';

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

describe('svgIcon', () => {
  test('path 配列から aria-hidden な SVG を生成する', () => {
    const svg = svgIcon(['M3 6h18', 'M10 11v6']);
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    const paths = svg.querySelectorAll('path');
    expect(paths).toHaveLength(2);
    expect(paths[0]?.getAttribute('d')).toBe('M3 6h18');
  });
});
