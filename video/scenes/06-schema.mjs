// チャプター06: 表のデザイン（抽出項目）。help.html #schema に対応。最も尺が長い章。
//
// #/schema（確定版 v1。study 8 項目 + arm 3 項目 + outcome_result 5 項目 = 16 項目）の
// 表を、entity_level（study → arm → outcome_result）の順にホバーしながら見せ、
// 最後に「新しいプロトコルで AI に再ドラフトさせる」セクションへスクロールする。

import { hoverSequence, hoverSlow } from './lib/gestures.mjs';
import { loadCueDurations, sleepRemainder } from './lib/pacing.mjs';

/** #schema-current-table tbody tr の行を範囲指定で取得する（DEMO_SCHEMA_FIELDS の field_index 順） */
function rows(page, from, to) {
  const trs = page.locator('#schema-current-table tbody tr');
  const list = [];
  for (let i = from; i <= to; i += 1) list.push(trs.nth(i));
  return list;
}

export default {
  id: '06',
  slug: 'schema',
  title: '表のデザイン（抽出項目）',
  narration: '06-schema',

  async run(ctx) {
    const durations = loadCueDurations('06-schema');
    async function playCue(n, action) {
      const nn = String(n).padStart(2, '0');
      const t0 = Date.now();
      ctx.cue(n);
      if (action) await action();
      await sleepRemainder(ctx, t0, (durations[nn] ?? 3) * 1000 + 500);
    }

    await ctx.openExtensionPage('app/app.html#/home');
    await ctx.page.locator('#app-nav .app__nav-link').first().waitFor({ state: 'visible', timeout: 15000 });
    await ctx.page.locator('#app-nav a[href="#/schema"]').click();
    await ctx.page.locator('#schema-current-table').waitFor({ state: 'visible', timeout: 15000 });
    await ctx.sleep(500);

    // cue 1: 表のデザイン=見出し行。AIがプロトコル+サンプル論文からドラフト
    await playCue(1, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#schema-current-table'), { durationMs: 700 });
    });

    // cue 2: entity_level=study（試験概要: country, study_design, enrollment_period, followup_duration）
    await playCue(2, async () => {
      await hoverSequence(ctx.page, rows(ctx.page, 0, 3), { holdMs: 300, moveMs: 350 });
    });

    // cue 3: study level 続き（対象集団: sample_size_total, mean_age_years, female_percent, funding_source）
    await playCue(3, async () => {
      await hoverSequence(ctx.page, rows(ctx.page, 4, 7), { holdMs: 300, moveMs: 350 });
    });

    // cue 4: entity_level=arm（群構成: arm_name, arm_n, arm_intervention）
    await playCue(4, async () => {
      await hoverSequence(ctx.page, rows(ctx.page, 8, 10), { holdMs: 400, moveMs: 450 });
    });

    // cue 5: entity_level=outcome_result（アウトカム: outcome_name〜outcome_effect_size）
    await playCue(5, async () => {
      await hoverSequence(ctx.page, rows(ctx.page, 11, 15), { holdMs: 300, moveMs: 350 });
    });

    // cue 6: 項目数に上限なし・RoBテンプレート（表全体を俯瞰）
    await playCue(6, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#schema-current-table'), { durationMs: 600 });
    });

    // cue 7: 版履歴・プロトコル改訂後のAI再ドラフト+差分確認
    await playCue(7, async () => {
      const redraftForm = ctx.page.locator('#schema-redraft-form');
      await redraftForm.scrollIntoViewIfNeeded().catch(() => {});
      await hoverSlow(ctx.page, redraftForm, { durationMs: 700 });
    });
  },
};
