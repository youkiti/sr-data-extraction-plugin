// デモモードのシード投入。
//
// 「実データ・実 API・OAuth 画面なしで、全チャプターを収録できる状態」を作るため、
// 15 タブぶんのデータを実際の repository 書き込み関数（features/**/*Repository.ts）を
// そのまま呼び出して組み立てる。手書きの生シート行を直接書かないのは、実運用の書き込み
// 経路（ヘッダ検証・楽観ロック・動的列拡張等）と同じコードパスを通すことで、
// 行の形が実装とズレる事故を構造的に防ぐため（brief の指示どおり SHEET_HEADERS を
// 唯一の正典として使う）。
//
// 呼び出し前提: installDemoFetchMock() が既にインストール済みで、globalThis.fetch が
// パッチ済みであること（app-entry.ts / popup-entry.ts / options-entry.ts が起動直後に行う）。
//
// 【2 論文構成】デモは架空論文 2 本を扱う（paperContent.ts の DEMO_PAPERS。
// インデックス 0 = デモ論文 1〔2 群〕、1 = デモ論文 2〔3 群〕）。
// - デモ論文 1: AI 抽出済み・検証途中・独立二重レビュー済み・裁定待ちまで、フルにシードする
//   （#/verify 以降の画面が録画開始時点で意味のある内容を持つようにするため）。
// - デモ論文 2: Study / Document の取り込みだけをシードし、抽出・群構成確定・検証・裁定は
//   一切シードしない。#/extract の一括抽出と #/verify の「群構成の確定」ゲート UI を
//   録画中に実際に動かして見せるための「素の状態」として残す（brief の受け入れ条件）
import { CURRENT_SCHEMA_VERSION } from '../domain/project';
import { NOT_REPORTED_TOKEN } from '../domain/annotation';
import type { AnnotatorType, ResultsDataRow, StudyDataRow } from '../domain/annotation';
import type { Decision, DecisionAction } from '../domain/decision';
import type { Evidence } from '../domain/evidence';
import type { ExtractionRun } from '../domain/extractionRun';
import type { DocumentRecord } from '../domain/document';
import type { StudyRecord } from '../domain/study';
import type { Protocol } from '../domain/protocol';
import type { SchemaVersion } from '../domain/schemaVersion';
import { SHEET_HEADERS, SHEET_TABS, STUDY_DATA_FIXED_HEADERS } from '../domain/sheetsSchema';
import { appendRow } from '../lib/google/sheets';
import type { GoogleApiDeps } from '../lib/google/types';
import { appendStudies } from '../features/documents/studyRepository';
import { appendDocuments } from '../features/documents/documentRepository';
import { appendSchemaFields, appendSchemaVersion } from '../features/schema/schemaRepository';
import { appendProtocol } from '../features/protocol/protocolRepository';
import { appendExtractionRun } from '../features/extraction/runRepository';
import { appendEvidenceRows } from '../features/extraction/evidenceRepository';
import { upsertResultsDataRows, upsertStudyDataRows } from '../features/extraction/annotationRepository';
import { appendArmStructureVersion } from '../features/verification/armStructureRepository';
import { appendDecisionRows } from '../features/verification/decisionRepository';
import { appendReviewerAssignment } from '../features/project/reviewerRepository';
import { resetDemoStore } from './sheetStore';
import { DEMO_SCHEMA_FIELDS } from './schema';
import { DEMO_PAPERS, type FieldInstanceContent } from './paperContent';
import { PAPER1 } from './paperData.mjs';
import {
  DEMO_DOCUMENT_IDS,
  DEMO_DRIVE_FOLDER_ID,
  DEMO_DRIVE_PDF_FILE_IDS,
  DEMO_DRIVE_TEXT_FILE_IDS,
  DEMO_PROJECT_ID,
  DEMO_PROJECT_TITLE,
  DEMO_REVIEWER_A_EMAIL,
  DEMO_REVIEWER_B_EMAIL,
  DEMO_SCHEMA_VERSION,
  DEMO_SEED_RUN_ID,
  DEMO_SPREADSHEET_ID,
  DEMO_STUDY_IDS,
  DEMO_TIMESTAMPS,
  DEMO_TOKEN,
  DEMO_USER_EMAIL,
} from './constants';

