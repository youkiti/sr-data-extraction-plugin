// 判定・データ・群構成の作業型を読み、モード変更をハードブロックする
// （issue #255・docs/design-independent-dual-review.md §2.1）。
// StudyData / ResultsData は重複キーの敗者も含めて全行を読み、Decisions / ArmStructures
// の追記履歴と併せて記録済みの作業型を収集する。
import type { AnnotatorType } from '../../domain/annotation';
import type { GoogleApiDeps } from '../../lib/google/types';
import { readAllStudyDataRows, readAllResultsDataRows } from '../extraction/annotationRepository';
import { readAllDecisions } from '../verification/decisionRepository';
import { readAllArmStructures } from '../verification/armStructureRepository';

export type HumanWorkType = Extract<AnnotatorType, 'human_with_ai' | 'human_independent'>;

/** email が完全一致する人間の作業行から、記録済みのモードを集める */
export function collectAnnotatorTypesForEmail(
  rows: ReadonlyArray<{ annotator: string; annotatorType: AnnotatorType }>,
  email: string,
): Set<HumanWorkType> {
  const types = new Set<HumanWorkType>();
  for (const row of rows) {
    if (
      row.annotator === email &&
      (row.annotatorType === 'human_with_ai' || row.annotatorType === 'human_independent')
    ) {
      types.add(row.annotatorType);
    }
  }
  return types;
}

/** 登録の都度、判定・データ・群構成を読み直す。読込失敗は呼び出し元へ伝播する */
export async function readAnnotatorTypesForEmail(
  spreadsheetId: string,
  email: string,
  google: GoogleApiDeps,
): Promise<Set<HumanWorkType>> {
  const [decisions, study, results, arms] = await Promise.all([
    readAllDecisions(spreadsheetId, google),
    readAllStudyDataRows(spreadsheetId, google),
    readAllResultsDataRows(spreadsheetId, google),
    readAllArmStructures(spreadsheetId, google),
  ]);
  return collectAnnotatorTypesForEmail([...decisions, ...study, ...results, ...arms], email);
}
