export const next = run => run.click('.guide-tour-card [data-guide-action="next"]');

export async function start(run, id, startFrom) {
    await run.open();
    if (startFrom) {
        await run.click(`[data-tour="nav-${startFrom}"]`);
        await run.action(`開始画面が ${startFrom} になる`, () => run.page.waitForURL(`**#/${startFrom}`));
    }
    // ツアーの初期化（保存値の読み込み）が終わると、ボタンに aria-controls が付く。それより前に押しても一覧は開かない
    await run.visible('#app-open-tours[aria-controls="guide-tour-list"]');
    await run.click('#app-open-tours');
    await run.click(`#guide-tour-list [data-guide-action="start"][data-guide-tour="${id}"]`);
}