/** seed.ts 専用の GoogleApiDeps。installDemoFetchMock() 済みの globalThis.fetch をそのまま使う */
function demoDeps(): GoogleApiDeps {
  return {
    fetch: (input, init) => globalThis.fetch(input, init),
    getAccessToken: async () => DEMO_TOKEN,
  };
}

/** fieldId → SchemaField 逆引き（entity_level / field_name の解決に使う。スキーマは両論文で共通） */
const FIELD_BY_ID = new Map(DEMO_SCHEMA_FIELDS.map((f) => [f.fieldId, f]));

/** FIELD_INSTANCES を entity_level ごとに振り分ける（study → StudyData、それ以外 → ResultsData） */
function splitByLevel(fieldInstances: readonly FieldInstanceContent[]): {
  study: FieldInstanceContent[];
  results: FieldInstanceContent[];
} {
  const study: FieldInstanceContent[] = [];
  const results: FieldInstanceContent[] = [];
  for (const item of fieldInstances) {
    const field = FIELD_BY_ID.get(item.fieldId);
    if (field?.entityLevel === 'study') {
      study.push(item);
    } else {
      results.push(item);
    }
  }
  return { study, results };
}

/** 空のシート（ヘッダ行のみ）一式を組み立てる。StudyData だけ固定列のみ（動的値列は upsert 側が拡張する） */
function buildEmptySheets(): Record<string, string[][]> {
  const sheets: Record<string, string[][]> = {};
  for (const tab of SHEET_TABS) {
    sheets[tab] = [tab === 'StudyData' ? [...STUDY_DATA_FIXED_HEADERS] : [...SHEET_HEADERS[tab]]];
  }
  return sheets;
}

// ---------------------------------------------------------------------------
// Evidence（AI 根拠。追記型）
// ---------------------------------------------------------------------------

function buildEvidenceRows(
  studyId: string,
  documentId: string,
  fieldInstances: readonly FieldInstanceContent[],
  evidenceIdPrefix: string,
): Evidence[] {
  return fieldInstances.map((item, index) => ({
    evidenceId: `${evidenceIdPrefix}-${String(index + 1).padStart(3, '0')}`,
    runId: DEMO_SEED_RUN_ID,
    studyId,
    fieldId: item.fieldId,
    documentId,
    entityKey: item.entityKey,
    value: item.value,
    notReported: item.notReported,
    quote: item.quote,
    page: item.page,
    confidence: item.confidence,
    anchorStatus: item.anchorStatus,
    bboxPage: null,
    bbox: null,
    relocatedFrom: null,
  }));
}

// ---------------------------------------------------------------------------
// StudyData / ResultsData（annotator 行）
// ---------------------------------------------------------------------------

/** 'ai' annotator 行（study の値は NOT_REPORTED_TOKEN、それ以外は素の値） */
function buildAiStudyDataRow(studyId: string, fieldInstances: readonly FieldInstanceContent[]): StudyDataRow {
  const { study } = splitByLevel(fieldInstances);
  const values: Record<string, string | null> = {};
  for (const item of study) {
    const field = FIELD_BY_ID.get(item.fieldId) as { fieldName: string };
    values[field.fieldName] = item.notReported ? NOT_REPORTED_TOKEN : item.value;
  }
  return {
    studyId,
    annotator: 'ai',
    annotatorType: 'ai',
    schemaVersion: DEMO_SCHEMA_VERSION,
    runId: DEMO_SEED_RUN_ID,
    updatedAt: DEMO_TIMESTAMPS.extractionFinishedAt,
    values,
  };
}

function buildAiResultsDataRows(studyId: string, fieldInstances: readonly FieldInstanceContent[]): ResultsDataRow[] {
  const { results } = splitByLevel(fieldInstances);
  return results.map((item, index) => ({
    resultId: `demo-result-ai-${studyId}-${String(index + 1).padStart(3, '0')}`,
    studyId,
    fieldId: item.fieldId,
    annotator: 'ai',
    annotatorType: 'ai',
    schemaVersion: DEMO_SCHEMA_VERSION,
    entityKey: item.entityKey,
    runId: DEMO_SEED_RUN_ID,
    value: item.notReported ? null : item.value,
    notReported: item.notReported,
    updatedAt: DEMO_TIMESTAMPS.extractionFinishedAt,
  }));
}

