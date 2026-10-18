// xlsx の生グリッド構造を把握するためのダンプ。convertGold.ts を書く前に、
// 人手 gold ブロック（列位置）・論文行・変数列の並びを目視確認する。
//
// 使い方: tsx src/inspectXlsx.ts <xlsx パス> [出力 TSV パス] [最大行数]
//   出力 TSV は「R{行}\tC{列}\t値」形式の非空セル列挙 + シート概要。
import { readFile, writeFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';

async function main(): Promise<void> {
  const [, , xlsxPath, outPath, maxRowsArg] = process.argv;
  if (!xlsxPath) {
    console.error('使い方: tsx src/inspectXlsx.ts <xlsx パス> [出力 TSV] [最大行数]');
    process.exitCode = 1;
    return;
  }
  const maxRows = maxRowsArg ? Number(maxRowsArg) : 60;
  const buf = await readFile(xlsxPath);
  const wb = XLSX.read(buf, { type: 'buffer' });

  const lines: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (ws === undefined) continue;
    const ref = ws['!ref'];
    if (!ref) {
      lines.push(`# シート「${sheetName}」: 空`);
      continue;
    }
    const range = XLSX.utils.decode_range(ref);
    lines.push(
      `# シート「${sheetName}」: 行 ${range.s.r}..${range.e.r}（${range.e.r - range.s.r + 1}）` +
        ` 列 ${range.s.c}..${range.e.c}（${range.e.c - range.s.c + 1}）`,
    );
    const rowEnd = Math.min(range.e.r, range.s.r + maxRows - 1);
    for (let r = range.s.r; r <= rowEnd; r++) {
      const cells: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== '') {
          cells.push(`C${c}=${String(cell.v).replace(/\s+/g, ' ').slice(0, 60)}`);
        }
      }
      if (cells.length > 0) lines.push(`R${r}\t${cells.join(' | ')}`);
    }
    lines.push('');
  }

  const out = lines.join('\n');
  if (outPath) {
    await writeFile(outPath, out, 'utf8');
    console.log(`wrote ${lines.length} lines -> ${outPath}`);
  } else {
    console.log(out);
  }
}

await main();
