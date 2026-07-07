import type { Evidence } from '../../../../src/domain/evidence';
import {
  appendEvidenceRows,
  evidenceToRow,
  readEvidenceRows,
} from '../../../../src/features/extraction/evidenceRepository';
import { SHEET_HEADERS } from '../../../../src/domain/sheetsSchema';

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidenceId: 'ev-1',
    runId: 'run-1',
    studyId: 'study-1',
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
      'study-1',
      'f-1',
      'doc-1',
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
    ).toEqual(['ev-1', 'run-1', 'study-1', 'f-1', 'doc-1', '-', null, true, null, null, null, null]);
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

describe('readEvidenceRows', () => {
  function readDeps(values: string[][]): { fetch: jest.Mock; getAccessToken: jest.Mock } {
    return {
      fetch: jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ values }),
        text: async () => '',
      } as Response),
      getAccessToken: jest.fn().mockResolvedValue('token'),
    };
  }

  const sheetRow = (overrides: Record<number, string> = {}): string[] => {
    const base = [
      'ev-1',
      'run-1',
      'study-1',
      'f-1',
      'doc-1',
      '-',
      '120',
      'FALSE',
      'total of 120 patients',
      '3',
      'high',
      'exact',
    ];
    for (const [index, value] of Object.entries(overrides)) {
      base[Number(index)] = value;
    }
    return base;
  };

  test('全行をシート行順のままパースして返す（TRUE の大小文字も許容）', async () => {
    const values = [
      [...SHEET_HEADERS.Evidence],
      sheetRow(),
      sheetRow({ 0: 'ev-2', 6: '', 7: 'True', 8: '', 9: '', 10: '', 11: '' }),
    ];
    const rows = await readEvidenceRows('sheet-1', readDeps(values));
    expect(rows[0]).toEqual(makeEvidence());
    expect(rows[1]).toEqual(
      makeEvidence({
        evidenceId: 'ev-2',
        value: null,
        notReported: true,
        quote: null,
        page: null,
        confidence: null,
        anchorStatus: null,
      }),
    );
  });

  test('ヘッダ行なし・列名不一致はエラー', async () => {
    await expect(readEvidenceRows('sheet-1', readDeps([]))).rejects.toThrow(
      'Evidence タブにヘッダ行がありません',
    );
    const badHeader = [...SHEET_HEADERS.Evidence];
    badHeader[5] = 'wrong';
    await expect(readEvidenceRows('sheet-1', readDeps([badHeader]))).rejects.toThrow(
      'Evidence のヘッダ 6 列目が "entity_key" ではありません',
    );
  });

  test('page / confidence / anchor_status の不正値はエラー', async () => {
    await expect(
      readEvidenceRows('sheet-1', readDeps([[...SHEET_HEADERS.Evidence], sheetRow({ 9: 'p3' })])),
    ).rejects.toThrow('Evidence 2 行目: page "p3" が正の整数ではありません');
    await expect(
      readEvidenceRows('sheet-1', readDeps([[...SHEET_HEADERS.Evidence], sheetRow({ 10: 'sure' })])),
    ).rejects.toThrow('confidence "sure" が不正です');
    await expect(
      readEvidenceRows('sheet-1', readDeps([[...SHEET_HEADERS.Evidence], sheetRow({ 11: 'ok' })])),
    ).rejects.toThrow('anchor_status "ok" が不正です');
  });

  test('ラグ配列（末尾セル欠落）は null として読む', async () => {
    const short = sheetRow();
    short.length = 7; // not_reported 以降が欠落
    const rows = await readEvidenceRows('sheet-1', readDeps([[...SHEET_HEADERS.Evidence], short]));
    expect(rows[0]).toMatchObject({
      notReported: false,
      quote: null,
      page: null,
      confidence: null,
      anchorStatus: null,
    });
  });
});
