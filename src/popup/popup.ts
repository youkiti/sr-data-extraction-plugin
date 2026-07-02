// エントリは起動フックのみ（実処理は bootstrap.ts。test-strategy.md §1 の方針）
import { bootstrapPopup, createChromePopupDeps } from './bootstrap';

void bootstrapPopup(document, createChromePopupDeps());
