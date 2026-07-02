// 実機確認の半自動ハーネス（docs/manual-testing.md §1 の Selenium 版）。
//
// 方針: Selenium が「操作 + 検証」を自動化し、人にしかできない箇所
// （Google ログイン / OAuth 同意 / Picker のファイル選択）だけコンソールで
// 一時停止してユーザーに委ねる。jest / Playwright ではカバーできない
// 「本物の Chrome + 本物の Google API」の結合部を通すためのツールであり、
// CI では実行しない。
//
// 前提（Chrome 137+ は --load-extension が使えないため、プロファイル方式を採る）:
//   1. npm run dev（dist/ を生成。.env の OAUTH_CLIENT_ID 必須）
//   2. node tools/selenium/manualCheck.mjs prepare
//      → 専用プロファイル（.selenium-profile/）の Chrome が開くので、
//        chrome://extensions でデベロッパーモード → dist/ を手動で 1 回読み込み、
//        Google アカウントにログインしておく（以後のセッションで再利用される）
//   3. node tools/selenium/manualCheck.mjs
//      → login → project → picker → verify を順に実行
//
// 個別実行: node tools/selenium/manualCheck.mjs picker verify
// エッジ:   node tools/selenium/manualCheck.mjs cancel
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DIST_DIR = path.join(ROOT, 'dist');
const PROFILE_DIR = path.join(ROOT, '.selenium-profile');
const PICKER_ORIGIN = 'https://youkiti.github.io';

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

function log(message) {
  console.log(message);
}

function ok(message) {
  console.log(`  ✔ ${message}`);
}

function ng(message) {
  console.log(`  ✘ ${message}`);
}

/** コンソールで Enter を待つ（ログイン・同意などの手動ステップ） */
function pause(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`\n>>> ${message}\n>>> 済んだら Enter: `, () => {
      rl.close();
      resolve();
    });
  });
}

/** manifest.json の key（固定公開鍵）から拡張 ID を導出する（SHA-256 先頭 16 バイト → a-p） */
function computeExtensionId() {
  const manifestPath = existsSync(path.join(DIST_DIR, 'manifest.json'))
    ? path.join(DIST_DIR, 'manifest.json')
    : path.join(ROOT, 'src', 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (typeof manifest.key !== 'string' || manifest.key === '') {
    throw new Error('manifest.json に key がありません（拡張 ID を固定できません）');
  }
  const hash = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest();
  return [...hash.subarray(0, 16)]
    .map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15)))
    .join('');
}

const EXTENSION_ID = computeExtensionId();
const POPUP_URL = `chrome-extension://${EXTENSION_ID}/popup/popup.html`;
const APP_URL = `chrome-extension://${EXTENSION_ID}/app/app.html`;

/** 表示中の要素を 1 つ返す（見つからなければ null） */
async function findVisible(driver, selector) {
  for (const element of await driver.findElements(By.css(selector))) {
    if (await element.isDisplayed().catch(() => false)) {
      return element;
    }
  }
  return null;
}

/** 新しいウィンドウ（タブ）が開くのを待ち、そのハンドルを返す */
async function waitForNewWindow(driver, beforeHandles, timeoutMs, what) {
  await driver.wait(
    async () => (await driver.getAllWindowHandles()).length > beforeHandles.length,
    timeoutMs,
    `${what} のタブが開きません`,
  );
  const handles = await driver.getAllWindowHandles();
  return handles.find((h) => !beforeHandles.includes(h));
}

/** 指定ハンドルのタブが閉じられるのを待つ */
async function waitForWindowClosed(driver, handle, timeoutMs, what) {
  await driver.wait(
    async () => !(await driver.getAllWindowHandles()).includes(handle),
    timeoutMs,
    `${what} のタブが閉じません`,
  );
}

