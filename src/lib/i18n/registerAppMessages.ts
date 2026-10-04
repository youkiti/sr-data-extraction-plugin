// app 起動前に両言語の app 群を登録する。
import { registerMessages } from './index';
import { jaApp } from './ja.app';
import { enApp } from './en.app';

registerMessages({ ja: jaApp, en: enApp });