/** 1 annotator ぶんの判定内容（field_id × entity_key をキーに検索する） */
interface AnnotatorDecisionPlan {
  /** StudyData/ResultsData/Decisions.annotator 列（'consensus' 行は annotator='consensus' 固定） */
  annotator: string;
  annotatorType: AnnotatorType;
  /**
   * Decisions.decided_by（操作を行った人間の email）。通常は annotator 本人と同一だが、
   * consensus 行（裁定）だけは「annotator='consensus' だが操作した人間は裁定者」という
   * ずれがあるため分離している（省略時は annotator と同じ）
   */
  decidedBy?: string;
  decidedAt: string;
  /** キー: `${fieldId} ${entityKey}` */
  entries: Map<string, { action: DecisionAction; value: string | null; note: string | null }>;
}

function planKey(fieldId: string, entityKey: string): string {
  return `${fieldId} ${entityKey}`;
}

/**
 * 判定プランから Decisions 行 + StudyData/ResultsData 行を組み立てる。
 * プランに含まれない field_id × entity_key の組は「未検証」のまま（何も書かない）。
 */
function materializePlan(
  studyId: string,
  fieldInstances: readonly FieldInstanceContent[],
  plan: AnnotatorDecisionPlan,
): {
  decisions: Decision[];
  studyRow: StudyDataRow | null;
  resultsRows: ResultsDataRow[];
} {
  const decisions: Decision[] = [];
  const studyValues: Record<string, string | null> = {};
  const resultsRows: ResultsDataRow[] = [];
  let resultIndex = 0;

  for (const item of fieldInstances) {
    const key = planKey(item.fieldId, item.entityKey);
    const entry = plan.entries.get(key);
    if (entry === undefined) {
      continue;
    }
    const field = FIELD_BY_ID.get(item.fieldId) as { entityLevel: string; fieldName: string };
    decisions.push({
      decidedAt: plan.decidedAt,
      decidedBy: plan.decidedBy ?? plan.annotator,
      studyId,
      fieldId: item.fieldId,
      entityKey: item.entityKey,
      annotator: plan.annotator,
      annotatorType: plan.annotatorType,
      schemaVersion: DEMO_SCHEMA_VERSION,
      action: entry.action,
      value: entry.value,
      note: entry.note,
    });
    if (field.entityLevel === 'study') {
      studyValues[field.fieldName] = entry.value;
    } else {
      resultIndex += 1;
      resultsRows.push({
        resultId: `demo-result-${plan.annotator.split('@')[0]}-${studyId}-${String(resultIndex).padStart(3, '0')}`,
        studyId,
        fieldId: item.fieldId,
        annotator: plan.annotator,
        annotatorType: plan.annotatorType,
        schemaVersion: DEMO_SCHEMA_VERSION,
        entityKey: item.entityKey,
        runId: null,
        value: entry.action === 'not_reported' ? null : entry.value,
        notReported: entry.action === 'not_reported',
        updatedAt: plan.decidedAt,
      });
    }
  }

  const studyRow: StudyDataRow | null =
    Object.keys(studyValues).length === 0
      ? null
      : {
          studyId,
          annotator: plan.annotator,
          annotatorType: plan.annotatorType,
          schemaVersion: DEMO_SCHEMA_VERSION,
          runId: null,
          updatedAt: plan.decidedAt,
          values: studyValues,
        };

  return { decisions, studyRow, resultsRows };
}

/**
 * 独立レビュアー（human_independent）の判定プラン。全セルを決定する（S12 裁定ゲートの
 * 「両者とも進捗 100%」条件を満たすため）。値は FIELD_INSTANCES の正解値をそのまま使い、
 * overrideKey で指定した 1 セルだけ異なる値にする（S12 の不一致 + κ 一致度レポートの実演用）。
 */
