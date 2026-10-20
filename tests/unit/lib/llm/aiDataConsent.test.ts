import {
  confirmAiDataConsent,
  createAiDataConsentGate,
  type AiDataConsentGateDeps,
} from '../../../../src/lib/llm/aiDataConsent';
import { AI_DATA_CONSENT_VERSION } from '../../../../src/lib/storage/aiDataConsentStore';

function makeDeps(overrides: Partial<AiDataConsentGateDeps> = {}): AiDataConsentGateDeps & {
  loadConsent: jest.Mock;
  saveConsent: jest.Mock;
  openDialog: jest.Mock;
} {
  return {
    loadConsent: jest.fn(async () => null),
    saveConsent: jest.fn(async () => undefined),
    openDialog: jest.fn(async () => true),
    now: () => '2026-10-20T01:02:03.000Z',
    ...overrides,
  } as never;
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('現在の版の記録があればダイアログを出さずに通す', async () => {
  const deps = makeDeps({
    loadConsent: jest.fn(async () => ({ version: AI_DATA_CONSENT_VERSION, acceptedAt: 'a' })),
  });
  expect(await createAiDataConsentGate(deps)('gemini')).toBe(true);
  expect(deps.openDialog).not.toHaveBeenCalled();
  expect(deps.saveConsent).not.toHaveBeenCalled();
});

test('記録が無ければダイアログを開き、同意を日時と版で記録する', async () => {
  const deps = makeDeps();
  expect(await createAiDataConsentGate(deps)('anthropic')).toBe(true);
  expect(deps.openDialog).toHaveBeenCalledWith('anthropic');
  expect(deps.saveConsent).toHaveBeenCalledWith({
    version: AI_DATA_CONSENT_VERSION,
    acceptedAt: '2026-10-20T01:02:03.000Z',
  });
});

test('古い版の記録では同意を取り直す', async () => {
  const deps = makeDeps({
    loadConsent: jest.fn(async () => ({ version: AI_DATA_CONSENT_VERSION - 1, acceptedAt: 'a' })),
  });
  expect(await createAiDataConsentGate(deps)('gemini')).toBe(true);
  expect(deps.openDialog).toHaveBeenCalledTimes(1);
});

test('キャンセルなら false を返し、記録しない', async () => {
  const deps = makeDeps({ openDialog: jest.fn(async () => false) });
  expect(await createAiDataConsentGate(deps)('gemini')).toBe(false);
  expect(deps.saveConsent).not.toHaveBeenCalled();
});

test('記録の読み込みに失敗したら未同意として確認する', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const deps = makeDeps({ loadConsent: jest.fn(async () => { throw new Error('x'); }) });
  expect(await createAiDataConsentGate(deps)('gemini')).toBe(true);
  expect(deps.openDialog).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalled();
});

test('記録の保存に失敗しても今回は続ける', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const deps = makeDeps({ saveConsent: jest.fn(async () => { throw new Error('x'); }) });
  expect(await createAiDataConsentGate(deps)('gemini')).toBe(true);
  expect(warn).toHaveBeenCalled();
});

test('now 未指定は現在時刻を記録する', async () => {
  const deps = makeDeps({ now: undefined });
  await createAiDataConsentGate(deps)('gemini');
  const record = deps.saveConsent.mock.calls[0]![0] as { acceptedAt: string };
  expect(Number.isNaN(Date.parse(record.acceptedAt))).toBe(false);
});

test('並行した呼び出しは同じダイアログを待ち、終わったら次の確認を受け付ける', async () => {
  let answer: (value: boolean) => void = () => undefined;
  const deps = makeDeps({
    openDialog: jest.fn(() => new Promise<boolean>((resolve) => { answer = resolve; })),
  });
  const gate = createAiDataConsentGate(deps);
  const first = gate('gemini');
  const second = gate('gemini');
  await Promise.resolve();
  await Promise.resolve();
  answer(false);
  expect(await Promise.all([first, second])).toEqual([false, false]);
  expect(deps.openDialog).toHaveBeenCalledTimes(1);
  const third = gate('gemini');
  await Promise.resolve();
  await Promise.resolve();
  answer(true);
  expect(await third).toBe(true);
  expect(deps.openDialog).toHaveBeenCalledTimes(2);
});

test('confirmAiDataConsent はゲート未注入なら通し、注入時はゲートの結果を返す', async () => {
  expect(await confirmAiDataConsent({}, 'gemini')).toBe(true);
  const ensure = jest.fn(async () => false);
  expect(await confirmAiDataConsent({ ensureAiDataConsent: ensure }, 'openrouter')).toBe(false);
  expect(ensure).toHaveBeenCalledWith('openrouter');
});
