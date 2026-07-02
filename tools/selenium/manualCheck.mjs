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
//      → login → project → picker → home を順に実行
//
// 個別実行: node tools/selenium/manualCheck.mjs picker home
// エッジ:   node tools/selenium/manualCheck.mjs cancel
// 通し確認: node tools/selenium/manualCheck.mjs options protocol schema pilot extract verify dashboard export offline
//   （§2 の S4→S10。ユーザー操作が要る箇所は Enter ではなく DOM の状態変化で自動検知する）
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
const OPTIONS_URL = `chrome-extension://${EXTENSION_ID}/options/options.html`;

// S5 ドラフトで使う既定モデル（pricing.ts に単価があるもの）
const DEFAULT_MODEL = 'gemini-3.5-flash';
// LLM 実弾（ドラフト / 抽出）の完了待ち上限
const LLM_TIMEOUT = 15 * 60 * 1000;
// ユーザー操作（キー入力・エディタ確認・判定など）の待ち上限
const USER_ACTION_TIMEOUT = 30 * 60 * 1000;

// S4 で保存するサンプルプロトコル（S5 の draft-schema がこの raw text を読む）
const SAMPLE_PROTOCOL = `# 実機確認用プロトコル（サンプル）

## リサーチクエスチョン
成人患者を対象としたランダム化比較試験（RCT）において、介入群は対照群と比較して臨床アウトカムを改善するか。

- P: 成人患者
- I: 試験で評価された介入
- C: 対照（プラセボまたは通常ケア）
- O: 主要アウトカム（死亡率など）、副次アウトカム（有害事象、QOL）

## 抽出したい項目
### 研究レベル
- 研究デザイン、実施国、セッティング、追跡期間、総サンプルサイズ、資金源、利益相反

### 群（arm）レベル
- 各群の名称、割付人数、平均年齢、女性の割合

### アウトカムレベル（群別）
- 死亡率（イベント数 / N）
- 有害事象（イベント数 / N）
- QOL スコア（平均値、SD）
`;

/**
 * 再描画による stale element を吸収して読み直す。
 * app のビューはストア更新のたびに DOM を丸ごと作り直す（replaceChildren）ため、
 * 要素の取得〜読み取りの間に再描画が挟まると stale になる。読み取りを 1 つの
 * クロージャにまとめてリトライする
 */
async function retryOnStale(fn, attempts = 5) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (i >= attempts - 1 || !message.includes('stale element')) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

/** 表示中の要素を 1 つ返す（見つからなければ null） */
async function findVisible(driver, selector) {
  for (const element of await driver.findElements(By.css(selector))) {
    if (await element.isDisplayed().catch(() => false)) {
      return element;
    }
  }
  return null;
}

/**
 * 値を設定して input / change を発火する（Playwright の fill 相当）。
 * 長文の sendKeys を避けつつ、input 購読・submit 時読み取りの両方の実装に効かせる
 */
async function setValue(driver, element, value) {
  await driver.executeScript(
    'const el = arguments[0]; el.value = arguments[1];' +
      "el.dispatchEvent(new Event('input', { bubbles: true }));" +
      "el.dispatchEvent(new Event('change', { bubbles: true }));",
    element,
    value,
  );
}

/** いずれかのセレクタが表示されるまで待ち、一致したセレクタ文字列を返す */
async function waitForAnyVisible(driver, selectors, timeoutMs, what) {
  let matched = null;
  await driver.wait(
    async () => {
      for (const selector of selectors) {
        if ((await findVisible(driver, selector)) !== null) {
          matched = selector;
          return true;
        }
      }
      return false;
    },
    timeoutMs,
    what,
  );
  return matched;
}

/** 要素のテキストを返す（stale・不在は空文字扱い） */
async function textOf(driver, selector) {
  return retryOnStale(async () => {
    const element = await findVisible(driver, selector);
    return element === null ? '' : (await element.getText()).trim();
  }).catch(() => '');
}

