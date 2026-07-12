// buildRSet.test.ts の golden fixture（issue #60 受け入れ条件の 8 シナリオを 1 プロジェクトへ集約）。
// ① study_label 重複（study-a / study-b）
// ② 未検証セル（study-d の outcome:mortality|arm:3|time:30d の outcome_total）
// ③ not_reported（study-d の outcome:mortality|arm:2|time:30d の outcome_events）
// ④ 3 群 + 複数 timepoint（study-d の mortality outcome。arm:1〜3 × time:30d/90d）
// ⑤ rob domain 行（study-d の RoB 2 判定）
// ⑥ カンマ・改行・日本語・引用符を含む値（study-d の note フィールド）
// ⑦ 確定 annotator 不明 study（study-c。StudyData / ResultsData ともに human 行が 2 件）
// ⑧ 未知 field_id（study-d の ResultsData に SchemaFields 未掲載の f-ghost 行）
import { NOT_REPORTED_TOKEN } from '../../../../../../src/domain/annotation';
import type { RSetManifestMeta, RSetMaterials } from '../../../../../../src/features/export/rset/buildRSet';
import {
  makeArmStructureRow,
  makeEvidence,
  makeField,
  makeResultsDataRow,
  makeStudy,
  makeStudyDataRow,
} from '../testHelpers';

/** RFC 4180 エスケープ検証用の値（カンマ・改行・引用符・日本語を含む） */
export const SPECIAL_CHAR_VALUE = 'Line1\nLine2, "quoted", 日本語です';

export const FIELDS = [
  makeField({ fieldId: 'f-design', fieldName: 'design', fieldIndex: 1, entityLevel: 'study', schemaVersion: 5 }),
  makeField({ fieldId: 'f-note', fieldName: 'note_with_special_chars', fieldIndex: 2, entityLevel: 'study', schemaVersion: 5 }),
  makeField({ fieldId: 'f-mean', fieldName: 'outcome_mean', fieldIndex: 3, entityLevel: 'outcome_result', dataType: 'float', schemaVersion: 5 }),
  makeField({ fieldId: 'f-sd', fieldName: 'outcome_sd', fieldIndex: 4, entityLevel: 'outcome_result', dataType: 'float', schemaVersion: 5 }),
  makeField({ fieldId: 'f-n', fieldName: 'outcome_n', fieldIndex: 5, entityLevel: 'outcome_result', dataType: 'integer', schemaVersion: 5 }),
  makeField({ fieldId: 'f-events', fieldName: 'outcome_events', fieldIndex: 6, entityLevel: 'outcome_result', dataType: 'integer', schemaVersion: 5 }),
  makeField({ fieldId: 'f-total', fieldName: 'outcome_total', fieldIndex: 7, entityLevel: 'outcome_result', dataType: 'integer', schemaVersion: 5 }),
  makeField({ fieldId: 'f-judgement', fieldName: 'rob2_judgement', fieldIndex: 8, entityLevel: 'rob_domain', dataType: 'enum', schemaVersion: 5 }),
  makeField({ fieldId: 'f-support', fieldName: 'rob2_support', fieldIndex: 9, entityLevel: 'rob_domain', dataType: 'text', schemaVersion: 5 }),
];

const studyA = makeStudy({ studyId: 'study-a', studyLabel: 'Smith 2020', registrationId: 'NCT0001' });
const studyB = makeStudy({ studyId: 'study-b', studyLabel: 'Smith 2020', registrationId: null });
const studyC = makeStudy({ studyId: 'study-c', studyLabel: 'Tanaka 2023', registrationId: null });
const studyD = makeStudy({ studyId: 'study-d', studyLabel: 'Suzuki 2024', registrationId: null });

export const STUDIES = [studyA, studyB, studyC, studyD];

const FINAL_ANNOTATOR = 'reviewer1@example.com';

export const STUDY_ROWS = [
  makeStudyDataRow({
    studyId: 'study-a',
    annotator: FINAL_ANNOTATOR,
    schemaVersion: 5,
    values: { design: 'RCT' },
  }),
  makeStudyDataRow({
    studyId: 'study-b',
    annotator: FINAL_ANNOTATOR,
    schemaVersion: 5,
    values: { design: 'cohort' },
  }),
  // ⑦ study-c: human 行が 2 件で確定 annotator を一意に特定できない
  makeStudyDataRow({
    studyId: 'study-c',
    annotator: 'x@example.com',
    schemaVersion: 5,
    values: { design: 'RCT' },
  }),
  makeStudyDataRow({
    studyId: 'study-c',
    annotator: 'y@example.com',
    schemaVersion: 5,
    values: { design: 'RCT' },
  }),
  // ⑥ study-d: カンマ・改行・引用符・日本語を含む値
  makeStudyDataRow({
    studyId: 'study-d',
    annotator: FINAL_ANNOTATOR,
    schemaVersion: 5,
    values: { design: 'RCT', note_with_special_chars: SPECIAL_CHAR_VALUE },
  }),
];

export const ARM_STRUCTURE_ROWS = [
  makeArmStructureRow({ studyId: 'study-d', armKey: 'arm:1', armName: '介入群A', annotator: FINAL_ANNOTATOR }),
  makeArmStructureRow({ studyId: 'study-d', armKey: 'arm:2', armName: '介入群B', annotator: FINAL_ANNOTATOR }),
  makeArmStructureRow({ studyId: 'study-d', armKey: 'arm:3', armName: '対照群', annotator: FINAL_ANNOTATOR }),
];