/** 既に開いている app.html のタブへ切り替える（無ければ現在のタブで開く） */
async function switchToApp(driver, hash) {
  for (const handle of await driver.getAllWindowHandles()) {
    await driver.switchTo().window(handle);
    const url = await driver.getCurrentUrl();
    if (url.startsWith(APP_URL)) {
      break;
    }
  }
  // hash 遷移ではなくフル読み込みにして bootstrap（batchGet 込み）を毎回通す
  await driver.get(`${APP_URL}${hash}`);
}

// ---------------------------------------------------------------------------
// シーン
// ---------------------------------------------------------------------------

async function scenePrepare(driver) {
  log('\n[prepare] 専用プロファイルの初期設定（初回のみ）');
  log(`  拡張 ID（manifest key から導出。読み込み後に一致すること）: ${EXTENSION_ID}`);
  log(`  dist: ${DIST_DIR}`);
  await driver.get('chrome://extensions');
  await pause(
    [
      '開いた Chrome で次を実施してください:',
      '  1. chrome://extensions 右上の「デベロッパーモード」を ON',
      `  2. 「パッケージ化されていない拡張機能を読み込む」で ${DIST_DIR} を選択`,
      '  3. 別タブで https://accounts.google.com を開き、確認用 Google アカウントにログイン',
      '     （OAuth 同意画面がテストモードの場合はテストユーザーに登録済みのアカウント）',
    ].join('\n'),
  );
  await driver.get(POPUP_URL);
  try {
    await driver.wait(until.elementLocated(By.css('#popup-status')), 5000);
    ok(`拡張を検出しました（${EXTENSION_ID}）。プロファイルは ${PROFILE_DIR} に永続化されます`);
  } catch {
    ng('拡張が読み込まれていません。dist/ の読み込みと拡張 ID を確認してください');
    throw new Error('prepare 未完了');
  }
}

async function sceneLogin(driver) {
  log('\n[login] Popup ログイン（手順書 §1-1 #1〜2）');
  await driver.get(POPUP_URL);
  await driver.wait(until.elementLocated(By.css('#popup-status')), 10000);
  // 認証状態の判定が終わるまで（#popup-auth / #popup-projects のどちらかが出る）
  await driver.wait(
    async () =>
      (await findVisible(driver, '#popup-auth')) !== null ||
      (await findVisible(driver, '#popup-projects')) !== null,
    15000,
    'Popup の認証状態が確定しません',
  );
  if ((await findVisible(driver, '#popup-projects')) !== null) {
    const email = await driver.findElement(By.css('#popup-email')).getText();
    ok(`ログイン済み: ${email}`);
    return;
  }
  await driver.findElement(By.css('#login-button')).click();
  log('  OAuth 同意画面が開きます。承認してください（最大 5 分待機）…');
  await driver.wait(
    async () => (await findVisible(driver, '#popup-projects')) !== null,
    5 * 60 * 1000,
    'ログインが完了しません（#popup-projects が表示されない）',
  );
  const email = await driver.findElement(By.css('#popup-email')).getText();
  if (email.trim() === '' || email.trim() === '—') {
    ng('ログイン後のメールアドレスが表示されていません');
  } else {
    ok(`ログイン成功: ${email}`);
  }
  const error = await driver.findElement(By.css('#login-error')).getText();
  if (error.trim() !== '') {
    ng(`ログインエラー表示: ${error}`);
    throw new Error('login 失敗');
  }
}

