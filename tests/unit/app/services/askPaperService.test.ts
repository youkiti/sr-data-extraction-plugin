import {
  askPaper,
  estimateForQuestion,
  type AskPaperDeps,
  type AskPaperParams,
} from '../../../../src/app/services/askPaperService';
import { estimateAskPaperCost } from '../../../../src/features/verification/askPaper';
import {
  buildAskPaperDocumentPrefix,
  ASK_PAPER_RESPONSE_SCHEMA,
} from '../../../../src/features/verification/skills/askPaper';
import { appendLlmApiLog } from '../../../../src/lib/llm/apiLogRepository';
import { ensureChildFolder, uploadTextFile } from '../../../../src/lib/google/drive';
import { FACTORY_DEFAULT_MODEL, loadDefaultModel } from '../../../../src/lib/storage/settingsStore';
import { UNLIMITED_POLICY } from '../../../../src/lib/llm/rateLimitPolicy';
import type { LLMProvider } from '../../../../src/lib/llm/LLMProvider';

jest.mock('../../../../src/lib/llm/apiLogRepository', () => ({ appendLlmApiLog: jest.fn() }));
jest.mock('../../../../src/lib/google/drive', () => ({
  ensureChildFolder: jest.fn(),
  uploadTextFile: jest.fn(),
}));
jest.mock('../../../../src/lib/storage/settingsStore', () => ({
  ...jest.requireActual('../../../../src/lib/storage/settingsStore'),
  loadDefaultModel: jest.fn(async () => null),
}));

const params: AskPaperParams = {
  spreadsheetId: 'sheet',
  question: '対象者は何人？',
  history: [],
  documents: [
    {
      documentId: 'doc1',
      role: 'primary',
      filename: '論文.pdf',
      pages: [{ page: 1, text: '対象者は120人であった。' }],
    },
    { documentId: 'doc2', role: 'supplement', filename: '補足.pdf', pages: [] },
  ],
  fields: [
    {
      schemaVersion: 1,
      fieldId: 'f1',
      fieldIndex: 1,
      section: 'population',
      fieldName: 'sample_size',
      fieldLabel: '人数',
      entityLevel: 'study',
      dataType: 'integer',
      unit: null,
      allowedValues: null,
      required: true,
      extractionInstruction: '人数を報告',
      example: null,
      aiGenerated: true,
      note: 'EVIDENCE_DECISION_SECRET',
      maxQuotes: null,
      locationHint: null,
      rules: null,
      hintSource: null,
    },
  ],
};
function setup() {
  const chat = jest.fn<ReturnType<LLMProvider['chat']>, Parameters<LLMProvider['chat']>>(
    async () => ({
      text: JSON.stringify({
        answer: '120人です。',
        found: true,
        citations: [
          { document_index: 1, quote: '対象者は120人であった。', page: 1 },
          { document_index: 1, quote: '存在しない引用です', page: 1 },
        ],
      }),
      tokensIn: 100,
      tokensOut: 20,
      cachedTokensIn: 50,
      raw: '回答の生データ',
    }),
  );
  const buildProvider = jest.fn((config) => ({
    providerId: 'gemini' as const,
    model: config.model,
    supportsImageInput: false,
    chat,
  }));
  const deps: AskPaperDeps = {
    google: { fetch: jest.fn(), getAccessToken: jest.fn() },
    loadApiKey: async () => 'test-key',
    buildProvider,
    newUuid: () => 'log-id',
    now: () => '2026-09-29T00:00:00Z',
  };
  return { deps, chat, buildProvider };
}

test('本文とスキーマだけを送り、Drive を使わずメタデータを記録する', async () => {
  const { deps, chat, buildProvider } = setup();
  const result = await askPaper(params, deps);
  expect(buildProvider).toHaveBeenCalledWith(
    expect.objectContaining({ model: FACTORY_DEFAULT_MODEL }),
  );
  expect(loadDefaultModel).toHaveBeenCalled();
  expect(result).toMatchObject({
    status: 'answered',
    turn: { question: params.question, answer: '120人です。', found: true, anchoredCount: 1 },
  });
  const messages = JSON.stringify(chat.mock.calls[0]?.[0]);
  expect(messages).toContain('対象者は120人であった。');
  expect(messages).toContain('sample_size');
  expect(messages).toContain('(no text layer available)');
  expect(messages).not.toContain('EVIDENCE_DECISION_SECRET');
  expect(chat.mock.calls[0]?.[1]).toEqual({
    temperature: 0,
    responseSchema: ASK_PAPER_RESPONSE_SCHEMA,
  });
  expect(appendLlmApiLog).toHaveBeenCalledWith(
    'sheet',
    expect.objectContaining({
      purpose: 'ask_paper',
      promptRef: '',
      responseRef: '',
      promptSummary: null,
      tokensIn: 100,
      tokensOut: 20,
      cachedTokensIn: 50,
      costEstimateUsd: expect.any(Number),
      error: null,
    }),
    deps.google,
  );
  expect(ensureChildFolder).not.toHaveBeenCalled();
  expect(uploadTextFile).not.toHaveBeenCalled();
  expect(deps.google.fetch).not.toHaveBeenCalled();
});

