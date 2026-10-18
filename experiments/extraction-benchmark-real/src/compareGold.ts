// gold/LLM 行の同定用の使い捨てスクリプト。
// 2 つの手法別 analysis xlsx を読み、各 arm の triplet（データ行A・データ行B・突合行）のうち、
// ファイル間で「不変な行」= 人手 gold、「変化する行」= LLM 出力 を判定する。
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';

const COLS = 64;

function loadGrid(buf: Buffer): string[][] {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]!]!;
  const range = XLSX.utils.decode_range(ws['!ref']!);
  const grid: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = 0; c < COLS; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      row.push(cell && cell.v !== undefined && cell.v !== null ? String(cell.v) : '');
    }
    grid.push(row);
  }
  return grid;
}

/** 非空行のインデックスを、triplet（3 連続の非空行）にまとめる */
function tripletStarts(grid: string[][]): number[] {
  const starts: number[] = [];
  for (let r = 1; r < grid.length; r++) {
    const paper = grid[r]![4]; // C4 = paper_name
    if (paper && paper.trim() !== '') starts.push(r);
  }
  return starts;
}

function rowSig(grid: string[][], r: number): string {
  // C6..C63（データ値列）を連結。C0-C5 は run メタ/arm 名なので除外
  return grid[r]!.slice(6).join('|');
}

async function main(): Promise<void> {
  const a = loadGrid(await readFile('raw/dataset1_conventional_n-shot.xlsx'));
  const b = loadGrid(await readFile('raw/dataset1_one-by-one.xlsx'));

  const starts = tripletStarts(a).slice(0, 8);
  for (const r of starts) {
    const paper = a[r]![4];
    const arm = a[r]![5];
    // 行A = r（メタ付き）, 行B = r+1
    const a_rowA = rowSig(a, r);
    const a_rowB = rowSig(a, r + 1);
    const b_rowA = rowSig(b, r);
    const b_rowB = rowSig(b, r + 1);
    const rowASame = a_rowA === b_rowA;
    const rowBSame = a_rowB === b_rowB;
    console.log(`R${r} ${paper} / ${arm}`);
    console.log(`  行A(メタ付き) file間一致=${rowASame}`);
    console.log(`  行B          file間一致=${rowBSame}`);
    console.log(`  → 不変(=gold候補): ${rowASame && !rowBSame ? '行A' : rowBSame && !rowASame ? '行B' : rowASame && rowBSame ? '両方一致(要精査)' : '両方相違(要精査)'}`);
  }
}

await main();