async function sceneProject(driver) {
  log('\n[project] 新規プロジェクト作成（手順書 §1-1 #3）');
  await driver.get(POPUP_URL);
  await driver.wait(
    async () => (await findVisible(driver, '#popup-projects')) !== null,
    15000,
    '未ログインです。先に login シーンを実行してください',
  );
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate(),
  ).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const title = `実機確認 ${stamp}`;
  const before = await driver.getAllWindowHandles();
  await driver.findElement(By.css('#popup-create-title')).sendKeys(title);
  await driver.findElement(By.css('#popup-create-form button[type=submit]')).click();
  log(`  「${title}」を作成中（Sheets 13 タブ + Drive フォルダ生成。1 分程度かかります）…`);
  const appHandle = await waitForNewWindow(driver, before, 3 * 60 * 1000, 'メインビュー');
  await driver.switchTo().window(appHandle);
  await driver.wait(until.urlContains('app/app.html'), 10000);
  await driver.wait(async () => {
    const status = await driver.findElement(By.css('#app-status')).getText();
    return status.includes('プロジェクト:');
  }, 30000, 'ヘッダにプロジェクト名が出ません');
  ok(`プロジェクト作成 → メインビュー表示: ${await driver.findElement(By.css('#app-status')).getText()}`);
}

/** Picker タブを開いて閉じられるまでを共通化。取り込みが始まったかどうかを返す */
async function runPickerRound(driver, instruction) {
  await switchToApp(driver, '#/documents');
  const importButton = await driver.wait(
    until.elementLocated(By.css('#documents-import')),
    15000,
  );
  await driver.wait(until.elementIsEnabled(importButton), 30000, '取り込みボタンが有効になりません');
  const before = await driver.getAllWindowHandles();
  await importButton.click();
  const pickerHandle = await waitForNewWindow(driver, before, 30000, 'Picker');
  await driver.switchTo().window(pickerHandle);
  const pickerUrl = await driver.getCurrentUrl();
  if (!pickerUrl.startsWith(PICKER_ORIGIN)) {
    ng(`Picker タブの URL が想定外です: ${pickerUrl}`);
  } else {
    ok(`Picker タブが開きました: ${pickerUrl.split('#')[0]}`);
  }
  log(`\n>>> ${instruction}`);
  log('>>> （タブが閉じるのを自動検知します。Enter は不要）');
  await driver.switchTo().window(before[before.length - 1]);
  await waitForWindowClosed(driver, pickerHandle, 10 * 60 * 1000, 'Picker');
  await switchToApp(driver, '#/documents');
  // 取り込みが始まったか（進捗行の出現）を少し待って判定する
  try {
    await driver.wait(until.elementLocated(By.css('#documents-progress')), 8000);
    return true;
  } catch {
    return false;
  }
}

async function scenePicker(driver) {
  log('\n[picker] Picker 正常系 + 取り込み（手順書 §1-1 #4〜9）');
  const started = await runPickerRound(
    driver,
    'Picker で著作権フリーの PDF を 1〜2 本選択してください',
  );
  if (!started) {
    ng('取り込みが始まりませんでした（キャンセル or 選択が伝わっていない）');
    throw new Error('picker 失敗');
  }
  ok('取り込み開始（進捗行を表示）');
  // 完了 = 取り込みボタンが再度有効になる（importing = false）
  await driver.wait(async () => {
    const button = await driver.findElement(By.css('#documents-import'));
    return await button.isEnabled();
  }, 10 * 60 * 1000, '取り込みが完了しません');
  const statuses = await driver.findElements(By.css('.documents__progress-status'));
  for (const status of statuses) {
    const text = await status.getText();
    if (text.startsWith('完了')) {
      ok(`進捗行: ${text}`);
    } else {
      ng(`進捗行: ${text}`);
    }
  }
  const rows = await driver.findElements(By.css('#documents-table tbody tr'));
  if (rows.length === 0) {
    ng('一覧に文献が表示されていません');
    throw new Error('picker 失敗');
  }
  for (const row of rows) {
    const cells = await row.findElements(By.css('td'));
    const filename = await cells[1].getText();
    const badge = await cells[2].getText();
    ok(`一覧: ${filename} / text_status = ${badge.replace(/\s+/g, ' ')}`);
  }
  log('  → 手順書 §1-2 の裏取り（Sheets の Documents タブ / Drive の documents/ + extracted_texts/）は目視で確認してください');
}

