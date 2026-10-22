// issue #381 の直し（PR #388 / #389 / #392）の実機確認用シーン（未コミットの作業用スクリプト）。
// manualCheck.mjs と同じ専用プロファイル（.selenium-profile/）の Chrome で、本体の dist/ を読む。
//
// 使い方: node tools/selenium/issue381Check.mjs <scene> [<scene> ...] [--out <dir>] [--study <file.pdf>]
//   perm      dist/manifest.json に tabs 権限が無いこと
//   tabs      拡張ページからの chrome.tabs.create（アイコンクリックと同じ API）、popup → app の遷移、
//             Picker タブを開いて閉じるとキャンセル扱いになること
//   consent   同意の記録を消し、一括抽出（1 論文・実 API）で同意画面 → キャンセル（LLM へ送らない）→
//             同意して実行 → 要求の推論の強さ → 2 回目は出ない → Options で取り消すと再び出る
//             推論の強さは一時的に medium にし、終わったら元に戻す
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DIST_DIR = path.join(ROOT, 'dist');
const PROFILE_DIR = path.join(ROOT, '.selenium-profile');
const PICKER_ORIGIN = 'https://youkiti.github.io';

function optionValue(key, fallback) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(key);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
}

const OUT_DIR = path.resolve(optionValue('--out', 'C:/tmp/srde381-realtest'));
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

const manifest = JSON.parse(readFileSync(path.join(DIST_DIR, 'manifest.json'), 'utf8'));
const EXTENSION_ID = (() => {
  const hash = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest();
  return [...hash.subarray(0, 16)]
    .map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15)))
    .join('');
})();
const ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const POPUP_URL = `${ORIGIN}/popup/popup.html`;
const APP_URL = `${ORIGIN}/app/app.html`;
const OPTIONS_URL = `${ORIGIN}/options/options.html`;

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

async function textOf(driver, selector) {
  const element = await findVisible(driver, selector);
  return element === null ? '' : element.getText();
}

async function saveShot(driver, name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  writeFileSync(file, await driver.takeScreenshot(), 'base64');
  log(`  shot: ${file}`);
}

async function storageGet(driver, key) {
  return driver.executeAsyncScript(
    'const done = arguments[arguments.length - 1]; chrome.storage.local.get(arguments[0], (items) => done(items[arguments[0]] ?? null));',
    key,
  );
}

async function storageSet(driver, key, value) {
  await driver.executeAsyncScript(
    'const done = arguments[arguments.length - 1]; chrome.storage.local.set({ [arguments[0]]: arguments[1] }, () => done(true));',
    key,
    value,
  );
}

async function storageRemove(driver, key) {
  await driver.executeAsyncScript(
    'const done = arguments[arguments.length - 1]; chrome.storage.local.remove(arguments[0], () => done(true));',
    key,
  );
}

/** service worker を起こし直してから、ログイン済みかを確かめる（issue307Check.mjs と同じ手順） */
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
    await driver.findElement(By.css('#login-button')).click();
    log('  ログインし直します（最大 3 分待機）…');
    await driver.wait(
      async () => (await findVisible(driver, '#popup-projects')) !== null,
      3 * 60 * 1000,
      'ログインが完了しません',
    );
  }
  ok(`ログイン済み: ${await driver.findElement(By.css('#popup-email')).getText()}`);
}

/** #/home の集計を待ってから hash で目的の画面へ移る（ガードで戻されたらやり直す） */
async function openApp(driver, hash) {
  await driver.get(`${APP_URL}#/home`);
  await driver.wait(
    async () =>
      (await findVisible(driver, '.home__summary')) !== null ||
      (await findVisible(driver, '#home-counts-error')) !== null,
    60000,
    '#/home のカウントが読み込まれません',
  );
  await driver
    .wait(async () => /文献数\s*[1-9]/.test((await textOf(driver, '.home__summary')).replace(/\s+/g, ' ')), 30000)
    .catch(() => undefined);
  if (hash === '#/home') return;
  const route = hash.split('?')[0];
  for (let attempt = 0; attempt < 5; attempt++) {
    await driver.executeScript('location.hash = arguments[0];', hash);
    await driver.sleep(1500);
    if (String(await driver.executeScript('return location.hash;')).startsWith(route)) return;
  }
  throw new Error(`${hash} へ遷移できません`);
}

