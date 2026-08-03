// paperData.mjs（プレーン ESM。実体は同ファイル冒頭コメント参照）の型宣言。
// TypeScript 側（paperContent.ts）がこのファイル経由で paperData.mjs の形を検査できるようにする。
// moduleResolution: "bundler" は `./paperData.mjs` という import 指定子に対して
// `./paperData.d.mts` を探すため、拡張子はこのまま `.d.mts` にすること。

/** value（セル素の値。not_reported なら null）+ sentence（本文の文章。同じく null 可） */
export interface PaperFact {
  value: string | null;
  sentence: string | null;
}

/** 1 群ぶんの事実 */
export interface PaperArmFact {
  key: string;
  name: string;
  n: string;
  nameSentence: string;
  nSentence: string;
  interventionValue: string;
  interventionSentence: string;
}

/** outcome_result の 1 群ぶんの事実 */
export interface PaperOutcomeArmFact {
  armKey: string;
  events: PaperFact;
  meanSd: PaperFact;
  effectSize: PaperFact;
}

export interface PaperOutcomeFact {
  slug: string;
  name: PaperFact;
  timepoint: PaperFact;
  perArm: readonly PaperOutcomeArmFact[];
}

export interface PaperContentFacts {
  country: PaperFact;
  design: PaperFact;
  enrollmentPeriod: PaperFact;
  followupDuration: PaperFact;
  sampleSizeTotal: PaperFact;
  meanAge: PaperFact;
  femalePercent: PaperFact;
  fundingSource: PaperFact;
}

export interface PaperDefinition {
  id: string;
  filename: string;
  title: string;
  journal: string;
  authors: string;
  year: number;
  volumeInfo: string;
  doi: string;
  disclaimerJa: string;
  abstract: string;
  facts: PaperContentFacts;
  arms: readonly PaperArmFact[];
  outcome: PaperOutcomeFact;
}

export declare const PAPER1: PaperDefinition;
export declare const PAPER2: PaperDefinition;
export declare const PAPER3: PaperDefinition;
export declare const PAPERS: readonly PaperDefinition[];

export declare const DISCUSSION_TEXT: string;
export declare const CONCLUSION_TEXT: string;
export declare function referenceEntry(paper: PaperDefinition): string;
