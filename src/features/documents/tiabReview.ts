// tiab-review 採用リスト取り込みの純ロジック（issue #68・requirements.md §4.5 / ※Q2）。
// tiab-review-plugin のシート構成（References / Decisions。tiab-review-plugin/src/lib/sheets-api.ts の
// REFERENCES_HEADERS / DECISIONS_HEADERS）を正とし、列位置はヘッダ行の列名から解決する
// （tiab 側の parseReferenceValues と同じ方式。列の追加・並び替えに耐える）。
// 最終判定 include の抽出 → study_label 生成 → 取り込み済み PDF との突き合わせ →
// 反映プラン（Studies 上書き + Documents 転記）の計算までを I/O なしで行う
import type { DocumentRecord } from '../../domain/document';
import type { StudyRecord } from '../../domain/study';

/** tiab-review References タブの 1 行（取り込みに使う列のみ） */
export interface TiabReference {
  refId: string;
  title: string;
  year: number | null;
  /** 「;」区切りの著者リスト（tiab の truncateAuthors 形式） */
  authors: string | null;
  doi: string | null;
  pmid: string | null;
  /** fulltext キャッシュ / OA 直リンクの URL（Drive の webViewLink を含む） */
  fulltextUrl: string | null;
}

export type TiabDecisionValue = 'include' | 'exclude' | 'maybe' | 'pending';
export type TiabScreeningPhase = 'tiab' | 'fulltext';

/** tiab-review Decisions タブの 1 行（集計に使う列のみ） */
export interface TiabDecision {
  refId: string;
  reviewerId: string;
  decision: TiabDecisionValue;
  decidedAt: string;
  /** screening_phase 列。空欄は 'tiab' 扱い（tiab 側の後方互換規約） */
  screeningPhase: TiabScreeningPhase;
}

/** 最終判定 include の抽出結果 */
export interface TiabAdoptedList {
  /** include 抽出に使った相（fulltext 相の判定が 1 件でもあれば fulltext、無ければ tiab） */
  phase: TiabScreeningPhase;
  includes: TiabReference[];
  totalReferences: number;
}

/** プレビュー 1 行（include 1 件）の反映状態 */
export type TiabPlanItemStatus = 'update' | 'already' | 'unmatched';

export interface TiabPlanItem {
  refId: string;
  title: string;
  /** 「著者 (year)」で生成した study_label */
  studyLabel: string;
  status: TiabPlanItemStatus;
  /** 突き合わせた PDF のファイル名（未紐付けは空配列） */
  matchedFilenames: string[];
}

/** 反映プラン（プレビュー = そのまま実行内容） */
export interface TiabImportPlan {
  phase: TiabScreeningPhase;
  totalReferences: number;
  includeCount: number;
  items: TiabPlanItem[];
  /** study_label を上書きする Studies 行（変更があるもののみ） */
  studyUpdates: StudyRecord[];
  /** pmid / doi を転記する Documents 行（変更があるもののみ） */
  documentUpdates: DocumentRecord[];
}

const DECISION_VALUES: readonly TiabDecisionValue[] = ['include', 'exclude', 'maybe', 'pending'];

/**
 * 入力（スプレッドシートの URL または ID）から spreadsheetId を取り出す。
 * URL は `/spreadsheets/d/{id}` から抽出し、ID 直指定は英数・ハイフン・アンダースコアのみ許容する。
 * 判別できない入力は null
 */
export function parseTiabSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') {
    return null;
  }
  const fromUrl = /\/spreadsheets\/d\/([\w-]+)/.exec(trimmed)?.[1];
  if (fromUrl !== undefined) {
    return fromUrl;
  }
  return /^[\w-]{20,}$/.test(trimmed) ? trimmed : null;
}

/** ヘッダ行から列名 → 列 index のマップを作る */
function headerIndex(header: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  header.forEach((name, i) => {
    if (name !== '' && !map.has(name)) {
      map.set(name, i);
    }
  });
  return map;
}

function cellAt(row: readonly string[], index: number | undefined): string {
  if (index === undefined) {
    return '';
  }
  return (row[index] ?? '').trim();
}

function emptyToNull(value: string): string | null {
  return value === '' ? null : value;
}

/**
 * References タブの values を TiabReference[] へ変換する。
 * ref_id / title 列が無い場合は tiab-review のシートではないとみなして throw
 */
export function parseTiabReferences(values: readonly (readonly string[])[]): TiabReference[] {
  const header = values[0];
  if (header === undefined || !header.includes('ref_id') || !header.includes('title')) {
    throw new Error(
      'References タブに ref_id / title 列が見つかりません。tiab-review のスプレッドシートを指定してください',
    );
  }
  const index = headerIndex(header);
  const rows: TiabReference[] = [];
  for (const raw of values.slice(1)) {
    const refId = cellAt(raw, index.get('ref_id'));
    if (refId === '') {
      continue;
    }
    const yearText = cellAt(raw, index.get('year'));
    const year = /^\d{4}$/.test(yearText) ? Number(yearText) : null;
    rows.push({
      refId,
      title: cellAt(raw, index.get('title')),
      year,
      authors: emptyToNull(cellAt(raw, index.get('authors'))),
      doi: emptyToNull(cellAt(raw, index.get('doi'))),
      pmid: emptyToNull(cellAt(raw, index.get('pmid'))),
      fulltextUrl: emptyToNull(cellAt(raw, index.get('fulltext_url'))),
    });
  }
  return rows;
}

