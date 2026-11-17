// #/schema（S5）のサービス層。features/schema + lib/llm を 1 段抽象化し、
// 画面状態（AppState.schema）の遷移を一手に引き受ける（architecture.md §2.2）。
// LLM 呼び出しは extractionService と同じくレート制限ポリシーとログ記録で包み、
// 全呼び出しを LLMApiLog + Drive（logs/llm/）に残す
import { multiSelectConfigOf } from '../../domain/multiSelect';
import type { SchemaOutcome } from '../../domain/schemaOutcome';
import type { OutcomeMigrationRow } from '../../features/schema/outcomeMigration';
import { buildOutcomeMigrationRows, migrationOutcomes } from '../../features/schema/outcomeMigration';
import { readEvidenceRows } from '../../features/extraction/evidenceRepository';
import { schemaFieldToEditorRow } from '../../features/schema/redraftDiff';
import type { Protocol } from '../../domain/protocol';
import type { DocumentRecord } from '../../domain/document';
import { readDocuments } from '../../features/documents/documentRepository';
// features/schema から features/extraction を直接 import すると「feature 同士は相互 import
// しない」という本リポジトリの層規約を破るため、両者を束ねるこの app サービス層から呼ぶ
// （confirmSchema 内で使用。schema と extraction の合成点）
import { ensureStudyDataColumns } from '../../features/extraction/annotationRepository';
import {
  makeLoadDocumentPages,
  parseDriveFileId,
} from '../../features/documents/loadDocumentPages';
import { listProtocols } from '../../features/protocol/protocolRepository';
import {
  buildDraftSchemaUserPrompt,
  DRAFT_SCHEMA_PROMPT_VERSION,
  DRAFT_SCHEMA_RESPONSE_SCHEMA,
  DRAFT_SCHEMA_SYSTEM_PROMPT,
  parseDraftSchemaResponse,
  type DraftSchemaSamplePaper,
} from '../../features/schema/skills/draftSchema';
import {
  applyImportDiff,
  applyRedraftDiff,
  applyRevertDiff,
  buildRedraftDiff,
  buildRevertDiff,
  defaultRedraftSelection,
  defaultRevertSelection,
  isRedraftSelectionPristine,
} from '../../features/schema/redraftDiff';
import {
  getSchemaFieldsByVersion,
  listSchemaVersions,
} from '../../features/schema/schemaRepository';
import { saveSchemaVersion } from '../../features/schema/saveSchemaVersion';
import { readAllSchemaOutcomes } from '../../features/schema/schemaOutcomeRepository';
import { buildOutcomeListContext } from '../../features/schema/outcomeListContext';
import { countJudgedCellsForOutcome, isOutcomeListMode, outcomesForVersion, restorableOutcomes, slugifyOutcomeLabel, validateOutcomeRows } from '../../features/schema/schemaOutcomes';
import { importNoteDefault } from '../../features/schema/schemaTransfer';
import { SCHEMA_PRESETS, type SchemaPresetKind } from '../../features/schema/presets';
import { mergePresetDialogPatch } from '../../features/schema/presets/prespecDialog';
import type {
  PresetDialogPatch,
  PresetDialogState,
} from '../../features/schema/presets/prespecDialog';
import {
  buildRob2LiteRows,
  buildRob2SqRows,
  createRobPrespecDialogState,
  dialogToPrespec,
  findRob2PrespecInRows,
  validateRobPrespecDialog,
} from '../../features/schema/presets/robPrespec';
import {
  buildQuadas3Rows,
  createQuadas3PrespecDialogState,
  findQuadas3PrespecInRows,
  quadas3DialogToPrespec,
} from '../../features/schema/presets/quadas3Prespec';
import {
  buildQuipsRows,
  createQuipsPrespecDialogState,
  findQuipsPrespecInRows,
  quipsDialogToPrespec,
} from '../../features/schema/presets/quipsPrespec';
import {
  buildRobinsILiteRows,
  buildRobinsISqRows,
  createRobinsIPrespecDialogState,
  findRobinsIPrespecInRows,
  robinsIDialogToPrespec,
  validateRobinsIPrespecDialog,
} from '../../features/schema/presets/robinsIPrespec';
import type { SchemaEditorRow, SchemaOutcomeEditorRow } from '../../features/schema/types';
import { validateEditorRows } from '../../features/schema/validateField';
import { readAllDecisions } from '../../features/verification/decisionRepository';
import { ensureChildFolder, getFileText, uploadTextFile } from '../../lib/google/drive';
import { getCurrentUserEmail, type ProfileDeps } from '../../lib/google/identity';
import type { GoogleApiDeps } from '../../lib/google/types';
import { appendLlmApiLog } from '../../lib/llm/apiLogRepository';
import { withLogging } from '../../lib/llm/apiLogger';
import { confirmAiDataConsent } from '../../lib/llm/aiDataConsent';
import type { LLMProvider } from '../../lib/llm/LLMProvider';
import { missingApiKeyMessage, providerModelMismatchMessage } from '../../lib/llm/modelCatalog';
import {
  resolveProviderConfig,
  type ProviderConfig,
  type ProviderResolutionDeps,
} from '../../lib/llm/providerFactory';
import {
  applyRateLimitPolicy,
  UNLIMITED_POLICY,
  type RateLimitPolicy,
} from '../../lib/llm/rateLimitPolicy';
import { FACTORY_DEFAULT_MODEL, loadDefaultModel } from '../../lib/storage/settingsStore';
import type { SchemaState, Store } from '../store';
import { showToast } from '../ui/toast';
import { t, type MessageKey } from '../../lib/i18n';

