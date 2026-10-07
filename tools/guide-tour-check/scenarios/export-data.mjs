import { defineScenario } from '../lib/scenario.mjs';
import { start, next } from '../lib/tour.mjs';

export default defineScenario({
    name: 'export-data',
    title: '進捗・形式・未検証警告・生成の案内を最後まで確認する',
    async run(run) {
        await start(run, 'export-data');
        await run.step('open-dashboard', 'nav-dashboard');
        await run.click('[data-tour="nav-dashboard"]');
        await run.step('check-progress', 'export-data-progress');
        await next(run);
        await run.step('open-export', 'nav-export');
        await run.click('[data-tour="nav-export"]');
        await run.step('choose-format', 'export-data-format');
        await run.action('R セットを選ぶ', () => run.page.locator('input[name="export-format"][value="r_set"]').check());
        await run.click('[data-tour="export-data-generate"]');
        await run.visible('#export-warning');
        await next(run);
        await run.step('unverified-warning', 'export-data-warning');
        await run.click('#export-warning-cancel');
        await next(run);
        await run.step('generate', 'export-data-generate');
        await next(run);
        await run.step('finish', 'tour-list');
        await run.finish('export-data');
    },
});
