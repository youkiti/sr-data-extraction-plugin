import { defineScenario } from '../lib/scenario.mjs';

export default defineScenario({
    name: 'getting-started-all-done',
    title: '既定のデモで済んだ手順を飛ばし、最後の手順だけで完了する',
    async run(run) {
        await run.open();
        // ツアーの初期化（保存値の読み込み）が終わってから検査・操作する（それより前は、帯が無いのも一覧が開かないのも当然なので検査にならない）
        await run.visible('#app-open-tours[aria-controls="guide-tour-list"]');
        // Home の集計が終わってから開始する。開始直後のカードも記録して手順省略を確認する。
        await run.action('件数の表示後、初回提案の帯がないこと', async () => {
            await run.page.waitForFunction(() =>
                Number(document.querySelector('.home__summary dd')?.textContent) > 0);
            if (await run.page.locator('#guide-suggest-band').count()) throw new Error('完了済みのプロジェクトに案内の帯が表示されています');
        });
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
