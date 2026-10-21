import {
  buildSuggestEnumUserPrompt, parseSuggestEnumResponse, validateEnumChoices,
  SUGGEST_ENUM_PROMPT_VERSION, SUGGEST_ENUM_RESPONSE_SCHEMA, SUGGEST_ENUM_SYSTEM_PROMPT,
} from '../../features/schema/skills/suggestEnum';
import { t } from '../../lib/i18n';
import { confirmAiDataConsent } from '../../lib/llm/aiDataConsent';
import { appendLlmApiLog } from '../../lib/llm/apiLogRepository';
import { withLogging } from '../../lib/llm/apiLogger';
import { missingApiKeyMessage, providerModelMismatchMessage } from '../../lib/llm/modelCatalog';
import { resolveProviderConfig } from '../../lib/llm/providerFactory';
import { applyRateLimitPolicy, UNLIMITED_POLICY } from '../../lib/llm/rateLimitPolicy';
import { FACTORY_DEFAULT_MODEL, loadDefaultModel } from '../../lib/storage/settingsStore';
import type { EnumSuggestion, Store } from '../store';
import { updateEditorRow, type SchemaServiceDeps } from './schemaService';

function setSuggestion(store: Store, suggestion: EnumSuggestion | null): void {
  store.setState({ schema: { ...store.getState().schema, enumSuggestion: suggestion } });
}

export function updateEnumSuggestion(
  store: Store, patch: Partial<Pick<EnumSuggestion, 'values' | 'appendInstruction'>>,
): void {
  const current = store.getState().schema.enumSuggestion;
  if (current) setSuggestion(store, { ...current, ...patch, error: null });
}

export function cancelEnumSuggestion(store: Store): void {
  setSuggestion(store, null);
}

export async function suggestEnum(
  store: Store, index: number, deps: SchemaServiceDeps,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const row = state.schema.editorRows?.[index];
  if (!project || !row || row.dataType !== 'text' || state.schema.enumSuggestion?.loading) return;
  const pending: EnumSuggestion = {
    row, loading: true, values: null, appendInstruction: true, error: null,
  };
  setSuggestion(store, pending);
  try {
    const model = (await (deps.loadDefaultModel ?? loadDefaultModel)()) ?? FACTORY_DEFAULT_MODEL;
    const resolution = await resolveProviderConfig(model, deps);
    if (resolution.modelMismatch !== null) {
      throw new Error(providerModelMismatchMessage(model, resolution.provider));
    }
    if (resolution.config === null) throw new Error(missingApiKeyMessage(resolution.provider));
    if (!(await confirmAiDataConsent(deps, resolution.provider))) {
      if (store.getState().schema.enumSuggestion === pending) cancelEnumSuggestion(store);
      return;
    }
    const pilotValues = [...new Set((state.pilot.evidence ?? [])
      .filter((item) => row.fieldId !== null && item.fieldId === row.fieldId && !item.notReported)
      .map((item) => (item.value ?? '').trim()).filter((value) => value !== ''))].slice(0, 30);
    const policy = await (deps.resolveRateLimitPolicy ?? (async () => UNLIMITED_POLICY))();
    if (store.getState().schema.enumSuggestion !== pending) return;
    const provider = applyRateLimitPolicy(withLogging(deps.buildProvider(resolution.config), 'suggest_enum', {
      omitPayload: true,
      appendLogEntry: (entry) => appendLlmApiLog(project.spreadsheetId, entry, deps.google),
      promptVersion: SUGGEST_ENUM_PROMPT_VERSION,
      newUuid: deps.newUuid,
      now: deps.now,
    }), policy);
    const response = await provider.chat([
      { role: 'system', content: SUGGEST_ENUM_SYSTEM_PROMPT },
      { role: 'user', content: buildSuggestEnumUserPrompt({
        fieldLabel: row.fieldLabel, extractionInstruction: row.extractionInstruction, pilotValues,
      }) },
    ], { responseFormat: 'json', responseSchema: SUGGEST_ENUM_RESPONSE_SCHEMA });
    const values = parseSuggestEnumResponse(response.text).join('|');
    if (store.getState().schema.enumSuggestion === pending) {
      setSuggestion(store, { ...pending, loading: false, values });
    }
  } catch (error) {
    if (store.getState().schema.enumSuggestion === pending) {
      setSuggestion(store, { ...pending, loading: false,
        error: error instanceof Error ? error.message : String(error) });
    }
  }
}

/** 確定した版には書き込まず、既存の行編集経路で下書きだけを更新する。 */
export function applyEnumSuggestion(store: Store): void {
  const { editorRows, enumSuggestion: suggestion } = store.getState().schema;
  if (!suggestion || suggestion.loading || suggestion.values === null) return;
  try {
    const index = editorRows?.indexOf(suggestion.row) ?? -1;
    if (index < 0) throw new Error(t('schema.enumRowChanged'));
    const values = validateEnumChoices(suggestion.values.split('|'));
    updateEditorRow(store, index, {
      dataType: 'enum', allowedValues: values.join('|'), maxQuotes: null,
      multiSelect: false, exclusiveValues: null, freeTextValues: null,
      extractionInstruction: suggestion.appendInstruction
        ? `${suggestion.row.extractionInstruction}\n${t('schema.enumInstruction', { values: values.join(' | ') })}`
        : suggestion.row.extractionInstruction,
    });
    cancelEnumSuggestion(store);
  } catch (error) {
    setSuggestion(store, { ...suggestion, error: (error as Error).message });
  }
}
