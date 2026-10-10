// 使い方ガイド（hosted/help.html）の図を撮る。
//
// 架空の論文 3 本のデモビルド（dist-demo/）を Playwright の Chromium に読み込み、
// scenes.mjs の各シーンを 1280x800 で撮って hosted/screenshots/ に保存する。
// 実データ・ログイン・API 呼び出しは使わない。
//
// 前提: npm run video:fixtures と npm run build:demo を済ませてあること。
// 使い方:
//   npm run help:shots                      # 全シーン
//   npm run help:shots -- verify dashboard  # 名前を指定したシーンだけ
// オプション:
//   --out <dir>   出力先（既定 hosted/screenshots）
//   --ext <dir>   デモビルドの場所（既定 dist-demo。環境変数 EXT_DIST_DIR でも指定できる）
//   --headed      ウィンドウありで動かす（既定はヘッドレス）
// 1 枚が 300KB を超えたとき、0 枚で終わったとき、シーン名が未知のときは終了コード 1。
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../guide-tour-check/lib/paths.mjs';
import { SHOT_SIZE, withShotBrowser } from './browser.mjs';
import { scenes } from './scenes.mjs';

const MAX_BYTES = 300 * 1024;
// 画面が落ち着いたかの確認: この間隔で撮り比べ、最大この回数まで待つ
const STABLE_INTERVAL_MS = 500;
const STABLE_MAX_TRIES = 12;

export function parseArgs(argv, env = process.env) {
    const options = {
        names: [],
        out: path.join(REPO_ROOT, 'hosted', 'screenshots'),
        ext: path.resolve(REPO_ROOT, env.EXT_DIST_DIR || 'dist-demo'),
        headed: false,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--headed') {
            options.headed = true;
        } else if (arg === '--out' || arg === '--ext') {
            const value = argv[i + 1];
            if (!value) {
                throw new Error(`${arg} にはディレクトリを指定してください`);
            }
            options[arg === '--out' ? 'out' : 'ext'] = path.resolve(REPO_ROOT, value);
            i += 1;
        } else if (arg.startsWith('--')) {
            throw new Error(`未知のオプションです: ${arg}`);
        } else {
            options.names.push(arg);
        }
    }
    return options;
}

// シーンごとに新しいプロファイルで起動する（デモの初期データは起動時に投入されるため、
// 状態を書き換えるシーンが他のシーンの絵を変えない）。
async function shootScene(scene, options) {
    let saved = null;
    await withShotBrowser(options.ext, { headed: options.headed }, async ({ page, extensionId }) => {
        const shot = {
            page,
            open: async pagePath => {
                await page.goto(`chrome-extension://${extensionId}/${pagePath}`);
            },
            openApp: async () => {
                await shot.open('app/app.html#/home');
                await page.locator('#app-nav .app__nav-link').first().waitFor({ state: 'visible', timeout: 20000 });
            },
            snap: async () => {
                const target = path.join(options.out, scene.file);
                // 直前にクリックした位置にマウスが残ると、スクロール後にその下へ来た別の項目が
                // ホバー表示になる。本文の右下の余白へ逃がしてから撮る。
                await page.mouse.move(SHOT_SIZE.width - 8, SHOT_SIZE.height - 8);
                // PDF は少しずつ描かれる。続けて撮った 2 枚が同じになるまで待ってから保存する。
                let image = await page.screenshot({ type: 'png' });
                for (let attempt = 0; attempt < STABLE_MAX_TRIES; attempt += 1) {
                    await page.waitForTimeout(STABLE_INTERVAL_MS);
                    const next = await page.screenshot({ type: 'png' });
                    const same = next.equals(image);
                    image = next;
                    if (same) {
                        break;
                    }
                }
                writeFileSync(target, image);
                saved = target;
            },
        };
        await scene.run(shot);
    });
    if (!saved) {
        throw new Error(`シーン ${scene.name} は画像を保存しませんでした`);
    }
    return saved;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const unknown = options.names.filter(name => !scenes.some(scene => scene.name === name));
    if (unknown.length > 0) {
        throw new Error(`未知のシーン名です: ${unknown.join(', ')}（有効: ${scenes.map(scene => scene.name).join(', ')}）`);
    }
    try {
        statSync(path.join(options.ext, 'manifest.json'));
    } catch {
        throw new Error(`${path.join(options.ext, 'manifest.json')} がありません。先に npm run build:demo を実行してください`);
    }
    mkdirSync(options.out, { recursive: true });
    const selected = options.names.length > 0 ? scenes.filter(scene => options.names.includes(scene.name)) : scenes;
    const started = Date.now();
    let count = 0;
    let oversized = 0;
    let failed = 0;
    for (const scene of selected) {
        try {
            const file = await shootScene(scene, options);
            const bytes = statSync(file).size;
            count += 1;
            console.log(`${scene.file}  ${bytes}`);
            if (bytes > MAX_BYTES) {
                oversized += 1;
                console.warn(`警告: ${scene.file} が 300KB を超えています（${bytes} バイト）`);
            }
        } catch (error) {
            failed += 1;
            console.error(`失敗: ${scene.name}: ${error.message}`);
        }
    }
    console.log(`${count} 枚を撮りました（${Math.round((Date.now() - started) / 1000)} 秒）`);
    if (count === 0) {
        throw new Error('1 枚も撮れませんでした');
    }
    if (failed > 0 || oversized > 0) {
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
