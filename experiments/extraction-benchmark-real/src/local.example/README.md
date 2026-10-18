このフォルダの `benchmark.json` をベンチ直下の `local/benchmark.json` へコピーし、手元の値を設定してください。見本はすべて架空です。`local/` は git の対象外です。

`targets` は対象順の pdfId と file、`cleanDir` は CLI 用の空フォルダです。`fields.string` と `fields.numeric` は rawName・entityLevel・dataType・extractionInstruction を持ちます。項目 ID は rawName から生成します。

`outcome.free` は or_mean・or_sd・or_n・or_events の指示文、`continuous` と `events` は条件付きの追記文です。

`probes` は cachePdfId・draftConditions（name と papers）・jevPdfId・robTargets・multiSelect・qualitative を持ちます。後者二つは pdfDir・papers・fields を持ち、fields の構造は JSON の見本を参照してください。papers には利用する文献識別子を設定します。

環境変数による既存の対象指定は維持されます。ローカル設定が無い場合、実行時はファイル名と不足キーを示して停止します。公開安全性テストだけは具体値の照合を省略し、汎用パターンの検査を続けます。

`testFixtures.armInvariant.armNames` は群の対応を検証するテスト用の二つの群名です。

ベンチ直下で `npm.cmd test` を実行すると、テスト自身とこのフォルダを含む src/ 全体を検査します。新しい非公開設定を加える場合は、読み込み時の必須キー検証と安全性テストの具体値収集も更新してください。
