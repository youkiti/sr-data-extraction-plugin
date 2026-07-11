// ステップ4-5: run-bbox の結果を集計し、目視判定（REPORT.md 記載）を補助する JSON を作る。
// 各行の box_2d を pt 単位・正規化寸法の両方で書き出す（REPORT.md の座標写像式の検算用）。
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const spikeRoot = path.resolve(here, '..');
const pagesDir = path.join(spikeRoot, 'outputs', 'pages');
const runsDir = path.join(spikeRoot, 'outputs', 'runs');

interface PageDims {
  page: number;
  widthPt: number;
  heightPt: number;
  rotation: number;
}

interface BboxRow {
  label: string;
  value: string | null;
  quote: string | null;
  page: number;
  box_2d: number[] | null;
  boxRecovered?: boolean;
  rawBox2d?: unknown;
}

interface RunFile {
  runId: string;
  page: number;
  usageMetadata: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } | null;
  elapsedMs: number;
  discardedRowCount: number;
  rows: BboxRow[];
}

async function main(): Promise<void> {
  const dimsRaw = JSON.parse(await readFile(path.join(pagesDir, 'dims.json'), 'utf8')) as {
    pages: PageDims[];
  };
  const dimsByPage = new Map(dimsRaw.pages.map((d) => [d.page, d]));

  const files = (await readdir(runsDir)).filter((f) => /^p\d+\.json$/.test(f));
  const summary: unknown[] = [];
  let totalTokens = 0;
  let totalElapsedMs = 0;

  for (const file of files.sort()) {
    const runFile = JSON.parse(await readFile(path.join(runsDir, file), 'utf8')) as RunFile;
    const dims = dimsByPage.get(runFile.page);
    totalTokens += runFile.usageMetadata?.totalTokenCount ?? 0;
    totalElapsedMs += runFile.elapsedMs;

    for (const row of runFile.rows) {
      const hasBox = !!row.box_2d && row.box_2d.length === 4;
      const [ymin, xmin, ymax, xmax] = hasBox ? (row.box_2d as number[]) : [null, null, null, null];
      summary.push({
        page: runFile.page,
        label: row.label,
        value: row.value,
        hasBox,
        boxRecovered: row.boxRecovered ?? false,
        box_2d_normalized: row.box_2d,
        box_pt:
          hasBox && dims
            ? {
                x: ((xmin as number) / 1000) * dims.widthPt,
                y: dims.heightPt * (1 - (ymax as number) / 1000),
                width: (((xmax as number) - (xmin as number)) / 1000) * dims.widthPt,
                height: (((ymax as number) - (ymin as number)) / 1000) * dims.heightPt,
              }
            : null,
      });
    }
  }

  const outPath = path.join(spikeRoot, 'outputs', 'report-summary.json');
  await writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        runCount: files.length,
        totalTokens,
        totalElapsedMs,
        items: summary,
      },
      null,
      1,
    ),
    'utf8',
  );
  console.log(`report-summary.json 保存 -> ${path.relative(spikeRoot, outPath)}`);
  console.log(`total tokens: ${totalTokens}, total elapsed: ${totalElapsedMs}ms, items: ${summary.length}`);
}

await main();
