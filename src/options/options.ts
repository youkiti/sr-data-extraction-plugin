// エントリは起動フックのみ（実処理は bootstrap.ts。test-strategy.md §1 の方針）。
// 表示言語の反映 → 設定本文の構築（settingsSections）→ 配線 → 言語切替時の再構築までを
// bootstrapOptionsPage が担う（issue #93）
import { bootstrapOptionsPage } from './bootstrap';

void bootstrapOptionsPage(document);
