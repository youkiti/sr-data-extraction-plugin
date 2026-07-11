// 追試タスクB: 回転ページの座標写像を実測で決着させる。
// p5（実ファイルではページ回転0）を pdfjs の `getViewport({ scale, rotation: 90 })` で
// 90度回転させて描画し、/Rotate 90 の実ページが Gemini に見せる「表示フレーム」を再現する。
// その回転画像を Gemini に送って既知セル（item1_percent=98）の box_2d を取得し、
// 案(i) 表示フレームへ直接 / 案(ii) UserSpaceRect→toDisplayRect(90度) 素通し、の
// 2通りで画素座標を計算して同一画像へ重ね描きし、どちらが正しい位置に乗るかを目視できるようにする。
//
// 案(ii) の toDisplayRect ロジックは src/lib/pdf/viewportRect.ts の 90度分岐を
// このファイル内に複製したもの（拡張本体は読むだけで変更しない）:
//   case 90: return { left: rect.y, top: rect.x, width: rect.height, height: rect.width };
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createCanvas, loadImage } from '@napi-rs/canvas';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- legacy ビルドは型解決が effective でないため
import { getDocument, version as pdfjsVersion } from 'pdfjs-dist/legacy/build/pdf.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const spikeRoot = path.resolve(here, '..');
const repoRoot = path.resolve(spikeRoot, '../..');
dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });

const MODEL = 'gemini-3.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const apiKey = process.env['GEMINI_API_KEY'];
if (!apiKey) {
  console.error('GEMINI_API_KEY がリポジトリルートの .env にありません');
  process.exit(1);
}

const pdfPath = path.join(spikeRoot, 'inputs', '07.pdf');
const outDir = path.join(spikeRoot, 'outputs', 'rotate-check');
const pdfjsRoot = path.resolve(spikeRoot, 'node_modules', 'pdfjs-dist');
const wasmUrl = path.join(pdfjsRoot, 'wasm').replace(/\\/g, '/') + '/';
const cMapUrl = path.join(pdfjsRoot, 'cmaps').replace(/\\/g, '/') + '/';
const standardFontDataUrl = path.join(pdfjsRoot, 'standard_fonts').replace(/\\/g, '/') + '/';

const TARGET_PAGE = 5;
const RENDER_SCALE = 2.0;
const ROTATION = 90;

// 既知セル（gold）。案(i)/案(ii) の当たり判定を目視するための対象で、値そのものはプロンプトに渡してよい
// （本タスクは座標写像の幾何を見るのが目的で、値の未知性はタスクAで別途検証済み）。
const KNOWN_ITEM = {
  label: 'item1_percent',
  description:
    'Table 2 の Item No. 1「Allowing families to hold their dying or dead infant」行の % 列の値（98）',
};

