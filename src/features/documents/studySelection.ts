// 抽出（S6 パイロット / S7 一括）の対象選択モデル（v0.10 study / document）。
// study（試験）を選択単位、document（PDF）をその配下として、サービス層（既定選択・対象解決）と
// ビュー層（選択リスト表示）で共有する。並びは Studies の作成順、study 内は role 固定順 → 取り込み順。
import { DOCUMENT_ROLE_ORDER, type DocumentRecord } from '../../domain/document';
import type { StudyRecord } from '../../domain/study';
import { resolveActiveStudies } from './studyRepository';

/** 選択リスト 1 行 = 1 study（配下文書つき） */
export interface StudySelectionItem {
  study: StudyRecord;
  /** 配下文書（role 固定順 → 取り込み順）。0 件はありえない（アクティブ study の定義） */
  documents: DocumentRecord[];
  /** text_only で抽出可能な文書（テキスト層あり）を 1 件以上含むか。false は選択不可 */
  hasTextLayer: boolean;
}

/** study 内の文書を role 固定順（DOCUMENT_ROLE_ORDER）→ 取り込み順（入力配列順）で並べる */
function orderDocuments(docs: readonly { doc: DocumentRecord; order: number }[]): DocumentRecord[] {
  const roleRank = new Map(DOCUMENT_ROLE_ORDER.map((role, index) => [role, index]));
  return [...docs]
    .sort((a, b) => {
      const rankA = roleRank.get(a.doc.documentRole) ?? DOCUMENT_ROLE_ORDER.length;
      const rankB = roleRank.get(b.doc.documentRole) ?? DOCUMENT_ROLE_ORDER.length;
      return rankA !== rankB ? rankA - rankB : a.order - b.order;
    })
    .map((entry) => entry.doc);
}

/**
 * アクティブ study（Documents から参照されている study）の選択モデルを作成順で返す。
 * 参照 0 の study 行は除外する（§3.2）
 */
export function buildStudySelection(
  studies: readonly StudyRecord[],
  records: readonly DocumentRecord[],
): StudySelectionItem[] {
  const byStudy = new Map<string, { doc: DocumentRecord; order: number }[]>();
  records.forEach((doc, order) => {
    const group = byStudy.get(doc.studyId);
    if (group === undefined) {
      byStudy.set(doc.studyId, [{ doc, order }]);
    } else {
      group.push({ doc, order });
    }
  });
  return resolveActiveStudies(studies, records).map((study) => {
    // アクティブ study は必ず 1 件以上の文書から参照されている（resolveActiveStudies の定義）
    const entries = byStudy.get(study.studyId) as { doc: DocumentRecord; order: number }[];
    const documents = orderDocuments(entries);
    return {
      study,
      documents,
      hasTextLayer: documents.some((doc) => doc.textStatus !== 'no_text_layer'),
    };
  });
}

/** 選択された study_id の配下文書をまとめて返す（対象の抽出 targets 用。作成順 → study 内 role 順） */
export function documentsForStudies(
  selection: readonly StudySelectionItem[],
  studyIds: readonly string[],
): DocumentRecord[] {
  const wanted = new Set(studyIds);
  return selection
    .filter((item) => wanted.has(item.study.studyId))
    .flatMap((item) => item.documents);
}

/**
 * 除外文書（excluded=true）を除いた抽出候補の study 選択モデルを返す（issue #181）。
 * 全文書が除外された study は候補から外れ、一部除外の study は残り文書で候補になる。
 * buildStudySelection 自体は変更しない（S3 表示・検証・エクスポートは除外済みも見せるため）
 */
export function buildExtractionCandidates(
  studies: readonly StudyRecord[],
  records: readonly DocumentRecord[],
): StudySelectionItem[] {
  return buildStudySelection(
    studies,
    records.filter((doc) => !doc.excluded),
  );
}