function buildIndependentPlan(
  fieldInstances: readonly FieldInstanceContent[],
  annotator: string,
  decidedAt: string,
  override: { fieldId: string; entityKey: string; value: string } | null,
): AnnotatorDecisionPlan {
  const entries = new Map<string, { action: DecisionAction; value: string | null; note: string | null }>();
  for (const item of fieldInstances) {
    const key = planKey(item.fieldId, item.entityKey);
    if (override !== null && override.fieldId === item.fieldId && override.entityKey === item.entityKey) {
      entries.set(key, { action: 'accept', value: override.value, note: null });
      continue;
    }
    if (item.notReported) {
      entries.set(key, { action: 'not_reported', value: NOT_REPORTED_TOKEN, note: null });
    } else {
      entries.set(key, { action: 'accept', value: item.value, note: null });
    }
  }
  return { annotator, annotatorType: 'human_independent', decidedAt, entries };
}

/**
 * 裁定（consensus）の判定プラン。independent レビュアー 2 名が一致したセルを
 * 「一致セルの一括採用」（features/adjudication/consensusWrites.ts の buildBulkAcceptWrites と
 * 同じ意味論: action='accept'）として consensus 行へ反映し、skipKeys で指定したセルだけ
 * 意図的に未裁定のまま残す（デモ論文 1 では f_arm_n × arm:1〔独立レビュアー間で不一致のセル〕と
 * f_funding_source × study〔study レベルの未検証セル残存を export 警告の実演に使う〕）。
 * consensus 行が 1 件も無いと features/export/finalAnnotator.ts が確定 annotator を特定できず
 * 全 study が除外されてしまうため、consensus 行自体は必ず作る（範囲外のセルだけ間引く）
 */
function buildConsensusPlan(
  fieldInstances: readonly FieldInstanceContent[],
  skipKeys: readonly { fieldId: string; entityKey: string }[],
): AnnotatorDecisionPlan {
  const entries = new Map<string, { action: DecisionAction; value: string | null; note: string | null }>();
  for (const item of fieldInstances) {
    if (skipKeys.some((skip) => skip.fieldId === item.fieldId && skip.entityKey === item.entityKey)) {
      continue;
    }
    const key = planKey(item.fieldId, item.entityKey);
    if (item.notReported) {
      entries.set(key, { action: 'not_reported', value: NOT_REPORTED_TOKEN, note: null });
    } else {
      entries.set(key, { action: 'accept', value: item.value, note: null });
    }
  }
  return {
    annotator: 'consensus',
    annotatorType: 'consensus',
    decidedBy: DEMO_USER_EMAIL,
    decidedAt: DEMO_TIMESTAMPS.consensusDecidedAt,
    entries,
  };
}

// ---------------------------------------------------------------------------
// シード本体
// ---------------------------------------------------------------------------

