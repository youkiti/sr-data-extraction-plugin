# プロジェクトの現在の値（自動生成）

<!-- このファイルは tools/facts/generateProjectFacts.mjs が生成する。手で編集しない。
     値を変えるときは「正の場所」を変えてから `npm run facts` で作り直す。 -->

| 項目 | 値 | 正の場所 |
|---|---|---|
| リポジトリの版 | v0.15.0 | `package.json` の `version` |
| ストアの公開版 | v0.13.0（掲載ページの更新日 2026-10-05。2026-10-07 に確認） | `docs/store/store-status.json`（手で更新する） |
| 工場出荷の既定モデル | `gemini-3.8-flash` | `src/lib/storage/settingsStore.ts` の `FACTORY_DEFAULT_MODEL` |
| extract-data プロンプトの版数 | 12 | `src/features/extraction/skills/extractData.ts` の `EXTRACT_DATA_PROMPT_VERSION` |
| 要件定義書の版 | v0.36 | `docs/requirements.md` の見出し |

リポジトリの版がストアの公開版より新しいとき、その差は「zip 作成済み・ストア未反映」を意味する。
ストアへ提出・反映されたら `docs/store/store-status.json` を手で更新し、`npm run facts` を実行する。
