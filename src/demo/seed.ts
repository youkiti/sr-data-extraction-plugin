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
import { DEMO_PAPER_META, FIELD_INSTANCES, PAGE_TEXTS, type FieldInstanceContent } from './paperContent';
import {
  DEMO_ARM_KEYS,
  DEMO_ARM_NAMES,
  DEMO_DOCUMENT_ID,
  DEMO_DRIVE_PDF_FILE_ID,
  DEMO_DRIVE_TEXT_FILE_ID,
  DEMO_PROJECT_ID,
  DEMO_PROJECT_TITLE,
  DEMO_REVIEWER_A_EMAIL,
  DEMO_REVIEWER_B_EMAIL,
  DEMO_SCHEMA_VERSION,
  DEMO_SEED_RUN_ID,
  DEMO_SPREADSHEET_ID,
  DEMO_STUDY_ID,
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

/** fieldId → SchemaField 逆引き（entity_level / field_name の解決に使う） */
const FIELD_BY_ID = new Map(DEMO_SCHEMA_FIELDS.map((f) => [f.fieldId, f]));

/** FIELD_INSTANCES を entity_level ごとに振り分ける（study → StudyData、それ以外 → ResultsData） */
function splitByLevel(): { study: FieldInstanceContent[]; results: FieldInstanceContent[] } {
  const study: FieldInstanceContent[] = [];
  const results: FieldInstanceContent[] = [];
  for (const item of FIELD_INSTANCES) {
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

function buildEvidenceRows(): Evidence[] {
  return FIELD_INSTANCES.map((item, index) => ({
    evidenceId: `demo-evidence-${String(index + 1).padStart(3, '0')}`,
    runId: DEMO_SEED_RUN_ID,
    studyId: DEMO_STUDY_ID,
    fieldId: item.fieldId,
    documentId: DEMO_DOCUMENT_ID,
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
function buildAiStudyDataRow(): StudyDataRow {
  const { study } = splitByLevel();
  const values: Record<string, string | null> = {};
  for (const item of study) {
    const field = FIELD_BY_ID.get(item.fieldId) as { fieldName: string };
    values[field.fieldName] = item.notReported ? NOT_REPORTED_TOKEN : item.value;
  }
  return {
    studyId: DEMO_STUDY_ID,
    annotator: 'ai',
    annotatorType: 'ai',
    schemaVersion: DEMO_SCHEMA_VERSION,
    runId: DEMO_SEED_RUN_ID,
    updatedAt: DEMO_TIMESTAMPS.extractionFinishedAt,
    values,
  };
}

function buildAiResultsDataRows(): ResultsDataRow[] {
  const { results } = splitByLevel();
  return results.map((item, index) => ({
    resultId: `demo-result-ai-${String(index + 1).padStart(3, '0')}`,
    studyId: DEMO_STUDY_ID,
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
function materializePlan(plan: AnnotatorDecisionPlan): {
  decisions: Decision[];
  studyRow: StudyDataRow | null;
  resultsRows: ResultsDataRow[];
} {
  const decisions: Decision[] = [];
  const studyValues: Record<string, string | null> = {};
  const resultsRows: ResultsDataRow[] = [];
  let resultIndex = 0;

  for (const item of FIELD_INSTANCES) {
    const key = planKey(item.fieldId, item.entityKey);
    const entry = plan.entries.get(key);
    if (entry === undefined) {
      continue;
    }
    const field = FIELD_BY_ID.get(item.fieldId) as { entityLevel: string; fieldName: string };
    decisions.push({
      decidedAt: plan.decidedAt,
      decidedBy: plan.decidedBy ?? plan.annotator,
      studyId: DEMO_STUDY_ID,
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
        resultId: `demo-result-${plan.annotator.split('@')[0]}-${String(resultIndex).padStart(3, '0')}`,
        studyId: DEMO_STUDY_ID,
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
          studyId: DEMO_STUDY_ID,
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
 * 独立レビュアー（human_independent）の判定プラン。全 24 セルを決定する（S12 裁定ゲートの
 * 「両者とも進捗 100%」条件を満たすため）。値は FIELD_INSTANCES の正解値をそのまま使い、
 * overrideKey で指定した 1 セルだけ異なる値にする（S12 の不一致 + κ 一致度レポートの実演用）。
 */
function buildIndependentPlan(
  annotator: string,
  decidedAt: string,
  override: { fieldId: string; entityKey: string; value: string } | null,
): AnnotatorDecisionPlan {
  const entries = new Map<string, { action: DecisionAction; value: string | null; note: string | null }>();
  for (const item of FIELD_INSTANCES) {
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
 * 意図的に未裁定のまま残す:
 * - f_arm_n × arm:1（独立レビュアー間で不一致のセル）: 裁定者がまだどちらを採るか決めていない、
 *   という自然な状態（#/adjudicate の不一致一覧の実演）
 * - f_funding_source × study（study レベル。study_wide.csv だけがセル単位の「空 = 未検証」を
 *   数える構造のため、study レベルに 1 件だけ未裁定を残さないと #/export の
 *   「未検証セル残存」警告が一度も発火しない。features/export/buildStudyWideCsv.ts 参照）
 * consensus 行が 1 件も無いと features/export/finalAnnotator.ts が確定 annotator を特定できず
 * 全 study が除外されてしまうため、consensus 行自体は必ず作る（範囲外のセルだけ間引く）
 */
function buildConsensusPlan(
  skipKeys: readonly { fieldId: string; entityKey: string }[],
): AnnotatorDecisionPlan {
  const entries = new Map<string, { action: DecisionAction; value: string | null; note: string | null }>();
  for (const item of FIELD_INSTANCES) {
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

  // --- Meta ---
  await appendRow(
    DEMO_SPREADSHEET_ID,
    'Meta',
    [
      DEMO_PROJECT_ID,
      DEMO_PROJECT_TITLE,
      DEMO_SPREADSHEET_ID,
      'demo-drive-folder-udca-2026',
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
  // 「プロトコル本文を取得できません」で失敗する）
  const protocolText = [
    'リサーチクエスチョン: 正期産児の間接型高ビリルビン血症に対し、光線療法へ薬物補助療法（UDCA 等）を追加することは、光線療法単独と比較して総ビリルビン低下・治療期間を改善するか。',
    '組み入れ基準: 正期産児（在胎 37 週以降）で間接型高ビリルビン血症により光線療法の適応となった新生児を対象とするランダム化比較試験。',
    '除外基準: 直接型優位の高ビリルビン血症、溶血性疾患の関与が明らかな症例、早産児。',
    'デザイン: ランダム化比較試験（並行群間）。',
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

  // --- Studies / Documents ---
  const study: StudyRecord = {
    studyId: DEMO_STUDY_ID,
    studyLabel: 'Zarkesh 2023',
    registrationId: null,
    createdAt: DEMO_TIMESTAMPS.documentImportedAt,
    createdBy: DEMO_USER_EMAIL,
    note: null,
  };
  await appendStudies(DEMO_SPREADSHEET_ID, [study], deps);

  const document: DocumentRecord = {
    documentId: DEMO_DOCUMENT_ID,
    studyId: DEMO_STUDY_ID,
    documentRole: 'article',
    driveFileId: DEMO_DRIVE_PDF_FILE_ID,
    sourceFileId: null,
    filename: DEMO_PAPER_META.filename,
    pmid: DEMO_PAPER_META.pmid,
    doi: DEMO_PAPER_META.doi,
    textRef: `https://drive.google.com/file/d/${DEMO_DRIVE_TEXT_FILE_ID}/view`,
    textStatus: 'ok',
    pageCount: PAGE_TEXTS.length,
    charCount: PAGE_TEXTS.join('').length,
    importedAt: DEMO_TIMESTAMPS.documentImportedAt,
    importedBy: DEMO_USER_EMAIL,
    note: null,
    excluded: false,
    exclusionReason: null,
    exclusionNote: null,
    excludedAt: null,
  };
  await appendDocuments(DEMO_SPREADSHEET_ID, [document], deps);

  // --- SchemaVersions / SchemaFields（確定版 1 版） ---
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

  // --- ExtractionRuns（2 行プロトコル: running → done） ---
  const runBase: Omit<ExtractionRun, 'status' | 'finishedAt' | 'tokensIn' | 'tokensOut' | 'costEstimate'> = {
    runId: DEMO_SEED_RUN_ID,
    runType: 'full',
    schemaVersion: DEMO_SCHEMA_VERSION,
    studyIds: [DEMO_STUDY_ID],
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
  await appendEvidenceRows(DEMO_SPREADSHEET_ID, buildEvidenceRows(), deps);
  await upsertStudyDataRows(DEMO_SPREADSHEET_ID, [buildAiStudyDataRow()], deps);
  await upsertResultsDataRows(DEMO_SPREADSHEET_ID, buildAiResultsDataRows(), deps);
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
  const arms = DEMO_ARM_KEYS.map((armKey) => ({ armKey, armName: DEMO_ARM_NAMES[armKey] }));
  await appendArmStructureVersion(
    DEMO_SPREADSHEET_ID,
    {
      studyId: DEMO_STUDY_ID,
      arms,
      annotator: DEMO_USER_EMAIL,
      annotatorType: 'human_with_ai',
      confirmedAt: DEMO_TIMESTAMPS.armConfirmedAtOwner,
    },
    deps,
  );
  await appendArmStructureVersion(
    DEMO_SPREADSHEET_ID,
    {
      studyId: DEMO_STUDY_ID,
      arms,
      annotator: DEMO_REVIEWER_A_EMAIL,
      annotatorType: 'human_independent',
      confirmedAt: DEMO_TIMESTAMPS.armConfirmedAtReviewerA,
    },
    deps,
  );
  await appendArmStructureVersion(
    DEMO_SPREADSHEET_ID,
    {
      studyId: DEMO_STUDY_ID,
      arms,
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
  // この study が対象から外れて κ が算出できなくなる（brief の受け入れ条件 7 が満たせない）。
  // 結果として owner から見たこの study は「AI 抽出済み・人手未着手」（進捗 0/24）の状態になる。
  // これは brief のデモデータ設計にある 3 本目（AI 抽出済み・人手未着手）の状態そのものであり、
  // 実論文が 1 本のみ（video/fixtures/README.md 参照）という制約の中での妥当な代替である。
  // 群構成（ArmStructures）は判定に数えられないため owner も確定させ、
  // #/verify を開いたときに arm / outcome タブがダイムされないようにしている（上のブロック）
  const mismatchKey = { fieldId: 'f_arm_n', entityKey: 'arm:1' };
  const reviewerAPlan = buildIndependentPlan(DEMO_REVIEWER_A_EMAIL, DEMO_TIMESTAMPS.decidedAtReviewerA, null);
  const reviewerBPlan = buildIndependentPlan(DEMO_REVIEWER_B_EMAIL, DEMO_TIMESTAMPS.decidedAtReviewerB, {
    ...mismatchKey,
    value: '52',
  });
  // 裁定（consensus）: 独立レビュアー 2 名が一致したセルを一括採用し、群のN（arm:1、不一致セル）と
  // 資金源（study レベル）の 2 件だけ未裁定のまま残す（buildConsensusPlan 冒頭コメント参照）
  const consensusPlan = buildConsensusPlan([mismatchKey, { fieldId: 'f_funding_source', entityKey: '-' }]);

  const allDecisions: Decision[] = [];
  for (const plan of [reviewerAPlan, reviewerBPlan, consensusPlan]) {
    const { decisions, studyRow, resultsRows } = materializePlan(plan);
    allDecisions.push(...decisions);
    if (studyRow !== null) {
      await upsertStudyDataRows(DEMO_SPREADSHEET_ID, [studyRow], deps);
    }
    if (resultsRows.length > 0) {
      await upsertResultsDataRows(DEMO_SPREADSHEET_ID, resultsRows, deps);
    }
  }
  await appendDecisionRows(DEMO_SPREADSHEET_ID, allDecisions, deps);

  // --- Reviewers（Home のレビュアー管理カードに表示するための最小 2 行） ---
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
