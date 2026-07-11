// 追試タスクA用 overlay。run-bbox-blind.ts の出力（outputs/runs-blind/p*.json）を
// outputs/overlays-blind/p*.png へ描画する。座標規約・描画ロジックは overlay.ts と同一。
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const here = path.dirname(fileURLToPath(import.meta.url));
const spikeRoot = path.resolve(here, '..');
const pagesDir = path.join(spikeRoot, 'outputs', 'pages');
const runsDir = path.join(spikeRoot, 'outputs', 'runs-blind');
const overlaysDir = path.join(spikeRoot, 'outputs', 'overlays-blind');

interface BboxRow {
  label: string;
  value: string | null;
  quote: string | null;
  page: number;
  box_2d: number[] | null;
  valueCorrect?: boolean;
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
  ctx.font = 'bold 22px sans-serif';

  let drawn = 0;
  for (const row of runFile.rows) {
    if (!row.box_2d || row.box_2d.length !== 4) continue;
    const [ymin, xmin, ymax, xmax] = row.box_2d as [number, number, number, number];
    const xPx = (xmin / 1000) * image.width;
    const yPx = (ymin / 1000) * image.height;
    const wPx = ((xmax - xmin) / 1000) * image.width;
    const hPx = ((ymax - ymin) / 1000) * image.height;
    // 値の正誤で色分け（緑=正・赤=誤）。目視前にどこが誤答か分かりすぎるのを避けるため
    // 色分けは補助情報にとどめ、box 位置自体の判定はオーケストレータが本文と照合して行う。
    const color = row.valueCorrect === false ? '#ff0000' : '#0a8a3c';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.strokeRect(xPx, yPx, wPx, hPx);
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
    console.error('outputs/runs-blind/p*.json が無い。先に npm run bbox:blind を実行すること');
    process.exit(1);
  }
  for (const file of files.sort()) {
    const raw = await readFile(path.join(runsDir, file), 'utf8');
    const runFile = JSON.parse(raw) as RunFile;
    await overlayForRun(runFile);
  }
}

await main();
