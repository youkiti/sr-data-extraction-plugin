import type { SchemaOutcomeEditorRow } from '../../features/schema/types';
import { schemaFieldToEditorRow } from '../../features/schema/redraftDiff';
import { listSchemaVersions, getSchemaFieldsByVersion } from '../../features/schema/schemaRepository';
import { readAllSchemaOutcomes } from '../../features/schema/schemaOutcomeRepository';
import { outcomesForVersion, validateOutcomeRows } from '../../features/schema/schemaOutcomes';
import { buildOutcomeListContext } from '../../features/schema/outcomeListContext';
import { saveSchemaVersion } from '../../features/schema/saveSchemaVersion';
import { getCurrentUserEmail } from '../../lib/google/identity';
import { t } from '../../lib/i18n';
import type { Store } from '../store';
import { showToast } from '../ui/toast';
import { outcomeEditorRows, resolveProtocol } from './schemaService';
import { loadPilotVerification, type PilotServiceDeps } from './pilotService';
import { withSpreadsheetWriteLock } from './verificationService';

/** 最新の確定版にアウトカムを追記し、パイロット全体の一覧を更新する。 */
export async function addPilotOutcome(store: Store, deps: PilotServiceDeps, row: SchemaOutcomeEditorRow): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.role.role !== 'owner' || state.pilot.outcomeList == null) {
    throw new Error(t('verify.outcomeAddUnavailable'));
  }
  await withSpreadsheetWriteLock(project.spreadsheetId, async () => {
    const [versions, allOutcomes] = await Promise.all([
      listSchemaVersions(project.spreadsheetId, deps.google),
      readAllSchemaOutcomes(project.spreadsheetId, deps.google),
    ]);
    const latest = versions[0];
    if (latest === undefined) {
      throw new Error(t('verify.outcomeAddUnavailable'));
    }
    const fields = await getSchemaFieldsByVersion(project.spreadsheetId, latest.schemaVersion, deps.google);
    const current = outcomesForVersion(allOutcomes, versions, latest.schemaVersion).outcomes;
    const history = allOutcomes.filter((item) => item.outcomeId === row.outcomeId.trim())
      .sort((a, b) => a.schemaVersion - b.schemaVersion);
    const restored = history[history.length - 1];
    const added = {
      ...row,
      outcomeId: row.outcomeId.trim(),
      addedVia: history[0]?.addedVia ?? row.addedVia,
      typicalTimepoints: restored?.typicalTimepoints ?? null,
    };
    const outcomes = [...outcomeEditorRows(current), added];
    const errors = validateOutcomeRows(outcomes, { listModeBefore: true });
    if (errors.length > 0) {
      throw new Error(errors.map((error) => error.message).join(' '));
    }
    const { protocol } = await resolveProtocol(store, deps, project.spreadsheetId);
    const createdBy = (await getCurrentUserEmail(deps.profile)) ?? '';
    store.setState({ pilot: { ...store.getState().pilot, verifyLoading: true } });
    const saved = await saveSchemaVersion({
      spreadsheetId: project.spreadsheetId,
      rows: fields.map(schemaFieldToEditorRow),
      outcomes,
      listModeBefore: true,
      parentVersion: latest.schemaVersion,
      protocolVersion: protocol.version,
      createdByType: 'pilot_revision',
      createdBy,
      note: `パイロットの検証でアウトカム ${added.outcomeId} を追加`,
    }, deps);
    const nextVersions = [saved.version, ...versions];
    const nextOutcomes = [...allOutcomes, ...saved.outcomes];
    const outcomeList = buildOutcomeListContext(nextOutcomes, nextVersions, saved.version.schemaVersion);
    const after = store.getState();
    store.setState({
      schema: {
        ...after.schema,
        versions: nextVersions,
        currentFields: saved.fields,
        currentOutcomes: saved.outcomes,
        currentOutcomesSourceVersion: saved.version.schemaVersion,
        allOutcomes: nextOutcomes,
      },
      counts: { ...after.counts, schemaVersions: nextVersions.length },
      pilot: { ...after.pilot, outcomeList },
    });
    showToast(t('verify.outcomeAddedToSchema', { version: saved.version.schemaVersion, label: added.outcomeLabel.trim() }));
  }).catch((error: unknown) => {
    store.setState({ pilot: { ...store.getState().pilot, verifyLoading: false } });
    throw error;
  });
  const studyId = store.getState().pilot.verifyStudyId;
  if (studyId !== null) {
    await loadPilotVerification(store, deps, studyId);
  } else {
    store.setState({ pilot: { ...store.getState().pilot, verifyLoading: false } });
  }
}
