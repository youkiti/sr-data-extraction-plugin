// パイロットの最終判定から抽出指示の部分改訂案を作るサービス。
// 現行スキーマへ適用する提案だけを差分承認へ渡し、通信と監査ログをここで配線する。
import { buildPilotFeedback } from '../../features/schema/pilotFeedback';
import {
  filterLeakingRevisions,
  selectRevisionFeedback,
} from '../../features/schema/pilotRevisionSafety';
import { buildRedraftDiff, defaultRedraftSelection } from '../../features/schema/redraftDiff';
import {
  buildRevisePilotInstructionsUserPrompt,
  parseRevisePilotInstructionsResponse,
  REVISE_PILOT_INSTRUCTIONS_PROMPT_VERSION,
  REVISE_PILOT_INSTRUCTIONS_RESPONSE_SCHEMA,
  REVISE_PILOT_INSTRUCTIONS_SYSTEM_PROMPT,
  toRevisionEditorRows,
} from '../../features/schema/skills/revisePilotInstructions';
import { readAllDecisions } from '../../features/verification/decisionRepository';
import { ensureChildFolder, uploadTextFile } from '../../lib/google/drive';
import { getCurrentUserEmail } from '../../lib/google/identity';
import { getUiLanguage, t } from '../../lib/i18n';
import { withLogging } from '../../lib/llm/apiLogger';
import { appendLlmApiLog } from '../../lib/llm/apiLogRepository';
import { missingApiKeyMessage } from '../../lib/llm/modelCatalog';
import { resolveProviderConfig } from '../../lib/llm/providerFactory';
import { applyRateLimitPolicy, UNLIMITED_POLICY } from '../../lib/llm/rateLimitPolicy';
import type { PilotState, Store } from '../store';
import { loadSchema, type SchemaServiceDeps } from './schemaService';
import { withSpreadsheetWriteLock } from './verificationService';

function patchPilot(store: Store, patch: Partial<PilotState>): void {
  store.setState({ pilot: { ...store.getState().pilot, ...patch } });
}

