// document_role の表示ラベル（表示言語に追従。issue #93）。
// 従来は domain/document.ts の DOCUMENT_ROLE_LABELS（ja 固定）を UI が直接参照していたが、
// UI 文言は辞書（lib/i18n）で解決する方針に合わせ、検証パネル・裁定 PDF ペイン等の
// 共有部はこのヘルパを使う（S6 / S7 の配下文書リストは短縮ラベル
// documents.roleAbstractShort / roleSupplementShort を使うため各ビューでキー対応表を持つ）
import type { DocumentRole } from '../../domain/document';
import { t, type MessageKey } from '../../lib/i18n';

const DOCUMENT_ROLE_LABEL_KEYS: Record<DocumentRole, MessageKey> = {
  article: 'documents.roleArticle',
  registration: 'documents.roleRegistration',
  protocol: 'documents.roleProtocol',
  abstract: 'documents.roleAbstract',
  supplement: 'documents.roleSupplement',
  other: 'documents.roleOther',
};

/** role の表示ラベルを現在の表示言語で返す */
export function documentRoleLabel(role: DocumentRole): string {
  return t(DOCUMENT_ROLE_LABEL_KEYS[role]);
}
