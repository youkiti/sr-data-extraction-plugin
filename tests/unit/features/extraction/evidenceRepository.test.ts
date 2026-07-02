import type { Evidence } from '../../../../src/domain/evidence';
import {
  appendEvidenceRows,
  evidenceToRow,
} from '../../../../src/features/extraction/evidenceRepository';

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidenceId: 'ev-1',
    runId: 'run-1',
    documentId: 'doc-1',
    fieldId: 'f-1',
    entityKey: '-',
    value: '120',
    notReported: false,
    quote: 'total of 120 patients',
    page: 3,
    confidence: 'high',
    anchorStatus: 'exact',
    ...overrides,
  };
}

function deps(): { fetch: jest.Mock; getAccessToken: jest.Mock } {
  return {
    fetch: jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
    } as Response),
    getAccessToken: jest.fn().mockResolvedValue('token'),
  };
}

describe('evidenceToRow', () => {
  test('SHEET_HEADERS.Evidence の列順に対応する', () => {
    expect(evidenceToRow(makeEvidence())).toEqual([
      'ev-1',
      'run-1',
      'doc-1',
      'f-1',
      '-',
      '120',
      false,
      'total of 120 patients',
      3,
      'high',
      'exact',
    ]);
  });

  test('null 許容列（value / quote / page / confidence / anchor_status）は null をそのまま返す', () => {
    expect(
      evidenceToRow(
        makeEvidence({
          value: null,
          notReported: true,
          quote: null,
          page: null,
          confidence: null,
          anchorStatus: null,
        }),
      ),
    ).toEqual(['ev-1', 'run-1', 'doc-1', 'f-1', '-', null, true, null, null, null, null]);
  });
});

describe('appendEvidenceRows', () => {
  test('Evidence タブへ 1 回の :append でまとめて追記する', async () => {
    const d = deps();
    await appendEvidenceRows('sid', [makeEvidence(), makeEvidence({ evidenceId: 'ev-2' })], d);
    expect(d.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = d.fetch.mock.calls[0];
    expect(decodeURIComponent(url as string)).toContain('/sid/values/Evidence!A1:append');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.values).toHaveLength(2);
    expect(body.values[0][0]).toBe('ev-1');
    expect(body.values[1][0]).toBe('ev-2');
  });

  test('空配列は no-op（API を呼ばない）', async () => {
    const d = deps();
    await appendEvidenceRows('sid', [], d);
    expect(d.fetch).not.toHaveBeenCalled();
  });
});
