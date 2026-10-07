import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { parseArgs } from './lib/options.mjs';
import { defineScenario, selectScenarios } from './lib/scenario.mjs';
import { executeScenarios, summarize } from './lib/results.mjs';
import { resolveDemoDir } from './lib/paths.mjs';
import { Run } from './lib/run.mjs';
import { expectUnchanged, expectTargetBlocked } from './lib/blocked.mjs';

test('引数の既定値と明示指定', () => {
    assert.deepEqual(parseArgs([]), { only: null, lang: 'ja', size: { width: 1280, height: 800 } });
    assert.deepEqual(parseArgs(['--lang', 'en', '--size', '400x700', '--only', 'getting-started']), {
        only: 'getting-started', lang: 'en', size: { width: 400, height: 700 },
    });
});

test('値の欠落・不正な言語・サイズ・パス・未知の引数は拒否する', () => {
    for (const args of [
        ['--only'], ['--lang'], ['--size'], ['--only', '--lang', 'en'], ['--lang', 'fr'],
        ['--size', '0x800'], ['--size', '-1x800'], ['--size', '800.5x600'],
        ['--size', '99999999999999999999x800'], ['--size', '800X600'], ['--only', '../a'], ['--unknown'],
    ]) assert.throws(() => parseArgs(args), undefined, args.join(' '));
});

test('シナリオの必須項目・名前・重複を検査する', () => {
    const valid = { name: 'sample', title: '検証', run() {} };
    assert.equal(defineScenario(valid), valid);
    for (const value of [null, {}, { ...valid, name: '../x' }, { ...valid, title: '' }, { ...valid, run: null }]) {
        assert.throws(() => defineScenario(value));
    }
    assert.deepEqual(selectScenarios([valid], null), [valid]);
    assert.deepEqual(selectScenarios([valid], 'sample'), [valid]);
    assert.throws(() => selectScenarios([valid], 'missing'));
    assert.throws(() => selectScenarios([], null));
    assert.throws(() => selectScenarios([valid, valid], null));
});

test('実シナリオはファイル名と定義が一致し、6本とも選択できる', async () => {
    const directory = new URL('./scenarios/', import.meta.url);
    const scenarios = [];
    for (const file of readdirSync(directory).filter(f => f.endsWith('.mjs'))) {
        const scenario = defineScenario((await import(new URL(file, directory).href)).default);
        assert.equal(`${scenario.name}.mjs`, file);
        scenarios.push(scenario);
    }
    assert.deepEqual(selectScenarios(scenarios, null).map(s => s.name).sort(), [
        'dual-review', 'export-data', 'getting-started', 'getting-started-all-done', 'pilot-and-extract', 'verify-basics',
    ]);
});

test('遮断の監視は全期間を確認し、途中の変化も検出する', async () => {
    let samples = 0;
    await expectUnchanged(async () => ({ quotes: 2 }), { quotes: 2 }, async () => { samples++; });
    assert.equal(samples, 20);
    let value = 2;
    await assert.rejects(() => expectUnchanged(async () => ({ quotes: value }), { quotes: 2 }, async () => { value--; }), /対象の処理/);
    let index = 0;
    await assert.rejects(() => expectUnchanged(async () => [2, 1, 2][index++], 2, async () => {}), /対象の処理/);
});

test('遮断確認はマウスとフォーカス後の Enter を送り、リスナを片づける', async () => {
    const calls = [];
    const button = {
        first() { return this; }, isEnabled: async () => true, evaluate: async () => true,
        click: async options => calls.push(['click', options]),
        focus: async () => calls.push('focus'), press: async key => calls.push(key),
    };
    const run = {
        action: async (_condition, fn) => fn(), shot: async label => calls.push(label),
        page: { locator: () => button, on: () => calls.push('on'), off: () => calls.push('off'), waitForTimeout: async () => {} },
    };
    await expectTargetBlocked(run, { target: 'button', unchanged: async () => 2 });
    assert.deepEqual(calls, ['on', ['click', { force: true }], 'blocked-mouse', 'focus', 'Enter', 'blocked-Enter', 'off']);
    let count = 0;
    await assert.rejects(() => expectTargetBlocked(run, { target: 'button', unchanged: async () => count++ }), /対象の処理/);
    assert.equal(calls.at(-1), 'off');
    button.isEnabled = async () => false;
    await assert.rejects(() => expectTargetBlocked(run, { target: 'button', unchanged: async () => 2 }), /対象自体が無効/);
});

test('失敗後も次を実行し、警告を保持して非ゼロ終了にする', async () => {
    const calls = [];
    const results = await executeScenarios([{ name: 'first' }, { name: 'second' }], async (scenario, warnings) => {
        calls.push(scenario.name);
        warnings.push('対象を覆っています');
        if (scenario.name === 'first') throw new Error('手順 import: 文献を待っています');
    });
    assert.deepEqual(calls, ['first', 'second']);
    assert.deepEqual(results.map(r => r.ok), [false, true]);
    const summary = summarize(results);
    assert.equal(summary.exitCode, 1);
    assert.match(summary.text, /手順 import/);
    assert.match(summary.text, /警告: 対象を覆っています/);
    assert.match(summary.text, /成功: second/);
    assert.equal(summarize(results.slice(1)).exitCode, 0);
    assert.equal(summarize([]).exitCode, 1);
});

test('デモビルドが無ければビルドを促す', () => {
    assert.throws(() => resolveDemoDir({ EXT_DIST_DIR: 'tools/guide-tour-check/nonexistent-demo' }), /npm run build:demo/);
});

test('待ちの失敗にシナリオ・手順・条件・カード属性・URL・画像を残す', async () => {
    const page = {
        locator: () => ({ evaluateAll: async () => [{ step: 'draft-schema', waiting: 'true' }] }),
        url: () => 'chrome-extension://fake/app/app.html?demoState=empty#/schema',
    };
    const run = new Run('getting-started', page, 'fake', 'ja', 'fake-demo', []);
    run.stepId = 'confirm-schema';
    run.shot = async label => `${label}.png`;
    await assert.rejects(() => run.action('確定ボタンが表示される', async () => { throw new Error('待ち時間切れ'); }), error => {
        for (const text of ['getting-started', 'confirm-schema', '確定ボタンが表示される', 'draft-schema',
            'data-guide-step', 'data-guide-waiting', 'true', page.url(), 'FAIL-confirm-schema.png', '待ち時間切れ']) {
            assert.ok(error.message.includes(text), text);
        }
        return true;
    });
});
