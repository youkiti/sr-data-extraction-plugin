// UI 文言辞書（日本語 = 既定言語。issue #93）。
// キーは「画面.要素」形式（例: home.countsLoading）。共通文言のみ common.* を使う。
// この ja がキー集合の正典で、en.ts は Record<MessageKey, string> で全キーの網羅を型強制する。
// 注意: LLM プロンプト・Sheets のタブ名 / 列名・entity_key・enum 値は UI 文言ではないため
// ここには置かない（翻訳対象外）
import { jaPages } from './ja.pages';
import { jaApp } from './ja.app';

export const ja = { ...jaPages, ...jaApp } as const;

/** 辞書キー（ja が正典。en は同一キー集合を型強制される） */
export type MessageKey = keyof typeof ja;
