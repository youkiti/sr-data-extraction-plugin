// ステップ 3: run-bbox の box_2d を対応ページ PNG へ描画し、目視判定用の overlay を作る。
// 座標規約は PLAN.md ステップ2 の実測確認結果に基づく: box_2d = [ymin, xmin, ymax, xmax]（0-1000 正規化）。
// x_px = xmin/1000 * 幅px, y_px = ymin/1000 * 高さpx（画像原点は左上）。
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const here = path.dirname(fileURLToPath(import.meta.url));
const spikeRoot = path.resolve(here, '..');
const pagesDir = path.join(spikeRoot, 'outputs', 'pages');
const runsDir = path.join(spikeRoot, 'outputs', 'runs');
const overlaysDir = path.join(spikeRoot, 'outputs', 'overlays');

interface BboxRow {
  label: string;
  value: string | null;
  quote: string | null;
  page: number;
  box_2d: number[] | null;
}

interface RunFile {
  runId: string;
  page: number;
  rows: BboxRow[];
}

async function overlayForRun(runFile: RunFile): Promise<void> {
  const pngPath = path.join(pagesDir, `p${runFile.page}.png`);
  const image = await loadImage(await readFile(pngPath));
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);

  ctx.lineWidth = 4;
  ctx.strokeStyle = '#ff0000';
  ctx.fillStyle = '#ff0000';
  ctx.font = 'bold 22px sans-serif';

  let drawn = 0;
  for (const row of runFile.rows) {
    if (!row.box_2d || row.box_2d.length !== 4) continue;
    const [ymin, xmin, ymax, xmax] = row.box_2d as [number, number, number, number];
    const xPx = (xmin / 1000) * image.width;
    const yPx = (ymin / 1000) * image.height;
    const wPx = ((xmax - xmin) / 1000) * image.width;
    const hPx = ((ymax - ymin) / 1000) * image.height;
    ctx.strokeRect(xPx, yPx, wPx, hPx);
    // ラベルは box の少し上（はみ出す場合は内側上部）に描く
    const labelY = yPx > 24 ? yPx - 6 : yPx + 20;
    ctx.fillText(row.label, xPx, labelY);
    drawn++;
  }

  const outPath = path.join(overlaysDir, `${runFile.runId}.png`);
  await writeFile(outPath, canvas.toBuffer('image/png'));
  console.log(`${runFile.runId}: box ${drawn}/${runFile.rows.length} 描画 -> ${path.relative(spikeRoot, outPath)}`);
}

async function main(): Promise<void> {
  await mkdir(overlaysDir, { recursive: true });
  const files = (await readdir(runsDir)).filter((f) => /^p\d+\.json$/.test(f));
  if (files.length === 0) {
    console.error('outputs/runs/p*.json が無い。先に npm run bbox を実行すること');
    process.exit(1);
  }
  for (const file of files.sort()) {
    const raw = await readFile(path.join(runsDir, file), 'utf8');
    const runFile = JSON.parse(raw) as RunFile;
    await overlayForRun(runFile);
  }
}

await main();
