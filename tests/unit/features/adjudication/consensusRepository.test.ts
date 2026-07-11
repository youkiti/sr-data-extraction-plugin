import { NOT_REPORTED_TOKEN } from '../../../../src/domain/annotation';
import { applyConsensusWrites } from '../../../../src/features/adjudication/consensusRepository';
import type { ConsensusCellWrite, ConsensusWriteParams } from '../../../../src/features/adjudication/consensusWrites';
import type { SchemaField } from '../../../../src/domain/schemaField';

const STUDY_DATA_HEADER = ['study_id', 'annotator', 'annotator_type', 'schema_version', 'run_id', 'updated_at'];
const RESULTS_DATA_HEADER = [
  'result_id',
  'study_id',
  'field_id',
  'annotator',
  'annotator_type',
  'schema_version',
  'entity_key',
  'run_id',
  'value',
  'not_reported',
  'updated_at',
];
const DECISIONS_HEADER = [
  'decided_at',
  'decided_by',
  'study_id',
  'field_id',
  'entity_key',
  'annotator',
  'annotator_type',
  'schema_version',
  'action',
  'value',
  'note',
];

function field(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-1',
    fieldIndex: 1,
    section: 'population',
    fieldName: 'sample_size',
    fieldLabel: '総サンプルサイズ',
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: false,
    extractionInstruction: '',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

interface MockDeps {
  fetch: jest.Mock;
  getAccessToken: jest.Mock;
}

function makeDeps(options: { studyDataValues?: string[][] }): MockDeps {
  const fetch = jest.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    let json: unknown = {};
    if (method === 'GET' && url.includes('/values/StudyData')) {
      json = { values: options.studyDataValues ?? [STUDY_DATA_HEADER] };
    } else if (method === 'GET' && url.includes('/values/ResultsData')) {
      json = { values: [RESULTS_DATA_HEADER] };
    } else if (method === 'GET' && url.includes('/values/Decisions')) {
      json = { values: [DECISIONS_HEADER] };
    }
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) } as Response;
  });
  return { fetch, getAccessToken: jest.fn().mockResolvedValue('token') };
}

function callsOf(deps: MockDeps, method: string): [string, RequestInit][] {
  return deps.fetch.mock.calls
    .filter(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === method)
    .map(([url, init]) => [decodeURIComponent(String(url)), init as RequestInit]);
}

const PARAMS: ConsensusWriteParams = {
  studyId: 'study-1',
  decidedBy: 'judge@example.com',
  decidedAt: 't-now',
  schemaVersion: 1,
};

describe('applyConsensusWrites', () => {
  test('空配列は no-op（fetch を呼ばない）', async () => {
    const deps = makeDeps({});
    await applyConsensusWrites('sheet-1', [], PARAMS, deps);
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  test('study レベルの書き込みは既存 consensus 行へマージして 1 回で upsert する', async () => {
    const deps = makeDeps({
      studyDataValues: [
        STUDY_DATA_HEADER,
        ['study-1', 'consensus', 'consensus', '1', '', 't-old'],
      ],
    });
    // 既存行に値が無い（動的値列が無い）想定。まず値列を持つ行を用意する別ケースは下で検証する
    const writes: ConsensusCellWrite[] = [
      { field: field(), entityKey: '-', action: 'accept', value: '120' },
    ];
    await applyConsensusWrites('sheet-1', writes, PARAMS, deps);
    // ResultsData への書き込みは発生しない（study レベルのみ）
    const resultsPosts = callsOf(deps, 'POST').filter(([url]) => url.includes('ResultsData'));
    expect(resultsPosts).toHaveLength(0);
    const decisionsPosts = callsOf(deps, 'POST').filter(([url]) => url.includes('Decisions'));
    expect(decisionsPosts).toHaveLength(1);
    const decisionsBody = JSON.parse(String(decisionsPosts[0]?.[1].body)) as { values: unknown[][] };
    expect(decisionsBody.values).toEqual([
      ['t-now', 'judge@example.com', 'study-1', 'f-1', '-', 'consensus', 'consensus', 1, 'accept', '120', ''],
    ]);
  });

  test('既存 consensus StudyData 行の他フィールド値を保持したままマージする', async () => {
    const deps = makeDeps({
      studyDataValues: [
        [...STUDY_DATA_HEADER, 'sample_size', 'design'],
        ['study-1', 'consensus', 'consensus', '1', '', 't-old', '', 'RCT'],
      ],
    });
    const writes: ConsensusCellWrite[] = [
      { field: field({ fieldName: 'sample_size' }), entityKey: '-', action: 'accept', value: '120' },
    ];
    await applyConsensusWrites('sheet-1', writes, PARAMS, deps);
    const puts = callsOf(deps, 'PUT');
    // updateRow（既存行の上書き）が呼ばれ、design 列（'RCT'）が保持されていること
    const updateCall = puts.find(([url]) => url.includes('StudyData'));
    expect(updateCall).toBeDefined();
    const body = JSON.parse(String(updateCall?.[1].body)) as { values: unknown[][] };
    expect(body.values[0]).toEqual(['study-1', 'consensus', 'consensus', 1, '', 't-now', '120', 'RCT']);
  });

  test('entity レベルの書き込みは ResultsData へ 1 回で upsert し、not_reported を value から判定する', async () => {
    const deps = makeDeps({});
    const armField = field({ fieldId: 'f-arm', fieldName: 'arm_name', entityLevel: 'arm' });
    const writes: ConsensusCellWrite[] = [
      { field: armField, entityKey: 'arm:1', action: 'not_reported', value: NOT_REPORTED_TOKEN },
    ];
    await applyConsensusWrites('sheet-1', writes, PARAMS, deps);
    const resultsPosts = callsOf(deps, 'POST').filter(([url]) => url.includes('ResultsData'));
    expect(resultsPosts).toHaveLength(1);
    const body = JSON.parse(String(resultsPosts[0]?.[1].body)) as { values: unknown[][] };
    expect(body.values[0]).toEqual([
      expect.any(String),
      'study-1',
      'f-arm',
      'consensus',
      'consensus',
      1,
      'arm:1',
      '',
      '',
      true,
      't-now',
    ]);
    const decisionsPosts = callsOf(deps, 'POST').filter(([url]) => url.includes('Decisions'));
    expect(decisionsPosts).toHaveLength(1);
  });

  test('study レベル・entity レベルが混在する一括書き込みも 1 回ずつの upsert + 1 回の Decisions 追記になる', async () => {
    const deps = makeDeps({ studyDataValues: [STUDY_DATA_HEADER] });
    const armField = field({ fieldId: 'f-arm', fieldName: 'arm_name', entityLevel: 'arm' });
    const writes: ConsensusCellWrite[] = [
      { field: field(), entityKey: '-', action: 'accept', value: '120' },
      { field: armField, entityKey: 'arm:1', action: 'edit', value: '介入群' },
    ];
    await applyConsensusWrites('sheet-1', writes, PARAMS, deps);
    expect(callsOf(deps, 'POST').filter(([url]) => url.includes('StudyData'))).toHaveLength(1);
    expect(callsOf(deps, 'POST').filter(([url]) => url.includes('ResultsData'))).toHaveLength(1);
    const decisionsPosts = callsOf(deps, 'POST').filter(([url]) => url.includes('Decisions'));
    expect(decisionsPosts).toHaveLength(1);
    const body = JSON.parse(String(decisionsPosts[0]?.[1].body)) as { values: unknown[][] };
    expect(body.values).toHaveLength(2);
  });
});
