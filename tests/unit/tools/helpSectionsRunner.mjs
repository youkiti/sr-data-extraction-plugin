// helpSections.mjs（ESM のみの entities 9 を読む）を jest（CommonJS）から呼ぶための子プロセス用ランナー。
// 標準入力の JSON {mode, source, lang} を受け、結果を JSON で標準出力へ書く。不正な言語では非 0 で終了する。
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const { mode, source, lang } = JSON.parse(readFileSync(0, 'utf8'));
const mod = await import(pathToFileURL(join(import.meta.dirname, '../../../tools/help/helpSections.mjs')).href);
const result =
  mode === 'loader'
    ? mod.default.call({ resourceQuery: `?help-sections&lang=${lang}` }, source)
    : mod.parseHelpSections(source, lang);
process.stdout.write(JSON.stringify(result));