/**
 * beforeHandles に無い新規タブのうち、URL が prefix で始まるものが開くのを待って
 * そのハンドルを返す（切替えた状態で返る）。複数の新規タブが開いても（ユーザーの
 * 先回り操作などで想定外のタブが混ざっても）目的のタブだけを拾う。
 * フォーカス移動を避けるため、切替えは「未確認の新規ハンドルが現れたとき」だけ行う
 */
async function waitForWindowWithUrl(driver, beforeHandles, prefix, timeoutMs, what) {
  const checked = new Set(beforeHandles);
  let found = null;
  await driver.wait(
    async () => {
      for (const handle of await driver.getAllWindowHandles()) {
        if (checked.has(handle)) {
          continue;
        }
        checked.add(handle);
        try {
          await driver.switchTo().window(handle);
          if ((await driver.getCurrentUrl()).startsWith(prefix)) {
            found = handle;
            return true;
          }
        } catch {
          // 確認中に閉じられたタブは無視する
        }
      }
      return false;
    },
    timeoutMs,
    `${what} のタブが開きません`,
  );
  return found;
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
  await waitForWindowWithUrl(driver, before, APP_URL, 3 * 60 * 1000, 'メインビュー');
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
  const pickerHandle = await waitForWindowWithUrl(driver, before, PICKER_ORIGIN, 30000, 'Picker');
  const pickerUrl = await driver.getCurrentUrl();
  ok(`Picker タブが開きました: ${pickerUrl.split('#')[0]}`);
  log(`\n>>> ${instruction}`);
  log('>>> （タブが閉じるのを自動検知します。Enter は不要）');
  // Picker タブに表示を残したまま待つ（switchTo はタブを前面化してしまうため呼ばない。
  // getAllWindowHandles はセッション単位の操作なので現タブが閉じられても失敗しない）
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
  // 完了 = 取り込みボタンが再度有効になる（importing = false）。
  // 進捗更新のたびに再描画されるため、要素は毎回取り直し stale は「未完了」扱いにする
  await driver.wait(async () => {
    try {
      return await driver.findElement(By.css('#documents-import')).isEnabled();
    } catch {
      return false;
    }
  }, 10 * 60 * 1000, '取り込みが完了しません');
  const progressTexts = await retryOnStale(async () => {
    const statuses = await driver.findElements(By.css('.documents__progress-status'));
    return Promise.all(statuses.map((status) => status.getText()));
  });
  for (const text of progressTexts) {
    if (text.startsWith('完了')) {
      ok(`進捗行: ${text}`);
    } else {
      ng(`進捗行: ${text}`);
    }
  }
  const tableRows = await retryOnStale(async () => {
    const rows = await driver.findElements(By.css('#documents-table tbody tr'));
    const result = [];
    for (const row of rows) {
      const cells = await row.findElements(By.css('td'));
      result.push({
        filename: await cells[1].getText(),
        badge: (await cells[2].getText()).replace(/\s+/g, ' '),
      });
    }
    return result;
  });
  if (tableRows.length === 0) {
    ng('一覧に文献が表示されていません');
    throw new Error('picker 失敗');
  }
  for (const row of tableRows) {
    ok(`一覧: ${row.filename} / text_status = ${row.badge}`);
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

async function sceneHome(driver) {
  log('\n[home] #/home 進捗カウントの実データ確認（手順書 §1-2 #3）');
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
  const summary = await retryOnStale(async () => {
    const labels = await driver.findElements(By.css('.home__summary-label'));
    const values = await driver.findElements(By.css('.home__summary-value'));
    const pairs = [];
    for (let i = 0; i < labels.length; i++) {
      pairs.push({ label: await labels[i].getText(), value: await values[i].getText() });
    }
    return pairs;
  });
  let documentsCount = -1;
  for (const { label, value } of summary) {
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

// ---------------------------------------------------------------------------
// §2 通し確認のシーン（S4→S10）。ユーザー操作が要る箇所は Enter 待ちではなく
// DOM の状態変化（保存完了・確定・判定チップの出現など）で自動検知する
// ---------------------------------------------------------------------------

async function sceneOptions(driver) {
  log('\n[options] Gemini API キーの保存（手順書 §2 #1）');
  await driver.get(OPTIONS_URL);
  await driver.wait(until.elementLocated(By.css('#options-status')), 10000);
  // 初期判定（「読み込み中…」→「Gemini: 保存済み / 未設定」）を待つ
  await driver.wait(async () => {
    const text = await textOf(driver, '#options-status');
    return text !== '' && !text.includes('読み込み中');
  }, 15000, 'Options の状態が確定しません');
  const status = await textOf(driver, '#options-status');
  if (status.includes('保存済み')) {
    ok(`既に保存済みです（${status}）`);
    return;
  }
  log('\n>>> 開いた Options 画面で Gemini API キーを入力し「保存」を押してください');
  log('>>> （「保存しました。」の表示を自動検知します。キーの値はログに出しません）');
  await driver.wait(async () => {
    const text = await textOf(driver, '#options-status');
    return text.includes('保存しました');
  }, USER_ACTION_TIMEOUT, 'API キーが保存されません');
  ok('Gemini API キーを保存しました');
}

async function sceneProtocol(driver) {
  log('\n[protocol] S4 プロトコル入力（手順書 §2 #2）');
  await switchToApp(driver, '#/protocol');
  const state = await waitForAnyVisible(
    driver,
    ['#protocol-form', '#protocol-readonly', '#protocol-load-error', '#protocol-no-project'],
    30000,
    '#/protocol が表示されません',
  );
  if (state === '#protocol-load-error' || state === '#protocol-no-project') {
    ng(`プロトコル画面がエラー状態です: ${await textOf(driver, state)}`);
    throw new Error('protocol 失敗');
  }
  if (state === '#protocol-readonly') {
    ok(`既に保存済み: ${(await textOf(driver, '#protocol-summary')).replace(/\s+/g, ' ')}`);
    return;
  }
  await driver.findElement(By.css('input[name="protocol-source"][value="manual"]')).click();
  await setValue(driver, await driver.findElement(By.css('#protocol-inline')), SAMPLE_PROTOCOL);
  await driver.findElement(By.css('#protocol-submit')).click();
  log('  サンプルプロトコルを保存中…');
  const result = await waitForAnyVisible(
    driver,
    ['#protocol-readonly', '#protocol-error'],
    60000,
    'プロトコルの保存が完了しません',
  );
  if (result === '#protocol-error') {
    ng(`保存エラー: ${await textOf(driver, '#protocol-error')}`);
    throw new Error('protocol 失敗');
  }
  ok(`保存完了（読み取り専用表示へ遷移）: ${(await textOf(driver, '#protocol-summary')).replace(/\s+/g, ' ')}`);
}

async function sceneSchema(driver) {
  log('\n[schema] S5 スキーマドラフト → 確定（手順書 §2 #3）');
  await switchToApp(driver, '#/schema');
  const state = await waitForAnyVisible(
    driver,
    ['#schema-draft-form', '#schema-editor', '#schema-confirmed', '#schema-load-error', '#schema-no-project'],
    30000,
    '#/schema が表示されません',
  );
  if (state === '#schema-load-error' || state === '#schema-no-project') {
    ng(`スキーマ画面がエラー状態です: ${await textOf(driver, state)}`);
    throw new Error('schema 失敗');
  }
  if (state === '#schema-confirmed') {
    ok(`既に確定済み: ${await textOf(driver, '#schema-current-meta')}`);
    return;
  }
  if (state === '#schema-draft-form') {
    // サンプル文献を先頭から最大 2 本選択（no_text_layer は disabled）
    const checkboxes = await driver.findElements(
      By.css('#schema-sample-list input[type="checkbox"]'),
    );
    let selected = 0;
    for (const box of checkboxes) {
      if (selected >= 2) {
        break;
      }
      if (!(await box.isEnabled())) {
        continue;
      }
      if (!(await box.isSelected())) {
        await box.click();
      }
      selected++;
    }
    if (selected === 0) {
      ng('選択できるサンプル文献がありません（取り込み済み文献を確認してください）');
      throw new Error('schema 失敗');
    }
    ok(`サンプル ${selected} 本を選択`);
    await setValue(driver, await driver.findElement(By.css('#schema-model')), DEFAULT_MODEL);
    await driver.findElement(By.css('#schema-draft-run')).click();
    log(`  ドラフト生成中（${DEFAULT_MODEL} 実弾。数十秒〜数分かかります）…`);
    const result = await waitForAnyVisible(
      driver,
      ['#schema-editor', '#schema-draft-error'],
      LLM_TIMEOUT,
      'ドラフト生成が完了しません',
    );
    if (result === '#schema-draft-error') {
      ng(`ドラフト失敗: ${await textOf(driver, '#schema-draft-error')}`);
      throw new Error('schema 失敗');
    }
    const rows = await driver.findElements(By.css('#schema-editor-table tbody tr'));
    ok(`ドラフト完了: ${rows.length} 行の項目案`);
  }
  log('\n>>> エディタの内容を確認し（必要なら修正して）「版として確定」を押してください');
  log('>>> （確定の完了を自動検知します）');
  await driver.wait(
    async () => (await findVisible(driver, '#schema-confirmed')) !== null,
    USER_ACTION_TIMEOUT,
    'スキーマが確定されません',
  );
  ok(`確定完了: ${await textOf(driver, '#schema-current-meta')}`);
}

/** 未検証チップを持つセルの判定ボタンを 1 つ返す（無ければ null） */
async function findUnverifiedAction(driver, actionSelector) {
  for (const cell of await driver.findElements(By.css('.verify__cell'))) {
    try {
      const chips = await cell.findElements(By.css('.verify__chip--unverified'));
      if (chips.length === 0) {
        continue;
      }
      const buttons = await cell.findElements(By.css(actionSelector));
      if (buttons.length > 0 && (await buttons[0].isDisplayed())) {
        return buttons[0];
      }
    } catch {
      // 再描画で stale になったセルはスキップして次を探す
    }
  }
  return null;
}

async function scenePilot(driver) {
  log('\n[pilot] S6 パイロット抽出 → 検証（手順書 §2 #4〜5）');
  await switchToApp(driver, '#/pilot');
  const state = await waitForAnyVisible(
    driver,
    ['#pilot-run', '.verify__panes', '#pilot-documents-error', '#pilot-documents-empty'],
    30000,
    '#/pilot が表示されません',
  );
  if (state === '#pilot-documents-error' || state === '#pilot-documents-empty') {
    ng(`パイロット画面がエラー / 空です: ${await textOf(driver, state)}`);
    throw new Error('pilot 失敗');
  }
  if (state === '#pilot-run') {
    ok(`コスト概算: ${await textOf(driver, '#pilot-estimate')}`);
    const modelInput = await driver.findElement(By.css('#pilot-model'));
    if (((await modelInput.getAttribute('value')) ?? '').trim() === '') {
      await setValue(driver, modelInput, DEFAULT_MODEL);
    }
    await driver.findElement(By.css('#pilot-run')).click();
    log('  パイロット抽出を実行中（Gemini 実弾。数分かかります）…');
    const result = await waitForAnyVisible(
      driver,
      ['#pilot-run-done', '#pilot-partial-failure', '#pilot-run-error'],
      LLM_TIMEOUT,
      'パイロット抽出が完了しません',
    );
    if (result === '#pilot-run-error') {
      ng(`実行エラー: ${await textOf(driver, '#pilot-run-error')}`);
      throw new Error('pilot 失敗');
    }
    if (result === '#pilot-partial-failure') {
      ng(`一部失敗: ${await textOf(driver, '#pilot-partial-failure')}（検証は続行します）`);
    } else {
      ok('パイロット抽出が完了しました');
    }
  }
  // 埋め込み検証 UI（PDF 描画 + ハイライト）
  await driver.wait(
    async () => (await findVisible(driver, '.verify__panes')) !== null,
    60000,
    '検証 UI が表示されません',
  );
  await driver.wait(
    async () => (await findVisible(driver, '.pdf-viewer__page-indicator')) !== null,
    60000,
    'PDF が描画されません',
  );
  ok(`PDF 表示: ${await textOf(driver, '.pdf-viewer__page-indicator')}`);
  const highlights = await driver.findElements(By.css('.pdf-viewer__hl'));
  const chips = await driver.findElements(By.css('.verify__chip'));
  ok(`ハイライト ${highlights.length} 個 / 検証セル ${chips.length} 件`);
  log('\n>>> ハイライトが根拠箇所に出ているか目視で確認し、承認 / 修正 / 棄却 / 未報告 の判定を');
  log('>>> 各 1 回以上行ってください（キーボード a / e / x / n。z の取り消し確認は任意）');
  log('>>> （4 種類の判定チップが揃うのを自動検知します）');
  const kinds = ['accept', 'edit', 'reject', 'not_reported'];
  await driver.wait(
    async () => {
      for (const kind of kinds) {
        if ((await driver.findElements(By.css(`.verify__chip--${kind}`))).length === 0) {
          return false;
        }
      }
      return true;
    },
    USER_ACTION_TIMEOUT,
    '4 種類の判定が揃いません',
  );
  ok('承認 / 修正 / 棄却 / 未報告 の 4 種類の判定を確認しました');
  log('  → Decisions タブへの追記と StudyData / ResultsData の human 行は Sheets 側で裏取りしてください');
}

async function sceneExtract(driver) {
  log('\n[extract] S7 一括抽出（手順書 §2 #6）');
  await switchToApp(driver, '#/extract');
  const state = await waitForAnyVisible(
    driver,
    ['#extract-run', '#extract-load-error'],
    30000,
    '#/extract が表示されません',
  );
  if (state === '#extract-load-error') {
    ng(`一括抽出画面がエラー状態です: ${await textOf(driver, '#extract-load-error')}`);
    throw new Error('extract 失敗');
  }
  if ((await findVisible(driver, '#extract-pilot-warning')) !== null) {
    ng('パイロット未実施の警告が出ています（pilot シーンを先に実行してください）');
  }
  // 既定選択（未抽出）が 0 件なら、抽出済みを含めて全件選択して再抽出の経路を通す
  const checkboxes = await driver.findElements(
    By.css('#extract-documents input[type="checkbox"]'),
  );
  let selectedCount = 0;
  for (const box of checkboxes) {
    if ((await box.isEnabled()) && (await box.isSelected())) {
      selectedCount++;
    }
  }
  if (selectedCount === 0) {
    for (const box of checkboxes) {
      if (await box.isEnabled()) {
        await box.click();
        selectedCount++;
      }
    }
    log(`  未抽出 0 件のため全 ${selectedCount} 件を選択（再抽出）`);
  } else {
    ok(`既定選択（未抽出）: ${selectedCount} 件`);
  }
  if (selectedCount === 0) {
    ng('選択できる文献がありません');
    throw new Error('extract 失敗');
  }
  const modelInput = await driver.findElement(By.css('#extract-model'));
  if (((await modelInput.getAttribute('value')) ?? '').trim() === '') {
    await setValue(driver, modelInput, DEFAULT_MODEL);
  }
  ok(`コスト概算: ${await textOf(driver, '#extract-estimate')}`);
  await driver.findElement(By.css('#extract-run')).click();
  await driver.wait(
    async () => (await findVisible(driver, '#extract-confirm')) !== null,
    10000,
    '実行確認カードが表示されません',
  );
  ok(`実行確認カード表示: ${await textOf(driver, '#extract-confirm-title')}`);
  await driver.findElement(By.css('#extract-confirm-run')).click();
  log('  一括抽出を実行中（Gemini 実弾。数分かかります）…');
  const result = await waitForAnyVisible(
    driver,
    ['#extract-run-done', '#extract-partial-failure', '#extract-run-error'],
    LLM_TIMEOUT,
    '一括抽出が完了しません',
  );
  if (result === '#extract-run-error') {
    ng(`実行エラー: ${await textOf(driver, '#extract-run-error')}`);
    throw new Error('extract 失敗');
  }
  const docRows = await retryOnStale(async () => {
    const rows = await driver.findElements(By.css('#extract-doc-list .extract__doc-row'));
    return Promise.all(rows.map((row) => row.getText()));
  });
  for (const row of docRows) {
    log(`  document 進捗: ${row.replace(/\s+/g, ' ')}`);
  }
  if (result === '#extract-partial-failure') {
    ng(`一部失敗: ${await textOf(driver, '#extract-partial-failure')}（画面の「再試行」で個別に再実行できます）`);
  } else {
    ok('一括抽出が完了しました');
  }
  if ((await findVisible(driver, '#extract-verify-link')) !== null) {
    ok('検証画面への導線（#/verify）を確認');
  }
}

async function sceneVerifyScreen(driver) {
  log('\n[verify] S8 検証画面（手順書 §2 #7）');
  await switchToApp(driver, '#/verify');
  const state = await waitForAnyVisible(
    driver,
    ['#verify-doc', '#verify-empty', '#verify-error'],
    30000,
    '#/verify が表示されません',
  );
  if (state !== '#verify-doc') {
    ng(`検証画面がエラー / 空です: ${await textOf(driver, state)}`);
    throw new Error('verify 失敗');
  }
  await driver.wait(
    async () => (await findVisible(driver, '.verify__panes')) !== null,
    60000,
    '検証データが読み込まれません',
  );
  const url = await driver.getCurrentUrl();
  if (url.includes('doc=')) {
    ok(`URL に ?doc= が同期: …${url.slice(url.indexOf('#'))}`);
  } else {
    ng(`URL に ?doc= がありません: ${url}`);
  }
  // 文献切替 → URL 同期の確認（2 本以上あるとき）
  const select = await driver.findElement(By.css('#verify-doc'));
  const options = await select.findElements(By.css('option'));
  if (options.length >= 2) {
    const nextValue = await options[1].getAttribute('value');
    await setValue(driver, select, nextValue);
    await driver.wait(
      async () => (await driver.getCurrentUrl()).includes(encodeURIComponent(nextValue)) ||
        (await driver.getCurrentUrl()).includes(nextValue),
      15000,
      '文献切替が URL に反映されません',
    );
    await driver.wait(
      async () => (await findVisible(driver, '.verify__panes')) !== null,
      60000,
      '切替後の検証データが読み込まれません',
    );
    ok('文献切替 → ?doc= 同期 + 再読み込みを確認');
  } else {
    log('  文献が 1 本のみのため切替確認はスキップ');
  }
  // 群構成の確定（arm レベル項目があるスキーマのみカードが出る）
  if ((await findVisible(driver, '.verify__arm-summary')) !== null) {
    ok(`群構成は確定済み: ${await textOf(driver, '.verify__arm-summary')}`);
  } else if ((await findVisible(driver, '#verify-arm-card')) !== null) {
    log('\n>>> 群構成カードの内容を確認し（必要なら編集して）「群構成を確定」を押してください');
    log('>>> （確定を自動検知します）');
    await driver.wait(
      async () => (await findVisible(driver, '.verify__arm-summary')) !== null,
      USER_ACTION_TIMEOUT,
      '群構成が確定されません',
    );
    ok(`群構成を確定: ${await textOf(driver, '.verify__arm-summary')}`);
    log('  → ArmStructures タブへの追記は Sheets 側で裏取りしてください');
  } else {
    log('  群構成カードなし（arm レベル項目のないスキーマ）');
  }
}

async function sceneDashboard(driver) {
  log('\n[dashboard] S9 ダッシュボード（手順書 §2 #8）');
  await switchToApp(driver, '#/dashboard');
  const state = await waitForAnyVisible(
    driver,
    ['#dashboard-summary', '#dashboard-empty', '#dashboard-load-error'],
    60000,
    '#/dashboard が表示されません',
  );
  if (state !== '#dashboard-summary') {
    ng(`ダッシュボードがエラー / 0 件です: ${await textOf(driver, state)}`);
    throw new Error('dashboard 失敗');
  }
  ok(`サマリ: ${(await textOf(driver, '#dashboard-summary')).replace(/\s+/g, ' ')}`);
  const rows = await driver.findElements(By.css('#dashboard-matrix tbody tr'));
  ok(`マトリクス: ${rows.length} 行`);
  const links = await driver.findElements(By.css('.dashboard__cell-link'));
  if (links.length === 0) {
    ng('セルリンクがありません（全セル 0 件）');
    throw new Error('dashboard 失敗');
  }
  const href = await links[0].getAttribute('href');
  await links[0].click();
  await driver.wait(
    async () => (await findVisible(driver, '.verify__panes')) !== null,
    60000,
    'セルクリック後に検証画面が表示されません',
  );
  const url = await driver.getCurrentUrl();
  if (url.includes('doc=') && url.includes('entity=')) {
    ok(`セルクリック → #/verify?doc=&entity= へ遷移: …${url.slice(url.indexOf('#'))}`);
  } else {
    ng(`遷移先 URL が想定外です: ${url}（リンク: ${href}）`);
  }
  // ディープリンクのフォーカス適用は microtask 後なので少し待って判定する
  try {
    await driver.wait(
      async () => (await findVisible(driver, '.verify__cell--focused')) !== null,
      10000,
    );
    ok(`該当セルにフォーカス: ${await textOf(driver, '.verify__cell--focused .verify__cell-label')}`);
  } catch {
    ng('セルフォーカスが確認できません（群構成未確定でタブがロック中の可能性）');
  }
}

async function sceneExport(driver) {
  log('\n[export] S10 エクスポート（手順書 §2 #9）');
  await switchToApp(driver, '#/export');
  const state = await waitForAnyVisible(
    driver,
    ['#export-format', '#export-load-error'],
    60000,
    '#/export が表示されません',
  );
  if (state === '#export-load-error') {
    ng(`エクスポート画面がエラー状態です: ${await textOf(driver, '#export-load-error')}`);
    throw new Error('export 失敗');
  }
  // 3 形式のプレビューを順に確認
  for (const format of ['study_wide', 'results_long', 'audit']) {
    await driver.findElement(By.css(`#export-format input[value=${format}]`)).click();
    await driver.wait(
      async () => (await findVisible(driver, '#export-summary')) !== null,
      15000,
      `${format} のサマリが表示されません`,
    );
    ok(`${format}: ${(await textOf(driver, '#export-summary')).replace(/\s+/g, ' ')}`);
  }
  // study_wide で生成（未検証セルが残っていれば警告 → 中止 → 続行 の両経路を通す）
  await driver.findElement(By.css('#export-format input[value=study_wide]')).click();
  const generate = await driver.findElement(By.css('#export-generate'));
  if (!(await generate.isEnabled())) {
    ng('生成ボタンが無効です（データ行 0 件）');
    throw new Error('export 失敗');
  }
  await generate.click();
  let outcome = await waitForAnyVisible(
    driver,
    ['#export-warning', '#export-result', '#export-generate-error'],
    2 * 60 * 1000,
    '生成が開始されません',
  );
  if (outcome === '#export-warning') {
    ok(`警告ダイアログ表示: ${await textOf(driver, '#export-warning-title')}`);
    await driver.findElement(By.css('#export-warning-cancel')).click();
    await driver.wait(
      async () => (await findVisible(driver, '#export-warning')) === null,
      10000,
      '警告ダイアログが閉じません',
    );
    ok('「中止」でダイアログが閉じることを確認');
    await driver.findElement(By.css('#export-generate')).click();
    await driver.wait(
      async () => (await findVisible(driver, '#export-warning')) !== null,
      15000,
      '警告ダイアログが再表示されません',
    );
    await driver.findElement(By.css('#export-warning-continue')).click();
    outcome = await waitForAnyVisible(
      driver,
      ['#export-result', '#export-generate-error'],
      3 * 60 * 1000,
      '生成が完了しません',
    );
  }
  if (outcome === '#export-generate-error') {
    ng(`生成失敗: ${await textOf(driver, '#export-generate-error')}`);
    throw new Error('export 失敗');
  }
  const link = await findVisible(driver, '#export-result-link');
  ok(`生成完了。Drive 保存先: ${link === null ? '（リンクなし）' : await link.getAttribute('href')}`);
  log('  → exports/ の CSV 実体と ExportLog 追記は Drive / Sheets 側で裏取りしてください');
}

async function sceneOffline(driver) {
  log('\n[offline] オフラインキュー（手順書 §2 #10）');
  await switchToApp(driver, '#/verify');
  await driver.wait(
    async () => (await findVisible(driver, '.verify__panes')) !== null,
    60000,
    '検証画面が表示されません',
  );
  const acceptButton = await findUnverifiedAction(driver, '.verify__action--accept');
  if (acceptButton === null) {
    ng('未検証セルがありません（全て判定済み）。オフライン確認には未検証セルが 1 つ以上必要です');
    throw new Error('offline 失敗');
  }
  // chromedriver のネットワークエミュレーションでオフライン化
  await driver.setNetworkConditions({
    offline: true,
    latency: 0,
    download_throughput: 0,
    upload_throughput: 0,
  });
  log('  ネットワークをオフライン化しました');
  try {
    await acceptButton.click();
    await driver.wait(async () => {
      const text = await textOf(driver, '#verify-queued');
      return text.includes('キュー');
    }, 30000, 'キュー表示が出ません');
    ok(`キュー表示: ${await textOf(driver, '#verify-queued')}`);
  } catch (err) {
    ng(
      'オフライン判定がキューに入りません（CDP のオフライン化が拡張ページに効いていない可能性。' +
        'その場合は DevTools の Network → Offline で手動確認してください）',
    );
    throw err;
  } finally {
    await driver.setNetworkConditions({
      offline: false,
      latency: 0,
      download_throughput: -1,
      upload_throughput: -1,
    });
    log('  オンラインへ復帰しました');
  }
  // 次の判定で自動再送 → キュー表示が消える
  const nextButton = await findUnverifiedAction(driver, '.verify__action--accept');
  if (nextButton === null) {
    ng('再送トリガー用の未検証セルがありません（次の判定時に再送される仕様のため、後続の操作で消えることを目視確認してください）');
    return;
  }
  await nextButton.click();
  await driver.wait(async () => {
    const text = await textOf(driver, '#verify-queued');
    return text === '' || !text.includes('キュー');
  }, 60000, 'キューが再送されません');
  ok('オンライン復帰後の判定でキューが再送され、表示が消えました');
}

const SCENES = {
  prepare: scenePrepare,
  login: sceneLogin,
  project: sceneProject,
  picker: scenePicker,
  cancel: sceneCancel,
  home: sceneHome,
  options: sceneOptions,
  protocol: sceneProtocol,
  schema: sceneSchema,
  pilot: scenePilot,
  extract: sceneExtract,
  verify: sceneVerifyScreen,
  dashboard: sceneDashboard,
  export: sceneExport,
  offline: sceneOffline,
};

// ---------------------------------------------------------------------------
// エントリポイント
// ---------------------------------------------------------------------------

async function main() {
  const rawArgs = process.argv.slice(2);
  const keep = rawArgs.includes('--keep');
  // --auto: stdin を使わない（別プロセスからの起動用）。失敗時は一時停止せず
  // スクリーンショット + DOM を .selenium-profile/ へ保存して終了する
  const auto = rawArgs.includes('--auto');
  const args = rawArgs.filter((a) => !a.startsWith('--'));
  const names = args.length > 0 ? args : ['login', 'project', 'picker', 'home'];
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
    if (auto) {
      try {
        writeFileSync(
          path.join(PROFILE_DIR, 'last-failure.png'),
          await driver.takeScreenshot(),
          'base64',
        );
        writeFileSync(path.join(PROFILE_DIR, 'last-failure.html'), await driver.getPageSource());
        console.error(`失敗時の状態を保存しました: ${path.join(PROFILE_DIR, 'last-failure.png')} / .html`);
      } catch {
        // 取得できない状態（ブラウザごと落ちた等）は諦める
      }
    }
  } finally {
    if (!auto && (keep || failed)) {
      await pause('ブラウザを開いたままにしています。目視確認が済んだら Enter で終了します');
    }
    await driver.quit().catch(() => undefined);
  }
  process.exit(failed ? 1 : 0);
}

void main();
