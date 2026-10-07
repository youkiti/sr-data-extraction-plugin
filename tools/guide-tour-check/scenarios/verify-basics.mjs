import { defineScenario } from '../lib/scenario.mjs';
import { start, next } from '../lib/tour.mjs';
import { expectTargetBlocked } from '../lib/blocked.mjs';

export default defineScenario({
    name: 'verify-basics',
    title: '根拠・判定・進捗をたどり、引用削除の遮断を確認する',
    async run(run) {
        await start(run, 'verify-basics');
        await run.step('open-verify', 'nav-verify');
        await run.click('[data-tour="nav-verify"]');
        await run.step('pick-study', 'verify-basics-study');
        await run.action('抽出済みの論文 1 を選ぶ', () => run.page.locator('#verify-study').selectOption('demo-study-1'));
        await next(run);
        await run.step('read-evidence', 'verify-basics-pdf');
        await run.click('[data-tour="verify-basics-pdf"]');
        await next(run);
        await run.step('decide', 'verify-basics-decide');
        await next(run);
        await run.step('edit-evidence', 'verify-basics-quote-remove');
        await expectTargetBlocked(run, {
            target: '[data-tour="verify-basics-quote-remove"]',
            unchanged: () => run.page.locator('.verify__cell').evaluateAll(cells => cells.map(cell => ({
                field: cell.querySelector('.verify__cell-name')?.textContent,
                quotes: cell.querySelectorAll('.verify__quote-remove').length,
            }))),
        });
        await next(run);
        await run.step('check-progress', 'verify-basics-progress');
        await next(run);
        await run.step('finish', 'tour-list');
        await run.finish('verify-basics');
    },
});