export interface SchemaServiceDeps extends ProviderResolutionDeps {
  google: GoogleApiDeps;
  profile: ProfileDeps;
  /** provider 生成（実行時は lib/llm/providerFactory.createProvider。テストは fake を注入） */
  buildProvider: (config: ProviderConfig) => LLMProvider;
  /**
   * 実効レート制限ポリシー（429 対策）を解決する。未注入なら UNLIMITED_POLICY。
   * 本番は bootstrap が settingsStore.resolveRateLimitPolicy を注入する
   */
  resolveRateLimitPolicy?: () => Promise<RateLimitPolicy>;
  /** Options の既定モデル設定を解決する（未指定は lib/storage/settingsStore.loadDefaultModel） */
  loadDefaultModel?: () => Promise<string | null>;
  newUuid?: () => string;
  now?: () => string;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** schema スライスだけを差し替える setState ヘルパ（他スライスは維持） */
function patchSchema(store: Store, patch: Partial<SchemaState>): void {
  store.setState({ schema: { ...store.getState().schema, ...patch } });
}

/** 空のエディタ行（「行を追加」の初期値） */
export function emptyEditorRow(): SchemaEditorRow {
  return {
    fieldId: null,
    section: 'methods',
    fieldName: '',
    fieldLabel: '',
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: false,
    extractionInstruction: '',
    example: null,
    aiGenerated: false,
    note: null,
    maxQuotes: null,
    multiSelect: false,
    exclusiveValues: null,
    freeTextValues: null,
  };
}

/**
 * SchemaVersions + 最新版の SchemaFields を読み込む。
 * 読込済みのスキーマは force 指定時のみ再読込し、古くなった移行素材だけを読み直す。
 * プロジェクト未選択・読込中は no-op。
 */
export async function loadSchema(
  store: Store,
  deps: SchemaServiceDeps,
  options: { force?: boolean } = {},
): Promise<void> {
  const state = store.getState();
  if (!state.currentProject || state.schema.loading) {
    return;
  }
  const cached = state.schema.versions !== null && options.force !== true;
  if (cached && !state.schema.migrationStale) {
    return;
  }
  patchSchema(store, { loading: true, loadError: null });
  try {
    const [versions, allOutcomes] = cached ? [state.schema.versions!, state.schema.allOutcomes ?? []] : await Promise.all([
      listSchemaVersions(state.currentProject.spreadsheetId, deps.google),
      readAllSchemaOutcomes(state.currentProject.spreadsheetId, deps.google),
    ]);
    const resolved = outcomesForVersion(allOutcomes, versions, versions[0]?.schemaVersion ?? 0);
    const latest = versions[0];
    const currentFields = cached ? state.schema.currentFields ?? [] :
      latest === undefined
        ? []
        : await getSchemaFieldsByVersion(
            state.currentProject.spreadsheetId,
            latest.schemaVersion,
            deps.google,
          );
    // 既定モデルの注入（S11。ui-states.md §2「既定モデル」）:
    // ユーザーが画面で入力済みの値は上書きせず、空のときだけ埋める。
    // 優先順位: Options の設定値 → 工場出荷の既定モデル（FACTORY_DEFAULT_MODEL。Q8 = 抽出精度ベンチで確定）。
    const currentModel = store.getState().schema.model;
    const model =
      cached || currentModel !== ''
        ? currentModel
        : ((await (deps.loadDefaultModel ?? loadDefaultModel)()) ?? FACTORY_DEFAULT_MODEL);
    const migrationMaterials = latest !== undefined && !isOutcomeListMode(allOutcomes)
      ? await Promise.all([readEvidenceRows(state.currentProject.spreadsheetId, deps.google), readAllDecisions(state.currentProject.spreadsheetId, deps.google)])
      : null;
    const migrationRows = migrationMaterials === null ? [] : buildOutcomeMigrationRows(migrationMaterials[0], migrationMaterials[1], currentFields);
    const outcomeMigration = migrationMaterials !== null && migrationRows.length > 0 ? { rows: migrationRows, evidence: migrationMaterials[0], decisions: migrationMaterials[1], confirmingExclusions: false } : null;
    if (cached) {
      patchSchema(store, { loading: false, migrationStale: false, outcomeMigration });
      return;
    }
    const after = store.getState();
    store.setState({
      schema: { ...after.schema, loading: false, loadError: null, versions, currentFields, model, allOutcomes, currentOutcomes: resolved.outcomes, currentOutcomesSourceVersion: resolved.sourceVersion,
        migrationStale: false, outcomeMigration },
      counts: { ...after.counts, schemaVersions: versions.length },
    });
  } catch (err) {
    patchSchema(store, { loading: false, loadError: toMessage(err) });
  }
}

/** ドラフトフォーム: サンプル論文の選択切替（最大 3 本。超過は無視して案内） */
export function toggleSampleDocument(store: Store, documentId: string, selected: boolean): void {
  const current = store.getState().schema.selectedDocumentIds;
  if (!selected) {
    patchSchema(store, { selectedDocumentIds: current.filter((id) => id !== documentId) });
    return;
  }
  if (current.includes(documentId)) {
    return;
  }
  if (current.length >= 3) {
    showToast(t('schema.toastMax3'));
    return;
  }
  patchSchema(store, { selectedDocumentIds: [...current, documentId] });
}

/** ドラフトフォーム: requested_model の変更（未設定時の初期値は FACTORY_DEFAULT_MODEL = gemini-3.8-flash） */
export function setDraftModel(store: Store, model: string): void {
  patchSchema(store, { model: model.trim() });
}

/**
 * 最新プロトコルの本文を解決する（raw_text_inline 優先、無ければ raw_protocols/ の退避テキスト）。
 * pilotService も抽出プロンプトの protocolContext としてこれを再利用する
 */
export async function resolveProtocol(
  store: Store,
  deps: SchemaServiceDeps,
  spreadsheetId: string,
): Promise<{ protocol: Protocol; text: string }> {
  const cached = store.getState().protocol.records;
  const records = cached ?? (await listProtocols(spreadsheetId, deps.google));
  const protocol = records[0];
  if (protocol === undefined) {
    throw new Error(t('schema.errNoProtocol'));
  }
  if (protocol.rawTextInline !== null) {
    return { protocol, text: protocol.rawTextInline };
  }
  if (protocol.rawTextRef !== null) {
    const fileId = parseDriveFileId(protocol.rawTextRef);
    if (fileId !== null) {
      return { protocol, text: await getFileText(fileId, deps.google) };
    }
  }
  throw new Error(t('schema.errProtocolBody', { version: protocol.version }));
}

/** documents 一覧を解決する（documents スライスに読込済みならそれを使う） */
async function resolveDocuments(
  store: Store,
  deps: SchemaServiceDeps,
  spreadsheetId: string,
): Promise<readonly DocumentRecord[]> {
  const cached = store.getState().documents.records;
  return cached ?? (await readDocuments(spreadsheetId, deps.google));
}

let draftingLocked = false;

/**
 * draft-schema skill を実行してエディタへ流し込む（S5 の中核フロー）。
 * 経過時間は 1 秒ごとに store へ反映し、他の再描画で表示が消えない
 * （sr-query-builder draftRun の教訓。ui-states.md §3）
 */
export async function runDraftSchema(store: Store, deps: SchemaServiceDeps): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.schema.drafting || draftingLocked) {
    return;
  }
  const { selectedDocumentIds, model } = state.schema;
  if (selectedDocumentIds.length < 1 || selectedDocumentIds.length > 3) {
    patchSchema(store, { draftError: t('schema.errSamples') });
    return;
  }
  if (model === '') {
    patchSchema(store, { draftError: t('extraction.errNoModel') });
    return;
  }
  draftingLocked = true;
  let ticker: ReturnType<typeof setInterval> | undefined;
  try {
    const providerResolution = await resolveProviderConfig(model, deps);
    if (providerResolution.modelMismatch !== null) {
      patchSchema(store, { draftError: providerModelMismatchMessage(model, providerResolution.provider) });
      return;
    }
    if (providerResolution.config === null) {
      patchSchema(store, { draftError: missingApiKeyMessage(providerResolution.provider) });
      return;
    }
    // AI へ送る前の同意（issue #381）。キャンセルなら画面を変えずに戻る
    if (!(await confirmAiDataConsent(deps, providerResolution.provider))) {
      return;
    }

    patchSchema(store, { drafting: true, draftError: null, draftElapsedSeconds: 0 });
    const startedAt = Date.now();
    ticker = setInterval(() => {
      patchSchema(store, {
        draftElapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
      });
    }, 1000);

    const { text: protocolText } = await resolveProtocol(store, deps, project.spreadsheetId);
    const documents = await resolveDocuments(store, deps, project.spreadsheetId);
    const loadPages = makeLoadDocumentPages(documents, deps.google);
    const byId = new Map(documents.map((doc) => [doc.documentId, doc]));
    const samples: DraftSchemaSamplePaper[] = [];
    for (const documentId of selectedDocumentIds) {
      const doc = byId.get(documentId);
      samples.push({
        label: doc?.filename ?? documentId,
        pages: await loadPages(documentId),
      });
    }

    // logs/llm フォルダを名前で解決（プロジェクト生成時に作成済み。Meta はトップフォルダ ID のみ保持）
    const logsFolder = await ensureChildFolder('logs', project.driveFolderId, deps.google);
    const llmFolder = await ensureChildFolder('llm', logsFolder.id, deps.google);

    const baseProvider = deps.buildProvider(providerResolution.config);
    // 429 対策のレート制限ポリシーを適用（draft は 1 リクエストなのでスロットルより
    // リトライ強化が効く。extractionService と同じ経路。docs/requirements.md §4.3）
    const policy = await (deps.resolveRateLimitPolicy ?? (async () => UNLIMITED_POLICY))();
    const provider = applyRateLimitPolicy(
      withLogging(baseProvider, 'draft_schema', {
        uploadJson: async ({ filename, content }) => {
          const file = await uploadTextFile(
            { name: filename, content, parentId: llmFolder.id, mimeType: 'application/json' },
            deps.google,
          );
          return { webViewLink: file.webViewLink };
        },
        appendLogEntry: (entry) => appendLlmApiLog(project.spreadsheetId, entry, deps.google),
        promptVersion: DRAFT_SCHEMA_PROMPT_VERSION,
        newUuid: deps.newUuid,
        now: deps.now,
      }),
      policy,
    );

    const response = await provider.chat(
      [
        { role: 'system', content: (store.getState().schema.versions?.length ?? 0) > 0
          ? `${DRAFT_SCHEMA_SYSTEM_PROMPT}\nThis is a redraft of an existing schema. Return an empty outcomes array.`
          : DRAFT_SCHEMA_SYSTEM_PROMPT },
        { role: 'user', content: buildDraftSchemaUserPrompt({ protocolText, samples }) },
      ],
      { responseFormat: 'json', responseSchema: DRAFT_SCHEMA_RESPONSE_SCHEMA },
    );
    const { rows, outcomes } = parseDraftSchemaResponse(response.text);
    // 現行版の有無で分岐する（issue #197）: 0 版（初回ドラフト）は従来どおりエディタへ直行、
    // 1 件以上あるときはエディタへ直行せず差分承認画面（redraft）を経由させる
    // （既存項目がユーザーの明示的承認なしに消えないようにするため）
    const currentFields = store.getState().schema.currentFields;
    if (currentFields === null || currentFields.length === 0) {
      patchSchema(store, {
        drafting: false,
        editorRows: rows,
        editorOutcomes: outcomes,
        editorOutcomeErrors: [],
        outcomeRemoval: null,
        acknowledgedRemovedOutcomeIds: [],
        pendingOutcomeRemovals: null,
        outcomeDecisions: null,
        editorErrors: [],
        editorOrigin: 'ai_draft',
      });
      showToast(t('schema.toastDrafted', { n: rows.length }));
    } else {
      const diff = buildRedraftDiff(currentFields, rows);
      patchSchema(store, {
        drafting: false,
        redraft: { diff, selection: defaultRedraftSelection(diff) },
      });
      showToast(
        t('schema.toastRedrafted', {
          added: diff.added.length,
          changed: diff.changed.length,
          removed: diff.removed.length,
        }),
      );
    }
  } catch (err) {
    patchSchema(store, { drafting: false, draftError: toMessage(err) });
  } finally {
    clearInterval(ticker);
    draftingLocked = false;
  }
}