test('既定モデルとレート制限の注入を使い、未発見も回答として返す', async () => {
  const { deps, chat, buildProvider } = setup();
  deps.loadDefaultModel = async () => 'gemini-2.5-pro';
  deps.resolveRateLimitPolicy = jest.fn(async () => UNLIMITED_POLICY);
  chat.mockResolvedValue({
    text: JSON.stringify({ answer: '記載なし', found: false, citations: [] }),
    tokensIn: null,
    tokensOut: null,
    cachedTokensIn: null,
    raw: {},
  });
  expect(await askPaper(params, deps)).toEqual({
    status: 'answered',
    turn: {
      question: params.question,
      answer: '記載なし',
      found: false,
      citations: [],
      anchoredCount: 0,
    },
  });
  expect(buildProvider).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-2.5-pro' }));
  expect(deps.resolveRateLimitPolicy).toHaveBeenCalledTimes(1);
});

test('応答形式エラーを本文を含まない失敗として返す', async () => {
  const { deps, chat } = setup();
  chat.mockResolvedValue({
    text: '壊れた応答',
    tokensIn: 10,
    tokensOut: 5,
    cachedTokensIn: null,
    raw: {},
  });
  expect(await askPaper(params, deps)).toEqual({
    status: 'error',
    message: '論文への質問の応答形式が不正です',
  });
});

test('API キー未設定では呼び出しも記録もしない', async () => {
  const { deps, chat } = setup();
  deps.loadApiKey = async () => null;
  expect(await askPaper(params, deps)).toMatchObject({
    status: 'error',
    message: expect.any(String),
  });
  expect(chat).not.toHaveBeenCalled();
  expect(appendLlmApiLog).not.toHaveBeenCalled();
});

test.each([new Error('API失敗'), 'API失敗'])(
  '呼び出し失敗を返し、エラーのメタデータは記録する: %s',
  async (error) => {
    const { deps, chat } = setup();
    chat.mockRejectedValue(error);
    expect(await askPaper(params, deps)).toEqual({ status: 'error', message: 'API失敗' });
    expect(appendLlmApiLog).toHaveBeenCalledWith(
      'sheet',
      expect.objectContaining({
        error: 'Error',
        promptRef: '',
        responseRef: '',
        promptSummary: null,
      }),
      deps.google,
    );
  },
);

test('履歴概算は送信と同じ最後の5往復だけを数える', () => {
  const history = Array.from({ length: 7 }, () => ({
    question: '質問',
    answer: '回答',
    found: false,
    citations: [],
    anchoredCount: 0,
  }));
  expect(estimateForQuestion({ ...params, history }, 'unknown')).toEqual(
    estimateAskPaperCost({
      model: 'unknown',
      prefixChars: buildAskPaperDocumentPrefix(params).length,
      historyChars: 20,
      questionChars: params.question.length,
    }),
  );
});

test('範囲外の文書番号も失敗引用として回答に保持する', async () => {
  const { deps, chat } = setup();
  chat.mockResolvedValue({
    text: JSON.stringify({
      answer: '要確認',
      found: true,
      citations: [{ document_index: 99, quote: '原文候補', page: 1 }],
    }),
    tokensIn: 10,
    tokensOut: 5,
    cachedTokensIn: null,
    raw: {},
  });
  expect(await askPaper(params, deps)).toMatchObject({
    status: 'answered',
    turn: {
      anchoredCount: 0,
      citations: [
        {
          documentIndex: 99,
          documentId: null,
          quote: '原文候補',
          page: 1,
          anchorStatus: 'failed',
          anchoredPage: null,
          highlightable: false,
        },
      ],
    },
  });
});
