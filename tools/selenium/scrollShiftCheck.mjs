// 検証画面で「承認」したあと画面全体が横にずれ、左の PDF が見えなくなる件の実機確認用（未コミットの作業用スクリプト）。
// manualCheck.mjs と同じ専用プロファイル（.selenium-profile/）の Chrome で、確認用プロジェクトを開いて測る。
//
// 使い方: node tools/selenium/scrollShiftCheck.mjs --widths 1500,1200,1000 [--out <dir>] [--accept 1]
//   各窓幅で検証画面（一覧表示）を開き、横にはみ出している要素と横スクロール量を記録する。
//   --accept 1 のとき、未判定のカードを 1 件フォーカスして a キーで承認し、承認の前後を比べる
//   （確認用プロジェクトのシートに判定が 1 件ずつ書き込まれる）。
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Builder, By, Key, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DIST_DIR = path.join(ROOT, 'dist');
const PROFILE_DIR = path.join(ROOT, '.selenium-profile');

function optionValue(key, fallback) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(key);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
}

const OUT_DIR = path.resolve(optionValue('--out', 'C:/tmp/srde-scroll'));
mkdirSync(OUT_DIR, { recursive: true });
const log = (m) => console.log(m);

const manifest = JSON.parse(readFileSync(path.join(DIST_DIR, 'manifest.json'), 'utf8'));
const hash = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest();
const EXTENSION_ID = [...hash.subarray(0, 16)]
  .map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15)))
  .join('');
const POPUP_URL = `chrome-extension://${EXTENSION_ID}/popup/popup.html`;
const APP_URL = `chrome-extension://${EXTENSION_ID}/app/app.html`;

async function findVisible(driver, selector) {
  for (const element of await driver.findElements(By.css(selector))) {
    if (await element.isDisplayed().catch(() => false)) return element;
  }
  return null;
}

async function waitVisible(driver, selector, timeoutMs, what) {
  await driver.wait(async () => (await findVisible(driver, selector)) !== null, timeoutMs, what);
  return findVisible(driver, selector);
}

async function saveShot(driver, name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  writeFileSync(file, await driver.takeScreenshot(), 'base64');
  log(`  shot: ${file}`);
}

async function ensureLogin(driver) {
  await driver.get('about:blank');
  const keepAlive = await driver.getWindowHandle();
  await driver.switchTo().newWindow('tab');
  await driver.get(POPUP_URL);
  await driver.wait(until.elementLocated(By.css('#popup-status')), 10000);
  const reloadHandle = await driver.getWindowHandle();
  await driver.executeScript('setTimeout(() => chrome.runtime.reload(), 100);');
  await driver.sleep(3500);
  await driver.switchTo().window(keepAlive);
  if ((await driver.getAllWindowHandles()).includes(reloadHandle)) {
    await driver.switchTo().window(reloadHandle);
    await driver.close();
    await driver.switchTo().window(keepAlive);
  }
  await driver.get(POPUP_URL);
  await driver.wait(
    async () => (await findVisible(driver, '#popup-auth')) !== null || (await findVisible(driver, '#popup-projects')) !== null,
    20000,
    'Popup の認証状態が確定しません',
  );
  if ((await findVisible(driver, '#popup-projects')) === null) {
    await driver.findElement(By.css('#login-button')).click();
    await driver.wait(async () => (await findVisible(driver, '#popup-projects')) !== null, 3 * 60 * 1000, 'ログインが完了しません');
  }
}

async function openVerify(driver) {
  await driver.get(`${APP_URL}#/home`);
  await waitVisible(driver, '.home__summary', 60000, 'Home が読み込まれません');
  await driver.wait(async () => /文献数\s*[1-9]/.test((await (await findVisible(driver, '.home__summary')).getText()).replace(/\s+/g, ' ')), 30000).catch(() => undefined);
  for (let attempt = 0; attempt < 5; attempt++) {
    await driver.executeScript('location.hash = "#/verify";');
    await driver.sleep(1500);
    if (String(await driver.executeScript('return location.hash;')).startsWith('#/verify')) break;
  }
  await waitVisible(driver, '.verify__panes', 90000, '検証データが読み込まれません');
  await waitVisible(driver, '.pdf-viewer__page-indicator', 90000, 'PDF が描画されません');
  const toggle = await findVisible(driver, '#verify-layout-toggle');
  if (toggle !== null && (await driver.findElements(By.css('.verify__cell'))).length < 3) {
    await toggle.click();
    await driver.sleep(800);
  }
  await driver.sleep(2000);
}

