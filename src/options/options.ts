// エントリは起動フックのみ（実処理は bootstrap.ts。test-strategy.md §1 の方針）。
// 本文はアプリ内 #/options と共通の settingsSections.ts で生成してから配線する
import { bootstrapOptions } from './bootstrap';
import { buildSettingsSections } from './settingsSections';

const settingsBody = document.getElementById('settings-body');
if (settingsBody) {
  settingsBody.append(buildSettingsSections());
}
void bootstrapOptions(document);
