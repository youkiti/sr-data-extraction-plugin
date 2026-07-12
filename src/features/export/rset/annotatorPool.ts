// study 内の ResultsData 行から distinct な (annotator, annotator_type) 集合を取り出す。
// buildResultsLongCsv.ts と同じ考え方だが、finalAnnotator.ts 自体は変更しない方針のため
// R セット側で小さく複製する（既存の確定 annotator 選定ロジック selectFinalAnnotator は不変更で再利用する）
import type { AnnotatorTagged } from '../finalAnnotator';

/** 複合キーの区切り。NUL は annotator（email）等の値に現れない（buildAuditCsv.ts と同じ規約） */
const SEP = String.fromCharCode(0);

export function distinctAnnotators<T extends AnnotatorTagged>(rows: readonly T[]): AnnotatorTagged[] {
  const seen = new Map<string, AnnotatorTagged>();
  for (const row of rows) {
    const key = `${row.annotator}${SEP}${row.annotatorType}`;
    if (!seen.has(key)) {
      seen.set(key, { annotator: row.annotator, annotatorType: row.annotatorType });
    }
  }
  return [...seen.values()];
}
