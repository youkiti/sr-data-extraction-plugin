// 対象 annotator ペアの解決（docs/design-independent-dual-review.md §6.1・§11: v1 は 2 名固定）。
// StudyData / ResultsData / Decisions のいずれかに human 系 annotator（human_with_ai /
// human_independent。'ai' と 'consensus' は除外）の行を持つ email を study ごとに列挙し、
// ちょうど 2 名のときだけ裁定可能とする。1 名以下・3 名以上は画面内の案内に委ねる
import type { AnnotatorType, ResultsDataRow, StudyDataRow } from '../../domain/annotation';
import type { Decision } from '../../domain/decision';

const HUMAN_ANNOTATOR_TYPES: readonly AnnotatorType[] = ['human_with_ai', 'human_independent'];

function isHuman(type: AnnotatorType): boolean {
  return (HUMAN_ANNOTATOR_TYPES as readonly AnnotatorType[]).includes(type);
}

export type AnnotatorPairResolution =
  | { kind: 'ready'; annotatorA: string; annotatorB: string }
  | { kind: 'waiting'; annotators: readonly string[] }
  | { kind: 'ambiguous'; annotators: readonly string[] };

export interface ResolveAnnotatorPairInput {
  studyId: string;
  studyDataRows: readonly StudyDataRow[];
  resultsDataRows: readonly ResultsDataRow[];
  decisions: readonly Decision[];
}

/**
 * study 単位で human 系 annotator を列挙し、ペア解決の種別を返す。
 * 2 名ちょうど → ready（A/B は email の昇順で安定させる。テスト・表示の決定性のため）。
 * 1 名以下 → waiting（両者の検証完了待ち）。3 名以上 → ambiguous（対象を特定できない）
 */
export function resolveAnnotatorPair(input: ResolveAnnotatorPairInput): AnnotatorPairResolution {
  const emails = new Set<string>();
  for (const row of input.studyDataRows) {
    if (row.studyId === input.studyId && isHuman(row.annotatorType)) {
      emails.add(row.annotator);
    }
  }
  for (const row of input.resultsDataRows) {
    if (row.studyId === input.studyId && isHuman(row.annotatorType)) {
      emails.add(row.annotator);
    }
  }
  for (const decision of input.decisions) {
    if (decision.studyId === input.studyId && isHuman(decision.annotatorType)) {
      emails.add(decision.annotator);
    }
  }
  const sorted = [...emails].sort((a, b) => a.localeCompare(b));
  if (sorted.length === 2) {
    return { kind: 'ready', annotatorA: sorted[0] as string, annotatorB: sorted[1] as string };
  }
  if (sorted.length >= 3) {
    return { kind: 'ambiguous', annotators: sorted };
  }
  return { kind: 'waiting', annotators: sorted };
}
