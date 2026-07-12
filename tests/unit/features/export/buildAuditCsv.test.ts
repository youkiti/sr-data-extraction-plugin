import type { Decision } from '../../../../src/domain/decision';
import type { StudyRecord } from '../../../../src/domain/study';
import type { Evidence } from '../../../../src/domain/evidence';
import type { ExtractionRun } from '../../../../src/domain/extractionRun';
import type { SchemaField } from '../../../../src/domain/schemaField';
import {
  AUDIT_HEADER,
  AUDIT_MISSING_TOKEN,
  buildAuditCsv,
} from '../../../../src/features/export/buildAuditCsv';
import {
  ENTITY_INSTANCE_DECLARATION_FIELD_ID,
  OUTCOME_INSTANCE_DECLARATION_NOTE,
} from '../../../../src/features/verification/instanceDeclarations';
import { CSV_BOM } from '../../../../src/features/export/csvEncode';

/** 構造的欠損トークン（可読性のための短縮名） */
const NA = AUDIT_MISSING_TOKEN;
/** 構造的欠損の Evidence 列ブロック（run_id〜anchor_status の 8 列 + bbox 5 列 = 13 列。§7.4 PR3） */
const NA_EVIDENCE = [NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA, NA];

const study = (studyId: string, studyLabel: string): StudyRecord => ({
  studyId,
  studyLabel,
  registrationId: null,
  createdAt: '2026-07-02T00:00:00Z',
  createdBy: 'a@example.com',
  note: null,
});

const field = (fieldId: string, fieldName: string, fieldIndex: number): SchemaField => ({
  schemaVersion: 1,
  fieldId,
  fieldIndex,
  section: 'methods',
  fieldName,
  fieldLabel: fieldName,
  entityLevel: 'study',
  dataType: 'integer',
  unit: null,
  allowedValues: null,
  required: true,
  extractionInstruction: '指示',
  example: null,
  aiGenerated: true,
  note: null,
});

const run = (
  runId: string,
  schemaVersion: number,
  startedAt: string | null,
): ExtractionRun => ({
  runId,
  runType: 'full',
  schemaVersion,
  studyIds: ['d1'],
  provider: 'gemini',
  requestedModel: 'gemini-x',
  modelVersion: null,
  inputMode: 'text_only',
  status: 'done',
  startedAt,
  finishedAt: null,
  tokensIn: null,
  tokensOut: null,
  costEstimate: null,
});

const evidence = (
  evidenceId: string,
  runId: string,
  studyId: string,
  fieldId: string,
  entityKey: string,
  overrides: Partial<Evidence> = {},
): Evidence => ({
  evidenceId,
  runId,
  studyId,
  // quote の出所文書。audit の document_id 列はこの Evidence.documentId 由来（v0.10）。
  // study_id と別値にして「列が Evidence 由来である」ことを検証できるようにする
  documentId: `${studyId}-doc`,
  fieldId,
  entityKey,
  value: '120',
  notReported: false,
  quote: 'a total of 120 patients',
  page: 3,
  confidence: 'high',
  anchorStatus: 'exact',
  bboxPage: null,
  bbox: null,
  relocatedFrom: null,
  ...overrides,
});

const decision = (
  studyId: string,
  fieldId: string,
  entityKey: string,
  action: Decision['action'],
  decidedAt: string,
  overrides: Partial<Decision> = {},
): Decision => ({
  decidedAt,
  decidedBy: 'a@example.com',
  studyId,
  fieldId,
  entityKey,
  annotator: 'a@example.com',
  annotatorType: 'human_with_ai',
  schemaVersion: 1,
  action,
  value: null,
  note: null,
  ...overrides,
});

const headerLine = AUDIT_HEADER.join(',');

/** CSV をヘッダー除きの行配列（各行は列配列）へ戻す。テストデータは引用が必要な文字を含まない前提 */
const dataRows = (csv: string): string[][] =>
  csv
    .replace(CSV_BOM, '')
    .split('\r\n')
    .filter((line) => line !== '')
    .slice(1)
    .map((line) => line.split(','));

