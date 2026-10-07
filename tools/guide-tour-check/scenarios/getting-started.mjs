import path from 'node:path';
import { defineScenario } from '../lib/scenario.mjs';

export default defineScenario({
    name: 'getting-started',
    title: '空のプロジェクトから取り込み・保存・ドラフト・確定まで',
    async run(run) {
        await run.open(true);
        await run.visible('#guide-suggest-band');
        await run.click('#guide-suggest-band [data-guide-action="start"]');
        await run.step('open-documents', 'nav-documents');
        await run.click('[data-tour="nav-documents"]');
        await run.step('import-documents', 'documents-import');

        // デモのシートは再読込で初期化されるため、データを作る前に再開位置を確認する。
        await run.action('再開位置の保存を待ってページを再読み込みする', async () => {
            await run.page.waitForFunction(async () => {
                const items = await chrome.storage.local.get('guide_progress');
                return items.guide_progress?.active?.tourId === 'getting-started' &&
                    items.guide_progress.active.stepId === 'import-documents';
            });
            await run.page.reload();
        });
        await run.step('import-documents', 'documents-import');
        await run.action('この PC から架空論文 PDF を選択する', async () => {
            const [chooser] = await Promise.all([
                run.page.waitForEvent('filechooser'),
                run.page.locator('#documents-local-import').click(),
            ]);
            await chooser.setFiles(path.join(run.extensionDir, 'fixtures', 'demo-paper-01.pdf'));
        });

        await run.step('open-protocol', 'nav-protocol');
        await run.click('[data-tour="nav-protocol"]');
        await run.step('enter-protocol', 'protocol-save');
        await run.action('プロトコル本文を入力する', () => run.page.locator('#protocol-inline').fill(
            '成人の待機的手術患者において、周術期リハビリテーションは通常ケアと比較して術後回復を改善するか。ランダム化比較試験を対象とし、在院日数と合併症を抽出する。',
        ));
        await run.click('[data-tour="protocol-save"]');
        await run.step('open-schema', 'nav-schema');
        await run.click('[data-tour="nav-schema"]');
        await run.step('draft-schema', 'schema-draft');
        await run.action('取り込んだ論文をドラフトのサンプルに選ぶ', () => run.page.locator('#schema-sample-list input[type="checkbox"]').check());
        await run.click('[data-tour="schema-draft"]');
        await run.visible('#schema-editor-table tbody tr');
        await run.click('.guide-tour-card [data-guide-action="next"]');
        await run.step('confirm-schema', 'schema-confirm');
        await run.click('[data-tour="schema-confirm"]');
        await run.step('finish', 'tour-list');
        await run.finish();
    },
});
