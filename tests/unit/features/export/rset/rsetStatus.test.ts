import { NOT_REPORTED_TOKEN } from '../../../../../src/domain/annotation';
import {
  resolveRSetStatus,
  resolveRSetValue,
  resultsRowRawValue,
} from '../../../../../src/features/export/rset/rsetStatus';

describe('resolveRSetStatus', () => {
  test('値が null で Evidence がある場合は unverified', () => {
    expect(resolveRSetStatus(null, true)).toBe('unverified');
  });

  test('値が null で Evidence が無い場合は no_data', () => {
    expect(resolveRSetStatus(null, false)).toBe('no_data');
  });

  test('値が NOT_REPORTED_TOKEN の場合は not_reported', () => {
    expect(resolveRSetStatus(NOT_REPORTED_TOKEN, true)).toBe('not_reported');
  });

  test('それ以外の実値は verified', () => {
    expect(resolveRSetStatus('120', false)).toBe('verified');
  });
});

describe('resolveRSetValue', () => {
  test('verified のときのみ値を出す', () => {
    expect(resolveRSetValue('120', 'verified')).toBe('120');
  });

  test('verified で値が null なら空文字（防御。実運用では起こらない組み合わせ）', () => {
    expect(resolveRSetValue(null, 'verified')).toBe('');
  });

  test.each(['not_reported', 'unverified', 'no_data', 'not_applicable'] as const)(
    '%s のときは値を出さない（automation bias 対策）',
    (status) => {
      expect(resolveRSetValue('120', status)).toBe('');
    },
  );
});

describe('resultsRowRawValue', () => {
  test('行が無ければ null', () => {
    expect(resultsRowRawValue(undefined)).toBeNull();
  });

  test('notReported な行は NOT_REPORTED_TOKEN へ正規化する', () => {
    expect(resultsRowRawValue({ value: null, notReported: true })).toBe(NOT_REPORTED_TOKEN);
  });

  test('通常の行は value をそのまま返す', () => {
    expect(resultsRowRawValue({ value: '42', notReported: false })).toBe('42');
  });
});
