// 論文 Methods 記載例カード（S10）の実績値 MethodsFacts を、既に読み込んだ記録から組み立てる純関数。
// 文の出し分けの条件と各値の出所は docs/methods-boilerplate.md §1〜§3 が正典（issue #381:
// 記録に無いことを文案に書かないため、成功した事前抽出・草案の記録・人の行の種別を数える）
import type { AnnotatorType } from '../../domain/annotation';
import type { DocumentRecord } from '../../domain/document';
import { isWarningOnlyLogEntry, type LlmApiLogEntry, type LlmProviderId } from '../../domain/llmApiLog';
import type { SchemaVersion } from '../../domain/schemaVersion';
import type { MethodsRunFact } from '../extraction/runRepository';
import type { MethodsFacts } from './methodsBoilerplate';

/** LLMApiLog の抽出バッチ失敗行の接頭辞（extractionService の recordBatchFailure が書く） */
const BATCH_FAILED_PREFIX = '[batch_failed]';

export interface MethodsFactsInput {
  toolVersion: string | null;
  /** エクスポート対象の研究（Documents から参照される研究）の study_id */
  activeStudyIds: readonly string[];
  documents: readonly Pick<DocumentRecord, 'textStatus'>[];
  /** readMethodsRunFacts の結果（完了 run のみ・新しい順） */
  runFacts: readonly MethodsRunFact[];
  logs: readonly LlmApiLogEntry[];
  versions: readonly Pick<SchemaVersion, 'createdByType' | 'createdAt'>[];
  chatAssistDecisionCount: number;
  /** R セットの未検証セル数（エクスポート画面のサマリと同じ値） */
  unverifiedCellCount: number;
  /** StudyData / ResultsData の全行（人の行の種別と annotator を数える） */
  annotationRows: readonly { annotator: string; annotatorType: AnnotatorType }[];
}

/** 配列の重複除去（出現順を維持） */
function dedupe<T>(items: readonly T[]): T[] {
  return Array.from(new Set(items));
}

/** provider の表示名変換（docs/methods-boilerplate.md §3: gemini → Gemini 等） */
export function providerDisplayName(provider: LlmProviderId): string {
  if (provider === 'local_llm') {
    return 'Local LLM';
  }
  if (provider === 'openrouter') {
    return 'OpenRouter';
  }
  if (provider === 'openai_compatible') {
    return 'OpenAI-compatible';
  }
  if (provider === 'anthropic') {
    return 'Anthropic';
  }
  if (provider === 'azure_openai') {
    return 'Azure OpenAI';
  }
  return 'Gemini';
}

/** 空の provider（旧行・壊れた行）を除いて表示名へ変換し、重複除去する */
function providerNames(providers: readonly LlmProviderId[]): string[] {
  return dedupe(
    providers.filter((provider) => provider !== ('' as LlmProviderId)).map(providerDisplayName),
  );
}

/** run と study の組のキー（[batch_failed] 行との突き合わせ用） */
function runStudyKey(runId: string, studyId: string): string {
  return JSON.stringify([runId, studyId]);
}

export function buildMethodsFacts(input: MethodsFactsInput): MethodsFacts {
  const active = new Set(input.activeStudyIds);

  // [batch_failed] 行: run × study の失敗と、研究単位で失敗を特定できる run
  const failedRunStudies = new Set<string>();
  const runsWithAttributedFailures = new Set<string>();
  for (const log of input.logs) {
    if (
      log.promptSummary?.startsWith(BATCH_FAILED_PREFIX) === true &&
      log.runId !== null &&
      log.studyId !== null
    ) {
      failedRunStudies.add(runStudyKey(log.runId, log.studyId));
      runsWithAttributedFailures.add(log.runId);
    }
  }

  const extracted = new Set<string>();
  const complete = new Set<string>();
  const pilotStudies = new Set<string>();
  const usedRuns: MethodsRunFact[] = [];
  let earliestPilotStart: string | null = null;
  for (const run of input.runFacts) {
    // status = done、または失敗を研究単位で特定できる partial_failure だけが「全項目」の根拠になる
    const statusComplete = run.status === 'done' || runsWithAttributedFailures.has(run.runId);
    let succeededAny = false;
    for (const studyId of run.studyIds) {
      if (!active.has(studyId) || failedRunStudies.has(runStudyKey(run.runId, studyId))) {
        continue;
      }
      succeededAny = true;
      extracted.add(studyId);
      if (statusComplete && run.fieldIds === null) {
        complete.add(studyId);
      }
      if (run.runType === 'pilot') {
        pilotStudies.add(studyId);
      }
    }
    if (!succeededAny) {
      continue;
    }
    usedRuns.push(run);
    if (
      run.runType === 'pilot' &&
      run.startedAt !== null &&
      (earliestPilotStart === null || run.startedAt < earliestPilotStart)
    ) {
      earliestPilotStart = run.startedAt;
    }
  }

  // 事前抽出のモデル: 実際の版（model_version）が無い run は要求したモデル ID で代用する
  const modelIds = dedupe(
    usedRuns
      .map((run) => run.modelVersion ?? run.requestedModel)
      .filter((model) => model !== ''),
  );
  const modelIdsIncludeRequested = usedRuns.some(
    (run) => run.modelVersion === null && run.requestedModel !== '',
  );

  // フォームの草案: 成功した draft_schema 呼び出し（警告専用行・エラー行を除く）
  const draftLogs = input.logs.filter(
    (log) => log.purpose === 'draft_schema' && log.error === null && !isWarningOnlyLogEntry(log),
  );
  const aiDraft =
    draftLogs.length > 0 || input.versions.some((version) => version.createdByType === 'ai_draft');

  const startOfPilot = earliestPilotStart;
  const revisedAfterPilot =
    startOfPilot !== null && input.versions.some((version) => version.createdAt > startOfPilot);

  const humansByType = (type: AnnotatorType): number =>
    new Set(
      input.annotationRows.filter((row) => row.annotatorType === type).map((row) => row.annotator),
    ).size;

  return {
    toolVersion: input.toolVersion,
    aiDraft,
    draftModelIds: dedupe(draftLogs.map((log) => log.model).filter((model) => model !== '')),
    draftProviders: providerNames(draftLogs.map((log) => log.provider)),
    modelIds,
    modelIdsIncludeRequested,
    providers: providerNames(usedRuns.map((run) => run.provider)),
    includedStudyCount: active.size,
    extractedStudyCount: extracted.size,
    partialStudyCount: [...extracted].filter((studyId) => !complete.has(studyId)).length,
    pilotStudyCount: pilotStudies.size,
    revisedAfterPilot,
    formRevisionCount: Math.max(input.versions.length - 1, 0),
    scannedDocumentCount: input.documents.filter(
      (document) => document.textStatus === 'no_text_layer',
    ).length,
    pilotRevisionCount: input.versions.filter(
      (version) => version.createdByType === 'pilot_revision',
    ).length,
    chatAssistDecisionCount: input.chatAssistDecisionCount,
    unverifiedCellCount: input.unverifiedCellCount,
    humanWithAiAnnotatorCount: humansByType('human_with_ai'),
    humanIndependentAnnotatorCount: humansByType('human_independent'),
    hasConsensus: input.annotationRows.some((row) => row.annotatorType === 'consensus'),
  };
}
