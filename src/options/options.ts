// エントリは起動フックのみ（実処理は bootstrap.ts。test-strategy.md §1 の方針）
import { bootstrapOptions } from './bootstrap';

void bootstrapOptions(document);
