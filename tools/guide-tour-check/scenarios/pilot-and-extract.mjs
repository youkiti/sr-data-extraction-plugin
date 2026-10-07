import { defineScenario } from '../lib/scenario.mjs';
import { start, next } from '../lib/tour.mjs';

export default defineScenario({
    name: 'pilot-and-extract',
    title: 'パイロットと一括抽出をモックで実行し、完了で自動進行する',
    async run(run) {
        await start(run, 'pilot-and-extract');
        await run.step('open-pilot', 'nav-pilot');
        await run.click('[data-tour="nav-pilot"]');
        await run.step('select-studies', 'pilot-extract-study');
        await run.action('パイロットは先頭の論文だけを選ぶ', async () => {
            const boxes = run.page.locator('#pilot-documents input[type="checkbox"]');
            for (let i = 0; i < await boxes.count(); i++) await boxes.nth(i).setChecked(i === 0);
        });
        await next(run);
        await run.step('run-pilot', 'pilot-extract-run-pilot');
        await run.click('#pilot-run');
        await run.visible('#pilot-run-done');
        await run.step('review-pilot', 'pilot-extract-review');
        await next(run);
        await run.step('open-extract', 'nav-extract');
        await run.click('[data-tour="nav-extract"]');
        await run.step('check-estimate', 'pilot-extract-estimate');
        await run.action('一括抽出は未抽出の 2 本目を選ぶ', async () => {
            const boxes = run.page.locator('#extract-studies input[type="checkbox"]');
            for (let i = 0; i < await boxes.count(); i++) await boxes.nth(i).setChecked(i === 1);
        });
        await next(run);
        await run.step('run-extract', 'pilot-extract-run-full');
        await run.click('#extract-run');
        await run.visible('#extract-confirm-run');
        await run.click('#extract-confirm-run');
        await run.visible('#extract-run-done');
        await run.step('finish', 'tour-list');
        await run.finish('pilot-and-extract');
    },
});
