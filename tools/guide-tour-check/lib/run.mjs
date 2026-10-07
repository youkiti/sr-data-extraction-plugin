import path from 'node:path';
import { OUT_DIR } from './paths.mjs';

const TIMEOUT = 30000;
const CARD = '.guide-tour-card';

export class Run {
    constructor(name, page, extId, lang, extensionDir, warnings) {
        Object.assign(this, { name, page, extId, lang, extensionDir, warnings });
        this.stepId = 'setup';
        this.sequence = 0;
        this.settle = 0;
    }

    async shot(label = this.stepId, settle = false) {
        const file = path.join(OUT_DIR, `${this.name}-${String(++this.sequence).padStart(2, '0')}-${label}.png`);
        if (settle && this.settle > 0) await this.page.waitForTimeout(this.settle);
        await this.page.screenshot({ path: file, timeout: 10000 });
        return file;
    }

    async action(condition, fn) {
        try {
            return await fn();
        } catch (cause) {
            const attrs = await this.page.locator(CARD).evaluateAll(cards => cards.map(card => ({
                step: card.getAttribute('data-guide-step'),
                waiting: card.getAttribute('data-guide-waiting'),
            }))).catch(() => '取得失敗');
            const screenshot = await this.shot(`FAIL-${this.stepId}`).catch(error => `保存失敗: ${error.message}`);
            throw new Error(`シナリオ ${this.name} / 手順 ${this.stepId}\n` +
                `待っていた条件: ${condition}\nカード data-guide-step / data-guide-waiting: ${JSON.stringify(attrs)}\n` +
                `URL: ${this.page.url()}\n画像: ${screenshot}\n原因: ${cause.message ?? cause}`);
        }
    }

    async visible(selector) {
        await this.action(`${selector} が表示される`, () => this.page.locator(selector).first().waitFor({ state: 'visible', timeout: TIMEOUT }));
    }

    async click(selector) {
        await this.action(`${selector} を押せる`, () => this.page.locator(selector).click());
    }

    async open(empty = false) {
        await this.action('表示言語を設定して Home を開く', async () => {
            await this.page.goto(`chrome-extension://${this.extId}/options/options.html`);
            await this.page.evaluate(lang => chrome.storage.local.set({ 'settings.uiLanguage': lang }), this.lang);
            await this.page.goto(`chrome-extension://${this.extId}/app/app.html${empty ? '?demoState=empty' : ''}#/home`);
        });
        await this.visible('#app-open-tours');
        await this.visible('.home__summary');
    }

    async step(id, target) {
        this.stepId = id;
        await this.action(`カードが ${id}、data-guide-waiting=false になり、対象 ${target} と強調枠が重なる`, async () => {
            await this.page.locator(`${CARD}[data-guide-step="${id}"][data-guide-waiting="false"]`).waitFor({ timeout: TIMEOUT });
            await this.page.waitForFunction(({ id, target }) => {
                const card = document.querySelector(`.guide-tour-card[data-guide-step="${id}"]`);
                const highlight = document.querySelector('.guide-tour-highlight');
                const element = [...document.querySelectorAll(`[data-tour="${target}"]`)]
                    .find(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
                if (!card || !highlight || highlight.hidden || !element) return false;
                const c = card.getBoundingClientRect(), h = highlight.getBoundingClientRect(), t = element.getBoundingClientRect();
                return c.width > 0 && c.height > 0 && c.left >= 0 && c.top >= 0 && c.right <= innerWidth && c.bottom <= innerHeight &&
                    t.right > 0 && t.bottom > 0 && t.left < innerWidth && t.top < innerHeight &&
                    h.left < t.right && h.right > t.left && h.top < t.bottom && h.bottom > t.top;
            }, { id, target }, { timeout: TIMEOUT });
            const overlap = await this.page.evaluate(target => {
                const c = document.querySelector('.guide-tour-card').getBoundingClientRect();
                const element = [...document.querySelectorAll(`[data-tour="${target}"]`)]
                    .find(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
                const t = element.getBoundingClientRect();
                return c.left < t.right && c.right > t.left && c.top < t.bottom && c.bottom > t.top;
            }, target);
            if (overlap) this.warnings.push(`${this.name} / ${id}: カードが対象 ${target} を覆っています`);
            await this.shot(this.stepId, true);
        });
        console.log(`  ${this.name}: ${id}`);
    }

    async finish(tourId = 'getting-started') {
        await this.click(`${CARD} [data-guide-action="next"]`);
        await this.action('完了でカードが消える', () => this.page.locator(CARD).waitFor({ state: 'detached', timeout: TIMEOUT }));
        await this.click('#app-open-tours');
        await this.visible('#guide-tour-list');
        await this.action(`一覧の ${tourId} に済みが付く`, async () => {
            await this.page.waitForFunction(({ tourId, done }) => {
                const button = document.querySelector(`#guide-tour-list [data-guide-tour="${tourId}"]`);
                return button?.previousElementSibling?.previousElementSibling?.textContent?.endsWith(` — ${done}`);
            }, { tourId, done: this.lang === 'en' ? 'Done' : '済み' }, { timeout: TIMEOUT });
            await this.shot('done');
        });
    }
}
