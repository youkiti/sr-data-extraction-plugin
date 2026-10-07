import { defineScenario } from '../lib/scenario.mjs';
import { start, next } from '../lib/tour.mjs';
import { expectTargetBlocked } from '../lib/blocked.mjs';

export default defineScenario({
    name: 'dual-review',
    title: 'レビュアー・担当セット・裁定をたどり、分割の遮断を確認する',
    async run(run) {
        // Home から始めると先頭の移動手順が省略されるため、文献画面で一覧を開く。
        await start(run, 'dual-review', 'documents');
        await run.step('open-home', 'nav-home');
        await run.click('[data-tour="nav-home"]');
        await run.step('review-mode', 'dual-review-mode');
        await next(run);
        await run.step('add-reviewer', 'dual-review-add-reviewer');
        await next(run);
        await run.step('review-sets', 'dual-review-split');
        await expectTargetBlocked(run, {
            target: '[data-tour="dual-review-split"]',
            unchanged: () => run.page.locator('#home-review-sets').evaluate(card => ({
                text: card.textContent,
                saving: card.querySelector('[data-tour="dual-review-split"]')?.disabled,
                confirming: card.querySelectorAll('#review-sets-resplit-confirm').length,
            })),
        });
        await next(run);
        await run.step('open-adjudicate', 'nav-adjudicate');
        await run.click('[data-tour="nav-adjudicate"]');
        await run.step('agreement', 'dual-review-agreement');
        await run.click('#agreement-load');
        await run.visible('#agreement-table');
        await next(run);
        await run.step('open-study', 'dual-review-studies');
        await run.click('[data-study-id="demo-study-1"] .adjudicate__open-button');
        await next(run);
        await run.step('resolve', 'dual-review-mismatch');
        await next(run);
        await run.step('finish', 'tour-list');
        await run.finish('dual-review');
    },
});