/** 成功時だけ true を返し、ルート遷移は bootstrap に任せる。 */
export async function runPilotRevision(store: Store, deps: SchemaServiceDeps): Promise<boolean> {
  const state = store.getState();
  const project = state.currentProject;
  const { run, runFields, evidence, model } = state.pilot;
  if (
    !project ||
    state.pilot.revising ||
    state.pilot.running ||
    run === null ||
    runFields === null ||
    evidence === null
  )
    return false;
  if (model === '') {
    patchPilot(store, { reviseError: t('extraction.errNoModel') });
    return false;
  }
  patchPilot(store, { revising: true, reviseError: null, reviseElapsedSeconds: 0 });
  const startedAt = Date.now();
  const ticker = setInterval(
    () =>
      patchPilot(store, {
        reviseElapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
      }),
    1000,
  );
  try {
    const resolution = await resolveProviderConfig(model, deps);
    if (resolution.config === null) throw new Error(missingApiKeyMessage(resolution.provider));
    // 未送信判定の件数はパイロットの保存・再送結果から更新される。
    // 直前の判定保存が終わってからシートを読み、未保存の楽観状態を材料にしない。
    const decisions = await withSpreadsheetWriteLock(project.spreadsheetId, () => {
      const queued = store.getState().pilot.queuedDecisions;
      if (queued > 0) throw new Error(t('pilot.reviseQueuedDecisions', { n: queued }));
      return readAllDecisions(project.spreadsheetId, deps.google);
    });
    const runDecisions = decisions.filter((decision) => run.studyIds.includes(decision.studyId));
    const annotator = (await getCurrentUserEmail(deps.profile)) ?? '';
    const rawFeedback = buildPilotFeedback({
      runStudyIds: run.studyIds,
      schemaVersion: run.schemaVersion,
      fields: runFields,
      evidence,
      decisions: runDecisions,
      annotator,
    });
    patchPilot(store, {
      decisions: runDecisions,
    });
    if (rawFeedback.decisionCount === 0) throw new Error(t('pilot.reviseEmpty'));
    if (store.getState().schema.currentFields === null)
      await loadSchema(store, deps, { force: true });
    const currentFields = store.getState().schema.currentFields;
    if (currentFields === null)
      throw new Error(store.getState().schema.loadError ?? t('extraction.errNoSchema'));
    const { feedback, excludedSingleStudyCount } = selectRevisionFeedback(
      rawFeedback,
      currentFields,
    );
    if (feedback.items.length === 0) throw new Error(t('pilot.reviseInsufficientStudies'));
    const targetFields = currentFields.filter((field) =>
      feedback.items.some((item) => item.fieldId === field.fieldId),
    );
    const currentVersion = store.getState().schema.versions?.[0]?.schemaVersion;
    const logsFolder = await ensureChildFolder('logs', project.driveFolderId, deps.google);
    const llmFolder = await ensureChildFolder('llm', logsFolder.id, deps.google);
    const policy = await (deps.resolveRateLimitPolicy ?? (async () => UNLIMITED_POLICY))();
    const provider = applyRateLimitPolicy(
      withLogging(deps.buildProvider(resolution.config), 'revise_schema_pilot', {
        uploadJson: async ({ filename, content }) => {
          const file = await uploadTextFile(
            { name: filename, content, parentId: llmFolder.id, mimeType: 'application/json' },
            deps.google,
          );
          return { webViewLink: file.webViewLink };
        },
        appendLogEntry: (entry) => appendLlmApiLog(project.spreadsheetId, entry, deps.google),
        promptVersion: REVISE_PILOT_INSTRUCTIONS_PROMPT_VERSION,
        newUuid: deps.newUuid,
        now: deps.now,
      }),
      policy,
    );
    const response = await provider.chat(
      [
        { role: 'system', content: REVISE_PILOT_INSTRUCTIONS_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildRevisePilotInstructionsUserPrompt({
            fields: targetFields,
            feedback,
            rationaleLanguage: getUiLanguage() === 'ja' ? 'Japanese' : 'English',
          }),
        },
      ],
      { responseFormat: 'json', responseSchema: REVISE_PILOT_INSTRUCTIONS_RESPONSE_SCHEMA },
    );
    const after = store.getState().schema;
    if (
      after.versions?.[0]?.schemaVersion !== currentVersion ||
      after.currentFields !== currentFields
    )
      throw new Error(t('pilot.reviseSchemaChanged'));
    const parsed = parseRevisePilotInstructionsResponse(response.text, targetFields);
    const { revisions, droppedFieldNames } = filterLeakingRevisions(
      parsed.revisions,
      targetFields,
      feedback,
    );
    if (revisions.length === 0 && droppedFieldNames.length > 0)
      throw new Error(t('pilot.reviseAllLeaked'));
    if (revisions.length === 0) throw new Error(t('pilot.reviseNoChanges'));
    const diff = buildRedraftDiff(currentFields, toRevisionEditorRows(currentFields, revisions), {
      partial: true,
    });
    store.setState({
      schema: {
        ...store.getState().schema,
        editorRows: null,
        editorErrors: [],
        redraft: { diff, selection: defaultRedraftSelection(diff) },
        pilotRevision: {
          runId: run.runId,
          runStartedAt: run.startedAt,
          decisionCount: feedback.decisionCount,
          excludedSingleStudyCount,
          leakedProposalCount: droppedFieldNames.length,
          rationales: Object.fromEntries(
            revisions.map((revision) => [revision.fieldName, revision.rationale]),
          ),
        },
      },
    });
    return true;
  } catch (error) {
    patchPilot(store, { reviseError: error instanceof Error ? error.message : String(error) });
    return false;
  } finally {
    clearInterval(ticker);
    patchPilot(store, { revising: false });
  }
}
