// issue #307 の実機確認用シーン（未コミットの作業用スクリプト）。
// manualCheck.mjs と同じ専用プロファイル（.selenium-profile/）の Chrome を使い、
// 複数選択・引用の編集・PDF からの追加・書き出しを本物の Google API で通す。
//
// 使い方: node tools/selenium/issue307Check.mjs <scene> [<scene> ...] [--out <dir>]
//   probe            現在のプロジェクトと各タブのヘッダ・行数を表示する
//   shot --name x    現在の画面のスクリーンショットを out に保存する
// 各シーンは失敗時に out/<scene>-failure.png と .html を保存して終了コード 1 で終わる。
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DIST_DIR = path.join(ROOT, 'dist');
const PROFILE_DIR = path.join(ROOT, '.selenium-profile');

function optionValue(key, fallback) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(key);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
}

const OUT_DIR = path.resolve(optionValue('--out', 'C:/tmp/srde307-realtest'));
mkdirSync(OUT_DIR, { recursive: true });

function log(message) {
  console.log(message);
}
function ok(message) {
  console.log(`  OK  ${message}`);
}
function ng(message) {
  console.log(`  NG  ${message}`);
}

function computeExtensionId() {
  const manifest = JSON.parse(readFileSync(path.join(DIST_DIR, 'manifest.json'), 'utf8'));
  const hash = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest();
  return [...hash.subarray(0, 16)]
    .map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15)))
    .join('');
}

const EXTENSION_ID = computeExtensionId();
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

/** 拡張の service worker を起こし直してから、ログイン済みかを確かめる（未ログインなら失敗させる） */
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
    async () =>
      (await findVisible(driver, '#popup-auth')) !== null ||
      (await findVisible(driver, '#popup-projects')) !== null,
    20000,
    'Popup の認証状態が確定しません',
  );
  if ((await findVisible(driver, '#popup-projects')) === null) {
    throw new Error('未ログインです（manualCheck.mjs login で先にログインしてください）');
  }
  ok(`ログイン済み: ${await driver.findElement(By.css('#popup-email')).getText()}`);
}

async function openApp(driver, hash) {
  await driver.get(`${APP_URL}#/home`);
  await driver.wait(
    async () =>
      (await findVisible(driver, '.home__summary')) !== null ||
      (await findVisible(driver, '#home-counts-error')) !== null,
    60000,
    '#/home のカウントが読み込まれません',
  );
  // .home__summary は集計の読み込み前に 0 で描かれる。0 のままガード付きルートへ移ると
  // #/home へ戻されるので、文献数が 1 以上になるのを待ってから遷移し、戻されたらやり直す
  await driver.wait(async () => {
    const text = (await textOf(driver, '.home__summary')).replace(/\s+/g, ' ');
    return /文献数\s*[1-9]/.test(text);
  }, 30000, 'Home の集計が読み込まれません').catch(() => undefined);
  if (hash === '#/home') return;
  const route = hash.split('?')[0];
  for (let attempt = 0; attempt < 5; attempt++) {
    await driver.executeScript('location.hash = arguments[0];', hash);
    await driver.sleep(1500);
    const now = await driver.executeScript('return location.hash;');
    if (String(now).startsWith(route)) return;
  }
  throw new Error(`${hash} へ遷移できません（ガードで #/home に戻されます）`);
}

async function currentProject(driver) {
  return driver.executeAsyncScript(
    'const done = arguments[arguments.length - 1]; chrome.storage.local.get("currentProject", (items) => done(items.currentProject ?? null));',
  );
}

