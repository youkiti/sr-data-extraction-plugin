// デモビルド用エントリ（src/options/options.ts の代わり）。起動前処理は bootShared.ts を参照。
import { seedDemoState } from './bootShared';

async function bootDemo(): Promise<void> {
  await seedDemoState();
  const { bootstrapOptionsPage } = await import('../options/bootstrap');
  await bootstrapOptionsPage(document);
}

void bootDemo().catch((error) => {
  console.error('[demo] デモビルドの起動に失敗しました:', error);
});