/** 横方向の状態: 窓の横スクロール、はみ出し・横スクロール中の要素、PDF ペインと右列の位置 */
const MEASURE = `
  const describe = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
  const rect = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; };
  const scrolled = [];
  for (const el of [document.scrollingElement, ...document.querySelectorAll('*')]) {
    if (!el) continue;
    const over = el.scrollWidth - el.clientWidth;
    if (el.scrollLeft !== 0 || (over > 1 && getComputedStyle(el).overflowX !== 'visible' && getComputedStyle(el).overflowX !== 'hidden' && el.clientWidth > 200)) {
      scrolled.push({ el: describe(el).slice(0, 90), scrollLeft: Math.round(el.scrollLeft), overflow: over, overflowX: getComputedStyle(el).overflowX });
    }
  }
  return {
    innerWidth: window.innerWidth,
    scrollX: window.scrollX,
    docScrollWidth: document.documentElement.scrollWidth,
    sidebar: rect('.app__sidebar'),
    main: rect('.app__main') ?? rect('main'),
    panes: rect('.verify__panes'),
    pdf: rect('.verify__pane--pdf'),
    form: rect('.verify__pane--form'),
    focused: document.activeElement ? describe(document.activeElement).slice(0, 80) : null,
    scrolled,
  };
`;

async function measure(driver, label) {
  const m = await driver.executeScript(MEASURE);
  log(`  [${label}] innerWidth=${m.innerWidth} scrollX=${m.scrollX} docScrollWidth=${m.docScrollWidth}`);
  log(`    sidebar=${JSON.stringify(m.sidebar)} main=${JSON.stringify(m.main)}`);
  log(`    panes=${JSON.stringify(m.panes)} pdf=${JSON.stringify(m.pdf)} form=${JSON.stringify(m.form)}`);
  log(`    focus=${m.focused}`);
  for (const s of m.scrolled) log(`    横スクロール/はみ出し: ${s.el} scrollLeft=${s.scrollLeft} 余り=${s.overflow} overflow-x=${s.overflowX}`);
  return m;
}

async function acceptOne(driver, tag) {
  // 未判定（承認ボタンがある）カードで、次にもカードが続くものを選ぶ
  const cards = await driver.findElements(By.css('.verify__cell'));
  let target = null;
  for (let i = 0; i < cards.length - 1; i++) {
    if ((await cards[i].findElements(By.css('.verify__action--accept'))).length > 0 && (await cards[i].isDisplayed())) {
      target = cards[i];
      break;
    }
  }
  if (target === null) {
    log('  未判定のカードがありません（承認は試せません）');
    return;
  }
  const name = await target.findElement(By.css('.verify__cell-name')).getText().catch(() => '?');
  // 横位置を 0 に戻し、横スクロールを起こさずにカードへフォーカスしてから承認する
  await driver.executeScript(
    'const card = arguments[0]; const pane = document.querySelector(".verify__pane--form");' +
      'pane.scrollTop = card.offsetTop - pane.offsetTop - 40; card.focus({ preventScroll: true });' +
      'window.scrollTo(0, window.scrollY); pane.scrollLeft = 0;',
    target,
  );
  await driver.sleep(1500);
  await measure(driver, `承認前（${name} にフォーカス）`);
  await saveShot(driver, `${tag}-before`);
  if (optionValue('--how', 'key') === 'click') {
    await driver.executeScript('arguments[0].querySelector(".verify__action--accept").click();', target);
  } else {
    await driver.actions().sendKeys('a').perform();
  }
  await driver.sleep(3000);
  await measure(driver, '承認後');
  await saveShot(driver, `${tag}-after`);
}

async function main() {
  const widths = optionValue('--widths', '1500').split(',').map(Number);
  const accept = optionValue('--accept', '0') === '1';
  const options = new chrome.Options().addArguments(
    `--user-data-dir=${PROFILE_DIR}`,
    '--profile-directory=Default',
    '--no-first-run',
    '--no-default-browser-check',
    `--window-size=${widths[0]},1000`,
  );
  const driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
  let failed = false;
  try {
    await ensureLogin(driver);
    for (const width of widths) {
      log(`\n=== 窓幅 ${width}px ===`);
      await driver.manage().window().setRect({ width, height: 1000 });
      await openVerify(driver);
      await measure(driver, '開いた直後');
      await saveShot(driver, `w${width}-open`);
      if (accept) await acceptOne(driver, `w${width}`);
    }
  } catch (err) {
    failed = true;
    console.error(`中断: ${err instanceof Error ? err.message : String(err)}`);
    try {
      writeFileSync(path.join(OUT_DIR, 'failure.png'), await driver.takeScreenshot(), 'base64');
    } catch {
      // ブラウザごと落ちた場合は保存できない
    }
  } finally {
    await driver.quit().catch(() => undefined);
  }
  process.exit(failed ? 1 : 0);
}

void main();
