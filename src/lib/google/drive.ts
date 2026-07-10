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

/** listFolderPdfs が返すフォルダ直下の PDF（Picker の PickerSelection と同形） */
export interface DrivePdfEntry {
  id: string;
  name: string;
}

interface DrivePdfListResponse {
  files?: DrivePdfEntry[];
  nextPageToken?: string;
}

export interface CreateFolderOptions {
  /**
   * フォルダ色（例: '#e9318f'）。Drive のパレット外の色は最も近いパレット色に
   * 自動で丸められる（API 仕様）。
   */
  folderColorRgb?: string;
}

/**
 * Drive にフォルダを作成する。`parentId` を指定すると配下に、null で「マイドライブ直下」。
 */
export async function createFolder(
  name: string,
  parentId: string | null,
  deps: GoogleApiDeps,
  options: CreateFolderOptions = {}
): Promise<DriveFileRef> {
  const body = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: parentId ? [parentId] : undefined,
    folderColorRgb: options.folderColorRgb,
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
 * ファイルを指定フォルダへ移動する（Drive API files.update の parents 操作）。
 *
 * Sheets API の spreadsheets.create はスプレッドシートを必ずマイドライブ直下に
 * 作るため、プロジェクトフォルダ配下へ収めるにはこの移動が必要。現在の親
 * （通常は root）を removeParents で外し、`parentId` を addParents で付け替える。
 * drive.file スコープでも、当該ファイルを本アプリが作成していれば操作できる。
 */
export async function moveFileToFolder(
  fileId: string,
  parentId: string,
  deps: GoogleApiDeps
): Promise<void> {
  // 現在の親を取得してから付け替える（Drive は単一親モデルのため removeParents が要る）
  const getUrl = `${METADATA_API}/${encodeURIComponent(fileId)}?fields=parents`;
  const getRes = await googleFetch(getUrl, { method: 'GET' }, deps);
  const { parents } = (await getRes.json()) as { parents?: string[] };
  const removeParents = (parents ?? []).join(',');

  const params = new URLSearchParams({ addParents: parentId, fields: 'id,parents' });
  if (removeParents) {
    params.set('removeParents', removeParents);
  }
  const url = `${METADATA_API}/${encodeURIComponent(fileId)}?${params.toString()}`;
  await googleFetch(url, { method: 'PATCH' }, deps);
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
 * バイナリ（PDF 等）をファイルとして指定フォルダにアップロードする（ローカル取り込み・S3）。
 * uploadTextFile と同じ multipart/related 手組みだが、文字列連結では PDF のバイトを壊すため
 * body を Blob で組み立てる（Blob は文字列パートとバイナリパートを跨いで連結できる）。
 */
export async function uploadBinaryFile(
  params: {
    name: string;
    data: ArrayBuffer;
    parentId: string;
    mimeType?: string;
  },
  deps: GoogleApiDeps
): Promise<DriveFileRef> {
  const mimeType = params.mimeType ?? 'application/pdf';
  const metadata = {
    name: params.name,
    parents: [params.parentId],
  };
  const boundary = `boundary-${Math.random().toString(36).slice(2)}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    params.data,
    `\r\n--${boundary}--`,
  ]);
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
  deps: GoogleApiDeps,
  options: CreateFolderOptions = {}
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
  return createFolder(name, null, deps, options);
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
 * 指定フォルダの直下にある PDF を全件列挙する（フォルダ単位の文献取り込み。S3）。
 * drive.file スコープでも、ユーザーが Picker で選択したフォルダの配下は列挙できる。
 * 再帰はしない（直下のみ）。nextPageToken をたどって全ページを結合する。
 */
export async function listFolderPdfs(
  folderId: string,
  deps: GoogleApiDeps
): Promise<DrivePdfEntry[]> {
  const escapedId = folderId.replace(/'/g, "\\'");
  const query = [
    `'${escapedId}' in parents`,
    `mimeType='application/pdf'`,
    'trashed=false',
  ].join(' and ');
  const entries: DrivePdfEntry[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: query,
      fields: 'nextPageToken,files(id,name)',
      pageSize: '1000',
      orderBy: 'name',
    });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }
    const url = `${METADATA_API}?${params.toString()}`;
    const res = await googleFetch(url, { method: 'GET' }, deps);
    const body = (await res.json()) as DrivePdfListResponse;
    for (const file of body.files ?? []) {
      entries.push({ id: file.id, name: file.name });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  return entries;
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
