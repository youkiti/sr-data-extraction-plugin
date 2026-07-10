// #/schema（S5）のサービス層。features/schema + lib/llm を 1 段抽象化し、
// 画面状態（AppState.schema）の遷移を一手に引き受ける（architecture.md §2.2）。
// LLM 呼び出しは extractionService と同じく withRetry(withLogging(createProvider(...))) で包み、
// 全呼び出しを LLMApiLog + Drive（logs/llm/）に残す
import type { Protocol } from '../../domain/protocol';
import type { DocumentRecord } from '../../domain/document';
import { readDocuments } from '../../features/documents/documentRepository';
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
  getSchemaFieldsByVersion,
  listSchemaVersions,
} from '../../features/schema/schemaRepository';
import { saveSchemaVersion } from '../../features/schema/saveSchemaVersion';
import { SCHEMA_PRESETS, type SchemaPresetKind } from '../../features/schema/presets';
import type { SchemaEditorRow } from '../../features/schema/types';
import { validateEditorRows } from '../../features/schema/validateField';
import { ensureChildFolder, getFileText, uploadTextFile } from '../../lib/google/drive';
import { getCurrentUserEmail, type ProfileDeps } from '../../lib/google/identity';
import type { GoogleApiDeps } from '../../lib/google/types';
import { appendLlmApiLog } from '../../lib/llm/apiLogRepository';
import { withLogging } from '../../lib/llm/apiLogger';
import type { LLMProvider } from '../../lib/llm/LLMProvider';
import { missingApiKeyMessage } from '../../lib/llm/modelCatalog';
import {
  resolveProviderConfig,
  type ProviderConfig,
  type ProviderResolutionDeps,
} from '../../lib/llm/providerFactory';
import { withRetry } from '../../lib/llm/retry';
import { FACTORY_DEFAULT_MODEL, loadDefaultModel } from '../../lib/storage/settingsStore';
import type { SchemaState, Store } from '../store';
import { showToast } from '../ui/toast';

export interface SchemaServiceDeps extends ProviderResolutionDeps {
  google: GoogleApiDeps;
  profile: ProfileDeps;
  /** provider 生成（実行時は lib/llm/providerFactory.createProvider。テストは fake を注入） */
  buildProvider: (config: ProviderConfig) => LLMProvider;
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
  };
}

/**
 * SchemaVersions + 最新版の SchemaFields を読み込む。
 * 読込済み（versions !== null）なら force 指定時のみ再読込。プロジェクト未選択・読込中は no-op
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
  if (state.schema.versions !== null && options.force !== true) {
    return;
  }
  patchSchema(store, { loading: true, loadError: null });
  try {
    const versions = await listSchemaVersions(state.currentProject.spreadsheetId, deps.google);
    const latest = versions[0];
    const currentFields =
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
      currentModel !== ''
        ? currentModel
        : ((await (deps.loadDefaultModel ?? loadDefaultModel)()) ?? FACTORY_DEFAULT_MODEL);
    const after = store.getState();
    store.setState({
      schema: { ...after.schema, loading: false, loadError: null, versions, currentFields, model },
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
    showToast('サンプル論文は 3 本までです');
    return;
  }
  patchSchema(store, { selectedDocumentIds: [...current, documentId] });
}

/** ドラフトフォーム: requested_model の変更（未設定時の初期値は FACTORY_DEFAULT_MODEL = gemini-3.5-flash） */
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
    throw new Error('プロトコルが未入力です。先に #/protocol で入力してください');
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
  throw new Error(`プロトコル v${protocol.version} の本文を取得できません（raw_text がありません）`);
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

/**
 * draft-schema skill を実行してエディタへ流し込む（S5 の中核フロー）。
 * 経過時間は 1 秒ごとに store へ反映し、他の再描画で表示が消えない
 * （sr-query-builder draftRun の教訓。ui-states.md §3）
 */
