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
    return null; // 同一キーの重複行はバリデーション違反（§3.2）
  }
  const humans = rows.filter(
    (row) => row.annotatorType === 'human_with_ai' || row.annotatorType === 'human_independent',
  );
  return humans.length === 1 ? (humans[0] as T) : null;
}