/**
 * Decisions タブの values を TiabDecision[] へ変換する。
 * ref_id / reviewer_id / decision 列が無い場合は throw。decision が不正な行は読み飛ばす
 */
export function parseTiabDecisions(values: readonly (readonly string[])[]): TiabDecision[] {
  const header = values[0];
  if (
    header === undefined ||
    !header.includes('ref_id') ||
    !header.includes('reviewer_id') ||
    !header.includes('decision')
  ) {
    throw new Error(
      'Decisions タブに ref_id / reviewer_id / decision 列が見つかりません。tiab-review のスプレッドシートを指定してください',
    );
  }
  const index = headerIndex(header);
  const rows: TiabDecision[] = [];
  for (const raw of values.slice(1)) {
    const refId = cellAt(raw, index.get('ref_id'));
    const reviewerId = cellAt(raw, index.get('reviewer_id'));
    const decision = cellAt(raw, index.get('decision'));
    if (refId === '' || reviewerId === '' || !(DECISION_VALUES as readonly string[]).includes(decision)) {
      continue;
    }
    rows.push({
      refId,
      reviewerId,
      decision: decision as TiabDecisionValue,
      decidedAt: cellAt(raw, index.get('decided_at')),
      screeningPhase: cellAt(raw, index.get('screening_phase')) === 'fulltext' ? 'fulltext' : 'tiab',
    });
  }
  return rows;
}

/**
 * Drive の閲覧リンク（webViewLink / open?id= 形式）からファイル ID を取り出す。
 * Drive 以外の URL・不正な URL は null（tiab-review drive-api.ts の extractDriveFileId を移植）
 */
export function extractDriveFileId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'drive.google.com' && parsed.hostname !== 'drive.usercontent.google.com') {
    return null;
  }
  const fromPath = /\/file\/d\/([\w-]+)/.exec(parsed.pathname)?.[1];
  if (fromPath !== undefined) {
    return fromPath;
  }
  const idParam = parsed.searchParams.get('id');
  return idParam !== null && /^[\w-]+$/.test(idParam) ? idParam : null;
}

/**
 * 著者リスト（「;」区切り）から第一著者の姓を推定する。
 * - "Smith, John" 形式（RIS AU / PubMed FAU）: カンマ前を姓とする
 * - "Smith JP" 形式（末尾がイニシャル）: 末尾トークンを除いた部分を姓とする
 * - "John Smith" 形式: 末尾トークンを姓とする
 */
function firstAuthorFamilyName(authors: string | null): string | null {
  if (authors === null) {
    return null;
  }
  // split(separator, 1).join('') は先頭要素の取り出し（noUncheckedIndexedAccess の分岐を作らない）
  const first = authors.split(';', 1).join('').trim();
  if (first === '') {
    return null;
  }
  if (first.includes(',')) {
    const family = first.split(',', 1).join('').trim();
    return family === '' ? null : family;
  }
  const tokens = first.split(/\s+/);
  const last = tokens.slice(-1).join('');
  if (tokens.length === 1) {
    return last;
  }
  if (/^[A-Z]{1,3}\.?$/.test(last)) {
    // "Smith JP" のような省略イニシャル形式は姓が先頭側
    return tokens.slice(0, -1).join(' ');
  }
  return last;
}

/**
 * 「著者 (year)」形式の study_label を生成する。
 * 著者が無ければタイトル先頭 40 字、それも無ければ ref_id 先頭 8 桁へフォールバック
 */
export function buildTiabStudyLabel(ref: TiabReference): string {
  const family = firstAuthorFamilyName(ref.authors);
  const title = ref.title.trim();
  const base = family ?? (title === '' ? ref.refId.slice(0, 8) : title.slice(0, 40));
  return ref.year === null ? base : `${base} (${ref.year})`;
}

/** (phase, refId, reviewerId) ごとに decided_at 最新の判定へ畳み込むキー */
function latestKey(d: TiabDecision): string {
  return `${d.screeningPhase} ${d.refId} ${d.reviewerId}`;
}

/**
 * 最終判定 include の Reference を抽出する。
 * - 判定は (相, 文献, 判定者) ごとに decided_at 最新の 1 件へ畳み込む（tiab の「最新判定のみ有効」規約）
 * - `llm:` 判定者は fulltext 相の採用ラウンド（Config.fulltext_ai_active_round）のみ集計する
 *   （TiAb 相の LLM run の有効・無効判別は LLM_Runs の読み出しが必要なため v1 では集計しない）
 * - fulltext 相の有効判定が 1 件でもあるシートは fulltext 相の OR 合議（誰か 1 人でも include）、
 *   無ければ TiAb 相の OR 合議で include を決める
 */