// ---------------------------------------------------------------------------

async function scenePerm() {
  log('\n[perm] manifest の権限');
  const permissions = manifest.permissions ?? [];
  log(`  permissions: ${permissions.join(', ')}`);
  (permissions.includes('tabs') ? ng : ok)('permissions に tabs が無い');
}

async function sceneTabs(driver) {
  log('\n[tabs] tabs 権限なしでのタブの開閉');
  await ensureLogin(driver);
  // 1. アイコンクリックの処理（handleActionClick）が使うのと同じ chrome.tabs.create を拡張ページから呼ぶ
  await driver.get(POPUP_URL);
  let before = await driver.getAllWindowHandles();
  const created = await driver.executeAsyncScript(
    'const done = arguments[arguments.length - 1];' +
      ' chrome.tabs.create({ url: chrome.runtime.getURL("app/app.html") })' +
      '.then((tab) => done({ id: tab.id ?? null, url: tab.url ?? null, pendingUrl: tab.pendingUrl ?? null }), (e) => done({ error: String(e) }));',
  );
  log(`  chrome.tabs.create の戻り値: ${JSON.stringify(created)}`);
  (created.error === undefined && typeof created.id === 'number' ? ok : ng)('chrome.tabs.create がエラーなく tab.id を返す');
  await driver
    .wait(async () => (await driver.getAllWindowHandles()).length > before.length, 10000)
    .catch(() => undefined);
  const added = (await driver.getAllWindowHandles()).filter((h) => !before.includes(h));
  (added.length === 1 ? ok : ng)(`新しいタブが 1 つ開いた（${added.length}）`);
  for (const handle of added) {
    await driver.switchTo().window(handle);
    const url = await driver.getCurrentUrl();
    (url.startsWith(APP_URL) ? ok : ng)(`開いたタブの URL: ${url}`);
    await driver.close();
  }
  await driver.switchTo().window(before[before.length - 1]);

  // 2. popup → app（chrome.tabs.update で同じタブが app.html になる）。最近のプロジェクトから開く
  await driver.get(POPUP_URL);
  await waitVisible(driver, '#popup-projects', 20000, 'popup のプロジェクト欄が出ません');
  const project = await storageGet(driver, 'currentProject');
  const recent = await driver
    .wait(async () => findVisible(driver, '#popup-recent-form button[type="submit"]'), 15000)
    .catch(() => null);
  if (recent === null) {
    // 最近の一覧が空のときは、ID で開くフォームから現在のプロジェクトを開く
    log('  最近の一覧が出ないため、ID で開くフォームを使います');
    if (!project?.spreadsheetId) throw new Error('現在のプロジェクトがありません');
    await driver.findElement(By.css('#popup-open-id')).sendKeys(project.spreadsheetId);
    before = await driver.getAllWindowHandles();
    await driver.findElement(By.css('#popup-open-form button[type="submit"]')).click();
    await driver.wait(async () => (await driver.getCurrentUrl()).startsWith(APP_URL), 60000, 'popup から app へ遷移しません');
    ok(`popup → app へ同じタブで遷移: ${await driver.getCurrentUrl()}`);
    const opened = (await driver.getAllWindowHandles()).filter((h) => !before.includes(h));
    (opened.length === 0 ? ok : ng)(`余分なタブが開いていない（${opened.length}）`);
  } else {
    const select = await driver.findElement(By.css('#popup-recent-select'));
    const options = await select.findElements(By.css('option'));
    log(`  最近のスプレッドシート: ${options.length} 件 / 現在のプロジェクト: ${project?.title ?? project?.spreadsheetId ?? '(なし)'}`);
    if (project?.spreadsheetId) {
      await driver.executeScript(
        'const s = document.querySelector("#popup-recent-select"); const o = [...s.options].find((x) => x.value.includes(arguments[0])); if (o) { s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true })); }',
        project.spreadsheetId,
      );
    }
    before = await driver.getAllWindowHandles();
    await recent.click();
    await driver.wait(async () => (await driver.getCurrentUrl()).startsWith(APP_URL), 60000, 'popup から app へ遷移しません');
    ok(`popup → app へ同じタブで遷移: ${await driver.getCurrentUrl()}`);
    const opened = (await driver.getAllWindowHandles()).filter((h) => !before.includes(h));
    (opened.length === 0 ? ok : ng)(`余分なタブが開いていない（${opened.length}）`);
  }

  // 3. Picker タブを開いて、こちらで閉じる → キャンセル扱い
  await openApp(driver, '#/documents');
  const appHandle = await driver.getWindowHandle();
  const importButton = await driver.wait(until.elementLocated(By.css('#documents-import')), 15000);
  await driver.wait(until.elementIsEnabled(importButton), 30000, '取り込みボタンが有効になりません');
  before = await driver.getAllWindowHandles();
  await importButton.click();
  let pickerHandle = null;
  await driver.wait(async () => {
    for (const handle of await driver.getAllWindowHandles()) {
      if (before.includes(handle)) continue;
      try {
        await driver.switchTo().window(handle);
        if ((await driver.getCurrentUrl()).startsWith(PICKER_ORIGIN)) {
          pickerHandle = handle;
          return true;
        }
      } catch {
        // 確認中に閉じたタブは無視する
      }
    }
    return false;
  }, 30000, 'Picker のタブが開きません');
  ok(`Picker のタブが開いた: ${(await driver.getCurrentUrl()).split('#')[0]}`);
  await driver.sleep(2000);
  await saveShot(driver, 'tabs-picker-open');
  await driver.close();
  await driver.switchTo().window(appHandle);
  await driver.sleep(3000);
  const progress = await driver.findElements(By.css('#documents-progress'));
  (progress.length === 0 ? ok : ng)('タブを閉じたあと、取り込みは始まらない');
  const enabled = await driver.findElement(By.css('#documents-import')).isEnabled();
  (enabled ? ok : ng)('取り込みボタンが再び押せる（キャンセル扱い）');
  await saveShot(driver, 'tabs-picker-closed');
}