export async function runDraftSchema(store: Store, deps: SchemaServiceDeps): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.schema.drafting) {
    return;
  }
  const { selectedDocumentIds, model } = state.schema;
  if (selectedDocumentIds.length < 1 || selectedDocumentIds.length > 3) {
    patchSchema(store, { draftError: 'サンプル論文を 1〜3 本選択してください' });
    return;
  }
  if (model === '') {
    patchSchema(store, { draftError: 'モデルを選択してください（「その他」で直接入力も可）' });
    return;
  }
  const providerResolution = await resolveProviderConfig(model, deps);
  if (providerResolution.config === null) {
    patchSchema(store, { draftError: missingApiKeyMessage(providerResolution.provider) });
    return;
  }

  patchSchema(store, { drafting: true, draftError: null, draftElapsedSeconds: 0 });
  const startedAt = Date.now();
  const ticker = setInterval(() => {
    patchSchema(store, {
      draftElapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
    });
  }, 1000);

  try {
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
    const provider = withRetry(
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
    );

    const response = await provider.chat(
      [
        { role: 'system', content: DRAFT_SCHEMA_SYSTEM_PROMPT },
        { role: 'user', content: buildDraftSchemaUserPrompt({ protocolText, samples }) },
      ],
      { responseFormat: 'json', responseSchema: DRAFT_SCHEMA_RESPONSE_SCHEMA },
    );
    const rows = parseDraftSchemaResponse(response.text);
    patchSchema(store, {
      drafting: false,
      editorRows: rows,
      editorErrors: [],
      editorOrigin: 'ai_draft',
    });
    showToast(`AI が ${rows.length} 項目をドラフトしました。内容を確認して版として確定してください`);
  } catch (err) {
    patchSchema(store, { drafting: false, draftError: toMessage(err) });
  } finally {
    clearInterval(ticker);
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

/** エディタ: プリセット挿入（二値 / 連続アウトカム・RoB 2 / ROBINS-I。requirements.md §3.3） */
export function insertSchemaPreset(store: Store, kind: SchemaPresetKind): void {
  const rows = store.getState().schema.editorRows;
  if (rows === null) {
    return;
  }
  const next = [...rows, ...SCHEMA_PRESETS[kind].map((row) => ({ ...row }))];
  patchSchema(store, {
    editorRows: next,
    editorOrigin: 'user_edit',
    editorErrors: validateEditorRows(next),
  });
}

/** 確定済み画面の「新しい版を作る」: 現行版の項目をエディタへ引き継ぐ（fieldId 維持） */
export function startEditorFromCurrent(store: Store): void {
  const { currentFields } = store.getState().schema;
  if (currentFields === null) {
    return;
  }
  patchSchema(store, {
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
    })),
    editorErrors: [],
    editorOrigin: 'user_edit',
  });
}

/** エディタを閉じる（下書きは破棄） */
export function cancelEditor(store: Store): void {
  patchSchema(store, { editorRows: null, editorErrors: [], draftError: null });
}

/**
 * 「版として確定」: 全行検証 → SchemaVersions + SchemaFields へ新版を追記。
 * 検証エラーはエディタへ表示し、確定しない
 */
export async function confirmSchema(
  store: Store,
  deps: SchemaServiceDeps,
  note: string,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const rows = state.schema.editorRows;
  if (!project || rows === null || state.schema.confirming) {
    return;
  }
  const errors = validateEditorRows(rows);
  if (rows.length === 0 || errors.length > 0) {
    patchSchema(store, {
      editorErrors: errors,
      draftError: rows.length === 0 ? 'スキーマ項目が 1 件もありません' : null,
    });
    return;
  }
  patchSchema(store, { confirming: true });
  try {
    const { protocol } = await resolveProtocol(store, deps, project.spreadsheetId);
    const createdBy = (await getCurrentUserEmail(deps.profile)) ?? '';
    const trimmedNote = note.trim();
    const { version, fields } = await saveSchemaVersion(
      {
        spreadsheetId: project.spreadsheetId,
        rows,
        parentVersion: state.schema.versions?.[0]?.schemaVersion ?? null,
        protocolVersion: protocol.version,
        createdByType: state.schema.editorOrigin,
        createdBy,
        note: trimmedNote === '' ? null : trimmedNote,
      },
      { google: deps.google, newUuid: deps.newUuid, now: deps.now },
    );
    const after = store.getState();
    const versions = [version, ...(after.schema.versions ?? [])];
    store.setState({
      schema: {
        ...after.schema,
        confirming: false,
        versions,
        currentFields: fields,
        editorRows: null,
        editorErrors: [],
        draftError: null,
      },
      counts: { ...after.counts, schemaVersions: versions.length },
    });
    showToast(`スキーマ v${version.schemaVersion} を確定しました（${fields.length} 項目）`);
  } catch (err) {
    patchSchema(store, { confirming: false, draftError: toMessage(err) });
  }
}