/** エディタ: 行の編集（人が触った時点で created_by_type は user_edit へ） */
export function updateEditorRow(
  store: Store,
  index: number,
  patch: Partial<SchemaEditorRow>,
): void {
  const rows = store.getState().schema.editorRows;
  if (rows === null || rows[index] === undefined) {
    return;
  }
  const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
  patchSchema(store, {
    editorRows: next,
    editorOrigin: 'user_edit',
    editorErrors: validateEditorRows(next),
  });
}

/** エディタ: 空行の追加（空行は必須エラーになるため即時に再検証して確定を止める） */
export function addEditorRow(store: Store): void {
  const rows = store.getState().schema.editorRows;
  if (rows === null) {
    return;
  }
  const next = [...rows, emptyEditorRow()];
  patchSchema(store, {
    editorRows: next,
    editorOrigin: 'user_edit',
    editorErrors: validateEditorRows(next),
  });
}

/** エディタ: 行の削除 */
export function removeEditorRow(store: Store, index: number): void {
  const rows = store.getState().schema.editorRows;
  if (rows === null) {
    return;
  }
  const next = rows.filter((_, i) => i !== index);
  patchSchema(store, {
    editorRows: next,
    editorOrigin: 'user_edit',
    editorErrors: validateEditorRows(next),
  });
}

/** エディタ: 行の上下移動（配列位置がそのまま field_index の採番順になる） */
export function moveEditorRow(store: Store, from: number, to: number): void {
  const rows = store.getState().schema.editorRows;
  if (rows === null) {
    return;
  }
  if (from < 0 || from >= rows.length || to < 0 || to >= rows.length || from === to) {
    return;
  }
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as SchemaEditorRow);
  patchSchema(store, {
    editorRows: next,
    editorOrigin: 'user_edit',
    editorErrors: validateEditorRows(next),
  });
}

/** エディタ: section でまとめる（section の初出順・section 内の相対順序を保つ安定ソート） */
export function sortEditorRowsBySection(store: Store): void {
  const rows = store.getState().schema.editorRows;
  if (rows === null) {
    return;
  }
  const sectionOrder: string[] = [];
  for (const row of rows) {
    if (!sectionOrder.includes(row.section)) {
      sectionOrder.push(row.section);
    }
  }
  const next = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const sectionDiff = sectionOrder.indexOf(a.row.section) - sectionOrder.indexOf(b.row.section);
      return sectionDiff !== 0 ? sectionDiff : a.index - b.index;
    })
    .map(({ row }) => row);
  if (next.every((row, index) => row === rows[index])) {
    return;
  }
  patchSchema(store, {
    editorRows: next,
    editorOrigin: 'user_edit',
    editorErrors: validateEditorRows(next),
  });
}