export async function seedDemoData(): Promise<void> {
  resetDemoStore(DEMO_PROJECT_TITLE, buildEmptySheets());
  const deps = demoDeps();

  const [paper1, paper2] = DEMO_PAPERS;
  if (paper1 === undefined || paper2 === undefined) {
    throw new Error('[demo] DEMO_PAPERS は 2 件（デモ論文 1・2）を前提にしています');
  }
  const study1Id = DEMO_STUDY_IDS[0];
  const study2Id = DEMO_STUDY_IDS[1];
  const doc1Id = DEMO_DOCUMENT_IDS[0];
  const doc2Id = DEMO_DOCUMENT_IDS[1];

  // --- Meta ---
  await appendRow(
    DEMO_SPREADSHEET_ID,
    'Meta',
    [
      DEMO_PROJECT_ID,
      DEMO_PROJECT_TITLE,
      DEMO_SPREADSHEET_ID,
      DEMO_DRIVE_FOLDER_ID,
      CURRENT_SCHEMA_VERSION,
      DEMO_TIMESTAMPS.projectCreatedAt,
      DEMO_USER_EMAIL,
    ],
    deps,
  );

  // --- Protocol ---
  // features/protocol/saveProtocol.ts の実装に合わせる: 手入力（sourceType='manual'）は
  // frameworkType 等の構造化列を空のままにし、全文を rawTextInline へ入れる
  // （S5 の draft-schema や #/extract の「プロトコル本文」はここを読む。§4.3 プロンプトの
  // Protocol context セクション。rawTextInline が null だと一括抽出が
  // 「プロトコル本文を取得できません」で失敗する）。
  // デモ論文 1（早期離床）・2（制吐薬の用量比較）の両方が対象になるよう、
  // 「周術期の介入」という広めのリサーチクエスチョンにしている
  const protocolText = [
    'リサーチクエスチョン: 周術期（手術前後）に行われる介入（リハビリテーション・薬物療法等）は、',
    '通常ケアやプラセボと比較して術後回復に関するアウトカムを改善するか。',
    '組み入れ基準: 成人の待機的手術患者を対象とし、周術期の介入を評価するランダム化比較試験。',
    '除外基準: 症例報告・観察研究・プロトコル論文のみで結果データを含まないもの。',
    'デザイン: ランダム化比較試験（並行群間。2 群・3 群のいずれも対象）。',
  ].join('\n');
  const protocol: Protocol = {
    version: 1,
    frameworkType: null,
    researchQuestion: '',
    inclusionCriteria: null,
    exclusionCriteria: null,
    studyDesign: null,
    blockCount: 0,
    combinationExpression: '',
    sourceType: 'manual',
    sourceFilename: null,
    rawTextRef: null,
    rawTextPreview: null,
    rawTextInline: protocolText,
    createdAt: DEMO_TIMESTAMPS.protocolCreatedAt,
    createdBy: DEMO_USER_EMAIL,
  };
  await appendProtocol(DEMO_SPREADSHEET_ID, protocol, deps);

  // --- Studies / Documents（両論文） ---
  const study1: StudyRecord = {
    studyId: study1Id,
    studyLabel: 'Halvorsen 2026',
    registrationId: null,
    createdAt: DEMO_TIMESTAMPS.documentImportedAt,
    createdBy: DEMO_USER_EMAIL,
    note: null,
  };
  const study2: StudyRecord = {
    studyId: study2Id,
    studyLabel: 'Bergstrom 2026',
    registrationId: null,
    createdAt: DEMO_TIMESTAMPS.documentImportedAt2,
    createdBy: DEMO_USER_EMAIL,
    note: null,
  };
  await appendStudies(DEMO_SPREADSHEET_ID, [study1, study2], deps);

  const document1: DocumentRecord = {
    documentId: doc1Id,
    studyId: study1Id,
    documentRole: 'article',
    driveFileId: DEMO_DRIVE_PDF_FILE_IDS[0],
    sourceFileId: null,
    filename: paper1.meta.filename,
    pmid: paper1.meta.pmid,
    doi: paper1.meta.doi,
    textRef: `https://drive.google.com/file/d/${DEMO_DRIVE_TEXT_FILE_IDS[0]}/view`,
    textStatus: 'ok',
    pageCount: paper1.pageTexts.length,
    charCount: paper1.pageTexts.join('').length,
    importedAt: DEMO_TIMESTAMPS.documentImportedAt,
    importedBy: DEMO_USER_EMAIL,
    note: null,
    excluded: false,
    exclusionReason: null,
    exclusionNote: null,
    excludedAt: null,
  };
  const document2: DocumentRecord = {
    documentId: doc2Id,
    studyId: study2Id,
    documentRole: 'article',
    driveFileId: DEMO_DRIVE_PDF_FILE_IDS[1],
    sourceFileId: null,
    filename: paper2.meta.filename,
    pmid: paper2.meta.pmid,
    doi: paper2.meta.doi,
    textRef: `https://drive.google.com/file/d/${DEMO_DRIVE_TEXT_FILE_IDS[1]}/view`,
    textStatus: 'ok',
    pageCount: paper2.pageTexts.length,
    charCount: paper2.pageTexts.join('').length,
    importedAt: DEMO_TIMESTAMPS.documentImportedAt2,
    importedBy: DEMO_USER_EMAIL,
    note: null,
    excluded: false,
    exclusionReason: null,
    exclusionNote: null,
    excludedAt: null,
  };
  await appendDocuments(DEMO_SPREADSHEET_ID, [document1, document2], deps);

  // --- SchemaVersions / SchemaFields（確定版 1 版。両 study 共通） ---
  const schemaVersion: SchemaVersion = {
    schemaVersion: DEMO_SCHEMA_VERSION,
    parentVersion: null,
    protocolVersion: 1,
    createdByType: 'ai_draft',
    createdAt: DEMO_TIMESTAMPS.schemaCreatedAt,
    createdBy: DEMO_USER_EMAIL,
    note: 'AI ドラフト（study 8 項目・arm 3 項目・outcome_result 5 項目）をそのまま確定',
  };
  await appendSchemaVersion(DEMO_SPREADSHEET_ID, schemaVersion, deps);
  await appendSchemaFields(DEMO_SPREADSHEET_ID, DEMO_SCHEMA_FIELDS, deps);

  // ===========================================================================
  // デモ論文 1（2 群）: AI 抽出済み・検証途中・独立二重レビュー済み・裁定待ちまでフルにシードする
  // ===========================================================================

  // --- ExtractionRuns（2 行プロトコル: running → done） ---
  const runBase: Omit<ExtractionRun, 'status' | 'finishedAt' | 'tokensIn' | 'tokensOut' | 'costEstimate'> = {
    runId: DEMO_SEED_RUN_ID,
    runType: 'full',
    schemaVersion: DEMO_SCHEMA_VERSION,
    studyIds: [study1Id],
    provider: 'gemini',
    requestedModel: 'gemini-3.5-flash',
    modelVersion: 'gemini-3.5-flash-001',
    inputMode: 'text_only',
    startedAt: DEMO_TIMESTAMPS.extractionStartedAt,
    fieldIds: null,
    warnings: null,
  };
  await appendExtractionRun(
    DEMO_SPREADSHEET_ID,
    { ...runBase, status: 'running', finishedAt: null, tokensIn: null, tokensOut: null, costEstimate: null },
    deps,
  );
  await appendEvidenceRows(DEMO_SPREADSHEET_ID, buildEvidenceRows(study1Id, doc1Id, paper1.fieldInstances, 'demo-evidence-1'), deps);
  await upsertStudyDataRows(DEMO_SPREADSHEET_ID, [buildAiStudyDataRow(study1Id, paper1.fieldInstances)], deps);
  await upsertResultsDataRows(DEMO_SPREADSHEET_ID, buildAiResultsDataRows(study1Id, paper1.fieldInstances), deps);
  await appendExtractionRun(
    DEMO_SPREADSHEET_ID,
    {
      ...runBase,
      status: 'done',
      finishedAt: DEMO_TIMESTAMPS.extractionFinishedAt,
      tokensIn: 12480,
      tokensOut: 3210,
      costEstimate: 0.006,
    },
    deps,
  );

  // --- ArmStructures（owner / reviewer 各自が確定。3 名とも同じ 2 群構成に同意） ---
  const paper1Arms = PAPER1.arms.map((a) => ({ armKey: a.key, armName: a.name }));
  await appendArmStructureVersion(
    DEMO_SPREADSHEET_ID,
    { studyId: study1Id, arms: paper1Arms, annotator: DEMO_USER_EMAIL, annotatorType: 'human_with_ai', confirmedAt: DEMO_TIMESTAMPS.armConfirmedAtOwner },
    deps,
  );
  await appendArmStructureVersion(
    DEMO_SPREADSHEET_ID,
    {
      studyId: study1Id,
      arms: paper1Arms,
      annotator: DEMO_REVIEWER_A_EMAIL,
      annotatorType: 'human_independent',
      confirmedAt: DEMO_TIMESTAMPS.armConfirmedAtReviewerA,
    },
    deps,
  );
  await appendArmStructureVersion(
    DEMO_SPREADSHEET_ID,
    {
      studyId: study1Id,
      arms: paper1Arms,
      annotator: DEMO_REVIEWER_B_EMAIL,
      annotatorType: 'human_independent',
      confirmedAt: DEMO_TIMESTAMPS.armConfirmedAtReviewerB,
    },
    deps,
  );

  // --- 判定（独立レビュアー 2 名のみ。owner 自身はあえて未着手のままにする） ---
  //
  // owner（ログイン中のデモユーザー、human_with_ai）をこの study の判定に一切関与させない
  // のは意図的な設計判断: features/adjudication/pairResolution.ts の resolveAnnotatorPair は
  // StudyData / ResultsData / Decisions のいずれかに human 系行（human_with_ai も
  // human_independent も同格で数える）を持つ email を数え、ちょうど 2 名のときだけ
  // 'ready'（裁定の自動ペア確定・レビュアー間一致度レポートの集計対象）にする。
  // owner がここへ 1 行でも書くと 3 名（selectable）になり、
  // レビュアー間一致度レポート（features/adjudication/agreement.ts の
  // collectReadyStudyInputs）が `pair.kind === 'ready'` の study だけを拾う仕様上、
  // この study が対象から外れて κ が算出できなくなる（brief の受け入れ条件が満たせない）。
  // 結果として owner から見たこの study は「AI 抽出済み・人手未着手」（進捗 0/24）の状態になる。
  // 群構成（ArmStructures）は判定に数えられないため owner も確定させ、
  // #/verify を開いたときに arm / outcome タブがディムされないようにしている（上のブロック）
  const mismatchKey = { fieldId: 'f_arm_n', entityKey: 'arm:1' };
  const reviewerAPlan = buildIndependentPlan(paper1.fieldInstances, DEMO_REVIEWER_A_EMAIL, DEMO_TIMESTAMPS.decidedAtReviewerA, null);
  const reviewerBPlan = buildIndependentPlan(paper1.fieldInstances, DEMO_REVIEWER_B_EMAIL, DEMO_TIMESTAMPS.decidedAtReviewerB, {
    ...mismatchKey,
    value: '52',
  });
  // 裁定（consensus）: 独立レビュアー 2 名が一致したセルを一括採用し、群のN（arm:1、不一致セル）と
  // 資金源（study レベル）の 2 件だけ未裁定のまま残す（buildConsensusPlan 冒頭コメント参照）
  const consensusPlan = buildConsensusPlan(paper1.fieldInstances, [mismatchKey, { fieldId: 'f_funding_source', entityKey: '-' }]);

  const allDecisions: Decision[] = [];
  for (const plan of [reviewerAPlan, reviewerBPlan, consensusPlan]) {
    const { decisions, studyRow, resultsRows } = materializePlan(study1Id, paper1.fieldInstances, plan);
    allDecisions.push(...decisions);
    if (studyRow !== null) {
      await upsertStudyDataRows(DEMO_SPREADSHEET_ID, [studyRow], deps);
    }
    if (resultsRows.length > 0) {
      await upsertResultsDataRows(DEMO_SPREADSHEET_ID, resultsRows, deps);
    }
  }
  await appendDecisionRows(DEMO_SPREADSHEET_ID, allDecisions, deps);

  // ===========================================================================
  // デモ論文 2（3 群）: Study / Document の取り込みのみをシードし、抽出・群構成確定・
  // 検証・裁定は一切行わない（このモジュール冒頭コメント参照）。
  // #/extract の一括抽出（llmFixtures.ts が paper2 の filename を見て正しい値を返す）と、
  // #/verify を開いたときの「群構成の確定」ゲート UI（arm/outcome タブがディムされた状態から
  // 3 群を入力して確定する）を、録画・手動確認のたびに実際に動かして見せられる状態にしておく
  // ===========================================================================

  // --- Reviewers（Home のレビュアー管理カードに表示するための最小 2 行。プロジェクト共通） ---
  await appendReviewerAssignment(
    DEMO_SPREADSHEET_ID,
    {
      email: DEMO_REVIEWER_A_EMAIL,
      role: 'reviewer',
      reviewMode: 'independent',
      assignedBy: DEMO_USER_EMAIL,
      assignedAt: DEMO_TIMESTAMPS.armConfirmedAtOwner,
    },
    deps,
  );
  await appendReviewerAssignment(
    DEMO_SPREADSHEET_ID,
    {
      email: DEMO_REVIEWER_B_EMAIL,
      role: 'reviewer',
      reviewMode: 'independent',
      assignedBy: DEMO_USER_EMAIL,
      assignedAt: DEMO_TIMESTAMPS.armConfirmedAtOwner,
    },
    deps,
  );
}
