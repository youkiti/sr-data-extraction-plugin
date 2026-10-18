export interface GoldBlockRow {
  paper: string;
  block: string;
}

/** 論文ごとに最初の三つ組に属する行だけを採用する。 */
export function selectGoldBlocks(rows: readonly GoldBlockRow[]): boolean[] {
  const first = new Map<string, string>();
  return rows.map(({ paper, block }) => {
    if (!first.has(paper)) first.set(paper, block);
    return first.get(paper) === block;
  });
}