/**
 * エディタ末尾へ行群を追記して再検証する（プリセット挿入・事前設定ダイアログ確定の共通処理）。
 * 呼び出し元はいずれもエディタ表示中（editorRows !== null）でのみ到達する
 * — insertSchemaPreset は冒頭でガード済み、ダイアログ操作はダイアログを開けた時点で
 * エディタ表示中であり、エディタを閉じる操作（cancelEditor / confirmSchema 成功）は
 * presetDialog も同時に閉じる。`as` は この不変条件に基づく型注釈
 * （実行時フォールバックを作らない理由は robAlgorithm.ts の DOMAIN_ALGORITHMS コメント参照）
 */
function appendEditorRows(store: Store, added: readonly SchemaEditorRow[]): void {
  const rows = store.getState().schema.editorRows as SchemaEditorRow[];
  const next = [...rows, ...added];
  patchSchema(store, {
    editorRows: next,
    editorOrigin: 'user_edit',
    editorErrors: validateEditorRows(next),
  });
}

/**
 * エディタ: プリセット挿入（二値 / 連続アウトカム・RoB 系。requirements.md §3.3）。
 * RoB 系プリセット（rob2 / rob2_sq / robins_i / robins_i_sq / quadas3 / quips）は
 * 行を挿入する前に事前設定ダイアログを開く（issue #103 PR1〜PR3）
 */
export function insertSchemaPreset(store: Store, kind: SchemaPresetKind): void {
  const rows = store.getState().schema.editorRows;
  if (rows === null) {
    return;
  }
  // 再挿入時は既存の判定行 note に保存済みの事前設定 JSON をダイアログ初期値へ復元する
  if (kind === 'rob2' || kind === 'rob2_sq') {
    patchSchema(store, {
      presetDialog: createRobPrespecDialogState(kind, findRob2PrespecInRows(rows)),
    });
    return;
  }
  if (kind === 'robins_i' || kind === 'robins_i_sq') {
    patchSchema(store, {
      presetDialog: createRobinsIPrespecDialogState(kind, findRobinsIPrespecInRows(rows)),
    });
    return;
  }
  if (kind === 'quadas3') {
    patchSchema(store, {
      presetDialog: createQuadas3PrespecDialogState(findQuadas3PrespecInRows(rows)),
    });
    return;
  }
  if (kind === 'quips') {
    patchSchema(store, {
      presetDialog: createQuipsPrespecDialogState(findQuipsPrespecInRows(rows)),
    });
    return;
  }
  appendEditorRows(store, SCHEMA_PRESETS[kind].map((row) => ({ ...row })));
}

/** 事前設定ダイアログ: 入力の更新（検証エラーは入力変更でクリアする。ui-states.md §3）。
 * patch がどの variant のものかは view（renderPresetDialog の kind 分岐）が保証する契約は
 * 従来どおりだが、マージ自体は dialog.kind で narrow する mergePresetDialogPatch に委ねる
 * （issue #126 項目5: 一括 `as PresetDialogState` キャストを kind ガードで置き換え） */
export function updateRobPrespecDialog(store: Store, patch: PresetDialogPatch): void {
  const dialog = store.getState().schema.presetDialog;
  if (dialog === null) {
    return;
  }
  patchSchema(store, { presetDialog: mergePresetDialogPatch(dialog, patch) });
}

/** 事前設定ダイアログ: キャンセル（挿入せず閉じる） */
export function cancelRobPrespecDialog(store: Store): void {
  patchSchema(store, { presetDialog: null });
}

/** スキップ可能なダイアログ kind（全項目任意のツール = 軽量版 rob2 / robins_i と quadas3 / quips） */
const SKIPPABLE_DIALOG_KINDS: ReadonlySet<PresetDialogState['kind']> = new Set([
  'rob2',
  'robins_i',
  'quadas3',
  'quips',
]);

/**
 * 事前設定ダイアログ: 「スキップして挿入」（全項目任意のツールのみ）。
 * 現行テンプレートと同一の行を挿入する（回帰なし）。SQ 完全版（rob2_sq / robins_i_sq）は
 * effect of interest が SQ セット構成を決めるためスキップ不可
 * （ボタン自体を出さない + ここでも防御する）
 */
export function skipRobPrespecDialog(store: Store): void {
  const dialog = store.getState().schema.presetDialog;
  if (dialog === null || !SKIPPABLE_DIALOG_KINDS.has(dialog.kind)) {
    return;
  }
  appendEditorRows(store, SCHEMA_PRESETS[dialog.kind].map((row) => ({ ...row })));
  patchSchema(store, { presetDialog: null });
}

/** ダイアログ確定値からツール別に行群を生成する（confirmRobPrespecDialog の下請け） */
function buildPresetDialogRows(dialog: PresetDialogState): SchemaEditorRow[] {
  switch (dialog.kind) {
    case 'rob2':
      return buildRob2LiteRows(dialogToPrespec(dialog));
    case 'rob2_sq':
      return buildRob2SqRows(dialogToPrespec(dialog));
    case 'robins_i':
      return buildRobinsILiteRows(robinsIDialogToPrespec(dialog));
    case 'robins_i_sq':
      return buildRobinsISqRows(robinsIDialogToPrespec(dialog));
    case 'quadas3':
      return buildQuadas3Rows(quadas3DialogToPrespec(dialog));
    case 'quips':
      return buildQuipsRows(quipsDialogToPrespec(dialog));
  }
}

/** ツール別の確定前検証（switch で variant を絞る。エラーはメッセージキーで返す） */
function validatePresetDialog(dialog: PresetDialogState): MessageKey | null {
  switch (dialog.kind) {
    case 'rob2':
    case 'rob2_sq':
      return validateRobPrespecDialog(dialog);
    case 'robins_i':
    case 'robins_i_sq':
      return validateRobinsIPrespecDialog(dialog);
    case 'quadas3':
    case 'quips':
      // 全項目任意（原典 Phase 1〜2 / 参照枠の事前記述は推奨だが、v1 は挿入をブロックしない）
      return null;
  }
}

/**
 * 事前設定ダイアログ: 「この内容で挿入」。検証 → 行生成（Review context 注入 +
 * 判定行 note へ構造化 JSON 保存）→ エディタ末尾へ挿入して閉じる。
 * 検証エラーはダイアログ内に表示し、挿入しない（ui-states.md §3「必須未充足」）。
 * error にはメッセージキーをそのまま保存し、t() での解決は view の描画時に行う
 * （issue #126 項目3: エラー表示中に言語を切り替えても追従するように、解決済み文字列ではなく
 * キーを state に持たせる）
 */
