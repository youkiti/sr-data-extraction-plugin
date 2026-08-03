#!/usr/bin/env node
// デモビルド（dist-demo/）用の架空デモ論文フィクスチャを組み立てる。
//
// 手順:
//   1. src/demo/paperData.mjs（唯一の正典。理由は同ファイル冒頭コメント参照）から
//      各論文の HTML（video/fixtures/demo-paper-0N.html。コミット対象）を生成する。
//      本文の文章は paperData.mjs の文字列をそのまま埋め込むだけで、ここで新しい文章は作らない。
//   2. Playwright の page.pdf() で HTML → PDF（video/fixtures/demo-paper-0N.pdf。
//      .gitignore 済み。ネットワーク不要・実行環境内で完結する）に変換する。
//      PDF は生成済みならスキップする（冪等）。--force で強制再生成する。
//
// 使い方:
//   node video/fixtures/build-fixtures.mjs [--force]
//   npm run video:fixtures -- --force
//
// 実装は tiab-review-plugin/video/fixtures/demo-paper.html（手書き HTML → Chromium
// --print-to-pdf）の方式を踏襲しつつ、本リポジトリは HTML 自体も自動生成にして
// 「本文の文章を 2 箇所で別々にタイプしない」構造にしている（brief の指示）。

import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PAPERS, DISCUSSION_TEXT, CONCLUSION_TEXT, referenceEntry } from '../../src/demo/paperData.mjs';
import { resolveChromiumExecutable } from '../scripts/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FORCE = process.argv.includes('--force');

// ============================================================================
// HTML レンダリング（tiab-review-plugin/video/fixtures/demo-paper.html のスタイルを踏襲）
// ============================================================================

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** <p>...</p> を 1 個だけ出す（null は空文字扱い＝呼び出し側で filter 済み前提） */
function p(text) {
  return `<p>${escapeHtml(text)}</p>`;
}

function renderTable(headers, rows) {
  const thead = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;
  const tbody = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}

/** Table 1（背景特性）。年齢・女性割合は本デモの facts モデルでは群別データを持たないため
 * 全体値として脚注つきで示す（過剰な作り込みを避け、facts の唯一の正典性を保つため） */
function renderBaselineTable(paper) {
  const headers = ['Characteristic', ...paper.arms.map((a) => a.name), 'Total'];
  const rows = [
    ['No. randomized', ...paper.arms.map((a) => a.n), paper.facts.sampleSizeTotal.value],
    ['Mean age, years*', ...paper.arms.map(() => '–'), paper.facts.meanAge.value],
    ['Female sex, %*', ...paper.arms.map(() => '–'), paper.facts.femalePercent.value],
  ];
  return (
    '<h3>Table 1. Baseline characteristics</h3>' +
    renderTable(headers, rows) +
    '<p class="table-footnote">*Reported for the overall cohort only.</p>'
  );
}

/** アウトカム表。events / meanSd / effectSize のうち、いずれかの群で値がある行だけ出す */
function renderOutcomeTable(paper) {
  const headers = ['Outcome measure', ...paper.arms.map((a) => a.name)];
  const rows = [];
  if (paper.outcome.perArm.some((a) => a.events.value !== null)) {
    rows.push([
      'Events, n/N',
      ...paper.outcome.perArm.map((a) => a.events.value ?? '–'),
    ]);
  }
  if (paper.outcome.perArm.some((a) => a.meanSd.value !== null)) {
    rows.push([
      'Mean (SD)',
      ...paper.outcome.perArm.map((a) => a.meanSd.value ?? '–'),
    ]);
  }
  rows.push([
    'Effect size vs. comparator',
    ...paper.outcome.perArm.map((a) => a.effectSize.value ?? '–'),
  ]);
  return `<h3>Table 2. ${escapeHtml(paper.outcome.name.value)}</h3>${renderTable(headers, rows)}`;
}

/**
 * ページ分割は src/demo/paperContent.ts の buildPageTexts と 1 対 1 で対応させている
 * （P1〜P5。P6 は Discussion 等で quote の出所にならないため両ファイルとも未使用）。
 * ここを変える場合は両方合わせて直すこと
 */
