// UI 文言辞書（英語。issue #93）。キー集合は ja.ts と同一であることを型で強制する
// （Record<MessageKey, string> = 欠落キーはコンパイルエラー、余剰キーは過剰プロパティ検査で弾く）。
// 用語は docs/requirements.md の英語用語（study / document / extraction / verification /
// adjudication 等）に合わせ、SR 方法論の術語（risk of bias / verbatim quote 等）は原語のまま使う
import { enPages } from './en.pages';
import { enApp } from './en.app';
import type { MessageKey } from './ja';

export const en: Record<MessageKey, string> = { ...enPages, ...enApp };