describe('buildAuditCsv', () => {
  test('判定履歴（undo 含む）全行に schema_version 一致 run の Evidence を添付し、seq を振る', () => {
    // シナリオ: v1 で accept → undo → edit、スキーマ改訂後 v2 で accept
    const studies = [study('d1', 'Tanaka 2023')];
    const fields = [field('f1', 'total_n', 1)];
    const runs = [run('run-1', 1, '2026-07-01T00:00:00Z'), run('run-2', 2, '2026-07-02T00:00:00Z')];
    const evidences = [
      evidence('e1', 'run-1', 'd1', 'f1', '-'),
      evidence('e2', 'run-2', 'd1', 'f1', '-', { value: '124', quote: 'randomized 124' }),
    ];
    // 入力はあえて時系列を崩して渡す（decided_at 昇順ソートの検証）
    const decisions = [
      decision('d1', 'f1', '-', 'accept', '2026-07-02T10:00:00Z', {
        value: '124',
        schemaVersion: 2,
      }),
      decision('d1', 'f1', '-', 'undo', '2026-07-01T10:01:00Z'),
      decision('d1', 'f1', '-', 'accept', '2026-07-01T10:00:00Z', { value: '120' }),
      decision('d1', 'f1', '-', 'edit', '2026-07-01T10:02:00Z', {
        value: '124',
        note: 'Table 2 と本文で不一致、Table 2 採用',
      }),
    ];
    const result = buildAuditCsv(studies, decisions, evidences, runs, fields);
    const rows = dataRows(result.csv);
    expect(result.csv.startsWith(`${CSV_BOM}${headerLine}\r\n`)).toBe(true);
    expect(rows).toHaveLength(4);
    // seq は decided_at 昇順の連番（study_id 列の追加で decision_seq は 22 列目）
    expect(rows.map((row) => row[22])).toEqual(['1', '2', '3', '4']);
    expect(rows.map((row) => row[23])).toEqual(['accept', 'undo', 'edit', 'accept']);
    // v1 の判定 3 行には run-1 の Evidence、v2 の判定には run-2 の Evidence が付く
    expect(rows.map((row) => row[10])).toEqual(['e1', 'e1', 'e1', 'e2']);
    // study_id 列は Studies 由来（1 列目）、document_id は添付 Evidence.documentId 由来（2 列目）
    expect(rows.map((row) => row[1])).toEqual(['d1', 'd1', 'd1', 'd1']);
    expect(rows.map((row) => row[2])).toEqual(['d1-doc', 'd1-doc', 'd1-doc', 'd1-doc']);
    expect(rows[3]?.[6]).toBe('2'); // schema_version は判定行のもの
    expect(rows[2]?.[27]).toBe('Table 2 と本文で不一致、Table 2 採用');
    expect(result.undecidedCellCount).toBe(0);
    expect(result.droppedRowCount).toBe(0);
    expect(result.studyCount).toBe(1);
  });

  test('Evidence も判定もない study は studyCount に数えない', () => {
    const studies = [study('d1', 'Tanaka 2023'), study('d2', 'Suzuki 2024')];
    const fields = [field('f1', 'total_n', 1)];
    const runs = [run('run-1', 1, '2026-07-01T00:00:00Z')];
    const evidences = [evidence('e1', 'run-1', 'd1', 'f1', '-')];
    const result = buildAuditCsv(studies, [], evidences, runs, fields);
    expect(result.studyCount).toBe(1);
  });

  test('判定 0 件のセルは最新 run の代表 Evidence でプレースホルダ 1 行を出す', () => {
    const studies = [study('d1', 'Tanaka 2023')];
    const fields = [field('f1', 'blinding', 1)];
    const runs = [run('run-1', 1, '2026-07-01T00:00:00Z'), run('run-2', 1, '2026-07-02T00:00:00Z')];
    // 最新 run の Evidence を先頭に置く（後続の旧 Evidence が代表を上書きしないことの検証）
    const evidences = [
      evidence('e-new', 'run-2', 'd1', 'f1', '-', { value: 'double-blind' }),
      evidence('e-old', 'run-1', 'd1', 'f1', '-'),
    ];
    const result = buildAuditCsv(studies, [], evidences, runs, fields);
    const rows = dataRows(result.csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[10]).toBe('e-new'); // 旧 run の未判定 Evidence は出さない（結合規則 3）
    expect(rows[0]?.[1]).toBe('d1'); // study_id 列は Studies 由来
    expect(rows[0]?.[2]).toBe('d1-doc'); // document_id 列は代表 Evidence.documentId 由来
    expect(rows[0]?.[6]).toBe('1'); // schema_version は代表 Evidence の run から
    expect(rows[0]?.[7]).toBe(NA); // annotator が構造的欠損 = 未検証の明示
    // 判定列ブロック（decision_seq〜note）も構造的欠損（study_id 列の追加で開始位置は 22）
    expect(rows[0]?.slice(22)).toEqual([NA, NA, NA, NA, NA, NA]);
    expect(result.undecidedCellCount).toBe(1);
  });

  test('同一 schema_version の run が複数あるとき started_at 最新の Evidence を添付する', () => {
    const studies = [study('d1', 'Tanaka 2023')];
    const fields = [field('f1', 'total_n', 1)];
    const runs = [
      run('run-1', 1, '2026-07-01T00:00:00Z'),
      run('run-retry', 1, '2026-07-01T12:00:00Z'),
    ];
    const evidences = [
      evidence('e1', 'run-1', 'd1', 'f1', '-'),
      evidence('e-retry', 'run-retry', 'd1', 'f1', '-'),
    ];
    const decisions = [decision('d1', 'f1', '-', 'accept', '2026-07-01T13:00:00Z')];
    const result = buildAuditCsv(studies, decisions, evidences, runs, fields);
    expect(dataRows(result.csv)[0]?.[10]).toBe('e-retry');
  });

  test('relocate-quote（issue #94）で同一 run_id の Evidence が追記された場合、後に追記された行を添付する', () => {
    // relocateQuoteService は再特定した新 Evidence 行を元の失敗行と同じ run_id で追記するため、
    // startedAtOf() は両者で同値になる（同一 run を指す）。追記順（= evidences 配列の並び）で
    // 後ろにある行（再特定成功後の行）が「後勝ち」で採用されることを確認する
    // （修正前の `>` 比較は同値ケースで常に先頭を残してしまう回帰があった）
    const studies = [study('d1', 'Tanaka 2023')];
    const fields = [field('f1', 'total_n', 1)];
    const runs = [run('run-1', 1, '2026-07-01T00:00:00Z')];
    const evidences = [
      evidence('e-original', 'run-1', 'd1', 'f1', '-', { anchorStatus: 'failed', quote: null, page: null }),
      evidence('e-relocated', 'run-1', 'd1', 'f1', '-', {
        anchorStatus: 'fuzzy',
        relocatedFrom: 'e-original',
      }),
    ];
    const decisions = [decision('d1', 'f1', '-', 'accept', '2026-07-01T13:00:00Z')];
    const result = buildAuditCsv(studies, decisions, evidences, runs, fields);
    expect(dataRows(result.csv)[0]?.[10]).toBe('e-relocated');
  });

  test('Evidence 欠損は正常: 独立抽出行への判定・schema_version 不一致は Evidence 列空', () => {
    const studies = [study('d1', 'Tanaka 2023')];
    const fields = [field('f1', 'total_n', 1), field('f2', 'country', 2)];
    const runs = [run('run-1', 1, '2026-07-01T00:00:00Z')];
    // f1 には v1 の Evidence があるが判定は v2（不一致）、f2 は Evidence なし
    const evidences = [evidence('e1', 'run-1', 'd1', 'f1', '-')];
    const decisions = [
      decision('d1', 'f1', '-', 'accept', '2026-07-02T10:00:00Z', { schemaVersion: 2 }),
      decision('d1', 'f2', '-', 'edit', '2026-07-02T10:01:00Z', {
        value: 'Japan',
        annotator: 'b@example.com',
        annotatorType: 'human_independent',
      }),
    ];
    const result = buildAuditCsv(studies, decisions, evidences, runs, fields);
    const rows = dataRows(result.csv);
    // f1 セルには判定があるためプレースホルダは出ない（v1 Evidence は添付されず落ちる）→ 判定 2 行のみ
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.slice(9, 22))).toEqual([NA_EVIDENCE, NA_EVIDENCE]);
    // 添付 Evidence がない判定行は document_id 列も構造的欠損（study_id 列自体は常に非欠損）
    expect(rows.map((row) => row[1])).toEqual(['d1', 'd1']);
    expect(rows.map((row) => row[2])).toEqual([NA, NA]);
    expect(result.undecidedCellCount).toBe(0);
  });

  test('run 不明の Evidence は添付候補外、プレースホルダでは schema_version 空で出す', () => {
    const studies = [study('d1', 'Tanaka 2023')];
    const fields = [field('f1', 'total_n', 1), field('f2', 'country', 2)];
    const runs = [run('run-null', 1, null)];
    const evidences = [
      // f1: run 不明 Evidence のみ → 判定に添付されない
      evidence('e-orphan', 'unknown-run', 'd1', 'f1', '-'),
      // f2: run 不明 Evidence のみが未判定 → プレースホルダは出すが schema_version 空
      evidence('e-orphan-2', 'unknown-run', 'd1', 'f2', '-', {
        value: null,
        quote: null,
        page: null,
        confidence: null,
        anchorStatus: null,
        notReported: true,
      }),
    ];
    const decisions = [decision('d1', 'f1', '-', 'accept', '2026-07-01T10:00:00Z')];
    const result = buildAuditCsv(studies, decisions, evidences, runs, fields);
    const rows = dataRows(result.csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.slice(9, 22)).toEqual(NA_EVIDENCE); // f1 判定行
    expect(rows[0]?.[2]).toBe(NA); // 添付なし判定行の document_id は構造的欠損
    expect(rows[1]?.[2]).toBe('d1-doc'); // プレースホルダは代表 Evidence.documentId
    // f2 プレースホルダ: Evidence は出すが run 由来の schema_version は不明 → 構造的欠損
    expect(rows[1]?.[6]).toBe(NA);
    expect(rows[1]?.[10]).toBe('e-orphan-2');
    expect(rows[1]?.[12]).toBe('true'); // ai_not_reported
    // Evidence レコードは存在しセルが null → 構造的欠損ではなく空文字のまま
    expect(rows[1]?.slice(13, 17)).toEqual(['', '', '', '']); // quote / page / confidence / anchor_status
    expect(result.undecidedCellCount).toBe(1);
  });

  test('started_at 未記録の run は最古扱いで代表に選ばれない', () => {
    const studies = [study('d1', 'Tanaka 2023')];
    const fields = [field('f1', 'total_n', 1)];
    const runs = [run('run-null', 1, null), run('run-1', 1, '2026-07-01T00:00:00Z')];
    const evidences = [
      evidence('e-null', 'run-null', 'd1', 'f1', '-'),
      evidence('e1', 'run-1', 'd1', 'f1', '-'),
    ];
    const result = buildAuditCsv(studies, [], evidences, runs, fields);
    expect(dataRows(result.csv)[0]?.[10]).toBe('e1');
  });

  test('field_id が SchemaFields にない判定行・プレースホルダ行は除外して数える', () => {
    const studies = [study('d1', 'Tanaka 2023')];
    const fields = [field('f1', 'total_n', 1)];
    const runs = [run('run-1', 1, '2026-07-01T00:00:00Z')];
    const evidences = [evidence('e1', 'run-1', 'd1', 'f-unknown-2', '-')];
    const decisions = [decision('d1', 'f-unknown', '-', 'accept', '2026-07-01T10:00:00Z')];
    const result = buildAuditCsv(studies, decisions, evidences, runs, fields);
    expect(dataRows(result.csv)).toHaveLength(0);
    expect(result.droppedRowCount).toBe(2);
    expect(result.undecidedCellCount).toBe(0);
  });

  test('インスタンス宣言イベントは audit.csv の判定行から除外し、droppedRowCount にも数えない', () => {
    const studies = [study('d1', 'Tanaka 2023')];
    const fields = [field('f1', 'event_count', 1)];
    const result = buildAuditCsv(
      studies,
      [
        decision(
          'd1',
          ENTITY_INSTANCE_DECLARATION_FIELD_ID,
          'outcome:mortality|arm:1',
          'edit',
          '2026-07-01T10:00:00Z',
          {
            value: 'outcome:mortality|arm:1',
            note: OUTCOME_INSTANCE_DECLARATION_NOTE,
          },
        ),
      ],
      [],
      [],
      fields,
    );
    expect(dataRows(result.csv)).toHaveLength(0);
    expect(result.droppedRowCount).toBe(0);
  });

  test('entity_key → field_index → annotator 順に並び、decided_at 同時刻は追記順を保つ', () => {
    const studies = [study('d1', 'Tanaka 2023')];
    const fields = [field('f1', 'group_n', 1), field('f2', 'event_count', 2)];
    const runs = [run('run-1', 1, '2026-07-01T00:00:00Z')];
    const evidences = [evidence('e1', 'run-1', 'd1', 'f2', 'arm:2')]; // 未判定 → プレースホルダ
    const at = '2026-07-01T10:00:00Z';
    const decisions = [
      decision('d1', 'f2', 'arm:1', 'accept', at, { annotator: 'b@example.com' }),
      decision('d1', 'f1', 'arm:1', 'accept', at, { annotator: 'c@example.com' }),
      decision('d1', 'f1', 'arm:2', 'accept', at),
      decision('d1', 'f1', 'arm:1', 'accept', at, { value: 'first' }),
      decision('d1', 'f1', 'arm:1', 'accept', at, { value: 'second' }), // 同時刻 → 追記順で seq 2
      decision('d1', 'f1', 'arm:1', 'reject', '2026-07-01T09:00:00Z', {
        annotator: 'b@example.com',
      }),
    ];
    const result = buildAuditCsv(studies, decisions, evidences, runs, fields);
    const rows = dataRows(result.csv);
    // [entity_key, field_name, annotator, decision_seq]（study_id 列の追加で decision_seq は 22 列目）
    expect(rows.map((row) => [row[3], row[5], row[7], row[22]])).toEqual([
      ['arm:1', 'group_n', 'a@example.com', '1'],
      ['arm:1', 'group_n', 'a@example.com', '2'],
      ['arm:1', 'group_n', 'b@example.com', '1'],
      ['arm:1', 'group_n', 'c@example.com', '1'],
      ['arm:1', 'event_count', 'b@example.com', '1'],
      ['arm:2', 'group_n', 'a@example.com', '1'],
      ['arm:2', 'event_count', NA, NA], // プレースホルダは annotator / seq が構造的欠損
    ]);
    expect(rows[0]?.[24]).toBe('first');
    expect(rows[1]?.[24]).toBe('second');
  });

  test('study は取り込み順を保ち、他 study の Evidence / Decisions は混ざらない', () => {
    const studies = [study('d2', 'Suzuki 2024'), study('d1', 'Tanaka 2023')];
    const fields = [field('f1', 'total_n', 1)];
    const runs = [run('run-1', 1, '2026-07-01T00:00:00Z')];
    const evidences = [
      evidence('e1', 'run-1', 'd1', 'f1', '-'),
      evidence('e2', 'run-1', 'd2', 'f1', '-'),
      evidence('e3', 'run-1', 'd-other', 'f1', '-'),
    ];
    const decisions = [
      decision('d1', 'f1', '-', 'accept', '2026-07-01T10:00:00Z'),
      decision('d-other', 'f1', '-', 'accept', '2026-07-01T10:00:00Z'),
    ];
    const result = buildAuditCsv(studies, decisions, evidences, runs, fields);
    const rows = dataRows(result.csv);
    expect(rows.map((row) => row[0])).toEqual(['Suzuki 2024', 'Tanaka 2023']);
    expect(rows.map((row) => row[1])).toEqual(['d2', 'd1']); // study_id 列は Studies 由来
    expect(rows.map((row) => row[2])).toEqual(['d2-doc', 'd1-doc']); // document_id は各 study の Evidence 由来
    // action 列は study_id 列の追加で 23 列目
    expect(rows[0]?.[23]).toBe(NA); // d2 は未判定プレースホルダ
    expect(rows[1]?.[23]).toBe('accept');
    expect(result.undecidedCellCount).toBe(1);
  });

  test('データが空なら ヘッダーのみの CSV を返す', () => {
    const result = buildAuditCsv([study('d1', 'Tanaka 2023')], [], [], [], []);
    expect(result.csv).toBe(`${CSV_BOM}${headerLine}\r\n`);
    expect(result.undecidedCellCount).toBe(0);
    expect(result.droppedRowCount).toBe(0);
  });

  test('bbox 列（bbox_page/bbox_ymin/bbox_xmin/bbox_ymax/bbox_xmax）を末尾に出力する（§7.4 PR3）', () => {
    const studies = [study('d1', 'Tanaka 2023')];
    const fields = [field('f1', 'total_n', 1)];
    const runs = [run('run-1', 1, '2026-07-01T00:00:00Z')];
    const evidences = [
      evidence('e1', 'run-1', 'd1', 'f1', '-', {
        bboxPage: 2,
        bbox: { ymin: 100, xmin: 200, ymax: 300, xmax: 400 },
      }),
    ];
    const result = buildAuditCsv(studies, [], evidences, runs, fields);
    const rows = dataRows(result.csv);
    expect(rows).toHaveLength(1); // 未判定のプレースホルダ 1 行
    // bbox 5 列は quote(13)/page(14)/confidence(15)/anchor_status(16) の直後（17-21）
    expect(rows[0]?.slice(17, 22)).toEqual(['2', '100', '200', '300', '400']);
  });

  test('bbox が無い Evidence は bbox 列を空文字で出力する', () => {
    const studies = [study('d1', 'Tanaka 2023')];
    const fields = [field('f1', 'total_n', 1)];
    const runs = [run('run-1', 1, '2026-07-01T00:00:00Z')];
    const evidences = [evidence('e1', 'run-1', 'd1', 'f1', '-')]; // bboxPage/bbox は既定 null
    const result = buildAuditCsv(studies, [], evidences, runs, fields);
    const rows = dataRows(result.csv);
    expect(rows[0]?.slice(17, 22)).toEqual(['', '', '', '', '']);
  });
});