export function confirmRobPrespecDialog(store: Store): void {
  const dialog = store.getState().schema.presetDialog;
  if (dialog === null) {
    return;
  }
  const errorKey = validatePresetDialog(dialog);
  if (errorKey !== null) {
    patchSchema(store, { presetDialog: { ...dialog, error: errorKey } });
    return;
  }
  appendEditorRows(store, buildPresetDialogRows(dialog));
  patchSchema(store, { presetDialog: null });
}

/** 確定済み画面の「新しい版を作る」: 現行版の項目をエディタへ引き継ぐ（fieldId 維持） */
export function startEditorFromCurrent(store: Store): void {
  const { currentFields } = store.getState().schema;
  if (currentFields === null) {
    return;
  }
  patchSchema(store, {
    editorOutcomes: outcomeEditorRows(store.getState().schema.currentOutcomes ?? []),
    editorOutcomeErrors: [],
    outcomeRemoval: null,
    acknowledgedRemovedOutcomeIds: [],
    pendingOutcomeRemovals: null,
    outcomeDecisions: null,
    editorRows: currentFields.map((field) => ({
      fieldId: field.fieldId,
      section: field.section,
      fieldName: field.fieldName,
      fieldLabel: field.fieldLabel,
      entityLevel: field.entityLevel,
      dataType: field.dataType,
      unit: field.unit,
      allowedValues: field.allowedValues,
      required: field.required,
      extractionInstruction: field.extractionInstruction,
      example: field.example,
      aiGenerated: field.aiGenerated,
      note: field.note,
      maxQuotes: field.maxQuotes,
      multiSelect: multiSelectConfigOf(field) !== null,
      exclusiveValues: multiSelectConfigOf(field)?.exclusiveValues.join('|') || null,
      freeTextValues: multiSelectConfigOf(field)?.freeTextValues.join('|') || null,
    })),
    editorErrors: [],
    editorOrigin: 'user_edit',
    editorParentVersion: null,
    editorNoteDefault: null,
  });
}

/** 「前の版の内容に戻す」: 戻し元の版の選択（読み込み中は変えない。前回のエラーは消す） */
export function selectRevertVersion(store: Store, version: number): void {
  const { revertFrom } = store.getState().schema;
  if (revertFrom.loading) {
    return;
  }
  patchSchema(store, { revertFrom: { ...revertFrom, version, error: null } });
}

/**
 * 「前の版の内容に戻す」（issue #318）: 戻し元の版の項目を読み込み、最新版との差分承認画面を開く。
 * 版の番号は巻き戻さず、差分を反映したエディタから「版として確定」で新しい版を追記する。
 * 最新版そのものを選んだときは「新しい版を作る」と同じ（差分が無いため）
 */
export async function startRevertFromVersion(
  store: Store,
  deps: Pick<SchemaServiceDeps, 'google'>,
  version: number,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const { currentFields, versions, revertFrom } = state.schema;
  if (!project || currentFields === null || versions === null || revertFrom.loading) {
    return;
  }
  if (versions[0]?.schemaVersion === version) {
    startEditorFromCurrent(store);
    return;
  }
  patchSchema(store, { revertFrom: { version, loading: true, error: null } });
  try {
    const sourceFields = await getSchemaFieldsByVersion(project.spreadsheetId, version, deps.google);
    // 読み込み中に別の操作（「新しい版を作る」・AI 再ドラフト・プロジェクト切替・新しい版の確定）が
    // 始まっていたら、結果を捨てる。そのまま差分画面を出すと、編集中の内容を上書きしてしまう
    const after = store.getState();
    if (
      after.currentProject?.spreadsheetId !== project.spreadsheetId ||
      after.schema.currentFields !== currentFields ||
      after.schema.editorRows !== null ||
      after.schema.redraft !== null ||
      after.schema.drafting
    ) {
      patchSchema(store, { revertFrom: { version, loading: false, error: null } });
      return;
    }
    if (sourceFields.length === 0) {
      throw new Error(t('schema.revertVersionMissing', { version }));
    }
    const diff = buildRevertDiff(currentFields, sourceFields);
    patchSchema(store, {
      revertFrom: { version, loading: false, error: null },
      redraft: {
        diff,
        selection: defaultRevertSelection(diff),
        revert: { sourceVersion: version, sourceFields },
      },
    });
  } catch (err) {
    patchSchema(store, { revertFrom: { version, loading: false, error: toMessage(err) } });
  }
}

/** エディタを閉じる（下書きは破棄。開いたままの事前設定ダイアログ・差分承認も閉じる） */
export function cancelEditor(store: Store): void {
  patchSchema(store, {
    editorOutcomes: [],
    editorOutcomeErrors: [],
    outcomeRemoval: null,
    acknowledgedRemovedOutcomeIds: [],
    pendingOutcomeRemovals: null,
    outcomeDecisions: null,
    editorRows: null,
    editorErrors: [],
    draftError: null,
    presetDialog: null,
    redraft: null,
    editorParentVersion: null,
    editorNoteDefault: null,
  });
}

/**
 * 差分承認画面: チェックボックスの切替（issue #197）。
 * redraft が null（非表示中）は no-op
 */
export function toggleRedraftSelection(
  store: Store,
  kind: 'added' | 'changed' | 'removed',
  fieldName: string,
  selected: boolean,
): void {
  const { redraft } = store.getState().schema;
  if (redraft === null) {
    return;
  }
  patchSchema(store, {
    redraft: {
      ...redraft,
      selection: { ...redraft.selection, [kind]: { ...redraft.selection[kind], [fieldName]: selected } },
    },
  });
}

/**
 * 差分承認画面: 「この内容でエディタへ反映」（issue #197）。
 * redraft が null（非表示中）は no-op。選択が既定のまま（isRedraftSelectionPristine）なら
 * created_by_type は ai_draft、1 つでも変更していれば user_edit として確定時に扱う
 * （applyEditorOrigin は confirmSchema がそのまま editorOrigin を使う）
 */
