// データの流れの図（公開ヘルプ・プライバシーポリシー用）を日英 2 枚の PNG で書き出す。
//
//   npm run diagram:data-flow
//
// 出力: hosted/screenshots/data-flow-ja.png / data-flow-en.png（1280×860、300KB 以下）
// 図の文言の正典は docs/store/privacy-policy.md。ポリシーの送信先・保存先を変えたら、
// 下の TEXT を直して撮り直す。ロゴは tools/data-flow/logos/ の SVG（入手元は同フォルダの README.md）。
// 描画は同梱の Playwright（Chromium）で行う。日本語フォントは環境のものを使うため、
// 撮り直したら PNG を目で確かめる。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { resolveChromiumExecutable } from '../../video/scripts/config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const W = 1280;
const H = 860;

const COLOR = {
  ink: '#1f2933',
  sub: '#52606d',
  line: '#9aa5b1',
  user: '#2e7d32',
  userBg: '#f1f8f2',
  google: '#1a73e8',
  googleBg: '#f3f7fe',
  ai: '#6d4bc2',
  aiBg: '#f6f3fc',
  pickBg: '#f7f7f7',
  no: '#c62828',
  noBg: '#fdf2f2',
  warn: '#8a5a00',
};

const TEXT = {
  ja: {
    title: 'データはどこへ行くか',
    subtitle:
      '開発者のサーバーはありません。データは、あなたのブラウザ・あなたの Google アカウント・あなたが選んだ AI の間だけを流れます。',
    browserTitle: 'あなたのブラウザ',
    browserSub: 'SR Data Extraction（Chrome 拡張）',
    browserKeep: 'ブラウザの中に置くもの',
    browserItems: [
      'LLM の API キー（暗号化せずに保存）',
      'Google のトークン（閉じると消える）',
      'サインイン中のメールアドレス',
    ],
    devTitle: '開発者のサーバー：ありません',
    devSub: ['開発者はあなたの論文・抽出結果を', '受け取らず、AI の学習にも使いません'],
    googleTitle: 'あなたの Google アカウント',
    driveName: 'Google Drive',
    driveItems: ['論文の PDF', '抽出した本文テキスト', 'AI とのやりとりの記録', '（logs/llm）'],
    sheetsName: 'Google Sheets',
    sheetsItems: ['抽出表の設計', '抽出結果・判定履歴', 'プロジェクトの DB'],
    googleFoot: ['拡張が触れるのは、あなたが選んだファイルと', '拡張が作ったファイルだけ（drive.file）'],
    googleArrow: ['読み書き', '（いつも）'],
    collabTitle: '共同研究者',
    collabItems: ['あなたが招待した', '相手だけが、Drive の', '共有で見られる'],
    shareArrow: '共有',
    aiTitle: 'あなたが選んだ AI（自分の API キー = BYOK）',
    aiNames: ['Gemini', 'Anthropic', 'OpenRouter', 'Azure OpenAI', 'OpenAI 互換', 'ローカル LLM'],
    aiFoot: [
      '送った内容の扱い（保存・学習・人の閲覧）は各社の規約しだい。',
      'Gemini の無料枠は製品の改善に使われ、人が読むことがあります。',
      '未公開のデータは有料枠で使ってください。',
    ],
    aiArrowOut: ['AI 機能を使うときだけ', '論文の本文', '（スキャンはページ画像）', 'プロトコル・質問'],
    aiArrowBack: '回答・抽出結果',
    helpNote: 'ヘルプへの相談は、質問と公開ヘルプの文だけを送ります（論文・抽出データは送らない）',
    pickTitle: 'ファイルを選ぶときだけ',
    pickSub: 'GitHub Pages の静的ページ + Google Picker',
    pickItems: ['選んだファイルの ID と名前を返すだけ。', 'データの保存も送信もしません'],
    foot: '各ロゴは各社の商標です。内容はプライバシーポリシー（2026-11-08）に基づきます。',
  },
  en: {
    title: 'Where your data goes',
    subtitle:
      'There is no developer server. Data moves only between your browser, your Google account and the AI you chose.',
    browserTitle: 'Your browser',
    browserSub: 'SR Data Extraction (Chrome extension)',
    browserKeep: 'Kept inside the browser',
    browserItems: [
      'LLM API key (stored unencrypted)',
      'Google token (cleared on close)',
      'Signed-in email address',
    ],
    devTitle: 'Developer server: none',
    devSub: ['The developer never receives your papers', 'or results, and never trains AI on them'],
    googleTitle: 'Your Google account',
    driveName: 'Google Drive',
    driveItems: ['Paper PDFs', 'Extracted full text', 'Log of AI requests', '(logs/llm)'],
    sheetsName: 'Google Sheets',
    sheetsItems: ['Extraction form', 'Results and decisions', 'Project database'],
    googleFoot: ['The extension touches only files you pick', 'and files it creates (drive.file)'],
    googleArrow: ['Read / write', '(always)'],
    collabTitle: 'Collaborators',
    collabItems: ['Only people you', 'invite, through', 'Drive sharing'],
    shareArrow: 'Share',
    aiTitle: 'The AI you chose (your own API key = BYOK)',
    aiNames: ['Gemini', 'Anthropic', 'OpenRouter', 'Azure OpenAI', 'OpenAI-compatible', 'Local LLM'],
    aiFoot: [
      'How sent content is handled (retention, training, human review) depends on each provider.',
      'The Gemini free tier is used to improve products and may be read by people.',
      'Use a paid tier for unpublished data.',
    ],
    aiArrowOut: ['Only when you use AI', 'Paper text', '(page images if scanned)', 'protocol, questions'],
    aiArrowBack: 'Answers, extracted values',
    helpNote: 'Help consultation sends only your question and public help text (no papers or data)',
    pickTitle: 'Only when picking files',
    pickSub: 'Static GitHub Pages page + Google Picker',
    pickItems: ['Returns only the picked file IDs and names.', 'Stores and sends no data'],
    foot: 'Logos are trademarks of their owners. Based on the privacy policy (2026-11-08).',
  },
};

