// PDF.js worker 同梱方式（chrome.runtime.getURL 解決）の MV3 CSP 実弾確認。
// 1) worker が実 Worker として起動するか（fake worker フォールバックの検出込み）
// 2) fixture PDF 1 ページ目の canvas 描画
// 3) getTextContent() のテキストを Node（extract-text.ts）と同じ規則で組み立てて出力
//    → Playwright 側で Node 出力と突き合わせる
const resultEl = document.getElementById('result');

// fake worker へのフォールバックは console.warn に出るため捕捉する
const warnings = [];
const origWarn = console.warn.bind(console);
console.warn = (...args) => {
  warnings.push(args.map(String).join(' '));
  origWarn(...args);
};

async function main() {
  const pdfjs = await import('./pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.mjs');

  const doc = await pdfjs.getDocument({ url: chrome.runtime.getURL('udca.pdf') }).promise;
  const page = await doc.getPage(1);

  // canvas 描画
  const viewport = page.getViewport({ scale: 1.2 });
  const canvas = document.getElementById('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

  // テキスト層（extract-text.ts と同じ連結規則: str + hasEOL 位置に \n）
  const content = await page.getTextContent();
  let text = '';
  for (const item of content.items) {
    if (!('str' in item)) continue;
    text += item.str;
    if (item.hasEOL) text += '\n';
  }

  const fakeWorker = warnings.some((w) => w.toLowerCase().includes('fake worker'));
  return {
    ok: true,
    pdfjsVersion: pdfjs.version,
    pageCount: doc.numPages,
    renderedPage1: true,
    fakeWorker,
    warnings,
    page1TextLength: text.length,
    page1Text: text,
  };
}

main()
  .then((r) => {
    resultEl.textContent = JSON.stringify(r);
    resultEl.dataset.done = '1';
  })
  .catch((e) => {
    resultEl.textContent = JSON.stringify({ ok: false, error: String(e && e.stack ? e.stack : e), warnings });
    resultEl.dataset.done = '1';
  });