function renderPages(paper) {
  const firstTwoArmsNameN = paper.arms
    .slice(0, 2)
    .map((a) => `${p(a.nameSentence)}${p(a.nSentence)}`)
    .join('');
  const restArmsNameN = paper.arms
    .slice(2)
    .map((a) => `${p(a.nameSentence)}${p(a.nSentence)}`)
    .join('');
  const armInterventions = paper.arms.map((a) => p(a.interventionSentence)).join('');
  const outcomeSentences = (key) =>
    paper.outcome.perArm
      .map((a) => a[key].sentence)
      .filter((s) => s !== null)
      .map(p)
      .join('');

  const pages = [
    // P1: Title / journal meta / disclaimer / Abstract / Introduction
    `<h1>${escapeHtml(paper.title)}</h1>
<div class="authors">${escapeHtml(paper.authors)}</div>
<div class="journal-meta">${escapeHtml(paper.volumeInfo)} &middot; doi:${escapeHtml(paper.doi)}</div>
<div class="disclaimer">${escapeHtml(paper.disclaimerJa)}</div>
<div class="abstract"><h3 style="margin-top:0;">Abstract</h3>${p(paper.abstract)}</div>
<h2>1. Introduction</h2>
${p(paper.facts.country.sentence)}
${p(paper.facts.design.sentence)}`,
    // P2: Methods（登録・追跡・症例数 + 先頭 2 群の名称・N）
    `<h2>2. Methods</h2>
${p(paper.facts.enrollmentPeriod.sentence)}
${p(paper.facts.followupDuration.sentence)}
${p(paper.facts.sampleSizeTotal.sentence)}
${firstTwoArmsNameN}`,
    // P3: Methods 続き（3 群目以降の名称・N + 全群の介入内容）
    `${restArmsNameN}
${armInterventions}`,
    // P4: 年齢・性別 + Table 1 + Outcomes 定義
    `${p(paper.facts.meanAge.sentence)}
${p(paper.facts.femalePercent.sentence)}
${renderBaselineTable(paper)}
<h2>3. Outcomes</h2>
${p(paper.outcome.name.sentence)}
${p(paper.outcome.timepoint.sentence)}`,
    // P5: Results（アウトカム値・効果量）+ アウトカム表
    `<h2>4. Results</h2>
${outcomeSentences('events')}
${outcomeSentences('meanSd')}
${outcomeSentences('effectSize')}
${renderOutcomeTable(paper)}`,
    // P6: Discussion / Conclusion / References（quote の出所にはならないflavor文。
    // paperData.mjs の DISCUSSION_TEXT / CONCLUSION_TEXT / referenceEntry を
    // paperContent.ts の PAGE_TEXTS ページ 6 と共有する）
    `<h2>5. Discussion</h2>
${p(DISCUSSION_TEXT)}
<h2>6. Conclusion</h2>
${p(CONCLUSION_TEXT)}
<h2>References</h2>
<ol class="refs">
<li>${escapeHtml(referenceEntry(paper))}</li>
</ol>
<div class="footnote">${escapeHtml(paper.disclaimerJa)} / This PDF is a synthetic fixture generated for the SR Data Extraction Plugin demo build and does not represent a real publication.</div>`,
  ];

  return pages.map((body, i) => {
    const isLast = i === pages.length - 1;
    return `<div class="page"${isLast ? '' : ' style="page-break-after: always;"'}>${body}</div>`;
  });
}

function renderPaperHtml(paper) {
  const pagesHtml = renderPages(paper).join('\n');
  return `<!--
    デモ用フルテキスト PDF のソース HTML（架空のサンプル論文。実在の研究ではない）。
    本ファイルは video/fixtures/build-fixtures.mjs が src/demo/paperData.mjs から
    自動生成する。手で編集しても次回実行時に上書きされるため、内容を変える場合は
    paperData.mjs 側を直すこと（このリポジトリでの「単一の正典」の置き場所）。

    再生成コマンド:
      node video/fixtures/build-fixtures.mjs [--force]
-->
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(paper.title)}</title>
<style>
    @page { size: A4; margin: 20mm 18mm; }
    body {
        font-family: Georgia, "Times New Roman", serif;
        font-size: 10.5pt;
        line-height: 1.5;
        color: #111;
        margin: 0;
    }
    h1 { font-size: 14pt; line-height: 1.35; margin: 0 0 4pt 0; }
    .journal-meta { font-size: 9pt; color: #555; margin-bottom: 8pt; }
    .authors { font-size: 10pt; margin-bottom: 2pt; }
    .disclaimer {
        font-size: 9pt;
        font-style: italic;
        color: #7a4a00;
        background: #fff6e6;
        border: 1px solid #e0b871;
        border-radius: 3px;
        padding: 6pt 8pt;
        margin-bottom: 12pt;
    }
    h2 { font-size: 12pt; margin: 14pt 0 6pt 0; border-bottom: 1px solid #ccc; padding-bottom: 2pt; }
    h3 { font-size: 10.5pt; margin: 10pt 0 4pt 0; }
    p { margin: 0 0 7pt 0; text-align: justify; }
    .abstract { background: #f7f7f7; padding: 8pt 10pt; border-left: 3px solid #888; margin-bottom: 10pt; }
    table { width: 100%; border-collapse: collapse; margin: 6pt 0 4pt 0; font-size: 9.5pt; }
    th, td { border: 1px solid #999; padding: 3pt 5pt; text-align: left; }
    .table-footnote { font-size: 8pt; color: #666; margin-top: 2pt; }
    .refs li { font-size: 9pt; margin-bottom: 3pt; }
    .footnote { font-size: 8pt; color: #666; margin-top: 16pt; border-top: 1px solid #ccc; padding-top: 6pt; }
    .page { }
</style>
</head>
<body>
${pagesHtml}
</body>
</html>
`;
}

// ============================================================================
// メイン処理
// ============================================================================

async function main() {
  console.log(`デモ論文フィクスチャを生成します（対象: ${PAPERS.length} 件）${FORCE ? ' [--force]' : ''}`);

  const htmlPaths = [];
  for (const paper of PAPERS) {
    const htmlFilename = paper.filename.replace(/\.pdf$/, '.html');
    const htmlPath = path.join(__dirname, htmlFilename);
    const html = renderPaperHtml(paper);
    const previous = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : null;
    if (previous !== html) {
      writeFileSync(htmlPath, html, 'utf8');
      console.log(`  HTML を更新しました: ${htmlFilename}`);
    } else {
      console.log(`  HTML は最新です（変更なし）: ${htmlFilename}`);
    }
    htmlPaths.push({ paper, htmlPath, pdfPath: path.join(__dirname, paper.filename) });
  }

  const pending = htmlPaths.filter(({ pdfPath }) => FORCE || !existsSync(pdfPath));
  if (pending.length === 0) {
    console.log('PDF はすべて生成済みのためスキップします（--force で再生成できます）。');
    return;
  }

  const executablePath = resolveChromiumExecutable();
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    for (const { paper, htmlPath, pdfPath } of pending) {
      console.log(`  PDF 生成中: ${paper.filename}`);
      await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
      await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
      const sizeKb = Math.round(readFileSync(pdfPath).length / 1024);
      console.log(`  完了: ${paper.filename} (${sizeKb} KB)`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('デモ論文フィクスチャの生成に失敗しました:', error);
  process.exitCode = 1;
});
