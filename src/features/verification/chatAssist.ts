// 論文への質問パネル（issue #264）の質問・回答処理を支える。
// 文脈は 1 study の本文とスキーマ定義だけとし、Evidence・データ行・Decisions は渡さない。
// 質問と回答の payload は保存せず、会話はセッション内のみで扱う。
import type { ProjectRole } from '../../domain/reviewer';

/** 質問後の判定を監査証跡で識別する先頭の印。 */
export const CHAT_ASSIST_NOTE_MARKER = '[chat-assist]';

export function hasChatAssistMarker(note: string | null): boolean {
  return note !== null && note.startsWith(CHAT_ASSIST_NOTE_MARKER);
}

export function withChatAssistMarker(note: string | null): string {
  if (hasChatAssistMarker(note)) return note as string;
  return note ? `${CHAT_ASSIST_NOTE_MARKER} ${note}` : CHAT_ASSIST_NOTE_MARKER;
}

/** 独立レビュアーと未解決ロールには質問を開放しない。 */
export function canAskPaper(role: ProjectRole | null): boolean {
  return role === 'owner' || role === 'reviewer_with_ai' || role === 'adjudicator';
}
