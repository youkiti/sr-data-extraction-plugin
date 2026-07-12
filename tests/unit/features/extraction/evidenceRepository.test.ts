import type { Evidence } from '../../../../src/domain/evidence';
import {
  appendEvidenceRows,
  ensureEvidenceBboxColumns,
  ensureEvidenceRelocatedFromColumn,
  evidenceToRow,
  readEvidenceRows,
} from '../../../../src/features/extraction/evidenceRepository';
import { SHEET_HEADERS } from '../../../../src/domain/sheetsSchema';

/** 旧ヘッダ（bbox 列導入前）の 12 列 */
const LEGACY_HEADER = SHEET_HEADERS.Evidence.slice(0, 12);
/** bbox 5 列込み・relocated_from 導入前の 17 列（issue #94 の移行元ヘッダ） */
const BBOX_ONLY_HEADER = SHEET_HEADERS.Evidence.slice(0, 17);

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
    bboxPage: null,
    bbox: null,
    relocatedFrom: null,
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
  test('SHEET_HEADERS.Evidence の列順に対応する（bbox 5 列 + relocated_from 込みで 18 セル）', () => {
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
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  test('relocated_from（issue #94）は末尾セルへそのまま書く', () => {
    expect(evidenceToRow(makeEvidence({ relocatedFrom: 'ev-original' }))).toEqual([
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
      null,
      null,
      null,
      null,
      null,
      'ev-original',
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
    ).toEqual([
      'ev-1',
      'run-1',
      'study-1',
      'f-1',
      'doc-1',
      '-',
      null,
      true,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  test('bbox 込みの Evidence は末尾 5 セルへ bboxPage + 4 座標を書く（§7.4 PR3）', () => {
    expect(
      evidenceToRow(
        makeEvidence({
          bboxPage: 2,
          bbox: { ymin: 100, xmin: 200, ymax: 300, xmax: 400 },
        }),
      ),
    ).toEqual([
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
      2,
      100,
      200,
      300,
      400,
      null,
    ]);
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

  test('旧 12 列ヘッダ（bbox 列なし）は許容し、bbox は null として読む（既存プロジェクトの後方互換）', async () => {
    const rows = await readEvidenceRows(
      'sheet-1',
      readDeps([LEGACY_HEADER, sheetRow()]),
    );
    expect(rows[0]).toEqual(makeEvidence());
  });

  test('フルヘッダ（18 列）+ bbox セルが埋まった行を往復できる（§7.4 PR3）', async () => {
    const rows = await readEvidenceRows(
      'sheet-1',
      readDeps([
        [...SHEET_HEADERS.Evidence],
        sheetRow({ 12: '2', 13: '100', 14: '200', 15: '300', 16: '400' }),
      ]),
    );
    expect(rows[0]).toEqual(
      makeEvidence({ bboxPage: 2, bbox: { ymin: 100, xmin: 200, ymax: 300, xmax: 400 } }),
    );
  });

  test('17 列ヘッダ（bbox 拡張済み・relocated_from 未拡張）は許容し、relocated_from は null として読む（issue #94 の回帰確認）', async () => {
    // ensureEvidenceBboxColumns だけを既に実行した既存プロジェクトを模す。
    // 修正前は「header.length > LEGACY_COLUMN_COUNT なら拡張列 6 個すべてを検証する」実装のため、
    // 存在しない 18 列目（relocated_from）まで検証しようとして誤って throw していた
    const rows = await readEvidenceRows(
      'sheet-1',
      readDeps([[...BBOX_ONLY_HEADER], sheetRow({ 12: '2', 13: '100', 14: '200', 15: '300', 16: '400' })]),
    );
    expect(rows[0]).toEqual(
      makeEvidence({ bboxPage: 2, bbox: { ymin: 100, xmin: 200, ymax: 300, xmax: 400 } }),
    );
  });

  test('relocated_from 列（18 列目）を読む（issue #94）', async () => {
    const rows = await readEvidenceRows(
      'sheet-1',
      readDeps([[...SHEET_HEADERS.Evidence], sheetRow({ 17: 'ev-original' })]),
    );
    expect(rows[0]).toEqual(makeEvidence({ relocatedFrom: 'ev-original' }));
  });

  test('18 列目（relocated_from）の名前不一致はエラー', async () => {
    const badHeader = [...SHEET_HEADERS.Evidence];
    badHeader[17] = 'wrong';
    await expect(
      readEvidenceRows('sheet-1', readDeps([badHeader, sheetRow()])),
    ).rejects.toThrow('Evidence のヘッダ 18 列目が "relocated_from" ではありません');
  });

  test('13 列目以降（bbox 列）の名前不一致はエラー', async () => {
    const badHeader = [...SHEET_HEADERS.Evidence];
    badHeader[13] = 'wrong';
    await expect(
      readEvidenceRows('sheet-1', readDeps([badHeader, sheetRow()])),
    ).rejects.toThrow('Evidence のヘッダ 14 列目が "bbox_ymin" ではありません');
  });

  test('bbox セルが一部だけ埋まっている行はエラー', async () => {
    await expect(
      readEvidenceRows(
        'sheet-1',
        readDeps([[...SHEET_HEADERS.Evidence], sheetRow({ 12: '2' })]),
      ),
    ).rejects.toThrow('bbox 列（bbox_page/bbox_ymin/bbox_xmin/bbox_ymax/bbox_xmax）が一部だけ埋まっています');
  });

  test('bbox 座標の順序が逆（ymin>ymax）はエラー', async () => {
    await expect(
      readEvidenceRows(
        'sheet-1',
        readDeps([
          [...SHEET_HEADERS.Evidence],
          sheetRow({ 12: '2', 13: '500', 14: '200', 15: '300', 16: '400' }),
        ]),
      ),
    ).rejects.toThrow('bbox の座標順序が不正です');
  });

  test('bbox_page が正の整数でない（0 以下・非整数）はエラー', async () => {
    await expect(
      readEvidenceRows(
        'sheet-1',
        readDeps([
          [...SHEET_HEADERS.Evidence],
          sheetRow({ 12: '0', 13: '100', 14: '200', 15: '300', 16: '400' }),
        ]),
      ),
    ).rejects.toThrow('bbox_page "0" が正の整数ではありません');
  });

  test('bbox 座標が範囲外（1000 超）はエラー', async () => {
    await expect(
      readEvidenceRows(
        'sheet-1',
        readDeps([
          [...SHEET_HEADERS.Evidence],
          sheetRow({ 12: '2', 13: '100', 14: '200', 15: '300', 16: '1001' }),
        ]),
      ),
    ).rejects.toThrow('bbox_xmax "1001" が 0-1000 の整数ではありません');
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

describe('ensureEvidenceBboxColumns', () => {
  /** getBatchValues（GET .../values:batchGet）と updateRow（PUT .../values/Evidence!A1）を
   *  method で出し分けるモック fetch。headerRow が undefined ならヘッダ行なし（空シート）を模す */
  function bboxDeps(headerRow: string[] | undefined): {
    fetch: jest.Mock;
    getAccessToken: jest.Mock;
  } {
    const fetch = jest.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            valueRanges: headerRow === undefined ? [] : [{ values: [headerRow] }],
          }),
          text: async () => '',
        } as Response;
      }
      // updateRow（ヘッダ拡張の PUT）
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as Response;
    });
    return { fetch, getAccessToken: jest.fn().mockResolvedValue('token') };
  }

  test('旧 12 列ヘッダはフルヘッダ（17 列）へ拡張する（PUT）', async () => {
    const d = bboxDeps([...LEGACY_HEADER]);
    await ensureEvidenceBboxColumns('sid', d);
    const putCall = d.fetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT');
    expect(putCall).toBeDefined();
    const [url, init] = putCall as [string, RequestInit];
    expect(decodeURIComponent(url)).toContain('/sid/values/Evidence!A1');
    const body = JSON.parse(init.body as string) as { values: string[][] };
    expect(body.values).toEqual([[...SHEET_HEADERS.Evidence]]);
  });

  test('既に 17 列（拡張済み）なら no-op（PUT を呼ばない）', async () => {
    const d = bboxDeps([...SHEET_HEADERS.Evidence]);
    await ensureEvidenceBboxColumns('sid', d);
    const putCall = d.fetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT');
    expect(putCall).toBeUndefined();
  });

  test('先頭 12 列が SHEET_HEADERS.Evidence と不一致なら throw し、PUT は呼ばない（壊れたプロジェクトへの書き込み防止）', async () => {
    const badHeader = [...LEGACY_HEADER];
    badHeader[2] = 'wrong'; // study_id のはずが不一致
    const d = bboxDeps(badHeader);
    await expect(ensureEvidenceBboxColumns('sid', d)).rejects.toThrow(
      'Evidence のヘッダ 3 列目が "study_id" ではありません',
    );
    const putCall = d.fetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT');
    expect(putCall).toBeUndefined();
  });

  test('ヘッダ行が無い（空シート）場合も列不一致として throw する', async () => {
    const d = bboxDeps(undefined);
    await expect(ensureEvidenceBboxColumns('sid', d)).rejects.toThrow(
      'Evidence のヘッダ 1 列目が "evidence_id" ではありません',
    );
  });
});

describe('ensureEvidenceRelocatedFromColumn（issue #94）', () => {
  /** ensureEvidenceBboxColumns のテストと同じ GET/PUT 出し分けモック */
  function relocatedFromDeps(headerRow: string[] | undefined): {
    fetch: jest.Mock;
    getAccessToken: jest.Mock;
  } {
    const fetch = jest.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            valueRanges: headerRow === undefined ? [] : [{ values: [headerRow] }],
          }),
          text: async () => '',
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as Response;
    });
    return { fetch, getAccessToken: jest.fn().mockResolvedValue('token') };
  }

  test('旧 12 列ヘッダはフルヘッダ（18 列）へ拡張する（PUT）', async () => {
    const d = relocatedFromDeps([...LEGACY_HEADER]);
    await ensureEvidenceRelocatedFromColumn('sid', d);
    const putCall = d.fetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT');
    expect(putCall).toBeDefined();
    const [url, init] = putCall as [string, RequestInit];
    expect(decodeURIComponent(url)).toContain('/sid/values/Evidence!A1');
    const body = JSON.parse(init.body as string) as { values: string[][] };
    expect(body.values).toEqual([[...SHEET_HEADERS.Evidence]]);
  });

  test('17 列ヘッダ（bbox 拡張済み・relocated_from 未拡張）もフルヘッダ（18 列）へ拡張する（PUT）', async () => {
    const d = relocatedFromDeps([...BBOX_ONLY_HEADER]);
    await ensureEvidenceRelocatedFromColumn('sid', d);
    const putCall = d.fetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT');
    expect(putCall).toBeDefined();
    const [, init] = putCall as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { values: string[][] };
    expect(body.values).toEqual([[...SHEET_HEADERS.Evidence]]);
  });

  test('既に 18 列（拡張済み）なら no-op（PUT を呼ばない）', async () => {
    const d = relocatedFromDeps([...SHEET_HEADERS.Evidence]);
    await ensureEvidenceRelocatedFromColumn('sid', d);
    const putCall = d.fetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT');
    expect(putCall).toBeUndefined();
  });

  test('先頭 12 列が SHEET_HEADERS.Evidence と不一致なら throw し、PUT は呼ばない', async () => {
    const badHeader = [...LEGACY_HEADER];
    badHeader[2] = 'wrong';
    const d = relocatedFromDeps(badHeader);
    await expect(ensureEvidenceRelocatedFromColumn('sid', d)).rejects.toThrow(
      'Evidence のヘッダ 3 列目が "study_id" ではありません',
    );
    const putCall = d.fetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT');
    expect(putCall).toBeUndefined();
  });

  test('13 列目以降（bbox 列。存在する場合）の名前不一致は throw する', async () => {
    const badHeader = [...BBOX_ONLY_HEADER];
    badHeader[13] = 'wrong';
    const d = relocatedFromDeps(badHeader);
    await expect(ensureEvidenceRelocatedFromColumn('sid', d)).rejects.toThrow(
      'Evidence のヘッダ 14 列目が "bbox_ymin" ではありません',
    );
  });

  test('ヘッダ行が無い（空シート）場合も列不一致として throw する', async () => {
    const d = relocatedFromDeps(undefined);
    await expect(ensureEvidenceRelocatedFromColumn('sid', d)).rejects.toThrow(
      'Evidence のヘッダ 1 列目が "evidence_id" ではありません',
    );
  });
});
