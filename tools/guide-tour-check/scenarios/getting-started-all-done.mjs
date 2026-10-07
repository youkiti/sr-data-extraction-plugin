import { defineScenario } from '../lib/scenario.mjs';

export default defineScenario({
    name: 'getting-started-all-done',
    title: '既定のデモで済んだ手順を飛ばし、最後の手順だけで完了する',
    async run(run) {
        await run.open();
        // Home の集計が終わってから開始する。開始直後のカードも記録して手順省略を確認する。
        await run.visible('#guide-suggest-band');
        await run.action('表示されたカードの手順を記録する', () => run.page.evaluate(() => {
            window.tourCheckSteps = [];
            new MutationObserver(() => {
                const id = document.querySelector('.guide-tour-card')?.getAttribute('data-guide-step');
                if (id) window.tourCheckSteps.push(id);
            }).observe(document.body, { childList: true, subtree: true });
        }));
        await run.click('#app-open-tours');
        await run.click('#guide-tour-list [data-guide-action="start"][data-guide-tour="getting-started"]');
        await run.step('finish', 'tour-list');
        await run.action('最後の手順だけが表示されたこと', async () => {
            const steps = await run.page.evaluate(() => window.tourCheckSteps);
            if (!steps.length || steps.some(id => id !== 'finish')) throw new Error(`表示された手順: ${steps.join(', ')}`);
        });
        await run.finish();
    },
});