/** app のページの fetch を包み、LLM API への要求の宛先と生成設定だけを記録する（本文は残さない） */
const FETCH_HOOK_JS = `
if (!window.__llmLog) {
  window.__llmLog = [];
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (/generativelanguage|openrouter|anthropic|openai/.test(url)) {
      const entry = { host: new URL(url).host, at: new Date().toISOString() };
      try {
        const body = JSON.parse(init && typeof init.body === 'string' ? init.body : '{}');
        entry.thinkingConfig = body.generationConfig?.thinkingConfig ?? null;
        entry.reasoningEffort = body.reasoning_effort ?? body.reasoning?.effort ?? null;
        entry.outputConfig = body.output_config ?? null;
      } catch (e) {
        entry.parseError = String(e);
      }
      window.__llmLog.push(entry);
      const response = await original(input, init);
      entry.status = response.status;
      return response;
    }
    return original(input, init);
  };
}
return true;`;

async function llmLog(driver) {
  return driver.executeScript('return window.__llmLog ?? [];');
}

/** #/extract で指定の 1 論文だけを選び、実行確認カードまで進める */
async function prepareExtract(driver, study) {
  await openApp(driver, '#/extract');
  await waitVisible(driver, '#extract-run', 60000, '#/extract が表示されません');
  const selector = '#extract-studies input[type="checkbox"]';
  await driver.wait(async () => (await driver.findElements(By.css(selector))).length > 0, 30000, '文献一覧が出ません');
  const states = await driver.executeScript(
    'return [...document.querySelectorAll("#extract-studies .extract__study-item")].map((li) => {' +
      ' const box = li.querySelector("input[type=checkbox]");' +
      ' return { checked: box.checked, disabled: box.disabled, files: [...li.querySelectorAll(".extract__doc-filename")].map((el) => el.textContent.trim()) }; });',
  );
  let target = states.findIndex((s) => s.files.includes(study));
  if (target < 0) target = states.findIndex((s) => !s.disabled);
  if (target < 0) throw new Error('抽出できる文献がありません');
  log(`  対象の論文: ${states[target].files.join(', ')}`);
  for (let i = 0; i < states.length; i++) {
    const want = i === target;
    if (states[i].checked !== want && !states[i].disabled) {
      const boxes = await driver.findElements(By.css(selector));
      await boxes[i].click();
      await driver.sleep(300);
    }
  }
  await driver.wait(async () => {
    const text = await textOf(driver, '#extract-estimate');
    return text.includes('バッチ') || text.includes('概算不可') || text.includes('計算できません');
  }, 60000, 'コスト概算が出ません');
  log(`  モデル: ${await driver.executeScript('return document.querySelector("#extract-model")?.value ?? "";')}`);
  log(`  コスト概算: ${(await textOf(driver, '#extract-estimate')).replace(/\s+/g, ' ')}`);
}

