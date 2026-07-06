import { readProgressCounts } from '../../../../src/features/project/progressCounts';

/** ExtractionRuns!B2:I の 1 行（B=run_type 起点、末尾 I=status） */
function runRow(runType: string, status: string): string[] {
  return [runType, '1', 'doc-1', 'gemini', 'gemini-test', '', 'text_only', status];
}

function depsWithRanges(valueRanges: { values?: string[][] }[]): {
  fetch: jest.Mock;
  getAccessToken: jest.Mock;
} {
  return {
    fetch: jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ valueRanges }),
      text: async () => '',
    }),
    getAccessToken: jest.fn().mockResolvedValue('token'),
  };
}

describe('readProgressCounts', () => {
  test('7 範囲を batchGet 1 呼び出しで読み、タブ別の行数へ畳み込む', async () => {
    const d = depsWithRanges([
      { values: [['doc-1'], ['doc-2']] }, // Documents
      { values: [['1']] }, // Protocol
      { values: [['1'], ['2'], ['3']] }, // SchemaVersions
      {
        // ExtractionRuns run_type〜status。running 行（2 行プロトコルの 1 行目）は数えない
        values: [
          runRow('pilot', 'running'),
          runRow('pilot', 'done'),
          runRow('full', 'done'),
          runRow('pilot', 'partial_failure'),
          runRow('single_document', 'done'),
        ],
      },
      { values: [['ev-1'], ['ev-2'], ['ev-3'], ['ev-4'], ['ev-5']] }, // Evidence
      { values: [['doc-1']] }, // StudyData
      { values: [['r-1'], ['r-2']] }, // ResultsData
    ]);
    await expect(readProgressCounts('sid', d)).resolves.toEqual({
      documents: 2,
      protocolVersions: 1,
      schemaVersions: 3,
      pilotRuns: 2,
      evidenceRows: 5,
      dataRows: 3, // StudyData 1 + ResultsData 2
    });
    expect(d.fetch).toHaveBeenCalledTimes(1);
    const url = decodeURIComponent(String(d.fetch.mock.calls[0][0]));
    expect(url).toContain('/values:batchGet?');
    expect(url).toContain('ranges=Documents!A2:A');
    expect(url).toContain('ranges=ExtractionRuns!B2:I'); // run_type〜status 列（pilot 完了行の判定）
  });

  test('空プロジェクト（全範囲空）は全カウント 0', async () => {
    const d = depsWithRanges([]);
    await expect(readProgressCounts('sid', d)).resolves.toEqual({
      documents: 0,
      protocolVersions: 0,
      schemaVersions: 0,
      pilotRuns: 0,
      evidenceRows: 0,
      dataRows: 0,
    });
  });

  test('キー列が空文字の行（ゴミ空行）は件数に含めない', async () => {
    const d = depsWithRanges([
      { values: [['doc-1'], [''], []] }, // Documents: 実質 1 行
      {},
      {},
      // run_type 空セル・空行・status 欠落のラグ配列は pilot に数えない
      { values: [[''], [], ['pilot'], runRow('pilot', 'done')] },
      {},
      {},
      {},
    ]);
    const counts = await readProgressCounts('sid', d);
    expect(counts.documents).toBe(1);
    expect(counts.pilotRuns).toBe(1);
  });
});
