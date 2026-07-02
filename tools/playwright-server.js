// E2E 用の dist/ 静的配信サーバ（外部依存なし）。
// dist/ を丸ごと配信することで、PDF.js worker も本番と同じ相対パスで解決できる
// （chrome スタブ側で chrome.runtime.getURL = (p) => '/' + p とする。test-strategy.md §2.1-2）
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 4400;
const ROOT = path.resolve(__dirname, '..', 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
};

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filePath = path.join(ROOT, urlPath === '/' ? 'app/app.html' : urlPath);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(filePath)] || 'application/octet-stream',
      });
      res.end(data);
    });
  })
  .listen(PORT, () => {
    console.log(`playwright-server: http://localhost:${PORT} (root: ${ROOT})`);
  });
