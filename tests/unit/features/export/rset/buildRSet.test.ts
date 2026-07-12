// R セット（issue #60）のオーケストレータ結合テスト。golden fixture（__fixtures__/scenario.ts）で
// 受け入れ条件の 8 シナリオ（①study_label 重複〜⑧未知 field_id）を一括検証する
import { CSV_BOM } from '../../../../../src/features/export/csvEncode';
import { parseCsv } from '../../../../../src/features/export/parseCsv';
import { buildRSet } from '../../../../../src/features/export/rset/buildRSet';
import { EXPORT_FORMAT_VERSION, FINAL_ANNOTATOR_RULE_DESCRIPTION } from '../../../../../src/features/export/rset/buildExportManifest';
import { MANIFEST_META, MATERIALS, SPECIAL_CHAR_VALUE } from './__fixtures__/scenario';

describe('buildRSet', () => {
  const built = buildRSet(MATERIALS, MANIFEST_META);

  test('8 ファイル（tab1/tab1_status/ma/ma_status/rob/data_dictionary/export_issues/manifest）を生成する', () => {
    expect(built.files.map((file) => file.name)).toEqual([
      'tab1.csv',
      'tab1_status.csv',
      'ma.csv',
      'ma_status.csv',
      'rob.csv',
      'data_dictionary.csv',
      'export_issues.csv',
      'export_manifest.json',
    ]);
  });

  test('① study_label 重複でも study_id で行を区別できる（tab1.csv）', () => {
    const tab1 = built.files.find((file) => file.name === 'tab1.csv');
    const records = parseCsv(tab1?.content ?? '');
    const smithRows = records.filter((row) => row[1] === 'Smith 2020');
    expect(smithRows).toHaveLength(2);
    expect(smithRows.map((row) => row[0]).sort()).toEqual(['study-a', 'study-b']);
  });

  test('② 未検証セル（AI Evidence のみ）は ma.csv の値列が空・ma_status.csv が unverified・export_issues.csv に明示される', () => {
    const ma = built.files.find((file) => file.name === 'ma.csv');
    const maStatus = built.files.find((file) => file.name === 'ma_status.csv');
    const records = parseCsv(ma?.content ?? '');
    const statusRecords = parseCsv(maStatus?.content ?? '');
    const header = records[0] as string[];
    const totalColumn = header.indexOf('outcome_total');
    const targetRow = records.find(
      (row) => row[0] === 'study-d' && row[2] === 'mortality' && row[4] === '30d' && row[7] === '3',
    );
    const targetStatusRow = statusRecords.find(
      (row) => row[0] === 'study-d' && row[2] === 'mortality' && row[4] === '30d' && row[7] === '3',
    );
    expect(targetRow?.[totalColumn]).toBe('');
    expect(targetStatusRow?.[totalColumn]).toBe('unverified');

    const issuesCsv = built.files.find((file) => file.name === 'export_issues.csv');
    const issueRecords = parseCsv(issuesCsv?.content ?? '');
    expect(
      issueRecords.some(
        (row) =>
          row[0] === 'unverified_cell' &&
          row[1] === 'study-d' &&
          row[3] === 'outcome:mortality|arm:3|time:30d',
      ),
    ).toBe(true);
  });

  test('③ not_reported の値は空・ステータスは not_reported になる（ma.csv）', () => {
    const ma = built.files.find((file) => file.name === 'ma.csv');
    const maStatus = built.files.find((file) => file.name === 'ma_status.csv');
    const records = parseCsv(ma?.content ?? '');
    const statusRecords = parseCsv(maStatus?.content ?? '');
    const header = records[0] as string[];
    const eventsColumn = header.indexOf('outcome_events');
    const targetRow = records.find(
      (row) => row[0] === 'study-d' && row[2] === 'mortality' && row[4] === '30d' && row[7] === '2',
    );
    const targetStatusRow = statusRecords.find(
      (row) => row[0] === 'study-d' && row[2] === 'mortality' && row[4] === '30d' && row[7] === '2',
    );
    expect(targetRow?.[eventsColumn]).toBe('');
    expect(targetStatusRow?.[eventsColumn]).toBe('not_reported');
  });

  test('④ 3 群 + 複数 timepoint が study × outcome × timepoint × arm の long 行として揃う（ma.csv）', () => {
    const ma = built.files.find((file) => file.name === 'ma.csv');
    const records = parseCsv(ma?.content ?? '');
    const mortalityRows = records.filter((row) => row[0] === 'study-d' && row[2] === 'mortality');
    expect(mortalityRows).toHaveLength(6); // 2 timepoint × 3 arm
    const combos = mortalityRows.map((row) => `${row[4]}|${row[7]}`).sort();
    expect(combos).toEqual(['30d|1', '30d|2', '30d|3', '90d|1', '90d|2', '90d|3']);
    // arm_label は ArmStructures の確定名
    const arm1 = mortalityRows.find((row) => row[4] === '30d' && row[7] === '1');
    expect(arm1?.[8]).toBe('介入群A');
  });

  test('⑤ rob domain 行が RoB 2 の全ドメイン分（5 + overall = 6）出現し、実データは verified になる（rob.csv）', () => {
    const rob = built.files.find((file) => file.name === 'rob.csv');
    const records = parseCsv(rob?.content ?? '');
    const studyDRows = records.slice(1).filter((row) => row[0] === 'study-d');
    expect(studyDRows).toHaveLength(6);
    const d1 = studyDRows.find((row) => row[3] === 'd1_randomization');
    expect(d1?.[8]).toBe('low'); // judgement
    expect(d1?.[10]).toBe('verified'); // verification_status
    const d2 = studyDRows.find((row) => row[3] === 'd2_deviations');
    expect(d2?.[10]).toBe('no_data'); // 幽霊セル: 実データが無いドメインも必ず出現する

    // ma.csv 側にも rob_overall_judgement が複製される
    const ma = built.files.find((file) => file.name === 'ma.csv');
    const maRecords = parseCsv(ma?.content ?? '');
    const maRow = maRecords.find((row) => row[0] === 'study-d' && row[2] === 'mortality');
    expect(maRow?.[9]).toBe('rob2');
    expect(maRow?.[10]).toBe('low');
  });

  test('⑥ カンマ・改行・引用符・日本語を含む値が RFC4180 でエスケープされ、parseCsv で原文へ round-trip する', () => {
    const tab1 = built.files.find((file) => file.name === 'tab1.csv');
    // 構造的な行区切りは CRLF だが、値の中の改行はそのまま保持する（RFC 4180 は引用内改行を \n / \r\n どちらも許容）
    expect(tab1?.content).toContain('"Line1\nLine2, ""quoted"", 日本語です"');
    const records = parseCsv(tab1?.content ?? '');
    const header = records[0] as string[];
    const noteColumn = header.indexOf('note_with_special_chars');
    const studyDRow = records.find((row) => row[0] === 'study-d');
    expect(studyDRow?.[noteColumn]).toBe(SPECIAL_CHAR_VALUE);
  });

  test('⑦ 確定 annotator を特定できない study は tab1 / ma / rob から除外され、export_issues.csv に明示される', () => {
    for (const name of ['tab1.csv', 'ma.csv', 'rob.csv']) {
      const file = built.files.find((f) => f.name === name);
      const records = parseCsv(file?.content ?? '');
      expect(records.some((row) => row[0] === 'study-c')).toBe(false);
    }
    const issuesCsv = built.files.find((file) => file.name === 'export_issues.csv');
    const issueRecords = parseCsv(issuesCsv?.content ?? '');
    const skipIssues = issueRecords.filter(
      (row) => row[0] === 'skipped_study_no_final_annotator' && row[1] === 'study-c',
    );
    // tab1 / ma / rob それぞれが自分の対象データ（StudyData と ResultsData）から独立に判定するため、
    // ResultsData 起因の 1 事象でも「どのファイルへ影響したか」が分かるよう ma と rob で 1 件ずつ計上する
    expect(skipIssues.map((row) => row[4])).toEqual([
      expect.stringContaining('tab1.csv'),
      expect.stringContaining('ma.csv'),
      expect.stringContaining('rob.csv'),
    ]);
  });

  test('⑧ SchemaFields に無い field_id を参照する ResultsData 行は export_issues.csv に明示される', () => {
    const issuesCsv = built.files.find((file) => file.name === 'export_issues.csv');
    const issueRecords = parseCsv(issuesCsv?.content ?? '');
    expect(
      issueRecords.some(
        (row) =>
          row[0] === 'dropped_unknown_field' && row[1] === 'study-d' && row[2] === 'f-ghost-unknown',
      ),
    ).toBe(true);
  });

  test('export_manifest.json はファイル別行数・issue 集計・確定 annotator 規則を記録する', () => {
    const manifestFile = built.files.find((file) => file.name === 'export_manifest.json');
    const manifest = JSON.parse(manifestFile?.content ?? '{}') as Record<string, unknown>;
    expect(manifest.export_format_version).toBe(EXPORT_FORMAT_VERSION);
    expect(manifest.schema_version).toBe(5);
    expect(manifest.exported_at).toBe(MANIFEST_META.exportedAt);
    expect(manifest.app_version).toBe(MANIFEST_META.appVersion);
    expect(manifest.review_mode).toBe(MANIFEST_META.reviewMode);
    expect(manifest.final_annotator_rule).toBe(FINAL_ANNOTATOR_RULE_DESCRIPTION);
    expect(manifest.files).toMatchObject({
      'tab1.csv': { rows: 3 }, // a / b / d（c は確定 annotator 不明で除外）
    });
    const issuesSummary = manifest.issues_summary as Record<string, number>;
    // study-c の 1 事象が tab1 / ma / rob の 3 ファイルへそれぞれ影響を及ぼすため 3 件
    expect(issuesSummary.skipped_study_no_final_annotator).toBe(3);
    expect(issuesSummary.dropped_unknown_field).toBe(1);
    expect(issuesSummary.unverified_cell).toBeGreaterThanOrEqual(1);
  });

  test('全 CSV ファイルは UTF-8 BOM 付きヘッダーで始まる', () => {
    for (const file of built.files) {
      if (file.name.endsWith('.csv')) {
        expect(file.content.startsWith(CSV_BOM)).toBe(true);
      }
    }
  });

  test('data_dictionary.csv は最新確定版の全項目を field_index 順に列挙する', () => {
    const dictionary = built.files.find((file) => file.name === 'data_dictionary.csv');
    const records = parseCsv(dictionary?.content ?? '');
    expect(records.slice(1).map((row) => row[1])).toEqual([
      'design',
      'note_with_special_chars',
      'outcome_mean',
      'outcome_sd',
      'outcome_n',
      'outcome_events',
      'outcome_total',
      'rob2_judgement',
      'rob2_support',
    ]);
  });
});
