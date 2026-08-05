// 確定 annotator の選定（requirements.md §3.2 / Q6:
// エクスポートの既定は consensus 行、なければ唯一の human 行）
import type { AnnotatorType } from '../../domain/annotation';

export interface AnnotatorTagged {
  annotator: string;
  annotatorType: AnnotatorType;
}

/**
 * 確定 annotator を選ぶ。consensus が 1 件ならそれ、なければ human
 * （human_with_ai / human_independent）が 1 件のときだけそれを返す。
 * 選定できない場合（consensus 重複・human 複数・ai のみ・空）は null
 * （呼び出し側でエクスポート対象外として計上する）
 */
export function selectFinalAnnotator<T extends AnnotatorTagged>(rows: readonly T[]): T | null {
  const consensus = rows.filter((row) => row.annotatorType === 'consensus');
  if (consensus.length === 1) {
    return consensus[0] as T;
  }
  if (consensus.length > 1) {
    // 呼び出し側（buildStudyWideCsv.ts:35-36 等）は study_id で絞った行を渡すため、
    // consensus 行のキーは study_id × annotator='consensus' に一意化されるはずで、
    // かつリポジトリ層（readStudyDataSheet / readResultsDataRows）がシート側の重複を
    // winner 1 行へ畳んでから返す（§3.2）。よってこの分岐は通常の読み取り経路からは
    // 到達しない防御的な分岐
    return null;
  }
  const humans = rows.filter(
    (row) => row.annotatorType === 'human_with_ai' || row.annotatorType === 'human_independent',
  );
  return humans.length === 1 ? (humans[0] as T) : null;
}