export function resolveAdoptedReferences(
  references: readonly TiabReference[],
  decisions: readonly TiabDecision[],
  activeFulltextAiRound: string | null,
): TiabAdoptedList {
  const latest = new Map<string, TiabDecision>();
  for (const decision of decisions) {
    const key = latestKey(decision);
    const existing = latest.get(key);
    if (existing === undefined || decision.decidedAt > existing.decidedAt) {
      latest.set(key, decision);
    }
  }

  // 有効判定（pending・無効 LLM を除く）を相ごとに refId → 判定値集合へ集約
  const byPhase: Record<TiabScreeningPhase, Map<string, Set<TiabDecisionValue>>> = {
    tiab: new Map(),
    fulltext: new Map(),
  };
  let hasFulltextDecision = false;
  for (const decision of latest.values()) {
    if (decision.decision === 'pending') {
      continue;
    }
    if (decision.reviewerId.startsWith('llm:')) {
      if (decision.screeningPhase !== 'fulltext' || decision.reviewerId !== activeFulltextAiRound) {
        continue;
      }
    }
    if (decision.screeningPhase === 'fulltext') {
      hasFulltextDecision = true;
    }
    const map = byPhase[decision.screeningPhase];
    const set = map.get(decision.refId);
    if (set === undefined) {
      map.set(decision.refId, new Set([decision.decision]));
    } else {
      set.add(decision.decision);
    }
  }

  const phase: TiabScreeningPhase = hasFulltextDecision ? 'fulltext' : 'tiab';
  const effective = byPhase[phase];
  const includes = references.filter((ref) => effective.get(ref.refId)?.has('include') === true);
  return { phase, includes, totalReferences: references.length };
}

/** ref と document の突き合わせ（(1) fulltext の Drive ID (2) ファイル名タグ (3) DOI / PMID） */
function matchesReference(ref: TiabReference, doc: DocumentRecord, fulltextFileId: string | null): boolean {
  if (fulltextFileId !== null && doc.sourceFileId === fulltextFileId) {
    return true;
  }
  if (doc.filename.includes(`[${ref.refId.slice(0, 8)}]`)) {
    return true;
  }
  if (ref.doi !== null && doc.doi !== null && doc.doi.toLowerCase() === ref.doi.toLowerCase()) {
    return true;
  }
  return ref.pmid !== null && doc.pmid !== null && doc.pmid === ref.pmid;
}

/**
 * include の Reference を取り込み済み study / document と突き合わせ、反映プランを計算する。
 * - study_label: 突き合わせた最初の文書の study へ「著者 (year)」を上書き（同一 study へは先勝ち）
 * - pmid / doi: 突き合わせた全文書へ転記（tiab 側に値がある列のみ。既存値と同じなら何もしない）
 * - 変更が 1 つも無い include は「適用済み」、文書が見つからない include は「PDF 未取り込み」
 * - 1 文書は 1 Reference にのみ紐付く（先勝ち。二重紐付けを防ぐ）
 */
export function planTiabImport(params: {
  adopted: TiabAdoptedList;
  studies: readonly StudyRecord[];
  documents: readonly DocumentRecord[];
}): TiabImportPlan {
  const { adopted, studies, documents } = params;
  const studyById = new Map(studies.map((study) => [study.studyId, study]));
  const claimed = new Set<string>();
  const scheduledStudies = new Map<string, StudyRecord>();
  const scheduledDocs = new Map<string, DocumentRecord>();
  const items: TiabPlanItem[] = [];

  for (const ref of adopted.includes) {
    const studyLabel = buildTiabStudyLabel(ref);
    const fulltextFileId = ref.fulltextUrl === null ? null : extractDriveFileId(ref.fulltextUrl);
    const matched = documents.filter(
      (doc) => !claimed.has(doc.documentId) && matchesReference(ref, doc, fulltextFileId),
    );
    const firstMatched = matched[0];
    if (firstMatched === undefined) {
      items.push({ refId: ref.refId, title: ref.title, studyLabel, status: 'unmatched', matchedFilenames: [] });
      continue;
    }
    let changed = false;
    for (const doc of matched) {
      claimed.add(doc.documentId);
      const base = scheduledDocs.get(doc.documentId) ?? doc;
      const next: DocumentRecord = {
        ...base,
        pmid: ref.pmid ?? base.pmid,
        doi: ref.doi ?? base.doi,
      };
      if (next.pmid !== base.pmid || next.doi !== base.doi) {
        scheduledDocs.set(doc.documentId, next);
        changed = true;
      }
    }
    const study = studyById.get(firstMatched.studyId);
    if (study !== undefined && !scheduledStudies.has(study.studyId) && study.studyLabel !== studyLabel) {
      scheduledStudies.set(study.studyId, { ...study, studyLabel });
      changed = true;
    }
    items.push({
      refId: ref.refId,
      title: ref.title,
      studyLabel,
      status: changed ? 'update' : 'already',
      matchedFilenames: matched.map((doc) => doc.filename),
    });
  }

  return {
    phase: adopted.phase,
    totalReferences: adopted.totalReferences,
    includeCount: adopted.includes.length,
    items,
    studyUpdates: [...scheduledStudies.values()],
    documentUpdates: [...scheduledDocs.values()],
  };
}
