// Google Drive MCP の download_file_content が保存する tool-results JSON（{content: base64,...}）を
// base64 デコードして raw/ 配下のバイナリ（xlsx / pdf）に復元するユーティリティ。
//
// 使い方: tsx src/decodeDownload.ts <入力 tool-results JSON> <出力ファイル>
//   例: tsx src/decodeDownload.ts "downloads/content.json" raw/data.xlsx
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function main(): Promise<void> {
  const [, , inPath, outPath] = process.argv;
  if (!inPath || !outPath) {
    console.error('使い方: tsx src/decodeDownload.ts <tool-results JSON> <出力ファイル>');
    process.exitCode = 1;
    return;
  }
  const rawJson = await readFile(inPath, 'utf8');
  const parsed = JSON.parse(rawJson) as { content: string; mimeType?: string; title?: string };
  if (typeof parsed.content !== 'string') {
    throw new Error('入力 JSON に content（base64）がありません');
  }
  const bytes = Buffer.from(parsed.content, 'base64');
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, bytes);
  console.log(`decoded ${bytes.length} bytes -> ${outPath}（title=${parsed.title ?? 'n/a'} mime=${parsed.mimeType ?? 'n/a'}）`);
}

await main();
