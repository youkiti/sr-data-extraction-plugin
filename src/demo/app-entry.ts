// デモビルド用エントリ（src/app/app.ts の代わり。webpack.config.js が --env demo のときだけ
// この entry を app/app.js としてビルドする）。起動前処理は bootShared.ts を参照。
import { seedDemoState } from './bootShared';

async function bootDemo(): Promise<void> {
  await seedDemoState();
  const { bootstrapApp } = await import('../app/bootstrap');
  await bootstrapApp(window);
}

void bootDemo().catch((error) => {
  // シード投入・起動のどこかで失敗した場合、デモ実行者がすぐ気付けるよう明示的にログへ出す
  // （unhandledrejection のブラウザ既定表示だけだと見落としやすいため）
  console.error('[demo] デモビルドの起動に失敗しました:', error);
});
