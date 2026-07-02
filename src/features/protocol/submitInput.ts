// S4 フォームの送信内容（view → service の受け渡し型）。
// File オブジェクトそのものではなく遅延読み込みのラッパを渡す
// （jsdom の File には text()/arrayBuffer() が無く、view のテストを fake で完結させるため）
import type { DocxFileInput } from './parseDocx';
import type { MarkdownFileInput } from './parseMarkdown';

export type ProtocolSubmitInput =
  | { sourceType: 'manual'; inlineText: string }
  | { sourceType: 'markdown'; file: MarkdownFileInput }
  | { sourceType: 'docx'; file: DocxFileInput };
