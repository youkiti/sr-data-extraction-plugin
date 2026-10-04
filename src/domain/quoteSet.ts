// セルごとの引用一覧と、人による編集スナップショットの型。
// AI の根拠行を保持したまま、表示する引用を別に管理する。
import type { AnchorStatus } from './anchor';
import type { AnnotatorType } from './annotation';
import type { Confidence, EvidenceBbox } from './evidence';

/** セル × annotator の引用一覧を追記するスナップショットの 1 行。 */
export interface QuoteSetRow {
  setId: string;
  savedAt: string;
  savedBy: string;
  annotator: string;
  annotatorType: AnnotatorType;
  studyId: string;
  fieldId: string;
  entityKey: string;
  schemaVersion: number;
  kind: 'quote' | 'empty' | 'reset';
  seq: number | null;
  quoteId: string | null;
  source: 'ai' | 'human' | null;
  evidenceId: string | null;
  originAnnotator: string | null;
  documentId: string | null;
  quote: string | null;
  page: number | null;
  section: string | null;
  theme: string | null;
  anchorStatus: AnchorStatus | null;
  /** 最初に人が編集した時点の AI の run。 */
  baseRunId: string | null;
}

/** AI と人の引用を共通の形で扱う。 */
export interface CellQuote {
  quoteId: string;
  studyId: string;
  fieldId: string;
  entityKey: string;
  source: 'ai' | 'human';
  evidenceId: string | null;
  originAnnotator: string | null;
  documentId: string | null;
  quote: string;
  page: number | null;
  section: string | null;
  theme: string | null;
  anchorStatus: AnchorStatus | null;
  bboxPage: number | null;
  bbox: EvidenceBbox | null;
  confidence: Confidence | null;
}

/** 表示に使う引用一覧と編集・再抽出の状態。 */
export interface ResolvedCellQuotes {
  quotes: CellQuote[];
  edited: boolean;
  newerAiAvailable: boolean;
  baseRunId: string | null;
}
