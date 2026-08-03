// デモビルド用エントリ（src/popup/popup.ts の代わり）。起動前処理は bootShared.ts を参照。
import { seedDemoState } from './bootShared';

async function bootDemo(): Promise<void> {
  await seedDemoState();
  const { bootstrapPopup, createChromePopupDeps } = await import('../popup/bootstrap');
  await bootstrapPopup(document, createChromePopupDeps());
}

void bootDemo().catch((error) => {
  console.error('[demo] デモビルドの起動に失敗しました:', error);
});
