// 文献グルーピングの意味論（requirements.md §3.2 / §4.5 v0.10）。
// 統合（複数 study を 1 試験へ）・分離（study から文書を外す）・所属変更は、文書集合が変化した
// study を「常に新 study_id で作り直す」ことで表現する（旧行は監査用に残置 = 追記型の原則）。
// 本モジュールは純粋関数のみ。Sheets への書き込み（Studies 追記 + Documents の study_id 付け替え）は
// サービス層（documentsService）の責務
import type { DocumentRecord } from '../../domain/document';
import type { StudyRecord } from '../../domain/study';

/** Documents 1 行の study_id 付け替え指示 */
export interface StudyReassignment {
  documentId: string;
  /** 付け替え後の study_id */
  studyId: string;
}

/** グルーピング操作の結果（新 Studies 行 + Documents の付け替え + 作り直された旧 study） */
export interface GroupingResult {
  /** Studies へ追記する新しい行 */
  newStudy: StudyRecord;
  /** Documents.study_id の付け替えリスト */
  reassignments: StudyReassignment[];
  /** 文書集合が変わり作り直された旧 study_id（監査用に残置される。非アクティブ化する） */
  supersededStudyIds: string[];
}

export interface MergeStudiesInput {
  /** 全 study（作成順。デフォルト値の解決に使う） */
  studies: readonly StudyRecord[];
  /** 全 document（付け替え対象の解決に使う） */
  documents: readonly DocumentRecord[];
  /** 統合する study_id（2 件以上） */
  targetStudyIds: readonly string[];
  /** 統合後のラベル（未指定 = 最初に取り込まれた study の値。§4.5） */
  label?: string;
  /** 統合後の登録番号（未指定 = 最初に取り込まれた study の値。§4.5） */
  registrationId?: string | null;
  createdBy: string;
  createdAt: string;
  /** 新 study の study_id（呼び出し側が採番。テスト差し替え用） */
  newStudyId: string;
  note?: string | null;
}

/**
 * 複数 study を 1 試験へ統合する。統合元の全文書を新 study へ付け替え、
 * 統合後の study_label / registration_id は「最初に取り込まれた（作成順で先頭の）統合元 study」の
 * 値を既定にする（呼び出し側が明示指定すればそれを優先）。統合元の旧 study は残置される（§4.5）
 */
export function mergeStudies(input: MergeStudiesInput): GroupingResult {
  const targetSet = new Set(input.targetStudyIds);
  if (targetSet.size < 2) {
    throw new Error('統合には 2 件以上の study が必要です');
  }
  // 作成順（studies の並び順）でフィルタし、既知の study だけを対象にする
  const ordered = input.studies.filter((study) => targetSet.has(study.studyId));
  if (ordered.length !== targetSet.size) {
    throw new Error('統合対象に未知の study_id が含まれています');
  }
  const first = ordered[0] as StudyRecord; // size ≥ 2 のため必ず存在
  const newStudy: StudyRecord = {
    studyId: input.newStudyId,
    studyLabel: input.label ?? first.studyLabel,
    registrationId:
      input.registrationId !== undefined ? input.registrationId : first.registrationId,
    createdAt: input.createdAt,
    createdBy: input.createdBy,
    note: input.note ?? null,
  };
  const reassignments: StudyReassignment[] = input.documents
    .filter((doc) => targetSet.has(doc.studyId))
    .map((doc) => ({ documentId: doc.documentId, studyId: input.newStudyId }));
  return {
    newStudy,
    reassignments,
    supersededStudyIds: ordered.map((study) => study.studyId),
  };
}

export interface SeparateDocumentsInput {
  documents: readonly DocumentRecord[];
  /** 独立させる文書 */
  documentIds: readonly string[];
  /** 新しい study のラベル（既定 = 対象文書の 1 本目のファイル名由来にしたい場合は呼び出し側で解決） */
  label: string;
  registrationId?: string | null;
  createdBy: string;
  createdAt: string;
  newStudyId: string;
  note?: string | null;
}

/**
 * study から文書を外して独立した新 study にする（分離・所属変更の分離側。§4.5）。
 * 外された文書だけを新 study へ付け替える。外された元 study の「残り」も文書集合が変わるが、
 * 残りの study_id 付け替えは呼び出し側（サービス層）が別途 mergeStudies / 本関数で行う
 */
export function separateDocuments(input: SeparateDocumentsInput): GroupingResult {
  const idSet = new Set(input.documentIds);
  if (idSet.size === 0) {
    throw new Error('分離する文書を 1 件以上指定してください');
  }
  const targets = input.documents.filter((doc) => idSet.has(doc.documentId));
  if (targets.length !== idSet.size) {
    throw new Error('分離対象に未知の document_id が含まれています');
  }
  const supersededStudyIds = [...new Set(targets.map((doc) => doc.studyId))];
  const newStudy: StudyRecord = {
    studyId: input.newStudyId,
    studyLabel: input.label,
    registrationId: input.registrationId ?? null,
    createdAt: input.createdAt,
    createdBy: input.createdBy,
    note: input.note ?? null,
  };
  return {
    newStudy,
    reassignments: targets.map((doc) => ({ documentId: doc.documentId, studyId: input.newStudyId })),
    supersededStudyIds,
  };
}

/**
 * これらの study のいずれかに抽出済みデータ（完了 run）があるかを判定する（§4.5 の警告文言の素材）。
 * 抽出済みの判定は常に「ExtractionRuns 完了行の study_ids」で行う（runRepository.readRunStudyCoverage）
 */
export function hasExtractedData(
  studyIds: readonly string[],
  extractedStudyIds: ReadonlySet<string>,
): boolean {
  return studyIds.some((id) => extractedStudyIds.has(id));
}

/** 統合候補（同一 registration_id を持つアクティブ study が複数） */
export interface MergeCandidate {
  registrationId: string;
  /** 同一 registration_id を持つ study_id（作成順） */
  studyIds: string[];
}

/**
 * アクティブ study を registration_id で束ね、2 件以上重なるグループを統合候補として返す（§4.5）。
 * registration_id が null のものは対象外。自動統合はせず、S3 の候補バナー → 人間確認に使う
 */
export function findMergeCandidates(activeStudies: readonly StudyRecord[]): MergeCandidate[] {
  const byRegistration = new Map<string, string[]>();
  for (const study of activeStudies) {
    if (study.registrationId === null || study.registrationId === '') {
      continue;
    }
    const group = byRegistration.get(study.registrationId);
    if (group === undefined) {
      byRegistration.set(study.registrationId, [study.studyId]);
    } else {
      group.push(study.studyId);
    }
  }
  const candidates: MergeCandidate[] = [];
  for (const [registrationId, studyIds] of byRegistration) {
    if (studyIds.length >= 2) {
      candidates.push({ registrationId, studyIds });
    }
  }
  return candidates;
}

/** 統合候補ペアを storage.local に記録するときの安定キー（study_id をソートして向き非依存に） */
export function ignoredCandidateKey(studyIds: readonly string[]): string {
  return [...studyIds].sort().join('|');
}
