// S5「スキーマのファイル（JSON）」（issue #316）。確定済みの版を JSON でダウンロードし、
// 別のプロジェクトで読み込む。読み込みは、版が無ければエディタへ直接、版があれば
// 差分承認画面（AI 再ドラフト #197・前の版に戻す #318 と同じ部品）を経てエディタへ入れる。
// どちらも最後は既存の「版として確定」。Google API は書き出しの項目読み込みにだけ使う
import { EXTRACT_DATA_PROMPT_VERSION } from '../../features/extraction/skills/extractData';
import { buildImportDiff, defaultRedraftSelection } from '../../features/schema/redraftDiff';
import { getSchemaFieldsByVersion } from '../../features/schema/schemaRepository';
import {
  SCHEMA_IMPORT_MAX_BYTES,
  SchemaImportError,
  importNoteDefault,
  parseSchemaExport,
  schemaExportFilename,
  serializeSchemaExport,
} from '../../features/schema/schemaTransfer';
import { validateEditorRows } from '../../features/schema/validateField';
import { getCurrentUserEmail } from '../../lib/google/identity';
import { t } from '../../lib/i18n';
import type { SchemaTransferState, Store } from '../store';
import { downloadTextFile } from '../ui/download';
import { showToast } from '../ui/toast';
import type { SchemaServiceDeps } from './schemaService';

export type SchemaTransferDeps = Pick<SchemaServiceDeps, 'google' | 'profile'> & {
  /** 書き出し日時（ISO 8601）。テストは固定値を注入する */
  now?: () => string;
  /** 拡張の版。既定は chrome.runtime.getManifest().version（無い環境では null） */
  getAppVersion?: () => string | null;
  /** ダウンロード。テストは fake を注入する */
  download?: (filename: string, content: string, mimeType: string) => void;
};

/** 読み込むファイル（`File` の必要な部分だけ。テストで差し替えやすくする） */
export interface SchemaImportFile {
  size: number;
  text(): Promise<string>;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function defaultAppVersion(): string | null {
  if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getManifest === 'function') {
    return chrome.runtime.getManifest().version;
  }
  return null;
}

function patchTransfer(store: Store, patch: Partial<SchemaTransferState>): void {
  const { schema } = store.getState();
  store.setState({ schema: { ...schema, transfer: { ...schema.transfer, ...patch } } });
}

/** 書き出す版の選択（書き出し中は変えない。前回のエラーは消す） */
export function selectSchemaExportVersion(store: Store, version: number): void {
  if (store.getState().schema.transfer.exporting) {
    return;
  }
  patchTransfer(store, { exportVersion: version, exportError: null });
}

/** 選んだ版を JSON にしてダウンロードする。最新版は読み込み済みの項目を使う */
export async function exportSchemaFile(store: Store, deps: SchemaTransferDeps, version: number): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const { versions, currentFields, transfer } = state.schema;
  if (!project || versions === null || transfer.exporting) {
    return;
  }
  patchTransfer(store, { exportVersion: version, exporting: true, exportError: null });
  try {
    const fields =
      versions[0]?.schemaVersion === version && currentFields !== null
        ? currentFields
        : await getSchemaFieldsByVersion(project.spreadsheetId, version, deps.google);
    if (fields.length === 0) {
      throw new Error(t('schema.consultDocVersionMissing', { version }));
    }
    const exportedAt = (deps.now ?? (() => new Date().toISOString()))();
    const content = serializeSchemaExport(fields, {
      projectName: project.name,
      schemaVersion: version,
      exportedAt,
      exportedBy: (await getCurrentUserEmail(deps.profile)) ?? '',
      extractPromptVersion: EXTRACT_DATA_PROMPT_VERSION,
      appVersion: (deps.getAppVersion ?? defaultAppVersion)(),
    });
    (deps.download ?? downloadTextFile)(
      schemaExportFilename(project.name, version, exportedAt),
      content,
      'application/json',
    );
    patchTransfer(store, { exporting: false });
  } catch (err) {
    patchTransfer(store, { exporting: false, exportError: toMessage(err) });
  }
}

/** エディタ・差分承認・ドラフト生成のいずれも開いていない（読み込み結果を出してよい）か */
function isIdle(state: ReturnType<Store['getState']>): boolean {
  return state.schema.editorRows === null && state.schema.redraft === null && !state.schema.drafting;
}

/**
 * ファイルを読み込む。版が無いプロジェクトではエディタへ直接、版があるプロジェクトでは
 * 最新版との差分承認画面へ入れる。読めないファイルは画面を変えずに理由を出す
 */
export async function importSchemaFile(store: Store, file: SchemaImportFile): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const { versions, currentFields, transfer } = state.schema;
  if (!project || versions === null || currentFields === null || transfer.importing || !isIdle(state)) {
    return;
  }
  patchTransfer(store, { importing: true, importError: null });
  try {
    if (file.size > SCHEMA_IMPORT_MAX_BYTES) {
      throw new SchemaImportError('schema.importTooLarge');
    }
    const { source, rows } = parseSchemaExport(await file.text());
    // 読み込み中に別の操作（エディタを開く・AI 再ドラフト・確定・プロジェクト切替）が始まっていたら捨てる
    const after = store.getState();
    if (
      after.currentProject?.spreadsheetId !== project.spreadsheetId ||
      after.schema.currentFields !== currentFields ||
      !isIdle(after)
    ) {
      patchTransfer(store, { importing: false });
      return;
    }
    if (versions.length === 0) {
      store.setState({
        schema: {
          ...after.schema,
          transfer: { ...after.schema.transfer, importing: false },
          editorRows: rows,
          editorErrors: validateEditorRows(rows),
          editorOrigin: 'user_edit',
          editorParentVersion: null,
          editorNoteDefault: importNoteDefault(source),
        },
      });
    } else {
      const diff = buildImportDiff(currentFields, rows);
      store.setState({
        schema: {
          ...after.schema,
          transfer: { ...after.schema.transfer, importing: false },
          redraft: { diff, selection: defaultRedraftSelection(diff), imported: source },
        },
      });
    }
    showToast(t('schema.toastImported', { n: rows.length }));
  } catch (err) {
    patchTransfer(store, { importing: false, importError: toMessage(err) });
  }
}
