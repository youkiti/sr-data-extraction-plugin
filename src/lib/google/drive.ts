// sr-query-builder-plugin の lib/google/drive.ts をコピー流用（architecture.md §7-3）
import { googleFetch, type GoogleApiDeps } from './types';

const METADATA_API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';

/**
 * Drive API v3 の薄いラッパ。プロジェクト作成段階で必要なのはフォルダ作成・
 * テキストファイル保存・テキスト取得の 3 本だけ（PDF コピーは S3 実装時に追加）。
 */

export interface DriveFileRef {
  id: string;
  webViewLink: string;
}

interface DriveListResponse {
  files?: DriveFileRef[];
}

/**
 * Drive にフォルダを作成する。`parentId` を指定すると配下に、null で「マイドライブ直下」。
 */
export async function createFolder(
  name: string,
  parentId: string | null,
  deps: GoogleApiDeps
): Promise<DriveFileRef> {
  const body = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: parentId ? [parentId] : undefined,
  };
  const url = `${METADATA_API}?fields=id,webViewLink`;
  const res = await googleFetch(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    deps
  );
  return (await res.json()) as DriveFileRef;
}

export async function ensureChildFolder(
  name: string,
  parentId: string,
  deps: GoogleApiDeps
): Promise<DriveFileRef> {
  const escapedName = name.replace(/'/g, "\\'");
  const query = [
    `name='${escapedName}'`,
    `mimeType='application/vnd.google-apps.folder'`,
    `'${parentId}' in parents`,
    'trashed=false',
  ].join(' and ');
  const url =
    `${METADATA_API}?fields=files(id,webViewLink)` +
    `&pageSize=1&q=${encodeURIComponent(query)}`;
  const res = await googleFetch(url, { method: 'GET' }, deps);
  const body = (await res.json()) as DriveListResponse;
  const existing = body.files?.[0];
  if (existing) {
    return existing;
  }
  return createFolder(name, parentId, deps);
}

/**
 * プレーンテキストや JSON をファイルとして指定フォルダにアップロードする。
 * multipart upload を手動で組み立てる（追加依存不要）。
 */
export async function uploadTextFile(
  params: {
    name: string;
    content: string;
    parentId: string;
    mimeType?: string;
  },
  deps: GoogleApiDeps
): Promise<DriveFileRef> {
  const mimeType = params.mimeType ?? 'text/plain';
  const metadata = {
    name: params.name,
    parents: [params.parentId],
  };
  const boundary = `boundary-${Math.random().toString(36).slice(2)}`;
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}; charset=UTF-8\r\n\r\n` +
    `${params.content}\r\n` +
    `--${boundary}--`;
  const url = `${UPLOAD_API}?uploadType=multipart&fields=id,webViewLink`;
  const res = await googleFetch(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
    deps
  );
  return (await res.json()) as DriveFileRef;
}

/**
 * My Drive ルート直下で指定名のフォルダを探し、なければ新規作成して返す。
 * 複数回プロジェクト作成しても sr-data-extraction フォルダが増殖しない。
 */
export async function ensureRootFolder(
  name: string,
  deps: GoogleApiDeps
): Promise<DriveFileRef> {
  const escapedName = name.replace(/'/g, "\\'");
  const query = [
    `name='${escapedName}'`,
    `mimeType='application/vnd.google-apps.folder'`,
    `'root' in parents`,
    'trashed=false',
  ].join(' and ');
  const url =
    `${METADATA_API}?fields=files(id,webViewLink)` +
    `&pageSize=1&q=${encodeURIComponent(query)}`;
  const res = await googleFetch(url, { method: 'GET' }, deps);
  const body = (await res.json()) as DriveListResponse;
  const existing = body.files?.[0];
  if (existing) {
    return existing;
  }
  return createFolder(name, null, deps);
}

/**
 * ファイル ID を指定してテキスト本文を取得する。`alt=media` で実体を返す。
 */
export async function getFileText(fileId: string, deps: GoogleApiDeps): Promise<string> {
  const url = `${METADATA_API}/${encodeURIComponent(fileId)}?alt=media`;
  const res = await googleFetch(url, { method: 'GET' }, deps);
  return await res.text();
}

/**
 * ファイル ID を指定してバイナリ実体を取得する（PDF のダウンロード用）。`alt=media`。
 */
export async function getFileBinary(fileId: string, deps: GoogleApiDeps): Promise<ArrayBuffer> {
  const url = `${METADATA_API}/${encodeURIComponent(fileId)}?alt=media`;
  const res = await googleFetch(url, { method: 'GET' }, deps);
  return await res.arrayBuffer();
}

/**
 * ファイルを指定フォルダへコピーする（files.copy）。
 * 文献取り込み（S3 / ※Q9）の「プロジェクト内コピー = 凍結スナップショット」を作るのに使う。
 * drive.file スコープでは Picker でユーザーが選択したファイルに対してのみ許可される
 */
export async function copyFile(
  sourceFileId: string,
  params: { name: string; parentId: string },
  deps: GoogleApiDeps
): Promise<DriveFileRef> {
  const url = `${METADATA_API}/${encodeURIComponent(sourceFileId)}/copy?fields=id,webViewLink`;
  const res = await googleFetch(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: params.name, parents: [params.parentId] }),
    },
    deps
  );
  return (await res.json()) as DriveFileRef;
}
