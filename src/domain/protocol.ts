// Protocol タブに対応する型。sr-query-builder のスキーマをそのまま流用する
// （requirements.md §3.2。ProtocolBlocks タブは本拡張では持たない）

export type FrameworkType = 'pico' | 'peco' | 'pcc' | 'spider' | 'custom' | null;
export type ProtocolSourceType = 'manual' | 'markdown' | 'docx';

export interface Protocol {
  version: number;
  frameworkType: FrameworkType;
  researchQuestion: string;
  inclusionCriteria: string | null;
  exclusionCriteria: string | null;
  studyDesign: string | null;
  /** sr-query-builder の検索式ブロック数。タブ流用のため列として保持する（本拡張では未使用） */
  blockCount: number;
  /** 同上（本拡張では未使用） */
  combinationExpression: string;
  sourceType: ProtocolSourceType;
  sourceFilename: string | null;
  rawTextRef: string | null;
  rawTextPreview: string | null;
  rawTextInline: string | null;
  createdAt: string;
  createdBy: string;
}
