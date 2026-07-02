// DOM 生成ヘルパ（UI ライブラリ不使用の方針を補う最小ユーティリティ）
export interface ElOptions {
  className?: string;
  id?: string;
  text?: string;
  attributes?: Record<string, string>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  children: Array<HTMLElement | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className !== undefined) {
    node.className = options.className;
  }
  if (options.id !== undefined) {
    node.id = options.id;
  }
  if (options.text !== undefined) {
    node.textContent = options.text;
  }
  if (options.attributes) {
    for (const [name, value] of Object.entries(options.attributes)) {
      node.setAttribute(name, value);
    }
  }
  for (const child of children) {
    node.append(child);
  }
  return node;
}