/** ブラウザの Google セッションで gviz の HTML を読み、タブの全行（ヘッダ行を含む）を返す */
async function readSheet(driver, spreadsheetId, sheet) {
  const handle = await driver.getWindowHandle();
  await driver.switchTo().newWindow('tab');
  try {
    await driver.get(
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:html&sheet=${encodeURIComponent(sheet)}&headers=0`,
    );
    return await driver.executeScript(
      'return Array.from(document.querySelectorAll("table tr"), (row) => Array.from(row.querySelectorAll("td,th"), (cell) => cell.textContent.trim()));',
    );
  } finally {
    await driver.close();
    await driver.switchTo().window(handle);
  }
}

async function sceneProbe(driver) {
  log('\n[probe] 現在のプロジェクトとシートの状態');
  await ensureLogin(driver);
  await openApp(driver, '#/home');
  const project = await currentProject(driver);
  log(`  currentProject: ${JSON.stringify(project)}`);
  log(`  home: ${(await driver.findElement(By.css('.app__main, main, body')).getText()).replace(/\s+/g, ' ').slice(0, 300)}`);
  if (project === null) return;
  for (const sheet of ['Meta', 'Documents', 'SchemaVersions', 'SchemaFields', 'Evidence', 'QuoteSets']) {
    const rows = await readSheet(driver, project.spreadsheetId, sheet);
    log(`  ${sheet}: ${rows.length} 行 / 先頭行 ${rows[0]?.length ?? 0} 列: ${(rows[0] ?? []).join(' | ').slice(0, 300)}`);
  }
  await saveShot(driver, 'probe-home');
}

/** 値を設定して input / change を発火する（再描画で stale になるので毎回取り直して呼ぶ） */
async function setValue(driver, selector, value) {
  const element = await waitVisible(driver, selector, 15000, `${selector} が見つかりません`);
  await driver.executeScript(
    'const el = arguments[0]; el.value = arguments[1];' +
      "el.dispatchEvent(new Event('input', { bubbles: true }));" +
      "el.dispatchEvent(new Event('change', { bubbles: true }));",
    element,
    value,
  );
}

async function textOf(driver, selector) {
  const element = await findVisible(driver, selector);
  return element === null ? '' : (await element.getText()).trim();
}

/** シートの実ヘッダ行（gviz は先頭に空のラベル行を出すので 2 行目）を返す */
async function sheetHeader(driver, sheet) {
  const project = await currentProject(driver);
  const rows = await readSheet(driver, project.spreadsheetId, sheet);
  return { header: rows[1] ?? [], rows };
}

const MULTI_ALLOWED = 'Students|Supervisors, faculty or residents|Records themselves|Administrative or system data|Other|unclear';

async function sceneSchemaMulti(driver) {
  log('\n[schema-multi] 既存プロジェクトの表のデザインに複数選択の項目を足して確定する');
  await ensureLogin(driver);
  const before = await (async () => {
    await openApp(driver, '#/home');
    return sheetHeader(driver, 'SchemaFields');
  })();
  log(`  確定前の SchemaFields ヘッダ: ${before.header.length} 列（末尾 ${before.header.slice(-2).join(' / ')}）`);
  await openApp(driver, '#/schema');
  await waitVisible(driver, '#schema-confirmed', 60000, '確定済みの表のデザインが表示されません');
  log(`  現行版: ${await textOf(driver, '#schema-current-meta')}`);
  await (await findVisible(driver, '#schema-new-version')).click();
  await waitVisible(driver, '#schema-editor', 15000, 'エディタが開きません');
  const rowCount = (await driver.findElements(By.css('#schema-editor-table tbody tr'))).length;
  await (await findVisible(driver, '#schema-add-row')).click();
  await driver.wait(
    async () => (await driver.findElements(By.css('#schema-editor-table tbody tr'))).length === rowCount + 1,
    10000,
    '行が追加されません',
  );
  const n = rowCount + 1;
  await setValue(driver, `input[aria-label="${n} 行目の section"]`, 'methods');
  await setValue(driver, `input[aria-label="${n} 行目の field_name"]`, 'data_source');
  await setValue(driver, `input[aria-label="${n} 行目の field_label"]`, 'データの取得元');
  await setValue(driver, `select[aria-label="${n} 行目の data_type"]`, 'enum');
  await setValue(driver, `input[aria-label="${n} 行目の許容値"]`, MULTI_ALLOWED);
  await setValue(
    driver,
    `textarea[aria-label="${n} 行目の抽出指示"], input[aria-label="${n} 行目の抽出指示"]`,
    'Who or what the data analysed in the study were obtained from. Select every source that applies.',
  );
  // 複数選択のチェック（enum 行にだけ出る。最後の行のものを押す）
  const checkboxes = await driver.findElements(By.css('.schema__multi-select'));
  if (checkboxes.length === 0) throw new Error('複数選択のチェックボックスが出ません');
  await checkboxes[checkboxes.length - 1].click();
  await driver.sleep(500);
  const exclusive = await driver.executeScript(
    'const els = document.querySelectorAll(".schema__exclusive-values"); return els[els.length - 1].value;',
  );
  const freeText = await driver.executeScript(
    'const els = document.querySelectorAll(".schema__free-text-values"); return els[els.length - 1].value;',
  );
  (exclusive === 'unclear' ? ok : ng)(`単独選択肢の初期入力: "${exclusive}"（期待: unclear）`);
  (freeText === 'Other' ? ok : ng)(`自由記述付き選択肢の初期入力: "${freeText}"（期待: Other）`);
  await saveShot(driver, 'schema-multi-editor');
  await setValue(driver, '#schema-note', 'issue #307 実機確認: 複数選択の項目を追加');
  await (await findVisible(driver, '#schema-confirm')).click();
  const result = await driver.wait(async () => {
    if ((await findVisible(driver, '#schema-confirmed')) !== null) return 'confirmed';
    if ((await findVisible(driver, '#schema-confirm-error')) !== null) return 'error';
    if ((await findVisible(driver, '#schema-editor-errors')) !== null) return 'invalid';
    return false;
  }, 120000, '確定が完了しません');
  if (result !== 'confirmed') {
    ng(`確定できません: ${await textOf(driver, '#schema-confirm-error')} ${await textOf(driver, '#schema-editor-errors')}`);
    throw new Error('schema-multi 失敗');
  }
  ok(`確定: ${await textOf(driver, '#schema-current-meta')}`);
  const table = (await textOf(driver, '#schema-current-table')).split('\n').filter((line) => line.includes('data_source'));
  log(`  確定済みの表の data_source 行: ${table.join(' / ')}`);
  await saveShot(driver, 'schema-multi-confirmed');
  const after = await sheetHeader(driver, 'SchemaFields');
  log(`  確定後の SchemaFields ヘッダ: ${after.header.length} 列（末尾 ${after.header.slice(-4).join(' / ')}）`);
  (after.header.length === 19 ? ok : ng)(`SchemaFields が 19 列になった（確定前 ${before.header.length} 列）`);
  const last = after.rows[after.rows.length - 1] ?? [];
  log(`  最終行（data_source）の末尾 4 セル: ${last.slice(-4).join(' / ')}`);
}

async function sceneExtract(driver) {
  log('\n[extract] 一括抽出（実 API）');
  await ensureLogin(driver);
  const before = await (async () => {
    await openApp(driver, '#/home');
    return sheetHeader(driver, 'Evidence');
  })();
  log(`  抽出前の Evidence: ヘッダ ${before.header.length} 列 / ${before.rows.length - 2} 行`);
  await openApp(driver, '#/extract');
  await waitVisible(driver, '#extract-run', 60000, '#/extract が表示されません');
  const selector = '#extract-studies input[type="checkbox"]';
  await driver.wait(async () => (await driver.findElements(By.css(selector))).length > 0, 30000, '文献一覧が出ません');
  const states = await driver.executeScript(
    'return [...document.querySelectorAll(arguments[0])].map((el) => ({ checked: el.checked, disabled: el.disabled }));',
    selector,
  );
  for (let i = 0; i < states.length; i++) {
    if (!states[i].checked && !states[i].disabled) {
      const boxes = await driver.findElements(By.css(selector));
      await boxes[i].click();
      await driver.sleep(300);
    }
  }
  const hasFlash38 = await driver.executeScript(
    'return [...document.querySelector("#extract-model").options].some((o) => o.value === "gemini-3.8-flash");',
  );
  if (hasFlash38) await setValue(driver, '#extract-model', 'gemini-3.8-flash');
  await driver.sleep(500);
  const model = await driver.executeScript('return document.querySelector("#extract-model")?.value ?? "";');
  log(`  モデル: ${model}`);
  await driver.wait(async () => {
    const text = await textOf(driver, '#extract-estimate');
    return text.includes('バッチ') || text.includes('概算不可') || text.includes('計算できません');
  }, 60000, 'コスト概算が出ません');
  log(`  コスト概算: ${(await textOf(driver, '#extract-estimate')).replace(/\s+/g, ' ')}`);
  await (await findVisible(driver, '#extract-run')).click();
  await waitVisible(driver, '#extract-confirm', 10000, '実行確認カードが出ません');
  await (await findVisible(driver, '#extract-confirm-run')).click();
  log('  実行中…');
  const result = await driver.wait(async () => {
    for (const s of ['#extract-run-done', '#extract-partial-failure', '#extract-run-error']) {
      if ((await findVisible(driver, s)) !== null) return s;
    }
    return false;
  }, 15 * 60 * 1000, '一括抽出が完了しません');
  log(`  結果: ${result} ${(await textOf(driver, result)).replace(/\s+/g, ' ').slice(0, 300)}`);
  await saveShot(driver, 'extract-done');
  if (result === '#extract-run-error') throw new Error('extract 失敗');
  const after = await sheetHeader(driver, 'Evidence');
  log(`  抽出後の Evidence: ヘッダ ${after.header.length} 列（末尾 ${after.header.slice(-3).join(' / ')}）/ ${after.rows.length - 2} 行`);
  (after.header.length === 21 ? ok : ng)(`Evidence が 21 列になった（抽出前 ${before.header.length} 列）`);
  const fieldIdx = after.header.indexOf('field_id');
  const sectionIdx = after.header.indexOf('section');
  const themeIdx = after.header.indexOf('quote_theme');
  const seqIdx = after.header.indexOf('quote_seq');
  const valueIdx = after.header.indexOf('value');
  const added = after.rows.slice(before.rows.length);
  const withSection = added.filter((row) => (row[sectionIdx] ?? '') !== '').length;
  log(`  今回追記された行: ${added.length} 行 / うち section あり ${withSection} 行`);
  const schema = await sheetHeader(driver, 'SchemaFields');
  const nameIdx = schema.header.indexOf('field_name');
  const idIdx = schema.header.indexOf('field_id');
  const sourceId = [...schema.rows].reverse().find((row) => row[nameIdx] === 'data_source')?.[idIdx];
  for (const row of added.filter((r) => r[fieldIdx] === sourceId)) {
    log(`  data_source の行: value="${row[valueIdx]}" theme="${row[themeIdx]}" seq=${row[seqIdx]} section="${row[sectionIdx]}"`);
  }
}

async function cardFor(driver, fieldName) {
  const xpath = `//div[contains(concat(' ', normalize-space(@class), ' '), ' verify__cell ')][.//code[contains(@class,'verify__cell-name') and normalize-space(text())='${fieldName}']]`;
  const cards = await driver.findElements(By.xpath(xpath));
  for (const card of cards) {
    if (await card.isDisplayed().catch(() => false)) return card;
  }
  return null;
}

async function openVerifyList(driver) {
  await openApp(driver, '#/verify');
  await waitVisible(driver, '.verify__panes', 90000, '検証データが読み込まれません');
  await waitVisible(driver, '.pdf-viewer__page-indicator', 90000, 'PDF が描画されません');
  // 一覧表示（全セルのカードが並ぶ）にする
  const toggle = await findVisible(driver, '#verify-layout-toggle');
  if (toggle !== null && (await driver.findElements(By.css('.verify__cell'))).length < 3) {
    await toggle.click();
    await driver.sleep(800);
  }
  log(`  PDF: ${await textOf(driver, '.pdf-viewer__page-indicator')} / カード ${(await driver.findElements(By.css('.verify__cell'))).length} 件`);
}

async function sceneVerifyMulti(driver) {
  log('\n[verify-multi] 判定画面: 複数選択のセルの表示とチップ');
  await ensureLogin(driver);
  await openVerifyList(driver);
  let card = await cardFor(driver, 'data_source');
  if (card === null) throw new Error('data_source のセルが見つかりません');
  await driver.executeScript('arguments[0].scrollIntoView({ block: "center" });', card);
  log(`  カード: ${(await card.getText()).replace(/\s+/g, ' ').slice(0, 700)}`);
  const themes = await card.findElements(By.css('.verify__quotes-theme'));
  log(`  引用の見出し（選択肢）: ${(await Promise.all(themes.map((t) => t.getText()))).join(' ; ')}`);
  const sections = await card.findElements(By.css('.verify__quote-section'));
  log(`  節: ${(await Promise.all(sections.map((t) => t.getText()))).join(' ; ')}`);
  await saveShot(driver, 'verify-multi-card');
  await (await card.findElement(By.css('.verify__action--edit'))).click();
  await waitVisible(driver, '.verify__editor--multi', 10000, '複数選択のエディタが開きません');
  const pressed = async () => driver.executeScript(
    'return [...document.querySelectorAll(".verify__editor--multi .verify__enum-chip")].map((c) => c.getAttribute("aria-label") + "=" + c.getAttribute("aria-pressed"));',
  );
  const clickChip = async (label) => {
    const chip = await driver.findElement(By.css(`.verify__editor--multi .verify__enum-chip[aria-label="${label}"]`));
    await chip.click();
    await driver.sleep(300);
  };
  log(`  開いた直後: ${(await pressed()).join(' , ')}`);
  await clickChip('unclear');
  const afterExclusive = await pressed();
  log(`  unclear を押した後: ${afterExclusive.join(' , ')}`);
  (afterExclusive.filter((s) => s.endsWith('=true')).join() === 'unclear=true' ? ok : ng)('単独選択肢を押すとほかが外れる');
  await clickChip('Students');
  await clickChip('Other');
  const afterNormal = await pressed();
  log(`  Students・Other を押した後: ${afterNormal.join(' , ')}`);
  (afterNormal.includes('unclear=false') && afterNormal.includes('Students=true') && afterNormal.includes('Other=true') ? ok : ng)(
    '通常の選択肢を押すと単独選択肢が外れる',
  );
  await setValue(driver, '.verify__multi-free-text', 'Standardized patients');
  await saveShot(driver, 'verify-multi-editor');
  await (await findVisible(driver, '.verify__editor--multi .verify__edit-confirm')).click();
  await driver.sleep(2500);
  card = await cardFor(driver, 'data_source');
  const text = card === null ? '' : (await card.getText()).replace(/\s+/g, ' ');
  log(`  確定後のカード: ${text.slice(0, 300)}`);
  (text.includes('Students | Other: Standardized patients') ? ok : ng)('確定値が「Students | Other: Standardized patients」と表示される');
  await openApp(driver, '#/home');
  const study = await sheetHeader(driver, 'StudyData');
  const col = study.header.indexOf('data_source');
  const annotatorIdx = study.header.indexOf('annotator');
  for (const row of study.rows.slice(2)) {
    log(`  StudyData: annotator=${row[annotatorIdx]} data_source="${row[col] ?? ''}"`);
  }
}

async function quoteSetsSummary(driver) {
  const project = await currentProject(driver);
  const rows = await readSheet(driver, project.spreadsheetId, 'QuoteSets');
  const header = rows[1] ?? [];
  // タブが無いとき gviz は先頭のタブ（Meta）を返すので、ヘッダの 1 列目で判定する
  if (header[0] !== 'set_id') return { exists: false, header, data: [] };
  return { exists: true, header, data: rows.slice(2) };
}

async function sceneQuoteEdit(driver) {
  log('\n[quote-edit] 判定画面: 引用の削除 → QuoteSets の作成 → 再読み込み → AI の引用に戻す');
  await ensureLogin(driver);
  await openApp(driver, '#/home');
  const before = await quoteSetsSummary(driver);
  log(`  操作前の QuoteSets: ${before.exists ? `あり（${before.data.length} 行）` : 'タブなし'}`);
  await openVerifyList(driver);
  // 削除ボタンを持つ（= AI の引用がある）最初のカードを対象にする
  const target = await driver.executeScript(
    'const card = [...document.querySelectorAll(".verify__cell")].find((c) => c.querySelector(".verify__quote-remove") && c.querySelectorAll(".verify__quote-remove").length === 1);' +
      'return card ? card.querySelector(".verify__cell-name").textContent.trim() : null;',
  );
  if (target === null) throw new Error('引用が 1 件のセルが見つかりません');
  log(`  対象の項目: ${target}`);
  let card = await cardFor(driver, target);
  await driver.executeScript('arguments[0].scrollIntoView({ block: "center" });', card);
  const quoteText = await (await card.findElement(By.css('.verify__quote-text'))).getText();
  const hlBefore = (await driver.findElements(By.css('.pdf-viewer__hl'))).length;
  log(`  引用: "${quoteText.slice(0, 80)}" / いまのページのハイライト ${hlBefore} 個`);
  await (await card.findElement(By.css('.verify__quote-remove'))).click();
  await driver.wait(async () => {
    const c = await cardFor(driver, target);
    return c !== null && (await c.findElements(By.css('.verify__quote-empty'))).length > 0;
  }, 20000, '「引用はすべて外されています」が出ません');
  await driver.sleep(3000);
  card = await cardFor(driver, target);
  const afterRemove = (await card.getText()).replace(/\s+/g, ' ');
  (afterRemove.includes('引用はすべて外されています') && !afterRemove.includes(quoteText.slice(0, 40)) ? ok : ng)(
    '削除後: 「引用はすべて外されています」が出て、AI の引用文が出ない',
  );
  ((await card.findElements(By.css('.verify__quote-error'))).length === 0 ? ok : ng)('保存エラーが出ていない');
  await saveShot(driver, 'quote-edit-removed');
  await openApp(driver, '#/home');
  const afterSheet = await quoteSetsSummary(driver);
  (afterSheet.exists ? ok : ng)(`QuoteSets タブが作られた（ヘッダ ${afterSheet.header.length} 列: ${afterSheet.header.slice(0, 4).join(' / ')} …）`);
  const kindIdx = afterSheet.header.indexOf('kind');
  const annotatorIdx = afterSheet.header.indexOf('annotator');
  const typeIdx = afterSheet.header.indexOf('annotator_type');
  for (const row of afterSheet.data.slice(-2)) {
    log(`  QuoteSets の行: kind=${row[kindIdx]} annotator=${row[annotatorIdx]} type=${row[typeIdx]}`);
  }
  // 再読み込みしても「全部外した」が保たれるか
  await openVerifyList(driver);
  card = await cardFor(driver, target);
  await driver.executeScript('arguments[0].scrollIntoView({ block: "center" });', card);
  const reloaded = (await card.getText()).replace(/\s+/g, ' ');
  (reloaded.includes('引用はすべて外されています') ? ok : ng)('再読み込み後も「引用はすべて外されています」のまま（AI の引用が復活しない）');
  await (await card.findElement(By.css('.verify__quote-reset'))).click();
  await driver.wait(async () => {
    const c = await cardFor(driver, target);
    return c !== null && (await c.getText()).includes(quoteText.slice(0, 30));
  }, 20000, 'AI の引用が戻りません');
  ok('「AI の引用に戻す」で AI の引用が戻った');
  await driver.sleep(2500);
  await openApp(driver, '#/home');
  const finalSheet = await quoteSetsSummary(driver);
  log(`  QuoteSets の最終行: kind=${finalSheet.data.at(-1)?.[kindIdx]}（${finalSheet.data.length} 行）`);
}

async function scenePdfAdd(driver) {
  log('\n[pdf-add] PDF で文を選んで根拠に追加（実 PDF）');
  await ensureLogin(driver);
  await openVerifyList(driver);
  const spans = await driver.executeScript(
    'return [...document.querySelectorAll(".pdf-viewer__text-layer span")].filter((s) => s.textContent.trim().length > 25).length;',
  );
  log(`  1 ページ目のテキスト層: 25 文字超の span が ${spans} 個`);
  if (spans === 0) throw new Error('テキスト層が描かれていません');
  // テキスト層の位置合わせを目で見るため、文字を一時的に赤い半透明にして撮る
  await driver.executeScript(
    'const style = document.createElement("style"); style.id = "tl-debug"; style.textContent = ".pdf-viewer__text-layer span{color:rgba(255,0,0,.55)!important}"; document.head.append(style);',
  );
  await saveShot(driver, 'pdf-add-textlayer-overlay');
  await driver.executeScript('document.querySelector("#tl-debug")?.remove();');
  // 対象のセル: data_source（複数選択。選択肢の指定が必須になる）
  let card = await cardFor(driver, 'data_source');
  if (card === null) {
    // 判定済みのセルは一覧の下のコンパクト行にある。クリックで詳細カードを開く
    const opened = await driver.executeScript(
      'const row = [...document.querySelectorAll("button.verify__cell--decided")].find((b) => b.querySelector(".verify__cell-label")?.textContent.trim() === "データの取得元");' +
        'if (!row) return false; row.scrollIntoView({ block: "center" }); row.click(); return true;',
    );
    if (!opened) throw new Error('data_source のセルが見つかりません');
    await driver.sleep(1000);
    card = await cardFor(driver, 'data_source');
    if (card === null) throw new Error('data_source の詳細カードが開きません');
    log('  判定済みの行を開いて詳細カードを表示');
  }
  await driver.executeScript('arguments[0].scrollIntoView({ block: "center" });', card);
  await (await card.findElement(By.css('.verify__cell-label'))).click();
  await driver.sleep(800);
  const before = await driver.executeScript(
    'const c = [...document.querySelectorAll(".verify__cell")].find((x) => x.querySelector(".verify__cell-name")?.textContent.trim() === "data_source");' +
      'return { quotes: c.querySelectorAll(".verify__quotes-item").length, human: c.querySelectorAll(".verify__quote-source").length };',
  );
  log(`  追加前: 引用 ${before.quotes} 件・人が追加 ${before.human} 件`);
  const selected = await driver.executeScript(
    'const span = [...document.querySelectorAll(".pdf-viewer__text-layer span")].find((s) => s.textContent.trim().length > 25);' +
      'span.scrollIntoView({ block: "center" });' +
      'const range = document.createRange(); range.selectNodeContents(span);' +
      'const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(range);' +
      'span.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));' +
      'return sel.toString();',
  );
  log(`  選んだ文: "${selected}"`);
  await waitVisible(driver, '.verify__quote-add', 10000, '追加バーが出ません');
  log(`  追加バー: ${(await textOf(driver, '.verify__quote-add')).replace(/\s+/g, ' ').slice(0, 250)}`);
  const disabledBefore = await driver.executeScript('return document.querySelector(".verify__quote-add-confirm").disabled;');
  (disabledBefore ? ok : ng)('複数選択の項目では、選択肢を選ぶまで「追加」が押せない');
  // 節の入力欄をクリックして文字を入れる（入力欄へフォーカスを移してもバーが消えないこと）
  const section = await findVisible(driver, '.verify__quote-add-section');
  await section.click();
  await section.sendKeys('Methods (実機確認)');
  await driver.sleep(500);
  ((await findVisible(driver, '.verify__quote-add')) !== null ? ok : ng)('節の入力欄に入力しても追加バーが消えない');
  await setValue(driver, 'select.verify__quote-add-theme', 'Records themselves');
  await driver.sleep(500);
  await saveShot(driver, 'pdf-add-bar');
  await (await findVisible(driver, '.verify__quote-add-confirm')).click();
  await driver.sleep(3500);
  const after = await driver.executeScript(
    'const c = [...document.querySelectorAll(".verify__cell")].find((x) => x.querySelector(".verify__cell-name")?.textContent.trim() === "data_source");' +
      'return { quotes: c.querySelectorAll(".verify__quotes-item").length, human: c.querySelectorAll(".verify__quote-source").length, error: c.querySelector(".verify__quote-error")?.textContent ?? "", text: c.textContent.replace(/\\s+/g, " ").slice(0, 900) };',
  );
  log(`  追加後: 引用 ${after.quotes} 件・人が追加 ${after.human} 件 / エラー "${after.error}"`);
  (after.quotes === before.quotes + 1 && after.human === before.human + 1 && after.error === '' ? ok : ng)(
    '一覧の末尾に「人が追加」の引用が 1 件増えた',
  );
  const active = (await driver.findElements(By.css('.pdf-viewer__hl--active'))).length;
  (active > 0 ? ok : ng)(`足した引用のハイライトが PDF 上で強調されている（強調中の矩形 ${active} 個）`);
  await saveShot(driver, 'pdf-add-done');
  await openApp(driver, '#/home');
  const sheet = await quoteSetsSummary(driver);
  const idx = (name) => sheet.header.indexOf(name);
  const setId = sheet.data.at(-1)?.[idx('set_id')];
  for (const row of sheet.data.filter((r) => r[idx('set_id')] === setId)) {
    log(`  QuoteSets: seq=${row[idx('seq')]} source=${row[idx('source')]} theme="${row[idx('theme')]}" page=${row[idx('page')]} section="${row[idx('section')]}" anchor=${row[idx('anchor_status')]} quote="${String(row[idx('quote')]).slice(0, 60)}"`);
  }
}

async function sceneExport(driver) {
  log('\n[export] 書き出し: study_wide の 1/0 列と evidence_quotes');
  await ensureLogin(driver);
  await openApp(driver, '#/export');
  await waitVisible(driver, '#export-format', 90000, '#/export が表示されません');
  const preview = async (format) => {
    await (await driver.findElement(By.css(`#export-format input[value=${format}]`))).click();
    await waitVisible(driver, '#export-summary', 30000, `${format} のサマリが出ません`);
    await driver.sleep(1500);
    return driver.executeScript(
      'const t = document.querySelector("#export-preview"); if (!t) return null;' +
        'return { head: [...t.querySelectorAll("thead th")].map((c) => c.textContent.trim()),' +
        ' rows: [...t.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent.trim())) };',
    );
  };
  const wide = await preview('study_wide');
  if (wide === null) throw new Error('study_wide のプレビューがありません');
  const at = wide.head.indexOf('data_source');
  const multiCols = wide.head.filter((h) => h.startsWith('data_source__'));
  log(`  study_wide の data_source まわりの列: ${wide.head.slice(at, at + 1 + multiCols.length).join(' | ')}`);
  for (const row of wide.rows) {
    log(`  値: ${row.slice(at, at + 1 + multiCols.length).join(' | ')}`);
  }
  (multiCols.length === 7 ? ok : ng)(`選択肢ごとの列が 7 個（6 選択肢 + Other の説明）: 実際 ${multiCols.length} 個`);
  await saveShot(driver, 'export-study-wide');
  const quotes = await preview('evidence_quotes');
  if (quotes === null) throw new Error('evidence_quotes のプレビューがありません');
  log(`  evidence_quotes のヘッダ（${quotes.head.length} 列）: ${quotes.head.join(' | ')}`);
  const col = (name) => quotes.head.indexOf(name);
  const source = quotes.rows.filter((r) => r[col('field_name')] === 'data_source');
  for (const row of source) {
    log(`  data_source: annotator=${row[col('annotator')]} source=${row[col('source')]} theme="${row[col('theme')]}" page=${row[col('page')]} section="${row[col('section')]}" is_final=${row[col('is_final')]} quote="${row[col('quote')].slice(0, 50)}"`);
  }
  log(`  プレビュー ${quotes.rows.length} 行のうち is_final=TRUE: ${quotes.rows.filter((r) => r[col('is_final')] === 'TRUE').length} 行`);
  (quotes.head.length === 17 ? ok : ng)('evidence_quotes が 17 列');
  await saveShot(driver, 'export-evidence-quotes');
}

async function sceneLook(driver) {
  log('[look] 複数選択のセルの詳細カードを撮る');
  await ensureLogin(driver);
  await openVerifyList(driver);
  await driver.executeScript(
    'const row = [...document.querySelectorAll("button.verify__cell--decided")].find((b) => b.querySelector(".verify__cell-label")?.textContent.trim() === "データの取得元");' +
      'if (row) { row.scrollIntoView({ block: "center" }); row.click(); }',
  );
  await driver.sleep(1200);
  const card = await cardFor(driver, 'data_source');
  if (card === null) throw new Error('data_source のカードが開きません');
  await driver.executeScript('arguments[0].scrollIntoView({ block: "start" });', card);
  await driver.sleep(500);
  await saveShot(driver, 'look-card');
}

const SCENES = {
  look: sceneLook,
  probe: sceneProbe,
  'schema-multi': sceneSchemaMulti,
  extract: sceneExtract,
  'verify-multi': sceneVerifyMulti,
  'quote-edit': sceneQuoteEdit,
  'pdf-add': scenePdfAdd,
  export: sceneExport,
};

async function main() {
  const names = process.argv.slice(2).filter((arg, i, all) => !arg.startsWith('--') && !(all[i - 1] ?? '').startsWith('--'));
  for (const name of names) {
    if (!(name in SCENES)) {
      console.error(`未知のシーン: ${name}（使用可能: ${Object.keys(SCENES).join(' / ')}）`);
      process.exit(1);
    }
  }
  if (!existsSync(path.join(DIST_DIR, 'manifest.json'))) {
    console.error('dist/ がありません。先に npm run dev を実行してください');
    process.exit(1);
  }
  const options = new chrome.Options().addArguments(
    `--user-data-dir=${PROFILE_DIR}`,
    '--profile-directory=Default',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1500,1000',
  );
  const driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
  let failed = false;
  let current = '';
  try {
    for (const name of names) {
      current = name;
      await SCENES[name](driver);
    }
    log('\n完了');
  } catch (err) {
    failed = true;
    console.error(`\n中断（${current}）: ${err instanceof Error ? err.message : String(err)}`);
    try {
      writeFileSync(path.join(OUT_DIR, `${current}-failure.png`), await driver.takeScreenshot(), 'base64');
      writeFileSync(path.join(OUT_DIR, `${current}-failure.html`), await driver.getPageSource());
      console.error(`失敗時の状態: ${path.join(OUT_DIR, `${current}-failure.png`)}`);
    } catch {
      // ブラウザごと落ちた場合は保存できない
    }
  } finally {
    await driver.quit().catch(() => undefined);
  }
  process.exit(failed ? 1 : 0);
}

void main();