async function sceneCancel(driver) {
  log('\n[cancel] Picker キャンセル系（手順書 §1-3 #1〜2）');
  const started = await runPickerRound(
    driver,
    'Picker の「キャンセル」を押してください（またはタブを手動で閉じる）',
  );
  if (started) {
    ng('キャンセルしたのに取り込みが始まりました');
    throw new Error('cancel 失敗');
  }
  const importButton = await driver.findElement(By.css('#documents-import'));
  if (await importButton.isEnabled()) {
    ok('キャンセル検知: 取り込みは走らず、ボタンが再度押せる状態です');
  } else {
    ng('キャンセル後に取り込みボタンが無効のままです');
  }
}

async function sceneVerify(driver) {
  log('\n[verify] #/home 進捗カウントの実データ確認（手順書 §1-2 #3）');
  // フル読み込みで bootstrap → values:batchGet の実弾経路を通す
  await switchToApp(driver, '#/home');
  await driver.wait(
    async () =>
      (await findVisible(driver, '.home__summary')) !== null ||
      (await findVisible(driver, '#home-counts-error')) !== null,
    30000,
    '#/home のカウントが読み込まれません',
  );
  const error = await findVisible(driver, '#home-counts-error');
  if (error !== null) {
    ng(`カウント読込失敗: ${await error.getText()}`);
    throw new Error('verify 失敗');
  }
  const labels = await driver.findElements(By.css('.home__summary-label'));
  const values = await driver.findElements(By.css('.home__summary-value'));
  let documentsCount = -1;
  for (let i = 0; i < labels.length; i++) {
    const label = await labels[i].getText();
    const value = await values[i].getText();
    ok(`${label}: ${value}`);
    if (label === '文献数') {
      documentsCount = Number(value);
    }
  }
  if (documentsCount >= 1) {
    ok('文献数 ≥ 1（batchGet 経由の実データ読込を確認）');
  } else {
    ng('文献数が 0 のままです（取り込み結果が反映されていない）');
    throw new Error('verify 失敗');
  }
}

const SCENES = {
  prepare: scenePrepare,
  login: sceneLogin,
  project: sceneProject,
  picker: scenePicker,
  cancel: sceneCancel,
  verify: sceneVerify,
};

// ---------------------------------------------------------------------------
// エントリポイント
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--keep');
  const keep = process.argv.includes('--keep');
  const names = args.length > 0 ? args : ['login', 'project', 'picker', 'verify'];
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
  const distManifest = JSON.parse(readFileSync(path.join(DIST_DIR, 'manifest.json'), 'utf8'));
  if (distManifest.oauth2?.client_id?.includes('__OAUTH_CLIENT_ID__')) {
    console.error('dist/manifest.json の client_id が未設定です。.env を設定して npm run dev し直してください');
    process.exit(1);
  }

  log(`拡張 ID: ${EXTENSION_ID}`);
  log(`プロファイル: ${PROFILE_DIR}`);
  log(`実行シーン: ${names.join(' → ')}`);
  log('（このプロファイルの Chrome が既に開いている場合は先に閉じてください）');

  const options = new chrome.Options().addArguments(
    `--user-data-dir=${PROFILE_DIR}`,
    '--profile-directory=Default',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1400,1000',
  );
  const driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();

  let failed = false;
  try {
    for (const name of names) {
      await SCENES[name](driver);
    }
    log('\nすべてのシーンが完了しました。');
  } catch (err) {
    failed = true;
    console.error(`\n中断: ${err instanceof Error ? err.message : String(err)}`);
    console.error('結果は docs/manual-testing.md §3 の結果メモに記録してください。');
  } finally {
    if (keep || failed) {
      await pause('ブラウザを開いたままにしています。目視確認が済んだら Enter で終了します');
    }
    await driver.quit().catch(() => undefined);
  }
  process.exit(failed ? 1 : 0);
}

void main();