async function clickRun(driver) {
  await (await findVisible(driver, '#extract-run')).click();
  const confirm = await driver
    .wait(async () => (await findVisible(driver, '#extract-confirm-run')) ?? (await findVisible(driver, '#ai-data-consent-accept')), 15000)
    .catch(() => null);
  if (confirm !== null && (await confirm.getAttribute('id')) === 'extract-confirm-run') {
    await confirm.click();
  }
}

async function dialogShown(driver, timeoutMs) {
  return driver
    .wait(async () => (await findVisible(driver, '#ai-data-consent-accept')) !== null, timeoutMs)
    .then(() => true, () => false);
}

async function sceneConsent(driver) {
  log('\n[consent] 同意画面と推論の強さ（1 論文の一括抽出・実 API）');
  const study = optionValue('--study', '');
  await ensureLogin(driver);
  await openApp(driver, '#/home');
  const savedEffort = await storageGet(driver, 'settings.defaultReasoningEffort');
  const savedConsent = await storageGet(driver, 'aiDataConsent');
  log(`  元の推論の強さ: ${JSON.stringify(savedEffort)} / 元の同意の記録: ${JSON.stringify(savedConsent)}`);
  await storageSet(driver, 'settings.defaultReasoningEffort', 'medium');
  await storageRemove(driver, 'aiDataConsent');
  try {
    // 1. 未同意で実行 → 同意画面 → キャンセル（Esc）→ LLM へ送らない
    await prepareExtract(driver, study);
    await driver.executeScript(FETCH_HOOK_JS);
    await clickRun(driver);
    (await dialogShown(driver, 15000) ? ok : ng)('未同意で実行すると同意画面が出る');
    await saveShot(driver, 'consent-dialog');
    const dialog = await driver.executeScript(
      'const d = document.querySelector("[aria-modal=true]"); if (!d) return null;' +
        ' const label = document.getElementById(d.getAttribute("aria-labelledby") ?? "")?.textContent ?? "";' +
        ' const desc = document.getElementById(d.getAttribute("aria-describedby") ?? "")?.textContent ?? "";' +
        ' return { role: d.getAttribute("role"), label, descLength: desc.length, focusInside: d.contains(document.activeElement) };',
    );
    log(`  ダイアログ: ${JSON.stringify(dialog)}`);
    (dialog?.role === 'dialog' && dialog.label !== '' && dialog.descLength > 0 ? ok : ng)('role=dialog・名前・説明文が付いている');
    (dialog?.focusInside ? ok : ng)('フォーカスがダイアログの中にある');
    await driver.actions().sendKeys('\uE00C').perform();
    await driver.sleep(1500);
    ((await findVisible(driver, '#ai-data-consent-accept')) === null ? ok : ng)('Esc でダイアログが閉じる');
    await driver.sleep(3000);
    let calls = await llmLog(driver);
    (calls.length === 0 ? ok : ng)(`キャンセル後に LLM への要求が出ていない（${calls.length} 件）`);
    ((await storageGet(driver, 'aiDataConsent')) === null ? ok : ng)('キャンセルでは同意を記録しない');

    // 2. もう一度実行 → 同意 → 実行され、要求に推論の強さ medium が乗る
    await clickRun(driver);
    (await dialogShown(driver, 15000) ? ok : ng)('キャンセルの後は、次の実行でまた同意画面が出る');
    await (await findVisible(driver, '#ai-data-consent-accept')).click();
    log('  同意して実行中…');
    const result = await driver.wait(async () => {
      for (const s of ['#extract-run-done', '#extract-partial-failure', '#extract-run-error']) {
        if ((await findVisible(driver, s)) !== null) return s;
      }
      return false;
    }, 15 * 60 * 1000, '一括抽出が完了しません');
    log(`  結果: ${result} ${(await textOf(driver, result)).replace(/\s+/g, ' ').slice(0, 200)}`);
    await saveShot(driver, 'consent-extract-done');
    calls = await llmLog(driver);
    log(`  LLM への要求: ${JSON.stringify(calls)}`);
    (calls.length > 0 ? ok : ng)(`同意後に LLM への要求が出た（${calls.length} 件）`);
    const levels = calls.map((c) => c.thinkingConfig?.thinkingLevel ?? c.reasoningEffort ?? c.outputConfig?.effort ?? null);
    (calls.length > 0 && levels.every((l) => l === 'medium') ? ok : ng)(`抽出の要求の推論の強さが medium（${levels.join(', ')}）`);
    (calls.every((c) => c.status === 200) ? ok : ng)(`応答がすべて 200（${calls.map((c) => c.status).join(', ')}）`);
    const consent = await storageGet(driver, 'aiDataConsent');
    (consent !== null && consent.version === 1 ? ok : ng)(`同意を記録した: ${JSON.stringify(consent)}`);

    // 3. 同意済みで同意画面が出ないことは、もう一度課金しないよう実行では確かめない
    //    （記録の版が一致すれば出さないことは unit テストで確かめている）

    // 4. Options で取り消す → 次の実行でまた出る（キャンセルして終える）
    await driver.get(OPTIONS_URL);
    const revoke = await waitVisible(driver, '#ai-data-consent-revoke', 20000, 'Options に同意の取り消しボタンがありません');
    log(`  Options の表示: ${await textOf(driver, '#ai-data-consent-status')}`);
    await revoke.click();
    await driver.sleep(1500);
    ((await storageGet(driver, 'aiDataConsent')) === null ? ok : ng)('Options の取り消しで同意の記録が消える');
    log(`  取り消し後の表示: ${await textOf(driver, '#ai-data-consent-status')}`);
    await saveShot(driver, 'consent-options-revoked');
    await prepareExtract(driver, study);
    await driver.executeScript(FETCH_HOOK_JS);
    await clickRun(driver);
    (await dialogShown(driver, 15000) ? ok : ng)('取り消した後の実行で、また同意画面が出る');
    await (await findVisible(driver, '#ai-data-consent-cancel')).click();
    await driver.sleep(3000);
    calls = await llmLog(driver);
    (calls.length === 0 ? ok : ng)(`「キャンセル」ボタンの後も LLM への要求が出ていない（${calls.length} 件）`);
  } finally {
    if (savedEffort === null) {
      await storageRemove(driver, 'settings.defaultReasoningEffort');
    } else {
      await storageSet(driver, 'settings.defaultReasoningEffort', savedEffort);
    }
    // 同意の記録は、確認前に同意済みだったときだけ元に戻す
    if (savedConsent !== null) await storageSet(driver, 'aiDataConsent', savedConsent);
    log(`  推論の強さを元に戻しました: ${JSON.stringify(await storageGet(driver, 'settings.defaultReasoningEffort'))}`);
  }
}

const SCENES = { perm: scenePerm, tabs: sceneTabs, consent: sceneConsent };

async function main() {
  const names = process.argv.slice(2).filter((arg, i, all) => !arg.startsWith('--') && !(all[i - 1] ?? '').startsWith('--'));
  for (const name of names) {
    if (!(name in SCENES)) {
      console.error(`未知のシーン: ${name}（使用可能: ${Object.keys(SCENES).join(' / ')}）`);
      process.exit(1);
    }
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
    } catch {
      // ブラウザごと落ちた場合は保存できない
    }
  } finally {
    await driver.quit().catch(() => undefined);
  }
  process.exit(failed ? 1 : 0);
}

void main();