export function applyRedraft(store: Store): void {
  const { redraft } = store.getState().schema;
  if (redraft === null) {
    return;
  }
  // 「前の版に戻す」（issue #318）: 戻し元の版の並び順で組み立て、確定時の parent_version を
  // 戻し元にする。created_by_type は user_edit（人が選んだ版の内容を確定するため。新しい値を
  // 足すと旧版の拡張でシートを読めなくなる）
  if (redraft.revert !== undefined) {
    const rows = applyRevertDiff(redraft.diff, redraft.selection, redraft.revert.sourceFields);
    const schema = store.getState().schema;
    const allOutcomes = schema.allOutcomes ?? [];
    const sourceOutcomes = outcomesForVersion(allOutcomes, schema.versions ?? [], redraft.revert.sourceVersion).outcomes;
    const outcomes = sourceOutcomes.length === 0 && isOutcomeListMode(allOutcomes)
      ? schema.currentOutcomes ?? []
      : sourceOutcomes;
    patchSchema(store, {
      editorOutcomes: outcomeEditorRows(outcomes),
      editorOutcomeErrors: [],
      outcomeRemoval: null,
      acknowledgedRemovedOutcomeIds: [],
      pendingOutcomeRemovals: null,
      outcomeDecisions: null,
      editorRows: rows,
      editorErrors: validateEditorRows(rows),
      editorOrigin: 'user_edit',
      editorParentVersion: redraft.revert.sourceVersion,
      editorNoteDefault: t('schema.revertNoteDefault', { version: redraft.revert.sourceVersion }),
      redraft: null,
    });
    return;
  }
  // ファイルからの読み込み（issue #316）: 最新版の並び順を保ち、追加分を末尾に置く。
  // 出所を改訂理由の初期値に残す
  if (redraft.imported !== undefined) {
    const rows = applyImportDiff(redraft.diff, redraft.selection);
    patchSchema(store, {
      editorOutcomes: importedOutcomeRows(store.getState().schema, redraft.importedOutcomes ?? null),
      editorOutcomeErrors: [],
      outcomeRemoval: null,
      acknowledgedRemovedOutcomeIds: [],
      pendingOutcomeRemovals: null,
      outcomeDecisions: null,
      editorRows: rows,
      editorErrors: validateEditorRows(rows),
      editorOrigin: 'user_edit',
      editorParentVersion: null,
      editorNoteDefault: importNoteDefault(redraft.imported),
      redraft: null,
    });
    return;
  }
  const rows = applyRedraftDiff(redraft.diff, redraft.selection);
  patchSchema(store, {
    editorOutcomes: outcomeEditorRows(store.getState().schema.currentOutcomes ?? []),
    editorOutcomeErrors: [],
    outcomeRemoval: null,
    acknowledgedRemovedOutcomeIds: [],
    pendingOutcomeRemovals: null,
    outcomeDecisions: null,
    editorRows: rows,
    editorErrors: validateEditorRows(rows),
    editorOrigin: isRedraftSelectionPristine(redraft.diff, redraft.selection) ? 'ai_draft' : 'user_edit',
    editorParentVersion: null,
    editorNoteDefault: null,
    redraft: null,
  });
}

/** 差分承認画面: 「破棄して戻る」（エディタは開かず確定済み画面へ戻る。issue #197） */
export function cancelRedraft(store: Store): void {
  patchSchema(store, { redraft: null });
}

/**
 * 「版として確定」: 全行検証 → SchemaVersions + SchemaFields へ新版を追記。
 * 検証エラーはエディタへ表示し、確定しない
 */
export async function confirmSchema(
  store: Store,
  deps: SchemaServiceDeps,
  note: string,
  acknowledgeRemovals = false,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const rows = state.schema.editorRows;
  if (!project || rows === null || state.schema.confirming || state.schema.outcomeRemoval !== null) {
    return;
  }
  const errors = validateEditorRows(rows);
  const outcomeErrors = validateOutcomeRows(state.schema.editorOutcomes, { listModeBefore: isOutcomeListMode(state.schema.allOutcomes ?? []) });
  if (rows.length === 0 || errors.length > 0 || outcomeErrors.length > 0) {
    patchSchema(store, {
      editorErrors: errors,
      editorOutcomeErrors: outcomeErrors,
      draftError: rows.length === 0 ? t('schema.errNoRows') : null,
    });
    return;
  }
  if (state.schema.pendingOutcomeRemovals?.loading) {
    return;
  }
  if (acknowledgeRemovals && state.schema.pendingOutcomeRemovals?.error === null) {
    patchSchema(store, {
      acknowledgedRemovedOutcomeIds: [...state.schema.acknowledgedRemovedOutcomeIds, ...state.schema.pendingOutcomeRemovals.items.map((item) => item.outcomeId)],
      pendingOutcomeRemovals: null,
    });
  }
  if (!await checkRemovedOutcomes(store, deps, note)) {
    return;
  }
  const afterCheck = store.getState();
  if (afterCheck.schema.confirming || afterCheck.schema.editorRows !== rows || afterCheck.schema.editorOutcomes !== state.schema.editorOutcomes || afterCheck.currentProject !== project) {
    return;
  }
  patchSchema(store, { confirming: true });
  try {
    const { protocol } = await resolveProtocol(store, deps, project.spreadsheetId);
    const createdBy = (await getCurrentUserEmail(deps.profile)) ?? '';
    const trimmedNote = note.trim();
    const { version, fields, outcomes } = await saveSchemaVersion(
      {
        spreadsheetId: project.spreadsheetId,
        rows,
        outcomes: state.schema.editorOutcomes,
        listModeBefore: isOutcomeListMode(state.schema.allOutcomes ?? []),
        // 「前の版に戻す」（issue #318）でエディタへ入ったときは戻し元の版、それ以外は最新版
        parentVersion: state.schema.editorParentVersion ?? state.schema.versions?.[0]?.schemaVersion ?? null,
        // 確定時は常に「その時点の最新プロトコル版」を刻む（親版の protocolVersion を
        // 継承しない。issue #197 でユーザーが確定した方針）。継承すると
        // SchemaVersions.protocol_version が単調でなくなり、監査で「どのプロトコルの下で
        // 確定された版か」が読めなくなるため。現行版が古いプロトコルに基づく状態は
        // 確定済み画面の陳腐化バナー（#schema-stale-protocol）で通知し、再ドラフトへ誘導する
        protocolVersion: protocol.version,
        createdByType: state.schema.editorOrigin,
        createdBy,
        note: trimmedNote === '' ? null : trimmedNote,
      },
      { google: deps.google, newUuid: deps.newUuid, now: deps.now },
    );

    // StudyData のヘッダへ study レベル項目の列を反映する（UI とシートのギャップ解消）。
    // ベストエフォート: 版そのものは SchemaVersions / SchemaFields へ追記済みでヘッダは派生物に
    // すぎないため、失敗してもスキーマ確定は失敗させない。upsertStudyDataRows 側の遅延拡張が
    // 保険として残っており、最終的には追いつく
    try {
      const studyFieldNames = fields
        .filter((field) => field.entityLevel === 'study')
        .map((field) => field.fieldName);
      await ensureStudyDataColumns(project.spreadsheetId, studyFieldNames, deps.google);
    } catch (err) {
      console.warn(
        `StudyData のヘッダ列同期に失敗しました（版の確定自体は成功しています）: ${toMessage(err)}`,
      );
    }

    const after = store.getState();
    const versions = [version, ...(after.schema.versions ?? [])];
    store.setState({
      schema: {
        ...after.schema,
        confirming: false,
        versions,
        currentFields: fields,
        currentOutcomes: outcomes,
        currentOutcomesSourceVersion: outcomes.length > 0 ? version.schemaVersion : null,
        allOutcomes: [...(after.schema.allOutcomes ?? []), ...outcomes],
        outcomeMigration: outcomes.length > 0 ? null : after.schema.outcomeMigration,
        editorOutcomes: [],
        editorOutcomeErrors: [],
        outcomeRemoval: null,
        acknowledgedRemovedOutcomeIds: [],
        pendingOutcomeRemovals: null,
        outcomeDecisions: null,
        editorRows: null,
        editorErrors: [],
        editorParentVersion: null,
        editorNoteDefault: null,
        draftError: null,
        presetDialog: null,
      },
      counts: { ...after.counts, schemaVersions: versions.length },
    });
    discardSchemaDependentCaches(store);
    showToast(t('schema.toastConfirmed', { version: version.schemaVersion, n: fields.length }));
  } catch (err) {
    patchSchema(store, { confirming: false, draftError: toMessage(err) });
  }
}

