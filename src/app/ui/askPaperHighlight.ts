// 質問の引用を既存の根拠アンカリングと同じ矩形へ変換する。監査行の追記は行わない。
import type { TextLayerPage } from '../../domain/textLayer';
import type { AnchoredCitation } from '../../features/verification/askPaper';
import {
  buildDocumentHighlights,
  type HighlightOccurrence,
} from '../../features/verification/highlights';
import { t } from '../../lib/i18n';
import type { ViewerHighlight } from './pdfViewer';

export function buildAskPaperHighlight(
  citation: AnchoredCitation,
  pages: readonly TextLayerPage[],
): ViewerHighlight | null {
  if (
    citation.documentId === null ||
    !citation.highlightable ||
    citation.anchorStatus === 'failed' ||
    citation.anchoredPage === null
  )
    return null;
  const id = `ask-paper:${citation.documentId}`;
  // Evidence の構造を矩形計算にだけ流用する。一時引用を抽出結果・データ行へ反映しない。
  const highlight = buildDocumentHighlights(
    citation.documentId,
    [
      {
        evidenceId: id,
        runId: '',
        studyId: '',
        fieldId: id,
        entityKey: '-',
        documentId: citation.documentId,
        value: null,
        notReported: false,
        quote: citation.quote,
        page: citation.anchoredPage,
        confidence: null,
        anchorStatus: citation.anchorStatus,
        bboxPage: null,
        bbox: null,
        relocatedFrom: null,
      },
    ],
    pages,
  )[0];
  if (highlight === undefined) return null;
  return {
    id,
    label: t('askPaper.citationHighlight'),
    kind: 'unverified',
    occurrence: highlight.occurrences[highlight.selectedIndex] as HighlightOccurrence,
  };
}
