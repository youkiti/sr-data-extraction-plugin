import { NOT_REPORTED_TOKEN } from '../../../../src/domain/annotation';
import type { AdjudicationCell } from '../../../../src/features/adjudication/cellMatch';
import { emptyCellState } from '../../../../src/features/verification/cellState';
import type { CellState } from '../../../../src/features/verification/cellState';
import {
  buildBulkAcceptWrites,
  buildChoiceWrite,
  buildCustomValueWrite,
  buildNotReportedWrite,
  buildUndoWrite,
  toConsensusDecision,
} from '../../../../src/features/adjudication/consensusWrites';

function cell(overrides: Partial<AdjudicationCell> = {}): AdjudicationCell {
  return {
    cellKey: JSON.stringify(['f-1', '-']),
    field: {
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
    },
    entityKey: '-',
    valueA: '120',
    valueB: '120',
    schemaVersionA: 1,
    schemaVersionB: 1,
    matches: true,
    schemaVersionMismatch: false,
    noteA: null,
    noteB: null,
    ...overrides,
  };
}

describe('toConsensusDecision', () => {
  test('annotator は常に consensus 固定・decided_by は裁定者', () => {
    const decision = toConsensusDecision(
      { field: cell().field, entityKey: '-', action: 'accept', value: '120' },
      { studyId: 'study-1', decidedBy: 'judge@example.com', decidedAt: 't1', schemaVersion: 1 },
    );
    expect(decision).toEqual({
      decidedAt: 't1',
      decidedBy: 'judge@example.com',
      studyId: 'study-1',
      fieldId: 'f-1',
      entityKey: '-',
      annotator: 'consensus',
      annotatorType: 'consensus',
      schemaVersion: 1,
      action: 'accept',
      value: '120',
      note: null,
    });
  });
});

describe('buildBulkAcceptWrites', () => {
  test('一致セルのみ・かつ consensus 未判定のセルだけを accept として書き出す', () => {
    const matched = cell({ cellKey: 'matched', matches: true, valueA: '120', valueB: '120' });
    const mismatched = cell({ cellKey: 'mismatched', matches: false });
    const alreadyDecided = cell({ cellKey: 'decided', matches: true, valueA: '5', valueB: '5' });
    const states = new Map<string, CellState>([
      ['decided', { status: 'accept', value: '5', stack: [] as never[] }],
    ]);
    const writes = buildBulkAcceptWrites([matched, mismatched, alreadyDecided], states);
    expect(writes).toEqual([{ field: matched.field, entityKey: '-', action: 'accept', value: '120' }]);
  });

  test('対象が無ければ空配列', () => {
    expect(buildBulkAcceptWrites([], new Map())).toEqual([]);
  });
});

describe('buildChoiceWrite', () => {
  test('A を選ぶと valueA を action=edit で書き出す', () => {
    const c = cell({ valueA: 'A 値', valueB: 'B 値' });
    expect(buildChoiceWrite(c, 'A')).toEqual({ field: c.field, entityKey: '-', action: 'edit', value: 'A 値' });
  });

  test('B を選ぶと valueB を action=edit で書き出す', () => {
    const c = cell({ valueA: 'A 値', valueB: 'B 値' });
    expect(buildChoiceWrite(c, 'B')).toEqual({ field: c.field, entityKey: '-', action: 'edit', value: 'B 値' });
  });
});

describe('buildCustomValueWrite', () => {
  test('trim して action=edit で書き出す', () => {
    const c = cell();
    expect(buildCustomValueWrite(c, '  第 3 の値  ')).toEqual({
      field: c.field,
      entityKey: '-',
      action: 'edit',
      value: '第 3 の値',
    });
  });

  test('空欄（trim 後空文字）は明示的な null 値になる', () => {
    const c = cell();
    expect(buildCustomValueWrite(c, '   ')).toEqual({ field: c.field, entityKey: '-', action: 'edit', value: null });
  });
});

describe('buildNotReportedWrite', () => {
  test('NOT_REPORTED_TOKEN を action=not_reported で書き出す', () => {
    const c = cell();
    expect(buildNotReportedWrite(c)).toEqual({
      field: c.field,
      entityKey: '-',
      action: 'not_reported',
      value: NOT_REPORTED_TOKEN,
    });
  });
});

describe('buildUndoWrite', () => {
  test('consensus 未判定（stack 空）なら null', () => {
    expect(buildUndoWrite(cell(), emptyCellState())).toBeNull();
  });

  test('判定済みなら 1 件戻した値で action=undo を書き出す', () => {
    const decisionA = {
      decidedAt: 't0',
      decidedBy: 'judge@example.com',
      studyId: 'study-1',
      fieldId: 'f-1',
      entityKey: '-',
      annotator: 'consensus',
      annotatorType: 'consensus' as const,
      schemaVersion: 1,
      action: 'accept' as const,
      value: '120',
      note: null,
    };
    const state: CellState = { status: 'accept', value: '120', stack: [decisionA] };
    expect(buildUndoWrite(cell(), state)).toEqual({
      field: cell().field,
      entityKey: '-',
      action: 'undo',
      value: null, // スタックが 1 件だけなので取り消すと未検証（空セル）に戻る
    });
  });
});