let logoCount = 0;
function logo(name, x, y, size) {
  logoCount += 1;
  const prefix = `${name}-${logoCount}`;
  const raw = readFileSync(join(here, 'logos', `${name}.svg`), 'utf8');
  const viewBox = /viewBox="([^"]+)"/.exec(raw)?.[1] ?? '0 0 24 24';
  const body = raw.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  // 同じロゴを 2 回置いても id が衝突しないよう、置くたびに接頭辞を付ける
  const scoped = body
    .replace(/id="([^"]+)"/g, `id="${prefix}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${prefix}-$1"`);
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${scoped}</svg>`;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function lines(x, y, list, { size = 15, color = COLOR.ink, weight = 400, gap = 1.45, anchor = 'start' } = {}) {
  return list
    .map(
      (t, i) =>
        `<text x="${x}" y="${y + i * size * gap}" font-size="${size}" fill="${color}" font-weight="${weight}" text-anchor="${anchor}">${esc(t)}</text>`,
    )
    .join('');
}

function box(x, y, w, h, stroke, fill, dash = '') {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${fill}" stroke="${stroke}" stroke-width="2"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
}

function people(x, y, color) {
  const one = (cx) =>
    `<circle cx="${cx}" cy="${y + 10}" r="8" fill="${color}"/><path d="M${cx - 14} ${y + 38} q0 -18 14 -18 q14 0 14 18 z" fill="${color}"/>`;
  return one(x) + one(x + 26);
}

function render(lang) {
  const t = TEXT[lang];
  const parts = [];
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(`<defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="context-stroke"/></marker>
  </defs>`);

  // タイトル
  parts.push(lines(40, 58, [t.title], { size: 30, weight: 700 }));
  parts.push(lines(40, 92, [t.subtitle], { size: 16, color: COLOR.sub }));

  // 開発者のサーバー（無い）
  parts.push(box(40, 128, 380, 104, COLOR.no, COLOR.noBg, '8 6'));
  parts.push(
    `<g stroke="${COLOR.no}" stroke-width="5" stroke-linecap="round"><line x1="66" y1="152" x2="106" y2="192"/><line x1="106" y1="152" x2="66" y2="192"/></g>`,
  );
  parts.push(lines(124, 166, [t.devTitle], { size: 18, weight: 700, color: COLOR.no }));
  parts.push(lines(124, 192, t.devSub, { size: 13.5, color: COLOR.sub, gap: 1.4 }));

  // ブラウザ
  parts.push(box(40, 300, 380, 260, COLOR.user, COLOR.userBg));
  parts.push(logo('chrome', 64, 324, 56));
  parts.push(lines(136, 348, [t.browserTitle], { size: 22, weight: 700, color: COLOR.user }));
  parts.push(lines(136, 374, [t.browserSub], { size: 14, color: COLOR.sub }));
  parts.push(`<line x1="64" y1="400" x2="396" y2="400" stroke="${COLOR.user}" stroke-opacity="0.3"/>`);
  parts.push(lines(64, 428, [t.browserKeep], { size: 14, weight: 700, color: COLOR.sub }));
  parts.push(
    t.browserItems
      .map(
        (s, i) =>
          `<circle cx="72" cy="${453 + i * 30}" r="3.5" fill="${COLOR.user}"/>` +
          lines(84, 458 + i * 30, [s], { size: 15 }),
      )
      .join(''),
  );

  // ブラウザ → 開発者（遮断）
  parts.push(
    `<line x1="230" y1="300" x2="230" y2="240" stroke="${COLOR.no}" stroke-width="2.5" stroke-dasharray="6 5"/>` +
      `<g stroke="${COLOR.no}" stroke-width="3.5" stroke-linecap="round"><line x1="220" y1="260" x2="240" y2="280"/><line x1="240" y1="260" x2="220" y2="280"/></g>`,
  );

  // Picker
  parts.push(box(40, 640, 380, 150, COLOR.line, COLOR.pickBg, '8 6'));
  parts.push(logo('github', 64, 662, 40));
  parts.push(logo('google-drive', 112, 664, 38));
  parts.push(lines(164, 682, [t.pickTitle], { size: 17, weight: 700 }));
  parts.push(lines(164, 704, [t.pickSub], { size: 12.5, color: COLOR.sub }));
  parts.push(lines(64, 742, t.pickItems, { size: 14, gap: 1.5 }));
  parts.push(
    `<line x1="230" y1="636" x2="230" y2="566" stroke="${COLOR.line}" stroke-width="2.5" stroke-dasharray="6 5" marker-start="url(#arrow)" marker-end="url(#arrow)"/>`,
  );

  // Google アカウント
  parts.push(box(640, 128, 420, 330, COLOR.google, COLOR.googleBg));
  parts.push(lines(664, 164, [t.googleTitle], { size: 21, weight: 700, color: COLOR.google }));
  parts.push(`<rect x="664" y="184" width="180" height="196" rx="10" fill="#fff" stroke="#d6e2f5"/>`);
  parts.push(logo('google-drive', 680, 198, 40));
  parts.push(lines(730, 224, [t.driveName], { size: 15, weight: 700 }));
  parts.push(lines(680, 270, t.driveItems, { size: 14, gap: 1.55 }));
  parts.push(`<rect x="856" y="184" width="180" height="196" rx="10" fill="#fff" stroke="#d6e2f5"/>`);
  parts.push(logo('google-sheets', 872, 198, 40));
  parts.push(lines(922, 224, [t.sheetsName], { size: 15, weight: 700 }));
  parts.push(lines(872, 270, t.sheetsItems, { size: 14, gap: 1.55 }));
  parts.push(lines(664, 412, t.googleFoot, { size: 13, color: COLOR.sub, gap: 1.4 }));

  // 共同研究者
  parts.push(box(1100, 200, 150, 186, COLOR.google, '#ffffff'));
  parts.push(people(1158, 220, COLOR.google));
  parts.push(lines(1175, 290, [t.collabTitle], { size: 16, weight: 700, anchor: 'middle' }));
  parts.push(lines(1175, 318, t.collabItems, { size: 12.5, color: COLOR.sub, gap: 1.45, anchor: 'middle' }));
  parts.push(
    `<line x1="1062" y1="292" x2="1096" y2="292" stroke="${COLOR.google}" stroke-width="2.5" marker-end="url(#arrow)"/>`,
  );
  parts.push(lines(1080, 278, [t.shareArrow], { size: 12, color: COLOR.google, anchor: 'middle', weight: 700 }));

  // ブラウザ ⇄ Google
  parts.push(
    `<path d="M422 370 C 520 370, 540 290, 636 290" fill="none" stroke="${COLOR.google}" stroke-width="3" marker-start="url(#arrow)" marker-end="url(#arrow)"/>`,
  );
  parts.push(lines(530, 286, t.googleArrow, { size: 14, color: COLOR.google, weight: 700, anchor: 'middle', gap: 1.35 }));

  // AI
  parts.push(box(640, 512, 610, 278, COLOR.ai, COLOR.aiBg));
  parts.push(lines(664, 548, [t.aiTitle], { size: 19, weight: 700, color: COLOR.ai }));
  const aiLogos = ['gemini', 'anthropic', 'openrouter', 'azure', 'openai', 'ollama'];
  aiLogos.forEach((name, i) => {
    const cx = 692 + i * 96;
    parts.push(`<rect x="${cx - 40}" y="566" width="80" height="104" rx="10" fill="#fff" stroke="#e2daf5"/>`);
    parts.push(logo(name, cx - 20, 580, 40));
    const label = t.aiNames[i];
    const size = label.length > 13 ? 10.5 : label.length > 10 ? 11 : 12;
    parts.push(lines(cx, 650, [label], { size, anchor: 'middle', weight: 700 }));
  });
  parts.push(lines(664, 704, t.aiFoot.slice(0, 1), { size: 13, color: COLOR.sub }));
  parts.push(lines(664, 726, t.aiFoot.slice(1), { size: 13, color: COLOR.warn, gap: 1.4 }));
  parts.push(lines(664, 774, [t.helpNote], { size: 12.5, color: COLOR.sub }));

  // ブラウザ → AI（行き）と戻り
  parts.push(
    `<path d="M422 520 C 540 520, 520 610, 636 610" fill="none" stroke="${COLOR.ai}" stroke-width="3" marker-end="url(#arrow)"/>`,
  );
  parts.push(
    `<path d="M636 650 C 520 650, 500 552, 424 546" fill="none" stroke="${COLOR.ai}" stroke-width="2" stroke-dasharray="5 4" marker-end="url(#arrow)"/>`,
  );
  parts.push(lines(530, 430, t.aiArrowOut.slice(0, 1), { size: 13.5, color: COLOR.ai, weight: 700, anchor: 'middle' }));
  parts.push(lines(530, 452, t.aiArrowOut.slice(1), { size: 12.5, color: COLOR.ai, anchor: 'middle', gap: 1.35 }));
  parts.push(lines(540, 680, [t.aiArrowBack], { size: 12.5, color: COLOR.ai, anchor: 'middle' }));

  // 脚注
  parts.push(lines(40, 836, [t.foot], { size: 12, color: COLOR.sub }));

  const font =
    lang === 'ja'
      ? "'Noto Sans JP','Hiragino Sans','Yu Gothic','WenQuanYi Zen Hei',sans-serif"
      : "Inter,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${font}">${parts.join('')}</svg>`;
}

const outDir = join(repoRoot, 'hosted', 'screenshots');
mkdirSync(outDir, { recursive: true });
const executablePath = resolveChromiumExecutable();
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  for (const lang of ['ja', 'en']) {
    const svg = render(lang);
    if (process.argv.includes('--svg')) writeFileSync(join(outDir, `data-flow-${lang}.svg`), svg);
    await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
    const file = join(outDir, `data-flow-${lang}.png`);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: W, height: H } });
    console.log(`書き出し: ${file}`);
  }
} finally {
  await browser.close();
}
