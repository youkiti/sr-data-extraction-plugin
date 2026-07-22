import { AI_ANNOTATOR, NOT_REPORTED_TOKEN } from '../../../src/domain/annotation';
import {
  SHEET_TABS,
  SHEET_HEADERS,
  STUDY_DATA_FIXED_HEADERS,
  buildStudyDataHeader,
} from '../../../src/domain/sheetsSchema';

describe('SHEET_TABS', () => {
  test('requirements.md §3.2 + 独立二重レビュー機能の 15 タブを定義順に持つ', () => {
    expect(SHEET_TABS).toEqual([
      'Meta',
      'Protocol',
      'Studies',
      'Documents',
      'SchemaVersions',
      'SchemaFields',
      'ExtractionRuns',
      'StudyData',
      'ResultsData',
      'ArmStructures',
      'Evidence',
      'Decisions',
      'LLMApiLog',
      'ExportLog',
      'Reviewers',
    ]);
  });

  test('全タブにヘッダー定義が存在し、列名が重複しない', () => {
    for (const tab of SHEET_TABS) {
      const headers = SHEET_HEADERS[tab];
      expect(headers.length).toBeGreaterThan(0);
      expect(new Set(headers).size).toBe(headers.length);
    }
  });
});

describe('SHEET_HEADERS', () => {
  test('Meta / Protocol は sr-query-builder のスキーマをそのまま流用する', () => {
    expect(SHEET_HEADERS.Meta).toEqual([
      'project_id',
      'project_title',
      'spreadsheet_id',
      'drive_folder_id',
      'schema_version',
      'created_at',
      'created_by',
    ]);
    expect(SHEET_HEADERS.Protocol).toContain('research_question');
    expect(SHEET_HEADERS.Protocol).toContain('combination_expression');
  });

  test('Documents は取り込みメタデータ（凍結スナップショット + テキスト層状態 + 除外機能）を持つ', () => {
    expect(SHEET_HEADERS.Documents).toEqual([
      'document_id',
      'study_id',
      'document_role',
      'drive_file_id',
      'source_file_id',
      'filename',
      'pmid',
      'doi',
      'text_ref',
      'text_status',
      'page_count',
      'char_count',
      'imported_at',
      'imported_by',
      'note',
      'excluded',
      'exclusion_reason',
      'exclusion_note',
      'excluded_at',
    ]);
  });

  test('Studies は試験メタデータ（study_label + 登録 ID）を持つ', () => {
    expect(SHEET_HEADERS.Studies).toEqual([
      'study_id',
      'study_label',
      'registration_id',
      'created_at',
      'created_by',
      'note',
    ]);
  });

  test('StudyData は固定列のみ（値列は動的生成）', () => {
    expect(SHEET_HEADERS.StudyData).toEqual(STUDY_DATA_FIXED_HEADERS);
  });

  test('ResultsData は long の更新キー 4 列（study_id × annotator × entity_key × field_id）を含む', () => {
    for (const key of ['study_id', 'annotator', 'entity_key', 'field_id']) {
      expect(SHEET_HEADERS.ResultsData).toContain(key);
    }
    expect(SHEET_HEADERS.ResultsData[0]).toBe('result_id');
  });

  test('Evidence は quote アンカリング列（quote / page / anchor_status）を含む', () => {
    for (const key of ['quote', 'page', 'confidence', 'anchor_status']) {
      expect(SHEET_HEADERS.Evidence).toContain(key);
    }
  });

  test('Decisions は判定対象 annotator 行の特定列と action を含む', () => {
    for (const key of ['annotator', 'annotator_type', 'schema_version', 'action']) {
      expect(SHEET_HEADERS.Decisions).toContain(key);
    }
  });

  test('ArmStructures は群構成の確定行（version + arm_key + arm_name + annotator）を持つ', () => {
    expect(SHEET_HEADERS.ArmStructures).toEqual([
      'study_id',
      'version',
      'arm_key',
      'arm_name',
      'annotator',
      'annotator_type',
      'confirmed_at',
      'note',
    ]);
  });

  test('Reviewers はロール割り当て（email + role + review_mode + assigned_by/at）を持つ', () => {
    expect(SHEET_HEADERS.Reviewers).toEqual([
      'email',
      'role',
      'review_mode',
      'assigned_by',
      'assigned_at',
    ]);
  });
});

describe('buildStudyDataHeader', () => {
  test('固定列の後ろに field_name 列を追加する', () => {
    expect(buildStudyDataHeader(['country', 'sample_size_total'])).toEqual([
      ...STUDY_DATA_FIXED_HEADERS,
      'country',
      'sample_size_total',
    ]);
  });

  test('field_name なし（スキーマ未確定）でも固定列だけで生成できる', () => {
    expect(buildStudyDataHeader([])).toEqual([...STUDY_DATA_FIXED_HEADERS]);
  });

  test('固定列と衝突する field_name を拒否する', () => {
    expect(() => buildStudyDataHeader(['annotator'])).toThrow('StudyData の列名が重複');
  });

  test('field_name の重複を拒否する', () => {
    expect(() => buildStudyDataHeader(['country', 'country'])).toThrow('StudyData の列名が重複');
  });
});

describe('annotation 定数', () => {
  test('AI annotator と未報告トークンの表記が requirements.md §3.2 と一致する', () => {
    expect(AI_ANNOTATOR).toBe('ai');
    expect(NOT_REPORTED_TOKEN).toBe('NR');
  });
});