interface UserSpaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface DisplayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** src/lib/pdf/viewportRect.ts の toDisplayRect 90度分岐をこのスクリプト内に複製したもの */
function toDisplayRect90(rect: UserSpaceRect): DisplayRect {
  return { left: rect.y, top: rect.x, width: rect.height, height: rect.width };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function callGemini(parts: unknown[]): Promise<{ responseJson: unknown; elapsedMs: number }> {
  const RESPONSE_SCHEMA = {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        label: { type: 'STRING' },
        value: { type: 'STRING' },
        quote: { type: 'STRING' },
        box_2d: { type: 'ARRAY', items: { type: 'INTEGER' } },
      },
      required: ['label', 'value', 'quote', 'box_2d'],
    },
  } as const;
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };
  for (let attempt = 1; ; attempt++) {
    const t0 = Date.now();
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey as string },
      body: JSON.stringify(body),
    });
    const elapsedMs = Date.now() - t0;
    const text = await res.text();
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 3) throw new Error(`Gemini ${res.status}（リトライ上限）: ${text.slice(0, 300)}`);
      const wait = 5000 * attempt;
      console.warn(`  ${res.status} -> ${wait}ms 待って再試行`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${text.slice(0, 500)}`);
    return { responseJson: JSON.parse(text), elapsedMs };
  }
}

function extractResponseText(responseJson: unknown): string {
  const r = responseJson as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  };
  const cand = r.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new Error(`応答にテキストがない（finishReason=${cand?.finishReason}）`);
  return text;
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });

  const data = new Uint8Array(await readFile(pdfPath));
  const loadingTask = getDocument({
    data,
    useSystemFonts: true,
    wasmUrl,
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl,
  });
  const doc = await loadingTask.promise;
  const page = await doc.getPage(TARGET_PAGE);

  // 未回転の pt 寸法（W_pt/H_pt）。回転0ページとしての本来の viewport
  const baseViewport = page.getViewport({ scale: 1.0 });
  const W_pt = baseViewport.width;
  const H_pt = baseViewport.height;
  console.log(`p${TARGET_PAGE} 未回転 pt 寸法: W_pt=${W_pt} H_pt=${H_pt} rotation(本来)=${baseViewport.rotation}`);

  // 90度回転させた描画フレーム（/Rotate 90 ページの見た目を再現）
  const rotViewport = page.getViewport({ scale: RENDER_SCALE, rotation: ROTATION });
  const W_disp = rotViewport.width;
  const H_disp = rotViewport.height;
  console.log(`回転${ROTATION}度 描画フレーム: W_disp=${W_disp}px H_disp=${H_disp}px (scale=${RENDER_SCALE})`);

  const canvas = createCanvas(W_disp, H_disp);
  await page.render({ canvas, viewport: rotViewport } as unknown as Parameters<typeof page.render>[0]).promise;
  const rotatedPngPath = path.join(outDir, `p${TARGET_PAGE}-rot${ROTATION}.png`);
  await writeFile(rotatedPngPath, canvas.toBuffer('image/png'));
  console.log(`回転画像保存 -> ${path.relative(spikeRoot, rotatedPngPath)}`);
  page.cleanup();
  await loadingTask.destroy();

  // Gemini へ回転画像を送り、既知セルの box_2d を取得
  const promptText = `あなたはこの画像（論文ページを90度回転させて表示したもの）から、指定された項目が書かれている領域を bounding box として返すタスクを行う。

box_2d の形式は [ymin, xmin, ymax, xmax] とする。画像の左上を原点 (0,0) とし、各座標はこの画像自体の高さ・幅に対して 0〜1000 に正規化した整数値で表す（ymin/ymax が縦方向、xmin/xmax が横方向。画像がテキストに対して回転して見えることは考慮せず、あくまで見えている画像そのものの座標系で答えること）。

項目:
- label="${KNOWN_ITEM.label}": ${KNOWN_ITEM.description}

次のフィールドを持つ JSON オブジェクト1つを配列で返すこと:
- "label": 上記の label をそのまま
- "value": 読み取った値
- "quote": box内に実際に見える文言
- "box_2d": [ymin, xmin, ymax, xmax]

出力は上記オブジェクトの配列のみ。`;

  const pngBytes = await readFile(rotatedPngPath);
  const parts = [
    { text: promptText },
    { inline_data: { mime_type: 'image/png', data: pngBytes.toString('base64') } },
  ];
  const result = await callGemini(parts);
  const responseText = extractResponseText(result.responseJson);
  const parsed = JSON.parse(responseText) as Array<{
    label: string;
    value: string;
    quote: string;
    box_2d: number[];
  }>;
  const row = parsed.find((r) => r.label === KNOWN_ITEM.label);
  if (!row) throw new Error(`応答に ${KNOWN_ITEM.label} が無い: ${responseText}`);
  const box2d = row.box_2d;
  console.log(`Gemini box_2d (回転画像上, 0-1000正規化): ${JSON.stringify(box2d)} value=${row.value} quote=${row.quote}`);
  if (!Array.isArray(box2d) || box2d.length !== 4) {
    throw new Error(`box_2d が4要素でない: ${JSON.stringify(box2d)}`);
  }
  const [ymin, xmin, ymax, xmax] = box2d as [number, number, number, number];

  // 案(i): 表示フレームへ直接（toDisplayRect を通さない）
  const rectDirectPx = {
    left: (xmin / 1000) * W_disp,
    top: (ymin / 1000) * H_disp,
    width: ((xmax - xmin) / 1000) * W_disp,
    height: ((ymax - ymin) / 1000) * H_disp,
  };

  // 案(ii): UserSpaceRect(未回転 W_pt/H_pt 基準) -> toDisplayRect(90度) 素通し
  // PLAN.md §6 の式で box_2d を「未回転ユーザー空間」の矩形とみなして UserSpaceRect を作る
  // （これが二重回転を疑われている箇所: box_2d は実際には回転後の表示フレーム座標なのに
  //   未回転フレーム基準として扱ってしまっている）
  const userSpaceRect: UserSpaceRect = {
    x: (xmin / 1000) * W_pt,
    width: ((xmax - xmin) / 1000) * W_pt,
    y: H_pt * (1 - ymax / 1000),
    height: ((ymax - ymin) / 1000) * H_pt,
  };
  const rectViaToDisplay = toDisplayRect90(userSpaceRect); // pt単位・「回転後フレーム」想定(拡張=H_pt, 高さ=W_pt)
  // 回転後フレームの pt 寸法は (H_pt, W_pt) なので、実際に描画した画素寸法 (W_disp, H_disp) への
  // スケール係数は W_disp/H_pt, H_disp/W_pt になる
  const scaleX = W_disp / H_pt;
  const scaleY = H_disp / W_pt;
  const rectViaToDisplayPx = {
    left: rectViaToDisplay.left * scaleX,
    top: rectViaToDisplay.top * scaleY,
    width: rectViaToDisplay.width * scaleX,
    height: rectViaToDisplay.height * scaleY,
  };

  console.log('案(i) 表示フレームへ直接 (px):', rectDirectPx);
  console.log('案(ii) UserSpaceRect->toDisplayRect(90) 素通し (px):', rectViaToDisplayPx);

  // overlay: 両案を同一の回転画像に重ね描き（案(i)=緑・案(ii)=赤）
  const image = await loadImage(pngBytes);
  const overlayCanvas = createCanvas(image.width, image.height);
  const ctx = overlayCanvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  ctx.lineWidth = 5;
  ctx.font = 'bold 26px sans-serif';

  ctx.strokeStyle = '#0a8a3c';
  ctx.fillStyle = '#0a8a3c';
  ctx.strokeRect(rectDirectPx.left, rectDirectPx.top, rectDirectPx.width, rectDirectPx.height);
  ctx.fillText('(i) direct', rectDirectPx.left, Math.max(rectDirectPx.top - 8, 24));

  ctx.strokeStyle = '#e00000';
  ctx.fillStyle = '#e00000';
  ctx.strokeRect(rectViaToDisplayPx.left, rectViaToDisplayPx.top, rectViaToDisplayPx.width, rectViaToDisplayPx.height);
  ctx.fillText('(ii) toDisplayRect', rectViaToDisplayPx.left, Math.min(rectViaToDisplayPx.top + rectViaToDisplayPx.height + 26, image.height - 6));

  const overlayPath = path.join(outDir, 'overlay-both.png');
  await writeFile(overlayPath, overlayCanvas.toBuffer('image/png'));
  console.log(`overlay(両案重ね描き)保存 -> ${path.relative(spikeRoot, overlayPath)}`);

  // 個別の overlay も保存（単独確認用）
  for (const [suffix, rect, color] of [
    ['direct', rectDirectPx, '#0a8a3c'],
    ['viewportrect', rectViaToDisplayPx, '#e00000'],
  ] as const) {
    const c = createCanvas(image.width, image.height);
    const cx = c.getContext('2d');
    cx.drawImage(image, 0, 0);
    cx.lineWidth = 5;
    cx.strokeStyle = color;
    cx.fillStyle = color;
    cx.font = 'bold 26px sans-serif';
    cx.strokeRect(rect.left, rect.top, rect.width, rect.height);
    cx.fillText(suffix, rect.left, Math.max(rect.top - 8, 24));
    const p = path.join(outDir, `overlay-${suffix}.png`);
    await writeFile(p, c.toBuffer('image/png'));
    console.log(`overlay(単独: ${suffix})保存 -> ${path.relative(spikeRoot, p)}`);
  }

  const resultJson = {
    pdfjsVersion,
    page: TARGET_PAGE,
    rotationApplied: ROTATION,
    renderScale: RENDER_SCALE,
    unrotatedPtDims: { W_pt, H_pt },
    rotatedDisplayPxDims: { W_disp, H_disp },
    geminiItem: KNOWN_ITEM,
    geminiBox2dNormalized: box2d,
    geminiValue: row.value,
    geminiQuote: row.quote,
    candidateI_direct: { formula: 'left=xmin/1000*W_disp, top=ymin/1000*H_disp (toDisplayRectを通さない)', rectPx: rectDirectPx },
    candidateII_viewportRect: {
      formula: 'UserSpaceRect(box_2dを未回転W_pt/H_pt基準とみなす) -> toDisplayRect(rotation=90) -> スケール変換',
      userSpaceRectPt: userSpaceRect,
      displayRectPt_beforeScale: rectViaToDisplay,
      scale: { scaleX, scaleY },
      rectPx: rectViaToDisplayPx,
    },
    elapsedMs: result.elapsedMs,
    note: 'API キーは x-goog-api-key ヘッダで送信（本ファイルには含めていない）。判定（どちらが命中か）はオーケストレータが overlay-both.png を目視して行う',
  };
  await writeFile(path.join(outDir, 'result.json'), JSON.stringify(resultJson, null, 1), 'utf8');
  console.log(`result.json 保存 -> ${path.relative(spikeRoot, path.join(outDir, 'result.json'))}`);
}

await main();
