// 重複 PDF の取り込み防止（S3 / requirements.md §4.5 / issue #102）。
// 取り込み開始時に既存 Documents と突き合わせ、重複の「新規発生」を防ぐ（既存レコードの
// 上書き・削除はしない = 追記型の原則）。判定は 2 段階:
//   ① same_source: 同一 Drive ファイル（source_file_id 一致）の再取り込み
//   ② same_content: ファイル ID は異なるが内容が同一（既存の凍結コピーの md5Checksum と一致。
//      ローカル取り込みはブラウザ内で MD5 を計算。同一バッチ内の内容重複も 2 件目以降を弾く）
// md5 の突き合わせ対象は「Documents 行から参照される凍結コピー」だけに限定する — save 失敗で
// documents/ に残った孤児コピー（Documents 行なし）を対象にすると、再取り込みによる復旧経路
// （importDocuments.ts 段階 3 のコメント参照）を塞いでしまうため。
// 判定中の Drive API 失敗は例外をそのまま伝播する（呼び出し側が取り込み全体を中断 =
// フェイルクローズ。黙って重複を作らない）
import type { DocumentRecord } from '../../domain/document';
import { getFileMd5, listFolderPdfs } from '../../lib/google/drive';
import type { GoogleApiDeps } from '../../lib/google/types';
import { md5Hex } from '../../utils/md5';
import type { ImportSelection } from './importDocuments';

/** スキップ理由（ui-states.md §3「重複スキップ」） */
export type DuplicateReason = 'same_source' | 'same_content';

/** 進捗行に表示するスキップ理由の文言 */
export const DUPLICATE_REASON_LABELS: Record<DuplicateReason, string> = {
  same_source: '取り込み済みのためスキップ',
  same_content: '内容が同一の PDF が取り込み済みのためスキップ',
};

export interface SkippedSelection {
  /** 進捗行との突き合わせキー（ImportSelection.key と同値） */
  key: string;
  filename: string;
  reason: DuplicateReason;
}

export interface DedupSelectionsResult {
  /** 取り込みへ進める選択（元の並び順を保つ） */
  accepted: ImportSelection[];
  /** 重複のためスキップした選択 */
  skipped: SkippedSelection[];
}

export interface DedupSelectionsParams {
  selections: readonly ImportSelection[];
  /** 既存の Documents 一覧（source_file_id / drive_file_id の突き合わせ元） */
  existingDocuments: readonly DocumentRecord[];
  /** プロジェクトの documents/ フォルダ ID（凍結コピーの md5 一覧の取得元） */
  documentsFolderId: string;
}

export interface DedupSelectionsDeps {
  google: GoogleApiDeps;
}

/**
 * 取り込み対象から重複 PDF を除外する。accepted だけを importDocuments へ渡し、
 * skipped は進捗行へ「スキップ（理由）」として反映する
 */
export async function dedupSelections(
  params: DedupSelectionsParams,
  deps: DedupSelectionsDeps,
): Promise<DedupSelectionsResult> {
  const accepted: ImportSelection[] = [];
  const skipped: SkippedSelection[] = [];

  // ① 同一 Drive ファイルの再取り込み（API 呼び出しなしで判定できるため先に済ませる）
  const existingSourceIds = new Set(
    params.existingDocuments
      .map((doc) => doc.sourceFileId)
      .filter((id): id is string => id !== null),
  );
  const contentCandidates: ImportSelection[] = [];
  for (const selection of params.selections) {
    if (selection.source.kind === 'drive' && existingSourceIds.has(selection.source.fileId)) {
      skipped.push({ key: selection.key, filename: selection.filename, reason: 'same_source' });
    } else {
      contentCandidates.push(selection);
    }
  }
  if (contentCandidates.length === 0) {
    return { accepted, skipped };
  }

  // ② 内容同一（md5）。既存の凍結コピーの md5 集合を 1 回の files.list で取得する
  //   （既存 0 件なら Drive を読まない = 初回取り込みに余計な API 呼び出しを足さない）
  const knownMd5 = new Set<string>();
  if (params.existingDocuments.length > 0) {
    const frozenCopyIds = new Set(params.existingDocuments.map((doc) => doc.driveFileId));
    const entries = await listFolderPdfs(params.documentsFolderId, deps.google);
    for (const entry of entries) {
      if (entry.md5Checksum !== undefined && frozenCopyIds.has(entry.id)) {
        knownMd5.add(entry.md5Checksum);
      }
    }
  }
  for (const selection of contentCandidates) {
    const md5 =
      selection.source.kind === 'drive'
        ? await getFileMd5(selection.source.fileId, deps.google)
        : md5Hex(selection.source.data);
    if (md5 !== null && knownMd5.has(md5)) {
      skipped.push({ key: selection.key, filename: selection.filename, reason: 'same_content' });
      continue;
    }
    if (md5 !== null) {
      // 同一バッチ内の内容重複も 2 件目以降を弾く（1 回だけ取り込む）
      knownMd5.add(md5);
    }
    accepted.push(selection);
  }
  return { accepted, skipped };
}