/** 確定済みの id を固定してエディタへ引き継ぐ。 */
export function outcomeEditorRows(outcomes: readonly SchemaOutcome[]): SchemaOutcomeEditorRow[] {
  return outcomes.map((row) => ({
    outcomeId: row.outcomeId, outcomeLabel: row.outcomeLabel, description: row.description,
    typicalTimepoints: row.typicalTimepoints, addedVia: row.addedVia, note: row.note,
    aliases: [...row.aliases],
    idLocked: true, idEdited: false,
  }));
}

/** 移行の候補を更新し、別名の連鎖や選択を外したまとめ先を防ぐ。 */
export function updateOutcomeMigration(store: Store, id: string, patch: Partial<Pick<OutcomeMigrationRow, 'selected' | 'label' | 'target' | 'newId'>>): void {
  const migration = store.getState().schema.outcomeMigration;
  if (!migration || store.getState().schema.confirming) {
    return;
  }
  const target = patch.target;
  if (target && (target === id || !migration.rows.some((row) => row.id === target && row.selected && row.target === null)
    || migration.rows.some((row) => row.target === id))) {
    return;
  }
  const { newId, ...rest } = patch;
  const rows = migration.rows.map((row) => ({ ...row, ...(row.id === id
    ? { ...rest, ...(row.newId !== null && newId !== undefined ? { newId } : {}) } : {}) }));
  for (const row of rows) {
    if (row.target !== null && !rows.some((candidate) => candidate.id === row.target && candidate.selected && candidate.target === null)) {
      row.target = null;
    }
  }
  patchSchema(store, { outcomeMigration: { ...migration, rows, confirmingExclusions: false }, editorOutcomeErrors: [] });
}

/** 現行の項目を保ち、移行で選んだ最初の一覧を版として確定する。 */
export async function confirmOutcomeMigration(store: Store, deps: SchemaServiceDeps, acknowledge = false): Promise<void> {
  const schema = store.getState().schema;
  const migration = schema.outcomeMigration;
  if (!migration || !schema.currentFields || schema.confirming || isOutcomeListMode(schema.allOutcomes ?? [])) {
    return;
  }
  const outcomes = migrationOutcomes(migration.rows);
  const errors = validateOutcomeRows(outcomes, { listModeBefore: true });
  if (errors.length > 0) {
    patchSchema(store, { editorOutcomeErrors: errors });
    return;
  }
  if (!acknowledge && migration.rows.some((row) => !row.selected && row.target === null && row.judgedCells > 0)) {
    patchSchema(store, { outcomeMigration: { ...migration, confirmingExclusions: true } });
    return;
  }
  patchSchema(store, {
    editorRows: schema.currentFields.map(schemaFieldToEditorRow), editorOutcomes: outcomes, editorOutcomeErrors: [],
    editorOrigin: 'user_edit', editorParentVersion: schema.versions?.[0]?.schemaVersion ?? null,
  });
  await confirmSchema(store, deps, 'アウトカムの一覧を作成（移行）');
}

/** 確定した版に依存するキャッシュを破棄し、次に開くときに読み直す。
 * パイロット内の追加では、開いている PDF と読み直しに必要な状態を保つ。 */
export function discardSchemaDependentCaches(store: Store, options: { keepPilot?: boolean } = {}): void {
  const after = store.getState();
  if (options.keepPilot !== true) {
    void after.pilot.verification?.disposePdf?.();
  }
  void after.verify.verification?.disposePdf?.();
  void after.adjudicate.working?.disposePdf();
  store.setState({
    verify: { ...after.verify, targets: null, selectedStudyId: null, verification: null, studyValues: null, studyRowUpdatedAt: null, resultsRowUpdatedAt: {} },
    pilot: options.keepPilot === true ? after.pilot : { ...after.pilot, verification: null, verifyStudyId: null, matrix: undefined, outcomeList: undefined,
      run: null, runFields: null, evidence: null, historyInitialized: false, studyValues: null, studyRowUpdatedAt: null, resultsRowUpdatedAt: {} },
    home: { ...after.home, assignedProgress: null, assignedProgressError: null },
    dashboard: { ...after.dashboard, data: null, reviewSetProgress: null, comparison: { loading: false, error: null, data: null } },
    adjudicate: { ...after.adjudicate, rows: null, selectedStudyId: null, working: null, agreement: null, calibrationAgreement: null, outcomeList: undefined },
    export: { ...after.export, built: null, materials: null, rSetMaterials: null, rSet: null, methodsFacts: null },
  });
}

/** ファイルの一覧が無いときは現行版を引き継ぐ。既存の id は固定する。 */
export function importedOutcomeRows(schema: SchemaState, rows: SchemaOutcomeEditorRow[] | null): SchemaOutcomeEditorRow[] {
  if (rows === null) {
    return outcomeEditorRows(schema.currentOutcomes ?? []);
  }
  return rows.map((row) => ({
    ...row,
    addedVia: 'file_import',
    idLocked: (schema.allOutcomes ?? []).some((old) => old.outcomeId === row.outcomeId),
  }));
}

/** 現行版から消えるアウトカムを、確定前にまとめて確認する。 */
async function checkRemovedOutcomes(store: Store, deps: SchemaServiceDeps, note: string): Promise<boolean> {
  const state = store.getState();
  const schema = state.schema;
  const removed = (schema.currentOutcomes ?? []).filter((row) =>
    !schema.editorOutcomes.some((edited) => edited.outcomeId === row.outcomeId)
    && !schema.acknowledgedRemovedOutcomeIds.includes(row.outcomeId),
  );
  if (removed.length === 0) {
    return true;
  }
  const pending = { loading: true, error: null, items: [] };
  patchSchema(store, { pendingOutcomeRemovals: pending, editorNoteDefault: note });
  try {
    const decisions = schema.outcomeDecisions ?? await readAllDecisions(state.currentProject!.spreadsheetId, deps.google);
    const after = store.getState();
    if (after.schema.pendingOutcomeRemovals !== pending || after.schema.editorRows === null || after.currentProject !== state.currentProject) {
      return false;
    }
    const counted = removed.map((row) => ({
      outcomeId: row.outcomeId,
      outcomeLabel: row.outcomeLabel,
      ...countJudgedCellsForOutcome(decisions, row.outcomeId, row.aliases,
        buildOutcomeListContext(schema.allOutcomes ?? [], schema.versions ?? [], row.schemaVersion)?.aliasMigratedAt),
    }));
    const items = counted.filter((item) => item.cells > 0);
    patchSchema(store, {
      outcomeDecisions: decisions,
      acknowledgedRemovedOutcomeIds: [...after.schema.acknowledgedRemovedOutcomeIds, ...counted.filter((item) => item.cells === 0).map((item) => item.outcomeId)],
      pendingOutcomeRemovals: items.length > 0 ? { loading: false, error: null, items } : null,
    });
    return items.length === 0;
  } catch (err) {
    if (store.getState().schema.pendingOutcomeRemovals === pending) {
      patchSchema(store, { pendingOutcomeRemovals: { loading: false, error: toMessage(err), items: [] } });
    }
    return false;
  }
}

