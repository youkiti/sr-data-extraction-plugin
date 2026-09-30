import {
  anchorAskPaperCitations,
  estimateAskPaperCost,
  ASK_PAPER_ESTIMATED_OUTPUT_TOKENS,
} from '../../../../src/features/verification/askPaper';
import { ASK_PAPER_SYSTEM_PROMPT } from '../../../../src/features/verification/skills/askPaper';
import { estimateCostUsd } from '../../../../src/lib/llm/pricing';
import { APPROX_CHARS_PER_TOKEN } from '../../../../src/features/extraction/planRun';
import {
  canAskPaper,
  CHAT_ASSIST_NOTE_MARKER,
  hasChatAssistMarker,
  withChatAssistMarker,
} from '../../../../src/features/verification/chatAssist';

test('全ページで日本語・正規化・曖昧一致を照合し、未照合は警告用に保持する', () => {
  const result = anchorAskPaperCitations(
    [
      { document_index: 1, quote: '対象者は１２０人であった。', page: 1 },
      { document_index: 1, quote: '対象者は120人であった。', page: 99 },
      { document_index: 2, quote: 'a total of 120 patientz were randomised', page: 1 },
      { document_index: 2, quote: '記載されていない文章です', page: null },
      { document_index: 3, quote: 'テキストなし', page: 1 },
      ...[0, -1, 1.5, 4].map((document_index) => ({ document_index, quote: '無効', page: 1 })),
    ],
    [
      {
        documentId: 'd1',
        role: 'primary',
        filename: '日本語.pdf',
        pages: [{ page: 1, text: '対象者は120人であった。' }],
      },
      {
        documentId: 'd2',
        role: 'supplement',
        filename: '英語.pdf',
        pages: [{ page: 8, text: 'a total of 120 patients were randomised' }],
      },
      { documentId: 'd3', role: 'supplement', filename: '画像.pdf', pages: [] },
    ],
  );
  expect(result).toHaveLength(5);
  expect(result[0]).toEqual({
    documentIndex: 1,
    documentId: 'd1',
    quote: '対象者は１２０人であった。',
    page: 1,
    anchorStatus: 'exact',
    anchoredPage: 1,
    highlightable: true,
  });
  expect(result[1]).toMatchObject({
    anchorStatus: 'normalized',
    anchoredPage: 1,
    highlightable: true,
  });
  expect(result[2]).toMatchObject({
    documentId: 'd2',
    anchorStatus: 'fuzzy',
    anchoredPage: 8,
    highlightable: true,
  });
  expect(result.slice(3)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ anchorStatus: 'failed', anchoredPage: null, highlightable: false }),
    ]),
  );
});

test('システム文も含めた入力概算と出力600トークンの費用を算出する', () => {
  const input = {
    model: 'gemini-3.5-flash',
    prefixChars: 501,
    historyChars: 21,
    questionChars: 13,
  };
  const tokensIn = Math.ceil((ASK_PAPER_SYSTEM_PROMPT.length + 535) / APPROX_CHARS_PER_TOKEN);
  expect(estimateAskPaperCost(input)).toEqual({
    tokensIn,
    costUsd: estimateCostUsd(input.model, tokensIn, ASK_PAPER_ESTIMATED_OUTPUT_TOKENS),
  });
  expect(estimateAskPaperCost({ ...input, model: 'unknown' })).toEqual({ tokensIn, costUsd: null });
});

test.each([null, '', 'メモ', '[chat-assist]', '[chat-assist] メモ', '文中の[chat-assist]'])(
  '判定メモ先頭の印を検出して重複なく付ける: %s',
  (note) => {
    const marked = withChatAssistMarker(note);
    expect(marked).toBe(
      note?.startsWith(CHAT_ASSIST_NOTE_MARKER)
        ? note
        : note
          ? `[chat-assist] ${note}`
          : '[chat-assist]',
    );
    expect(hasChatAssistMarker(note)).toBe(
      note !== null && note.startsWith(CHAT_ASSIST_NOTE_MARKER),
    );
    expect(hasChatAssistMarker(marked)).toBe(true);
    expect(withChatAssistMarker(marked)).toBe(marked);
  },
);

test.each([null, 'owner', 'reviewer_with_ai', 'adjudicator', 'reviewer_independent'] as const)(
  '質問を許可するロールを明示する: %s',
  (role) => {
    expect(canAskPaper(role)).toBe(
      role === 'owner' || role === 'reviewer_with_ai' || role === 'adjudicator',
    );
  },
);
