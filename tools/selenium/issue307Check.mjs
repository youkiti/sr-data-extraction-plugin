// issue #307 の実機確認用シーン（未コミットの作業用スクリプト）。
// manualCheck.mjs と同じ専用プロファイル（.selenium-profile/）の Chrome を使い、
// 複数選択・引用の編集・PDF からの追加・書き出しを本物の Google API で通す。
//
// 使い方: node tools/selenium/issue307Check.mjs <scene> [<scene> ...] [--out <dir>]
//   probe            現在のプロジェクトと各タブのヘッダ・行数を表示する
//   2026-10-05（manual-testing.md §9 #1〜#6）: schema-multi / extract / verify-multi / quote-edit / pdf-add / export
//   2026-10-06（同 #7a・#8）:
//     upload --files a.pdf,b.pdf        PC から PDF を取り込む
//     extract --studies a.pdf,b.pdf     指定した文献だけを一括抽出する（実 API）
//     textlayer --file a.pdf --page 3 --zoom 1.5 --match "…" --spans 2 [--field x --tab 1] [--expect none]
//                                       テキスト層の文を選んで根拠に追加し、位置を測る
//     verify-all --file a.pdf [--arms-only yes]   owner として群構成を確定し、全セルを判定する
//     seed-b --file a.pdf --b-quote-study "…" --b-quote-arm "…"   架空の 2 人目の行をシートへ直接書き込む
//     adjudicate / export-quotes --file a.pdf     裁定画面と、根拠の表の is_final を確かめる
//     dump --sheets A,B / peek --hash '#/verify' --file a.pdf     シートの中身・画面を保存する
// シートを直接読み書きするシーン（dump / seed-b / seed-dedupe など）は、拡張のページから拡張自身の
// トークンで Sheets API を呼ぶ。seed-b は実プロジェクトへ架空のレビュアーの行を追記するので、確認用の
// プロジェクトでだけ使う。
// 各シーンは失敗時に out/<scene>-failure.png と .html を保存して終了コード 1 で終わる。
import { createHash, randomUUID } from 'node:crypto';
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
let ngCount = 0;
function ng(message) {
  ngCount++;
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
    // アクセストークンは約 1 時間で切れる。ログインを押し直す（Google のセッションが残っていれば、
    // 同意画面は操作なしで閉じる。アカウントの選択を求められたら、開いた窓で本人が選ぶ）
    await driver.findElement(By.css('#login-button')).click();
    log('  ログインし直します（最大 3 分待機）…');
    await driver.wait(async () => (await findVisible(driver, '#popup-projects')) !== null, 3 * 60 * 1000, 'ログインが完了しません（開いた Chrome の窓で Google アカウントを選んでください）');
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
  // --studies（ファイル名のカンマ区切り）があれば、その文献だけを選ぶ。無ければ選べる文献をすべて選ぶ
  const wanted = optionValue('--studies', '').split(',').filter((name) => name !== '');
  const states = await driver.executeScript(
    'return [...document.querySelectorAll("#extract-studies .extract__study-item")].map((li) => {' +
      ' const box = li.querySelector("input[type=checkbox]");' +
      ' return { checked: box.checked, disabled: box.disabled, files: [...li.querySelectorAll(".extract__doc-filename")].map((el) => el.textContent.trim()) }; });',
  );
  for (let i = 0; i < states.length; i++) {
    const want = wanted.length === 0 ? true : states[i].files.some((file) => wanted.includes(file));
    if (states[i].checked !== want && !states[i].disabled) {
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

/** Documents タブのファイル名から study_id を引く */
async function studyIdByFile(driver, filename) {
  const project = await currentProject(driver);
  const rows = await apiReadSheet(driver, project.spreadsheetId, 'Documents');
  const row = rows.slice(1).find((r) => r[rows[0].indexOf('filename')] === filename);
  if (row === undefined) throw new Error(`Documents に ${filename} がありません`);
  return row[rows[0].indexOf('study_id')];
}

async function gotoPdfPage(driver, page) {
  for (let guard = 0; guard < 80; guard++) {
    const current = Number(((await textOf(driver, '.pdf-viewer__page-indicator')).match(/\d+/) ?? ['0'])[0]);
    if (current === page) return;
    await (await findVisible(driver, current < page ? '.pdf-viewer__next' : '.pdf-viewer__prev')).click();
    await driver.sleep(400);
  }
  throw new Error(`PDF の ${page} ページ目へ移れません`);
}

/** 検証画面のセル一覧のタブ（0 = Study / 1 = 群 / 2 = アウトカム）を開く。鍵つき・無いタブは false */
async function selectVerifyTab(driver, index) {
  const opened = await driver.executeScript(
    'const tab = document.querySelectorAll(".verify__tabs .verify__tab")[arguments[0]];' +
      'if (!tab || tab.classList.contains("verify__tab--locked") || tab.disabled) return false;' +
      'tab.click(); return true;',
    index,
  );
  if (opened) await driver.sleep(800);
  return opened;
}

async function openVerifyList(driver, studyId = null) {
  await openApp(driver, studyId === null ? '#/verify' : `#/verify?study=${encodeURIComponent(studyId)}`);
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

/** --sheets で指定したタブ（カンマ区切り）の全行を out/dump-<tab>.json へ保存し、ヘッダと行数を表示する */
async function sceneDump(driver) {
  log('\n[dump] シートの中身を保存する');
  await ensureLogin(driver);
  await openApp(driver, '#/home');
  const project = await currentProject(driver);
  const sheets = optionValue('--sheets', 'SchemaFields,Studies,Documents,StudyData,ResultsData,ArmStructures,Decisions,Reviewers,QuoteSets').split(',');
  for (const sheet of sheets) {
    const rows = await apiReadSheet(driver, project.spreadsheetId, sheet);
    writeFileSync(path.join(OUT_DIR, `dump-${sheet}.json`), JSON.stringify(rows, null, 1));
    log(`  ${sheet}: データ ${Math.max(rows.length - 1, 0)} 行 / ヘッダ ${(rows[0] ?? []).join(' | ').slice(0, 400)}`);
  }
}

/**
 * 拡張のページから、拡張自身のアクセストークンで Sheets API を呼ぶ（トークンはブラウザの外へ出さない）。
 * gviz は数値列のヘッダや型の混ざった列の値を落とすので、行を正確に読み書きするときはこちらを使う
 */
async function sheetsApi(driver, method, url, body) {
  await driver.manage().setTimeouts({ script: 60000 });
  const result = await driver.executeAsyncScript(
    'const [method, url, body, done] = arguments;' +
      'chrome.runtime.sendMessage({ type: "auth:get-token", interactive: false }).then(async (res) => {' +
      '  if (!res || !res.ok || !res.token) { done({ error: "トークンを取得できません" }); return; }' +
      '  const r = await fetch(url, { method, headers: { Authorization: "Bearer " + res.token, "Content-Type": "application/json" },' +
      '    body: body === null ? undefined : JSON.stringify(body) });' +
      '  done({ status: r.status, json: await r.json().catch(() => null) });' +
      '}).catch((e) => done({ error: String(e) }));',
    method,
    url,
    body ?? null,
  );
  if (result.error !== undefined || result.status !== 200) {
    throw new Error(`Sheets API 失敗: ${result.error ?? `HTTP ${result.status} ${JSON.stringify(result.json?.error?.message ?? '')}`}`);
  }
  return result.json;
}

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * タブの全行（1 行目 = ヘッダ）を返す。タブが無ければ空配列。
 * raw = true は数値・真偽値を型のまま返す（行を写して書き戻すとき、セルの型を変えないため）
 */
async function apiReadSheet(driver, spreadsheetId, sheet, raw = false) {
  const meta = await sheetsApi(driver, 'GET', `${SHEETS_API}/${spreadsheetId}?fields=sheets.properties.title`);
  if (!meta.sheets.some((s) => s.properties.title === sheet)) return [];
  const json = await sheetsApi(
    driver,
    'GET',
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(sheet)}${raw ? '?valueRenderOption=UNFORMATTED_VALUE' : ''}`,
  );
  return json.values ?? [];
}

/** ヘッダ行つきの行列を、列名で引けるオブジェクトの配列にする（行末の空セルは空文字で埋める） */
function toRecords(rows) {
  const header = rows[0] ?? [];
  return rows.slice(1).map((row) => Object.fromEntries(header.map((name, index) => [name, row[index] ?? ''])));
}

/** タブの末尾へ行を追記し、追記された行数を返す（拡張の appendRows と同じ RAW・INSERT_ROWS） */
async function apiAppendRows(driver, spreadsheetId, sheet, rows) {
  if (rows.length === 0) return 0;
  const json = await sheetsApi(
    driver,
    'POST',
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${sheet}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { values: rows },
  );
  return json.updates?.updatedRows ?? 0;
}

/** --files で指定した PDF（カンマ区切りの絶対パス）を PC からの取り込みで足す。取り込み済みのファイル名は飛ばす */
async function sceneUpload(driver) {
  log('\n[upload] PC から PDF を取り込む');
  await ensureLogin(driver);
  await openApp(driver, '#/home');
  const project = await currentProject(driver);
  const before = await apiReadSheet(driver, project.spreadsheetId, 'Documents');
  const nameIdx = before[0].indexOf('filename');
  const existing = new Set(before.slice(1).map((row) => row[nameIdx]));
  const files = optionValue('--files', '').split(',').filter((file) => file !== '' && !existing.has(path.basename(file)));
  if (files.length === 0) {
    log('  取り込む PDF がありません（すべて取り込み済み）');
    return;
  }
  for (const file of files) {
    if (!existsSync(file)) throw new Error(`ファイルがありません: ${file}`);
  }
  await openApp(driver, '#/documents');
  await driver.wait(async () => {
    const button = await findVisible(driver, '#documents-local-import');
    return button !== null && (await button.isEnabled());
  }, 30000, 'PC からの取り込みボタンが有効になりません');
  await driver.findElement(By.css('#documents-file-input[type="file"]')).sendKeys(files.join('\n'));
  await driver.wait(until.elementLocated(By.css('#documents-progress')), 30000, '取り込みが始まりません');
  await driver.wait(async () => {
    try {
      return await driver.findElement(By.css('#documents-import')).isEnabled();
    } catch {
      return false;
    }
  }, 10 * 60 * 1000, '取り込みが完了しません');
  const statuses = await driver.executeScript(
    'return [...document.querySelectorAll(".documents__progress-status")].map((el) => el.textContent.trim());',
  );
  for (const text of statuses) log(`  進捗行: ${text}`);
  await saveShot(driver, 'upload-done');
  const after = await apiReadSheet(driver, project.spreadsheetId, 'Documents');
  const col = (name) => after[0].indexOf(name);
  for (const row of after.slice(before.length)) {
    log(`  Documents: ${row[col('filename')]} / text_status=${row[col('text_status')]} / pages=${row[col('page_count')]} / chars=${row[col('char_count')]}`);
  }
  (after.length - before.length === files.length ? ok : ng)(`Documents に ${files.length} 行追記された（実際 ${after.length - before.length} 行）`);
}

/** ページ（.pdf-viewer__page）の左上を原点にした矩形の一覧を返す */
const PAGE_RECTS_JS =
  'const origin = document.querySelector(".pdf-viewer__page").getBoundingClientRect();' +
  'const rel = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height }; };';

/**
 * テキスト層の位置合わせ（§9 #8）。--file の文献の --page ページ目を --zoom 倍で開き、
 * テキスト層の文（--match を含む span から --spans 個。既定は 40 文字超の最初の span）を選んで
 * --field のセルの根拠に追加する。選んだ span と、追加後に描かれたハイライトの重なりを数値で出す。
 * --expect none のときは、テキスト層が無く文を選べないことだけを確かめる（スキャン PDF）
 */
async function sceneTextLayer(driver) {
  const file = optionValue('--file', '');
  const page = Number(optionValue('--page', '1'));
  const zoom = optionValue('--zoom', '1');
  const match = optionValue('--match', '');
  const spanCount = Number(optionValue('--spans', '1'));
  const fieldName = optionValue('--field', 'funding_source');
  const tag = optionValue('--tag', `${path.basename(file, '.pdf')}-p${page}-z${zoom}`);
  const expectNone = optionValue('--expect', '') === 'none';
  log(`\n[textlayer] ${file} / ${page} ページ目 / ${Number(zoom) * 100}% / ${expectNone ? 'テキスト層なしを期待' : `"${match || '（自動）'}" から ${spanCount} span`}`);
  await ensureLogin(driver);
  await openApp(driver, '#/home');
  const project = await currentProject(driver);
  const studyId = await studyIdByFile(driver, file);
  await openVerifyList(driver, studyId);
  if (!expectNone) {
    // 先に追加先のセルを選ぶ（セルを選ぶと PDF が AI の引用のページへ移るため、ページ移動より前に行う）
    await selectVerifyTab(driver, Number(optionValue('--tab', '0')));
    const card = await cardFor(driver, fieldName);
    if (card === null) throw new Error(`${fieldName} のセルが見つかりません`);
    await driver.executeScript('arguments[0].scrollIntoView({ block: "center" });', card);
    await (await card.findElement(By.css('.verify__cell-label'))).click();
    await driver.sleep(800);
  }
  await gotoPdfPage(driver, page);
  await setValue(driver, '.pdf-viewer__zoom', zoom);
  await driver
    .wait(async () => (await driver.executeScript('return document.querySelectorAll(".pdf-viewer__text-layer span").length;')) > 0, 12000)
    .catch(() => undefined);
  await driver.sleep(2000);
  const layer = await driver.executeScript(
    'return { spans: document.querySelectorAll(".pdf-viewer__text-layer span").length,' +
      ' selectable: document.querySelector(".pdf-viewer__page").classList.contains("pdf-viewer__page--selectable"),' +
      ' zoom: document.querySelector(".pdf-viewer__zoom").value, indicator: document.querySelector(".pdf-viewer__page-indicator").textContent,' +
      ' banner: (document.querySelector(".verify__no-text-banner, #verify-no-text-banner")?.textContent ?? "").trim() };',
  );
  log(`  表示: ${layer.indicator} / ズーム ${layer.zoom} / テキスト層の span ${layer.spans} 個 / 選択可の印 ${layer.selectable}`);
  if (expectNone) {
    (layer.spans === 0 && !layer.selectable ? ok : ng)('テキスト層が無く、文を選べない');
    await saveShot(driver, `textlayer-${tag}`);
    ((await findVisible(driver, '.verify__quote-add')) === null ? ok : ng)('追加バーが出ていない');
    return;
  }
  if (layer.spans === 0) throw new Error('テキスト層が描かれていません');
  // 位置合わせを目で見るため、テキスト層の文字を赤い半透明にして撮る
  await driver.executeScript(
    'const style = document.createElement("style"); style.id = "tl-debug"; style.textContent = ".pdf-viewer__text-layer span{color:rgba(255,0,0,.55)!important}"; document.head.append(style);',
  );
  const picked = await driver.executeScript(
    'const [match, count] = arguments;' +
      'const spans = [...document.querySelectorAll(".pdf-viewer__text-layer span")].filter((s) => s.textContent.trim().length > 0);' +
      'const start = match ? spans.findIndex((s) => s.textContent.includes(match)) : spans.findIndex((s) => s.textContent.trim().length > 40);' +
      'if (start < 0) return null;' +
      'const chosen = spans.slice(start, start + count);' +
      'chosen[0].scrollIntoView({ block: "center", inline: "center" });' +
      'const range = document.createRange(); range.setStart(chosen[0].firstChild, 0);' +
      'const last = chosen[chosen.length - 1]; range.setEnd(last.lastChild, last.lastChild.textContent.length);' +
      'const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(range);' +
      'chosen[0].dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));' +
      PAGE_RECTS_JS +
      // canvas 上で、選んだ span の矩形に入る画素のうち暗い画素（文字のインク）の割合
      'const canvas = document.querySelector(".pdf-viewer__canvas"); const ctx = canvas.getContext("2d");' +
      'const cr = canvas.getBoundingClientRect(); const sx = canvas.width / cr.width; const sy = canvas.height / cr.height;' +
      'const ink = (el) => { const r = el.getBoundingClientRect();' +
      // canvas の外へはみ出した分は数えない（はみ出しは透明な黒で返り、暗い画素に見えるため）。分母は span の矩形全体
      '  const x0 = Math.round((r.left - cr.left) * sx); const y0 = Math.round((r.top - cr.top) * sy);' +
      '  const fullW = Math.max(1, Math.round(r.width * sx)); const fullH = Math.max(1, Math.round(r.height * sy));' +
      '  const x = Math.max(0, x0); const y = Math.max(0, y0);' +
      '  const w = Math.min(canvas.width, x0 + fullW) - x; const h = Math.min(canvas.height, y0 + fullH) - y;' +
      '  if (w <= 0 || h <= 0) return 0;' +
      '  const d = ctx.getImageData(x, y, w, h).data; let dark = 0;' +
      '  for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 0 && d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < 128) dark++; }' +
      '  return dark / (fullW * fullH); };' +
      'return { text: sel.toString(), rects: chosen.map(rel), ink: chosen.map(ink),' +
      ' before: [...document.querySelectorAll(".pdf-viewer__overlay .pdf-viewer__hl")].map(rel) };',
    match,
    spanCount,
  );
  if (picked === null) throw new Error(`"${match}" を含む span がテキスト層にありません`);
  log(`  選んだ文: "${picked.text.replace(/\s+/g, ' ').slice(0, 120)}"`);
  log(`  span の矩形（ページ左上が原点・px）: ${picked.rects.map((r) => `(${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.w.toFixed(0)}x${r.h.toFixed(0)})`).join(' ')}`);
  log(`  span の矩形に入る canvas の暗い画素の割合: ${picked.ink.map((v) => `${(v * 100).toFixed(1)}%`).join(' / ')}`);
  (picked.ink.every((v) => v >= 0.03) ? ok : ng)('選んだ span の位置に、紙面の文字（暗い画素 3% 以上）がある');
  await saveShot(driver, `textlayer-${tag}-overlay`);
  await driver.executeScript('document.querySelector("#tl-debug")?.remove();');
  await waitVisible(driver, '.verify__quote-add', 10000, '追加バーが出ません');
  log(`  追加バー: ${(await textOf(driver, '.verify__quote-add')).replace(/\s+/g, ' ').slice(0, 200)}`);
  const cardState = () => driver.executeScript(
    'const c = [...document.querySelectorAll(".verify__cell")].find((x) => x.querySelector(".verify__cell-name")?.textContent.trim() === arguments[0]);' +
      'return c ? { quotes: c.querySelectorAll(".verify__quotes-item, .verify__quote-text").length, human: c.querySelectorAll(".verify__quote-source").length, error: c.querySelector(".verify__quote-error")?.textContent ?? "" } : null;',
    fieldName,
  );
  const beforeCard = await cardState();
  const confirm = await findVisible(driver, '.verify__quote-add-confirm');
  if (!(await confirm.isEnabled())) throw new Error(`「追加」を押せません: ${await textOf(driver, '.verify__quote-add-note')}`);
  await confirm.click();
  await driver.sleep(4000);
  const afterCard = await cardState();
  log(`  セルの引用: 人が追加 ${beforeCard?.human} → ${afterCard?.human} 件 / エラー "${afterCard?.error ?? ''}"`);
  (afterCard !== null && beforeCard !== null && afterCard.human === beforeCard.human + 1 && afterCard.error === '' ? ok : ng)('「人が追加」の引用が 1 件増えた');
  const after = await driver.executeScript(
    PAGE_RECTS_JS + 'return { hl: [...document.querySelectorAll(".pdf-viewer__overlay .pdf-viewer__hl")].map(rel), indicator: document.querySelector(".pdf-viewer__page-indicator").textContent };',
  );
  const keyOf = (r) => [r.x, r.y, r.w, r.h].map((v) => Math.round(v)).join(',');
  // 追加前の矩形を個数つきで差し引く（AI の引用が同じ行を塗っていると、同じ座標の矩形が重なって増える）
  const remaining = new Map();
  for (const r of picked.before) remaining.set(keyOf(r), (remaining.get(keyOf(r)) ?? 0) + 1);
  const added = after.hl.filter((r) => {
    const left = remaining.get(keyOf(r)) ?? 0;
    if (left > 0) remaining.set(keyOf(r), left - 1);
    return left === 0;
  });
  log(`  追加後: ${after.indicator} / ハイライト ${picked.before.length} → ${after.hl.length} 個（新しい矩形 ${added.length} 個）`);
  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const coverage = picked.rects.map((span) => Math.min(1, added.reduce((sum, r) => sum + overlap(span, r), 0) / (span.w * span.h)));
  log(`  span がハイライトに覆われる割合: ${coverage.map((v) => `${(v * 100).toFixed(0)}%`).join(' / ')}`);
  (added.length > 0 && coverage.every((v) => v >= 0.6) ? ok : ng)('足した引用のハイライトが、選んだ span の位置に描かれる（各 span の 60% 以上を覆う）');
  await saveShot(driver, `textlayer-${tag}-added`);
  const quoteSets = await apiReadSheet(driver, project.spreadsheetId, 'QuoteSets');
  const col = (name) => quoteSets[0].indexOf(name);
  const lastSetId = quoteSets.at(-1)[col('set_id')];
  const mine = quoteSets.filter((row) => row[col('set_id')] === lastSetId && row[col('source')] === 'human').at(-1);
  log(`  QuoteSets の最終行: study=${String(mine?.[col('study_id')]).slice(0, 8)} page=${mine?.[col('page')]} anchor=${mine?.[col('anchor_status')]} quote="${String(mine?.[col('quote')]).slice(0, 70)}"`);
  (mine !== undefined && mine[col('study_id')] === studyId && String(mine[col('page')]) === String(page) && ['exact', 'normalized', 'fuzzy'].includes(mine[col('anchor_status')]) ? ok : ng)(
    `QuoteSets に ${page} ページ目・照合成功（${mine?.[col('anchor_status')]}）で入った`,
  );
}

/**
 * owner（with_ai）として、--file の文献の群構成を確定し、未判定のセルをすべて判定する（§9 #7 の準備）。
 * AI の値があるセルは accept、無いセルは not_reported。Sheets の書き込み上限（毎分 60 回）に収まる間隔で押す
 */
/** 検証画面の「保存中（n 件）」の n。表示が無い・隠れているときは 0 */
async function savingCount(driver) {
  return driver.executeScript(
    'const el = document.querySelector("#verify-saving"); if (!el || el.hidden) return 0;' +
      'const m = el.textContent.match(/\\d+/); return m ? Number(m[0]) : -1;',
  );
}

async function sceneVerifyAll(driver) {
  const file = optionValue('--file', '');
  log(`\n[verify-all] ${file}: 群構成の確定と全セルの判定（owner・with_ai）`);
  await ensureLogin(driver);
  await openApp(driver, '#/home');
  const studyId = await studyIdByFile(driver, file);
  await openVerifyList(driver, studyId);
  const armConfirm = await findVisible(driver, '#verify-arm-confirm');
  if (armConfirm !== null) {
    log(`  群構成カード: ${(await textOf(driver, '#verify-arm-card')).replace(/\s+/g, ' ').slice(0, 300)}`);
    const names = await driver.executeScript('return [...document.querySelectorAll(".verify__arm-name")].map((el) => el.value ?? el.textContent);');
    log(`  確定する群: ${names.join(' / ')}`);
    await armConfirm.click();
    await driver.wait(async () => (await findVisible(driver, '#verify-arm-revise')) !== null, 30000, '群構成が確定しません');
    ok('群構成を確定した');
    await driver.sleep(2500);
  } else {
    log(`  群構成は確定済み: ${(await textOf(driver, '#verify-arm-card')).replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  // --arms-only yes: 群構成の確定までで止める（arm のセルへ先に引用を足すため）
  if (optionValue('--arms-only', '') === 'yes') {
    log(`  カード ${(await driver.findElements(By.css('.verify__cell'))).length} 件`);
    await saveShot(driver, `verify-arms-${path.basename(file, '.pdf')}`);
    return;
  }
  const counts = { accept: 0, not_reported: 0 };
  const savingTrace = [];
  let lastKey = '';
  let repeats = 0;
  for (let guard = 0, tab = 0; guard < 400; guard++) {
    const step = await driver.executeScript(
      'const card = [...document.querySelectorAll(".verify__cell")].find((c) => !c.classList.contains("verify__cell--decided") && !c.querySelector(".verify__action--undo:not([disabled])") && c.querySelector(".verify__action--accept:not([disabled]), .verify__action--not-reported:not([disabled])"));' +
        'if (!card) return null;' +
        'const accept = card.querySelector(".verify__action--accept"); const nr = card.querySelector(".verify__action--not-reported");' +
        'const button = accept && !accept.disabled ? accept : nr;' +
        'const key = card.textContent.replace(/\\s+/g, " ").slice(0, 90);' +
        'if (!button || button.disabled) return { stuck: key };' +
        'card.scrollIntoView({ block: "center" }); button.click();' +
        'return { key, action: button === accept ? "accept" : "not_reported" };',
    );
    if (step === null) {
      // このタブの未判定が無くなったら次のタブへ（Study → 群 → アウトカム）
      tab++;
      if (tab > 2) break;
      if (!(await selectVerifyTab(driver, tab))) log(`  タブ ${tab} は開けません（鍵つき・なし）`);
      continue;
    }
    if (step.stuck !== undefined) throw new Error(`判定ボタンを押せないセルがあります: ${step.stuck}`);
    repeats = step.key === lastKey ? repeats + 1 : 0;
    if (repeats >= 3) throw new Error(`同じセルが判定済みになりません: ${step.key}`);
    lastKey = step.key;
    counts[step.action]++;
    if (optionValue('--trace', '') === 'yes') log(`    ${step.action}: ${step.key.slice(0, 60)}`);
    await driver.sleep(Number(optionValue('--pace', '2200')));
    // 保存中（順番待ち + 実行中）の件数。押す間隔より保存が遅いと増えていく（issue #322）
    const saving = await savingCount(driver);
    savingTrace.push(saving);
  }
  log(`  押した判定: accept ${counts.accept} 件 / not_reported ${counts.not_reported} 件`);
  log(`  保存中の件数（判定を押した ${optionValue('--pace', '2200')} ms 後）: ${savingTrace.join(' ')}`);
  log(`  保存中の件数の最大: ${savingTrace.length === 0 ? 0 : Math.max(...savingTrace)} 件`);
  // 保存が全部終わるまで待つ（「保存中」の表示が消えるまで。閉じるのはそのあと）
  const waitStart = Date.now();
  await driver.wait(async () => (await savingCount(driver)) === 0, 300000, '保存中の表示が消えません');
  log(`  最後の判定から、保存中の表示が消えるまで: ${((Date.now() - waitStart) / 1000).toFixed(1)} 秒`);
  await driver.sleep(5000);
  log(`  進捗の表示: ${(await textOf(driver, '.verify__progress, .verify__tabs + *')).replace(/\s+/g, ' ').slice(0, 160)}`);
  const errors = await driver.executeScript('return [...document.querySelectorAll(".verify__error, .verify__queued, [role=alert], .toast")].map((el) => el.textContent.trim()).filter((t) => t !== "");');
  log(`  画面のエラー・保留の表示: ${errors.length === 0 ? 'なし' : errors.join(' / ').slice(0, 300)}`);
  await saveShot(driver, `verify-all-${path.basename(file, '.pdf')}`);
}

/** 架空の 2 人目のレビュアー（example.com は予約ドメイン。共有もメール送信もしない） */
const REVIEWER_B = 'zz-seeded-reviewer-b@example.com';
const SEED_NOTE = 'issue #307 実機確認: 架空の 2 人目（シートへ直接書き込み）';

/**
 * 架空の 2 人目（independent）の判定・群構成・引用を、owner の行を写してシートへ直接書き込む（§9 #7 の準備）。
 * - 群の順序は owner と逆にする（owner の arm:1 が B の arm:n）。arm を含む entity_key も B の番号へ付け替える
 * - --disagree（study レベルの field_name）の値と、arm:1 の --arm-field の値を owner と変えて、不一致セルを作る
 * - 引用: --study-field のセルに「owner が足した文と同じ文」と --b-quote-study を、
 *   --arm-field の「owner の arm:1 に当たる群」のセルに --b-quote-arm を入れる
 * 2 人目は実在しないので、別アカウントでのシート・PDF の読み取りは確かめられない。
 * 5 つのタブへ順に追記する。途中で失敗したら、書けたタブの 2 人目の行をシートで消してからやり直す
 */
async function sceneSeedB(driver) {
  const file = optionValue('--file', '');
  const disagreeField = optionValue('--disagree', 'country');
  const studyField = optionValue('--study-field', 'funding_source');
  const armField = optionValue('--arm-field', 'arm_allocated_n');
  const quoteStudy = { text: optionValue('--b-quote-study', ''), page: Number(optionValue('--b-quote-study-page', '1')) };
  const quoteArm = { text: optionValue('--b-quote-arm', ''), page: Number(optionValue('--b-quote-arm-page', '1')) };
  log(`\n[seed-b] ${file}: 架空の 2 人目（${REVIEWER_B}）の行を書き込む`);
  if (quoteStudy.text === '' || quoteArm.text === '') throw new Error('--b-quote-study と --b-quote-arm を指定してください');
  await ensureLogin(driver);
  await openApp(driver, '#/home');
  const { spreadsheetId } = await currentProject(driver);
  const studyId = await studyIdByFile(driver, file);
  const read = async (sheet) => apiReadSheet(driver, spreadsheetId, sheet, true);
  const [studyData, resultsData, decisions, arms, quoteSets, documents, fields] = [
    await read('StudyData'), await read('ResultsData'), await read('Decisions'), await read('ArmStructures'),
    await read('QuoteSets'), await read('Documents'), await read('SchemaFields'),
  ];
  const ofStudy = (rows) => toRecords(rows).filter((row) => row.study_id === studyId);
  // --only-missing yes: 2 人目の行が既にあるとき、owner にあって 2 人目に無いセルの判定とデータ行だけを足す
  const onlyMissing = optionValue('--only-missing', '') === 'yes';
  for (const [name, rows] of [['StudyData', studyData], ['ResultsData', resultsData], ['Decisions', decisions], ['ArmStructures', arms], ['QuoteSets', quoteSets]]) {
    if (!onlyMissing && ofStudy(rows).some((row) => row.annotator === REVIEWER_B)) {
      log(`  ${name} に 2 人目の行が既にあります。書き込みをやめます`);
      return;
    }
  }
  const owners = [...new Set(ofStudy(decisions).filter((row) => row.annotator_type === 'human_with_ai').map((row) => row.annotator))];
  if (owners.length !== 1) throw new Error(`with_ai の判定者が 1 人ではありません: ${owners.join(', ')}`);
  const owner = owners[0];
  const now = new Date().toISOString();
  const latestSchema = Math.max(...toRecords(fields).map((row) => Number(row.schema_version)));
  const fieldId = (name) => {
    const row = toRecords(fields).find((f) => Number(f.schema_version) === latestSchema && f.field_name === name);
    if (row === undefined) throw new Error(`項目 ${name} がありません`);
    return row.field_id;
  };

  // 群構成: owner の最新版を逆順にする
  const ownerArms = ofStudy(arms).filter((row) => row.annotator === owner);
  const armVersion = Math.max(...ownerArms.map((row) => Number(row.version)));
  const currentArms = ownerArms.filter((row) => Number(row.version) === armVersion);
  if (currentArms.length < 2) throw new Error(`owner の群が 2 つ未満です（${currentArms.length}）`);
  const armIndex = (key) => Number(String(key).slice('arm:'.length));
  const toB = new Map(currentArms.map((row) => [row.arm_key, `arm:${currentArms.length + 1 - armIndex(row.arm_key)}`]));
  const remap = (entityKey) => String(entityKey).split('|').map((segment) => toB.get(segment) ?? segment).join('|');
  const armRows = [...currentArms]
    .sort((a, b) => armIndex(toB.get(a.arm_key)) - armIndex(toB.get(b.arm_key)))
    .map((row) => [studyId, 1, toB.get(row.arm_key), row.arm_name, REVIEWER_B, 'human_independent', now, '']);
  for (const row of currentArms) log(`  群: owner ${row.arm_key} = "${row.arm_name}" → B ${toB.get(row.arm_key)}`);

  // StudyData: owner の行を写し、1 項目だけ値を変える
  const studyHeader = studyData[0];
  const ownerStudyRow = studyData.slice(1).find((row) => row[studyHeader.indexOf('study_id')] === studyId && row[studyHeader.indexOf('annotator')] === owner);
  if (ownerStudyRow === undefined) throw new Error('owner の StudyData 行がありません');
  if (!studyHeader.includes(disagreeField)) throw new Error(`StudyData に ${disagreeField} 列がありません`);
  const studyRow = studyHeader.map((name, index) => ownerStudyRow[index] ?? '');
  const disagreeValue = `${studyRow[studyHeader.indexOf(disagreeField)]} (B)`;
  studyRow[studyHeader.indexOf('annotator')] = REVIEWER_B;
  studyRow[studyHeader.indexOf('annotator_type')] = 'human_independent';
  studyRow[studyHeader.indexOf('updated_at')] = now;
  studyRow[studyHeader.indexOf(disagreeField)] = disagreeValue;

  // ResultsData: owner の行を写し、arm を付け替える。owner の arm:1 の --arm-field だけ値を変える
  const armFieldId = fieldId(armField);
  const changed = (row) => row.field_id === armFieldId && row.entity_key === 'arm:1';
  const bump = (value) => {
    if (value === '') return '999';
    if (!Number.isFinite(Number(value))) throw new Error(`--arm-field の値が数値ではありません: "${value}"`);
    return String(Number(value) + 1);
  };
  const ownerResults = ofStudy(resultsData).filter((row) => row.annotator === owner);
  const resultRows = ownerResults.map((row) => [
    randomUUID(), studyId, row.field_id, REVIEWER_B, 'human_independent', row.schema_version,
    remap(row.entity_key), '', changed(row) ? bump(row.value) : row.value, changed(row) ? false : row.not_reported, now,
  ]);

  // Decisions: セルごとに owner の最後の判定を写す（undo で終わるセルは未判定なので写さない）
  const lastDecision = new Map();
  for (const row of ofStudy(decisions).filter((d) => d.annotator === owner)) {
    lastDecision.set(`${row.field_id}\n${row.entity_key}`, row);
  }
  const disagreeFieldId = fieldId(disagreeField);
  const decisionRows = [...lastDecision.values()].filter((row) => row.action !== 'undo').map((row) => {
    const value = changed(row) ? bump(row.value) : row.field_id === disagreeFieldId ? disagreeValue : row.value;
    const action = changed(row) || row.field_id === disagreeFieldId || row.action === 'accept' ? 'edit' : row.action;
    return [now, REVIEWER_B, studyId, row.field_id, remap(row.entity_key), REVIEWER_B, 'human_independent', row.schema_version, action, value, SEED_NOTE];
  });

  // QuoteSets: study レベルのセルに 2 件（1 件は owner が足した文と同じ）、arm のセルに 1 件
  const documentId = toRecords(documents).find((row) => row.study_id === studyId).document_id;
  const studyFieldId = fieldId(studyField);
  const ownerHuman = ofStudy(quoteSets).filter((row) => row.annotator === owner && row.field_id === studyFieldId && row.source === 'human').at(-1);
  if (ownerHuman === undefined && !onlyMissing) throw new Error(`owner が ${studyField} に足した引用がありません（先に textlayer シーンで足してください）`);
  const quoteRow = (setId, field, entityKey, seq, quote) => [
    setId, now, REVIEWER_B, REVIEWER_B, 'human_independent', studyId, field, entityKey, latestSchema, 'quote', seq,
    randomUUID(), 'human', '', '', quote.documentId ?? documentId, quote.text, quote.page, '', '', 'exact', '',
  ];
  const setStudy = randomUUID();
  const setArm = randomUUID();
  const quoteRows = [
    quoteRow(setStudy, studyFieldId, '-', 1, { text: ownerHuman?.quote ?? '', page: ownerHuman?.page ?? 1, documentId: ownerHuman?.document_id }),
    quoteRow(setStudy, studyFieldId, '-', 2, quoteStudy),
    quoteRow(setArm, armFieldId, toB.get('arm:1'), 1, quoteArm),
  ];

  // 2 人目が既に持っているセル（B の番号の entity_key）
  // （タブごとに判定する。判定だけ・データ行だけが先に入っているセルを二重に書かないため）。
  // StudyData・群構成・引用は足さないので、study レベルのセルが不足しているときは使えない
  const cellsOfB = (rows) => new Set(ofStudy(rows).filter((row) => row.annotator === REVIEWER_B).map((row) => `${row.field_id}\n${row.entity_key}`));
  const missing = (have, fieldIdAt, entityKeyAt) => (row) => !have.has(`${row[fieldIdAt]}\n${row[entityKeyAt]}`);
  const missingDecisions = decisionRows.filter(missing(cellsOfB(decisions), 3, 4));
  if (onlyMissing && missingDecisions.some((row) => row[4] === '-')) throw new Error('study レベルのセルが不足しています（--only-missing では StudyData を直せません）');
  const plan = onlyMissing
    ? [['ResultsData', resultRows.filter(missing(cellsOfB(resultsData), 2, 6))], ['Decisions', missingDecisions]]
    : [['ArmStructures', armRows], ['StudyData', [studyRow]], ['ResultsData', resultRows], ['Decisions', decisionRows], ['QuoteSets', quoteRows]];
  for (const [sheet, rows] of plan) {
    const written = await apiAppendRows(driver, spreadsheetId, sheet, rows);
    (written === rows.length ? ok : ng)(`${sheet}: ${rows.length} 行を追記（API の応答 ${written} 行）`);
  }
  log(`  不一致にしたセル: ${disagreeField} = "${disagreeValue}" / ${armField}（owner の arm:1 = B の ${toB.get('arm:1')}）`);
  log(`  owner の判定 ${lastDecision.size} セル → 2 人目の判定 ${decisionRows.length} 行`);
}

/** 裁定画面のセル行（見出し・項目ラベル・状態・引用の候補）を読む */
async function adjudicateRows(driver) {
  return driver.executeScript(
    'return [...document.querySelectorAll("#adjudicate-cells tr.adjudicate__cell-row")].map((tr, index) => ({' +
      ' index, heading: tr.cells[0]?.textContent.trim() ?? "", label: tr.querySelector(".adjudicate__cell-label")?.textContent.trim() ?? "",' +
      ' status: [...tr.classList].find((c) => c.startsWith("adjudicate__cell-row--"))?.slice("adjudicate__cell-row--".length) ?? "",' +
      ' quotesStatus: tr.querySelector(".adjudicate__quotes-status")?.textContent.trim() ?? "",' +
      ' quotes: [...tr.querySelectorAll(".adjudicate__quotes li.adjudicate__quote")].map((li) => ({' +
      '   owner: li.querySelector(".adjudicate__quote-owner")?.textContent.trim() ?? "", text: li.querySelector("blockquote")?.textContent ?? "",' +
      '   adopted: li.querySelector(".adjudicate__quote-adopt")?.checked ?? null })) }));',
  );
}

/**
 * 裁定（§9 #7）: owner と架空の 2 人目の study を開き、群の対応づけ・両者の引用の並び・
 * 引用の採用（consensus の QuoteSets）・値の裁定を確かめる
 */
async function sceneAdjudicate(driver) {
  const file = optionValue('--file', '');
  const studyField = optionValue('--study-field', 'funding_source');
  const armField = optionValue('--arm-field', 'arm_allocated_n');
  const quoteStudy = optionValue('--b-quote-study', '');
  const quoteArm = optionValue('--b-quote-arm', '');
  log(`\n[adjudicate] ${file}: 裁定画面`);
  await ensureLogin(driver);
  await openApp(driver, '#/home');
  const { spreadsheetId } = await currentProject(driver);
  const studyId = await studyIdByFile(driver, file);
  const fields = toRecords(await apiReadSheet(driver, spreadsheetId, 'SchemaFields'));
  const latestSchema = Math.max(...fields.map((row) => Number(row.schema_version)));
  const field = (name) => fields.find((row) => Number(row.schema_version) === latestSchema && row.field_name === name);
  const ownerHuman = toRecords(await apiReadSheet(driver, spreadsheetId, 'QuoteSets'))
    .filter((row) => row.study_id === studyId && row.annotator_type === 'human_with_ai' && row.field_id === field(studyField).field_id && row.source === 'human')
    .at(-1);

  if (ownerHuman === undefined) throw new Error(`owner が ${studyField} に足した引用がありません`);
  await openApp(driver, '#/adjudicate');
  await waitVisible(driver, '#adjudicate-list, #adjudicate-empty', 90000, '裁定の一覧が表示されません');
  const listRows = await driver.executeScript(
    'return [...document.querySelectorAll("#adjudicate-list tr")].map((tr) => ({ id: tr.getAttribute("data-study-id"), text: tr.textContent.replace(/\\s+/g, " ").trim(), open: tr.querySelector(".adjudicate__open-button") !== null }));',
  );
  for (const row of listRows) log(`  一覧: ${row.text.slice(0, 200)}${row.open ? ' [裁定を開始できる]' : ''}`);
  (listRows.some((row) => row.id === studyId && row.open) ? ok : ng)('対象の study が「裁定を開始」できる（両者の検証が 100%）');
  await saveShot(driver, 'adjudicate-list');

  await openApp(driver, `#/adjudicate?study=${encodeURIComponent(studyId)}`);
  await waitVisible(driver, '#adjudicate-working', 90000, '裁定の作業画面が表示されません');
  await waitVisible(driver, '#adjudicate-arm-card', 30000, '群構成カードが表示されません');
  log(`  群構成カード: ${(await textOf(driver, '#adjudicate-arm-card')).replace(/\s+/g, ' ').slice(0, 400)}`);
  const mapping = await driver.executeScript(
    'return [...document.querySelectorAll("#adjudicate-arm-map tbody tr")].map((tr) => { const s = tr.querySelector("select"); return { a: tr.cells[0].textContent.trim(), bKey: s.value, bText: s.selectedOptions[0]?.textContent.trim() ?? "" }; });',
  );
  for (const row of mapping) log(`  群の対応: A "${row.a}" ↔ B ${row.bKey} "${row.bText}"`);
  if (mapping.length > 0) {
    (mapping.every((row) => row.bText.includes(row.a)) ? ok : ng)('順序を逆にした B の群が、名称の一致で A の群へ自動で対応づく');
    (mapping.some((row, index) => row.bKey !== `arm:${index + 1}`) ? ok : ng)('対応は位置（arm:1 ↔ arm:1）ではなく入れ替わっている');
  } else {
    log('  対応表は出ていません（群構成は確定済み）');
  }
  await saveShot(driver, 'adjudicate-arm-map');
  const armButton = (await findVisible(driver, '#adjudicate-arm-adopt')) ?? (await findVisible(driver, '#adjudicate-arm-confirm'));
  if (armButton !== null) {
    await armButton.click();
    await driver.wait(async () => (await findVisible(driver, '.adjudicate__arm-confirmed')) !== null, 30000, '群構成が確定しません');
    ok(`群構成を確定: ${(await textOf(driver, '#adjudicate-arm-card')).replace(/\s+/g, ' ').slice(0, 200)}`);
    await driver.sleep(2500);
  }

  await waitVisible(driver, '#adjudicate-cells', 30000, 'セル一覧が表示されません');
  // 既定は「不一致のみ」。一致セルの引用も見るので外す
  const showAll = async () => {
    const filter = await findVisible(driver, '#adjudicate-filter-mismatch');
    if (filter !== null && (await filter.isSelected())) {
      await filter.click();
      await driver.sleep(1200);
    }
  };
  await showAll();
  let rows = await adjudicateRows(driver);
  const byStatus = (list) => Object.entries(list.reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(' / ');
  log(`  セル ${rows.length} 行（${byStatus(rows)}）/ 引用の候補があるセル ${rows.filter((row) => row.quotes.length > 0).length} 行`);
  const studyRow = rows.find((row) => row.label === field(studyField).field_label);
  const armRows = rows.filter((row) => row.label === field(armField).field_label);
  if (studyRow === undefined || armRows.length < 2) throw new Error('対象のセル行が見つかりません');
  for (const quote of studyRow.quotes) log(`  ${studyField}: [${quote.owner}] "${quote.text.slice(0, 70)}" 採用=${quote.adopted}`);
  for (const row of armRows) {
    log(`  ${armField}（${row.heading.slice(0, 60)}）: ${row.quotes.map((q) => `[${q.owner}] "${q.text.slice(0, 50)}"`).join(' ; ') || '引用なし'}`);
  }
  const same = (a, b) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
  (studyRow.quotes.some((q) => q.owner === 'B' && same(q.text, quoteStudy)) ? ok : ng)('study レベルのセルに、B だけの引用が B の印で並ぶ');
  (studyRow.quotes.some((q) => q.owner === 'A') ? ok : ng)('同じセルに、A だけの引用が A の印で並ぶ');
  (studyRow.quotes.some((q) => !['A', 'B'].includes(q.owner) && same(q.text, String(ownerHuman?.quote ?? ''))) ? ok : ng)('両者が同じ文を足した引用は 1 件にまとまり「両者」の印になる');
  const withArmQuote = armRows.filter((row) => row.quotes.some((q) => same(q.text, quoteArm)));
  (withArmQuote.length === 1 && withArmQuote[0].index === armRows[0].index && withArmQuote[0].quotes.find((q) => same(q.text, quoteArm)).owner === 'B' ? ok : ng)(
    `B が自分の arm:${armRows.length}（= A の arm:1）に付けた引用が、A の arm:1 のセルにだけ出る`,
  );
  await saveShot(driver, 'adjudicate-cells');

  // 引用の採用: study セルの「B だけ」と「両者」、arm セルの B の引用
  const adopt = async (rowIndex, text) => {
    const clicked = await driver.executeScript(
      'const [rowIndex, text] = arguments; const norm = (s) => s.replace(/\\s+/g, " ").trim();' +
        'const tr = document.querySelectorAll("#adjudicate-cells tr.adjudicate__cell-row")[rowIndex];' +
        'const li = [...tr.querySelectorAll(".adjudicate__quotes li.adjudicate__quote")].find((el) => norm(el.querySelector("blockquote")?.textContent ?? "") === norm(text));' +
        'const box = li?.querySelector(".adjudicate__quote-adopt"); if (!box || box.disabled) return false;' +
        'tr.scrollIntoView({ block: "center" }); if (!box.checked) box.click(); return true;',
      rowIndex,
      text,
    );
    if (!clicked) throw new Error(`採用のチェックを押せません: "${text.slice(0, 40)}"`);
    await driver.sleep(3500);
  };
  await adopt(studyRow.index, quoteStudy);
  await adopt(studyRow.index, String(ownerHuman.quote));
  await adopt(armRows[0].index, quoteArm);
  rows = await adjudicateRows(driver);
  log(`  採用後の表示: ${studyField} = ${rows[studyRow.index].quotesStatus} / ${armField} = ${rows[armRows[0].index].quotesStatus}`);
  const quoteErrors = await driver.executeScript('return document.querySelectorAll(".adjudicate__quote-error").length;');
  (quoteErrors === 0 ? ok : ng)('引用の保存エラーが出ていない');
  await saveShot(driver, 'adjudicate-quotes-adopted');

  // 値の裁定: 一致セルを一括採用し、不一致セルは A を採用する
  await (await findVisible(driver, '#adjudicate-accept-all')).click();
  await driver.sleep(8000);
  for (let guard = 0; guard < 40; guard++) {
    const pressed = await driver.executeScript(
      'const button = [...document.querySelectorAll("#adjudicate-cells .adjudicate__action--choose-a")].find((b) => !b.disabled);' +
        'if (!button) return false; button.scrollIntoView({ block: "center" }); button.click(); return true;',
    );
    if (!pressed) break;
    await driver.sleep(2500);
  }
  rows = await adjudicateRows(driver);
  log(`  値の裁定後: ${byStatus(rows)}`);
  await saveShot(driver, 'adjudicate-decided');

  // シートの裏取り: consensus の引用スナップショットと、consensus の群構成・データ行
  const quoteSets = toRecords(await apiReadSheet(driver, spreadsheetId, 'QuoteSets')).filter((row) => row.study_id === studyId && row.annotator === 'consensus');
  for (const row of quoteSets) {
    log(`  QuoteSets（consensus）: field=${fields.find((f) => f.field_id === row.field_id)?.field_name} entity_key=${row.entity_key} kind=${row.kind} seq=${row.seq} source=${row.source} origin=${row.origin_annotator} saved_by=${row.saved_by} quote="${String(row.quote).slice(0, 50)}"`);
  }
  const lastArmSet = quoteSets.filter((row) => row.field_id === field(armField).field_id).at(-1);
  (lastArmSet !== undefined && lastArmSet.entity_key === 'arm:1' && lastArmSet.origin_annotator === REVIEWER_B ? ok : ng)(
    'arm のセルで採用した B の引用が、A の番号（arm:1）・出所 = B で consensus の行に入った',
  );
  for (const sheet of ['ArmStructures', 'StudyData', 'ResultsData', 'Decisions']) {
    const count = toRecords(await apiReadSheet(driver, spreadsheetId, sheet)).filter((row) => row.study_id === studyId && row.annotator === 'consensus').length;
    log(`  ${sheet}: consensus の行 ${count} 行`);
  }

  // 再入場しても採用の印が残るか
  await openApp(driver, '#/home');
  await openApp(driver, `#/adjudicate?study=${encodeURIComponent(studyId)}`);
  await waitVisible(driver, '#adjudicate-cells', 90000, '再入場後にセル一覧が表示されません');
  await driver.sleep(2000);
  await showAll();
  rows = await adjudicateRows(driver);
  const adoptedAfter = rows.flatMap((row) => row.quotes.filter((q) => q.adopted).map((q) => `${row.label}: [${q.owner}] "${q.text.slice(0, 40)}"`));
  for (const line of adoptedAfter) log(`  再入場後も採用済み: ${line}`);
  (adoptedAfter.length === 3 ? ok : ng)(`再入場後も、採用した 3 件に採用の印が残る（実際 ${adoptedAfter.length} 件）`);
}

/** evidence_quotes を生成してローカル保存の中身を捕まえ、--file の文献の行と is_final を確かめる（§9 #7） */
async function sceneExportQuotes(driver) {
  const file = optionValue('--file', '');
  log(`\n[export-quotes] evidence_quotes の全行を読み、${file} の is_final を確かめる`);
  await ensureLogin(driver);
  await openApp(driver, '#/home');
  const { spreadsheetId } = await currentProject(driver);
  const studyId = await studyIdByFile(driver, file);
  const label = toRecords(await apiReadSheet(driver, spreadsheetId, 'Studies')).find((row) => row.study_id === studyId).study_label;
  await openApp(driver, '#/export');
  await waitVisible(driver, '#export-format', 90000, '#/export が表示されません');
  await (await driver.findElement(By.css('#export-format input[value=evidence_quotes]'))).click();
  await waitVisible(driver, '#export-summary', 30000, 'サマリが出ません');
  await driver.sleep(1500);
  log(`  サマリ: ${(await textOf(driver, '#export-summary')).replace(/\s+/g, ' ').slice(0, 300)}`);
  await (await waitVisible(driver, '#export-generate', 15000, '生成ボタンがありません')).click();
  // 未検証セルが残っていると警告カードが出る（ほかの文献は未検証のまま）。続行する
  await waitVisible(driver, '#export-warning-continue, #export-download, #export-generate-error', 30000, '生成が始まりません');
  const proceed = await findVisible(driver, '#export-warning-continue');
  if (proceed !== null) {
    log(`  未検証セルの警告: ${(await textOf(driver, '#export-warning')).replace(/\s+/g, ' ').slice(0, 160)}`);
    await proceed.click();
  }
  await waitVisible(driver, '#export-download, #export-generate-error', 120000, '生成が完了しません');
  if ((await findVisible(driver, '#export-download')) === null) throw new Error(`生成に失敗: ${await textOf(driver, '#export-generate-error')}`);
  // ローカル保存は Blob を <a download> で落とす。Blob の中身を横取りして読む
  await driver.executeScript(
    'window.__captured = null; const original = URL.createObjectURL.bind(URL);' +
      'URL.createObjectURL = (blob) => { blob.text().then((text) => { window.__captured = text; }); return original(blob); };',
  );
  await (await findVisible(driver, '#export-download')).click();
  await driver.wait(async () => (await driver.executeScript('return window.__captured !== null;')) === true, 15000, 'CSV を読み取れません');
  const csv = await driver.executeScript('return window.__captured;');
  writeFileSync(path.join(OUT_DIR, 'evidence_quotes.csv'), csv);
  const table = parseCsv(csv);
  const header = table[0];
  const records = table.slice(1).map((row) => Object.fromEntries(header.map((name, index) => [name, row[index] ?? ''])));
  log(`  CSV: ${records.length} 行 / ${header.length} 列: ${header.join(' | ')}`);
  const mine = records.filter((row) => row.study_label === label || row.study_id === studyId);
  const finals = mine.filter((row) => String(row.is_final).toUpperCase() === 'TRUE');
  log(`  ${file} の行: ${mine.length} 行 / うち is_final = TRUE ${finals.length} 行`);
  for (const row of finals) {
    log(`  最終: field=${row.field_name} entity_key=${row.entity_key} annotator=${row.annotator} source=${row.source} origin=${row.origin_annotator ?? ''} quote="${String(row.quote).slice(0, 50)}"`);
  }
  for (const row of mine.filter((r) => r.source === 'human' && String(r.is_final).toUpperCase() !== 'TRUE')) {
    log(`  最終でない人の引用: field=${row.field_name} entity_key=${row.entity_key} annotator=${row.annotator} quote="${String(row.quote).slice(0, 50)}"`);
  }
  (finals.length === 3 ? ok : ng)(`裁定で採用した 3 件が is_final = TRUE（実際 ${finals.length} 件）`);
}

/** RFC 4180 の CSV を行列にする（引用符の中の改行・カンマ・"" に対応） */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const body = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++;
      row.push(cell); cell = ''; rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

/** --hash の画面（--file があればその study）を開いて、本文の先頭と画面を保存する */
async function scenePeek(driver) {
  await ensureLogin(driver);
  await openApp(driver, '#/home');
  const file = optionValue('--file', '');
  const base = optionValue('--hash', '#/verify');
  const hash = file === '' ? base : `${base}?study=${encodeURIComponent(await studyIdByFile(driver, file))}`;
  await openApp(driver, hash);
  await driver.sleep(Number(optionValue('--wait', '8000')));
  const tab = optionValue('--tab', '');
  if (tab !== '') await selectVerifyTab(driver, Number(tab));
  log(`[peek] ${hash}: ${(await driver.findElement(By.css('main, .app__main, body')).getText()).replace(/\s+/g, ' ').slice(0, Number(optionValue('--chars', '900')))}`);
  await saveShot(driver, `peek-${optionValue('--tag', 'screen')}`);
}

/**
 * 架空の 2 人目の ResultsData に同じセル（study × 項目 × entity_key）の行が 2 つ以上あれば、後ろの行を消す。
 * 消すのは REVIEWER_B の行だけ（このスクリプトが書いた行）。下の行から消して行番号をずらさない
 */
async function sceneSeedDedupe(driver) {
  log('\n[seed-dedupe] 架空の 2 人目の ResultsData の重複行を消す');
  await ensureLogin(driver);
  await openApp(driver, '#/home');
  const { spreadsheetId } = await currentProject(driver);
  const rows = await apiReadSheet(driver, spreadsheetId, 'ResultsData');
  const col = (name) => rows[0].indexOf(name);
  const seen = new Set();
  const duplicates = [];
  rows.forEach((row, index) => {
    if (index === 0 || row[col('annotator')] !== REVIEWER_B) return;
    const key = [row[col('study_id')], row[col('field_id')], row[col('entity_key')]].join('\n');
    if (seen.has(key)) duplicates.push(index);
    seen.add(key);
  });
  log(`  2 人目の行 ${seen.size + duplicates.length} 行 / 重複 ${duplicates.length} 行（シートの行番号 ${duplicates.map((i) => i + 1).join(', ') || 'なし'}）`);
  if (duplicates.length === 0) return;
  const meta = await sheetsApi(driver, 'GET', `${SHEETS_API}/${spreadsheetId}?fields=sheets.properties`);
  const sheetId = meta.sheets.find((s) => s.properties.title === 'ResultsData').properties.sheetId;
  await sheetsApi(driver, 'POST', `${SHEETS_API}/${spreadsheetId}:batchUpdate`, {
    requests: [...duplicates].reverse().map((index) => ({
      deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: index, endIndex: index + 1 } },
    })),
  });
  const after = await apiReadSheet(driver, spreadsheetId, 'ResultsData');
  (after.length === rows.length - duplicates.length ? ok : ng)(`ResultsData が ${rows.length - 1} → ${after.length - 1} 行になった`);
}

const SCENES = {
  'seed-dedupe': sceneSeedDedupe,
  peek: scenePeek,
  adjudicate: sceneAdjudicate,
  'export-quotes': sceneExportQuotes,
  'seed-b': sceneSeedB,
  'verify-all': sceneVerifyAll,
  textlayer: sceneTextLayer,
  dump: sceneDump,
  upload: sceneUpload,
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
    log(ngCount === 0 ? '\n完了' : `\n完了（NG ${ngCount} 件）`);
    if (ngCount > 0) failed = true;
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