function patchEditorOutcomes(store: Store, rows: SchemaOutcomeEditorRow[]): void {
  patchSchema(store, {
    editorOutcomes: rows,
    pendingOutcomeRemovals: null,
    editorOutcomeErrors: validateOutcomeRows(rows, { listModeBefore: isOutcomeListMode(store.getState().schema.allOutcomes ?? []) }),
    editorOrigin: 'user_edit',
    outcomeRemoval: null,
  });
}

/** 編集中の一覧に未確定のアウトカムを追加する。 */
export function addEditorOutcome(store: Store): void {
  if (store.getState().schema.outcomeMigration) {
    return;
  }
  const schema = store.getState().schema;
  if (schema.editorRows === null) {
    return;
  }
  patchEditorOutcomes(store, [...schema.editorOutcomes, {
    outcomeId: slugifyOutcomeLabel('', schema.editorOutcomes.map((row) => row.outcomeId)),
    outcomeLabel: '', description: null, typicalTimepoints: null, addedVia: 'schema_editor', note: null,
    aliases: [],
    idLocked: false, idEdited: false,
  }]);
}

/** 確定済みの id を保ちながらアウトカムの入力を更新する。 */
export function updateEditorOutcome(store: Store, index: number, patch: Partial<SchemaOutcomeEditorRow>): void {
  const schema = store.getState().schema;
  const row = schema.editorOutcomes[index];
  if (schema.editorRows === null || !row) {
    return;
  }
  const next = { ...row, ...patch, idLocked: row.idLocked };
  if (row.idLocked) {
    next.outcomeId = row.outcomeId;
  } else if (patch.outcomeId !== undefined) {
    next.idEdited = true;
  } else if (patch.outcomeLabel !== undefined && !row.idEdited) {
    next.outcomeId = slugifyOutcomeLabel(patch.outcomeLabel, schema.editorOutcomes.filter((_, i) => i !== index).map((item) => item.outcomeId));
  }
  if (!row.idLocked) {
    const restored = restorableOutcomes(schema.allOutcomes ?? [], []).find((item) => item.outcomeId === next.outcomeId.trim());
    next.aliases = [...(restored?.aliases ?? [])];
  }
  patchEditorOutcomes(store, schema.editorOutcomes.map((item, i) => i === index ? next : item));
}

/** 編集中のアウトカムの表示順を変更する。 */
export function moveEditorOutcome(store: Store, from: number, to: number): void {
  const schema = store.getState().schema;
  if (schema.editorRows === null || from < 0 || to < 0 || from >= schema.editorOutcomes.length || to >= schema.editorOutcomes.length || from === to) {
    return;
  }
  const rows = [...schema.editorOutcomes];
  rows.splice(to, 0, rows.splice(from, 1)[0]!);
  patchEditorOutcomes(store, rows);
}

/** 過去に外したアウトカムを最後に載っていた内容で戻す。 */
export function restoreEditorOutcome(store: Store, id: string): void {
  const schema = store.getState().schema;
  const row = restorableOutcomes(schema.allOutcomes ?? [], schema.editorOutcomes.map((item) => item.outcomeId)).find((item) => item.outcomeId === id);
  if (schema.editorRows === null || !row) {
    return;
  }
  patchEditorOutcomes(store, [...schema.editorOutcomes, ...outcomeEditorRows([row])]);
}

/** アウトカムを外す確認を取り消す。 */
export function cancelRemoveEditorOutcome(store: Store): void {
  patchSchema(store, { outcomeRemoval: null, pendingOutcomeRemovals: null });
}

/** 判定済みセルの件数を確認したアウトカムを一覧から外す。 */
export function confirmRemoveEditorOutcome(store: Store): void {
  const schema = store.getState().schema;
  if (schema.editorRows === null || !schema.outcomeRemoval?.counts) {
    return;
  }
  const outcomeId = schema.editorOutcomes[schema.outcomeRemoval.index]!.outcomeId;
  patchSchema(store, { acknowledgedRemovedOutcomeIds: [...schema.acknowledgedRemovedOutcomeIds, outcomeId] });
  patchEditorOutcomes(store, schema.editorOutcomes.filter((_, index) => index !== schema.outcomeRemoval!.index));
}

/** 判定済みセルを調べ、必要なら確認を待ってアウトカムを外す。 */
export async function requestRemoveEditorOutcome(store: Store, deps: Pick<SchemaServiceDeps, 'google'>, index: number): Promise<void> {
  const state = store.getState();
  const row = state.schema.editorOutcomes[index];
  if (!state.currentProject || state.schema.editorRows === null || !row) {
    return;
  }
  if (!row.idLocked) {
    patchEditorOutcomes(store, state.schema.editorOutcomes.filter((_, i) => i !== index));
    return;
  }
  const removal = { index, loading: true, error: null, counts: null };
  patchSchema(store, { outcomeRemoval: removal, pendingOutcomeRemovals: null });
  try {
    const decisions = state.schema.outcomeDecisions ?? await readAllDecisions(state.currentProject.spreadsheetId, deps.google);
    const after = store.getState();
    if (after.schema.outcomeRemoval !== removal || after.schema.editorRows === null || after.currentProject !== state.currentProject) {
      return;
    }
    patchSchema(store, { outcomeDecisions: decisions });
    const counts = countJudgedCellsForOutcome(decisions, row.outcomeId, row.aliases,
      buildOutcomeListContext(state.schema.allOutcomes ?? [], state.schema.versions ?? [], state.schema.versions?.[0]?.schemaVersion ?? 0)?.aliasMigratedAt);
    if (counts.cells === 0) {
      patchSchema(store, { acknowledgedRemovedOutcomeIds: [...after.schema.acknowledgedRemovedOutcomeIds, row.outcomeId] });
      patchEditorOutcomes(store, after.schema.editorOutcomes.filter((_, i) => i !== index));
    } else {
      patchSchema(store, { outcomeRemoval: { index, loading: false, error: null, counts } });
    }
  } catch (err) {
    if (store.getState().schema.outcomeRemoval === removal) {
      patchSchema(store, { outcomeRemoval: { index, loading: false, error: toMessage(err), counts: null } });
    }
  }
}
