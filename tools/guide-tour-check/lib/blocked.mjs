import { isDeepStrictEqual } from 'node:util';

// 非同期処理による変化を各操作の後で一定期間監視する。
export async function expectUnchanged(read, before, pause, samples = 20) {
    for (let i = 0; i < samples; i++) {
        await pause();
        const after = await read();
        if (!isDeepStrictEqual(after, before)) {
            throw new Error(`対象の処理が発生しました: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
        }
    }
}

export async function expectTargetBlocked(run, { target, unchanged }) {
    await run.action(`${target} はクリックでも Enter でも処理されない`, async () => {
        const button = run.page.locator(`${target}:visible`).first();
        if (!await button.isEnabled()) throw new Error('対象自体が無効のため遮断を検査できません');
        const before = await unchanged();
        const dialogs = [];
        const onDialog = dialog => { dialogs.push(dialog.type()); void dialog.dismiss(); };
        run.page.on('dialog', onDialog);
        try {
            // 遮断用の覆いがあるため、通常のクリックの hit-test 待ちは行わない。
            // DOM の click() ではなく、実際のマウス入力を送る。
            for (const input of ['mouse', 'Enter']) {
                if (input === 'mouse') {
                    const reachable = await button.evaluate(element => {
                        const rect = element.getBoundingClientRect();
                        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
                        return element.contains(hit) || hit?.classList.contains('guide-tour-block');
                    });
                    if (!reachable) throw new Error('対象の中心がカードなどに覆われ、マウスの遮断を検査できません');
                    await button.click({ force: true });
                }
                else { await button.focus(); await button.press('Enter'); }
                await expectUnchanged(unchanged, before, () => run.page.waitForTimeout(50));
                if (dialogs.length) throw new Error(`確認ダイアログが出ました: ${dialogs.join(', ')}`);
                await run.shot(`blocked-${input}`);
            }
        } finally {
            run.page.off('dialog', onDialog);
        }
    });
}