function maRow(entityKey: string, fieldId: string, value: string | null, notReported = false) {
  return makeResultsDataRow({
    resultId: `r-${entityKey}-${fieldId}`,
    studyId: 'study-d',
    annotator: FINAL_ANNOTATOR,
    schemaVersion: 5,
    entityKey,
    fieldId,
    value,
    notReported,
  });
}

export const RESULTS_ROWS = [
  // ④ 3 群 × 2 timepoint（events / total）
  maRow('outcome:mortality|arm:1|time:30d', 'f-events', '5'),
  maRow('outcome:mortality|arm:1|time:30d', 'f-total', '50'),
  // ③ not_reported
  maRow('outcome:mortality|arm:2|time:30d', 'f-events', NOT_REPORTED_TOKEN, true),
  maRow('outcome:mortality|arm:2|time:30d', 'f-total', '45'),
  // arm:3/time:30d の outcome_events は行自体が無い（② で Evidence のみ付与し unverified にする）
  maRow('outcome:mortality|arm:1|time:90d', 'f-events', '8'),
  maRow('outcome:mortality|arm:1|time:90d', 'f-total', '52'),
  maRow('outcome:mortality|arm:2|time:90d', 'f-events', '6'),
  maRow('outcome:mortality|arm:2|time:90d', 'f-total', '48'),
  maRow('outcome:mortality|arm:3|time:90d', 'f-events', '4'),
  maRow('outcome:mortality|arm:3|time:90d', 'f-total', '50'),
  // ⑤ RoB 2 ドメイン判定（d1 + overall のみ実データ、他ドメインは幽霊セルで no_data のまま出現）
  makeResultsDataRow({
    resultId: 'r-rob-d1',
    studyId: 'study-d',
    annotator: FINAL_ANNOTATOR,
    schemaVersion: 5,
    entityKey: 'rob:d1_randomization',
    fieldId: 'f-judgement',
    value: 'low',
  }),
  makeResultsDataRow({
    resultId: 'r-rob-d1-support',
    studyId: 'study-d',
    annotator: FINAL_ANNOTATOR,
    schemaVersion: 5,
    entityKey: 'rob:d1_randomization',
    fieldId: 'f-support',
    value: 'computer-generated randomization sequence',
  }),
  makeResultsDataRow({
    resultId: 'r-rob-overall',
    studyId: 'study-d',
    annotator: FINAL_ANNOTATOR,
    schemaVersion: 5,
    entityKey: 'rob:overall',
    fieldId: 'f-judgement',
    value: 'low',
  }),
  // ⑧ 未知 field_id（SchemaFields に無い）
  makeResultsDataRow({
    resultId: 'r-ghost',
    studyId: 'study-d',
    annotator: FINAL_ANNOTATOR,
    schemaVersion: 5,
    entityKey: 'outcome:mortality|arm:1|time:30d',
    fieldId: 'f-ghost-unknown',
    value: 'legacy value',
  }),
  // ⑦ study-c: 2 名の human 行（annotator が異なる）で確定 annotator を特定できない
  makeResultsDataRow({
    resultId: 'r-c-1',
    studyId: 'study-c',
    annotator: 'x@example.com',
    schemaVersion: 5,
    entityKey: 'outcome:pain|arm:1',
    fieldId: 'f-mean',
    value: '1',
  }),
  makeResultsDataRow({
    resultId: 'r-c-2',
    studyId: 'study-c',
    annotator: 'y@example.com',
    schemaVersion: 5,
    entityKey: 'outcome:pain|arm:1',
    fieldId: 'f-mean',
    value: '2',
  }),
];

export const EVIDENCES = [
  // ② unverified: AI Evidence はあるが人間の判定が 0 件
  makeEvidence({
    evidenceId: 'ev-unverified',
    studyId: 'study-d',
    documentId: 'doc-d-1',
    fieldId: 'f-total',
    entityKey: 'outcome:mortality|arm:3|time:30d',
  }),
  // rob:overall の Evidence（rob_overall_judgement の hasEvidence 判定に使う）
  makeEvidence({
    evidenceId: 'ev-rob-overall',
    studyId: 'study-d',
    documentId: 'doc-d-1',
    fieldId: 'f-judgement',
    entityKey: 'rob:overall',
  }),
  // study-c の pain|arm:1 にも Evidence を付けて instance 列挙を安定させる
  makeEvidence({
    evidenceId: 'ev-c-1',
    studyId: 'study-c',
    documentId: 'doc-c-1',
    fieldId: 'f-mean',
    entityKey: 'outcome:pain|arm:1',
  }),
];

/** tab1.csv の n_documents 集計素材（Documents 1 件 = 1 要素） */
export const DOCUMENT_STUDY_IDS = ['study-a', 'study-b', 'study-b', 'study-c', 'study-d', 'study-d'];

export const MATERIALS: RSetMaterials = {
  studies: STUDIES,
  studyRows: STUDY_ROWS,
  resultsRows: RESULTS_ROWS,
  decisions: [],
  evidences: EVIDENCES,
  armStructureRows: ARM_STRUCTURE_ROWS,
  documentStudyIds: DOCUMENT_STUDY_IDS,
  fields: FIELDS,
};

export const MANIFEST_META: RSetManifestMeta = {
  exportedAt: '2026-07-12T09:00:00Z',
  appVersion: '0.2.0',
  reviewMode: 'single_with_ai',
};
