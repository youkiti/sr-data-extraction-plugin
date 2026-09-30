// 使用量 CSV は未検証セルの確認や形式ディスパッチから独立した owner 専用出力。
import { readUsageRuns } from '../../features/extraction/runRepository';
import { appendExportLog } from '../../features/export/exportLogRepository';
import { listSchemaVersions } from '../../features/schema/schemaRepository';
import { aggregateUsage, buildUsageCsv } from '../../features/usage/aggregateUsage';
import { ensureChildFolder, uploadTextFile } from '../../lib/google/drive';
import { getCurrentUserEmail } from '../../lib/google/identity';
import { readLlmApiLogEntries } from '../../lib/llm/apiLogRepository';
import { nowIso8601 } from '../../utils/iso8601';
import { generateUuid } from '../../utils/uuid';
import type { ExportState, Store } from '../store';
import { downloadTextFile } from '../ui/download';
import { EXPORTS_FOLDER_NAME, timestampForFilename, type ExportServiceDeps } from './exportService';

function patchUsage(store: Store, usage: ExportState['usage']): void {
  store.setState({ export: { ...store.getState().export, usage } });
}

export async function generateUsageExport(store: Store, deps: ExportServiceDeps): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || (state.role.role ?? 'owner') !== 'owner' || state.export.usage?.generating) {
    return;
  }
  patchUsage(store, { generating: true, error: null, result: null });
  try {
    const [logs, runs, versions] = await Promise.all([
      readLlmApiLogEntries(project.spreadsheetId, deps.google),
      readUsageRuns(project.spreadsheetId, deps.google),
      listSchemaVersions(project.spreadsheetId, deps.google),
    ]);
    const summary = aggregateUsage({ logs, runs });
    const csv = buildUsageCsv(summary);
    const exportedAt = (deps.now ?? nowIso8601)();
    const filename = `usage_${timestampForFilename(exportedAt)}.csv`;
    const folder = await ensureChildFolder(EXPORTS_FOLDER_NAME, project.driveFolderId, deps.google);
    const file = await uploadTextFile(
      {
        name: filename,
        content: csv,
        parentId: folder.id,
        mimeType: 'text/csv',
      },
      deps.google,
    );
    const email = await getCurrentUserEmail(deps.profile);
    await appendExportLog(
      project.spreadsheetId,
      {
        exportId: (deps.newUuid ?? generateUuid)(),
        format: 'usage',
        // スキーマ確定前にも課金ログは存在するため、版がなければ 0 を記録する。
        schemaVersion: Math.max(0, ...versions.map((version) => version.schemaVersion)),
        studyCount: summary.succeededStudies,
        fileRef: file.webViewLink,
        exportedAt,
        exportedBy: email ?? '',
      },
      deps.google,
    );
    patchUsage(store, {
      generating: false,
      error: null,
      result: { filename, fileRef: file.webViewLink, csv },
    });
  } catch (err) {
    patchUsage(store, {
      generating: false,
      error: err instanceof Error ? err.message : String(err),
      result: null,
    });
  }
}

/** 生成済みの使用量 CSV をローカル保存する。 */
export function downloadUsageExport(store: Store, download = downloadTextFile): void {
  const state = store.getState();
  if ((state.role.role ?? 'owner') !== 'owner') {
    return;
  }
  const result = state.export.usage?.result;
  if (result) {
    download(result.filename, result.csv, 'text/csv');
  }
}
