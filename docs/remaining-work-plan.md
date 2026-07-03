# 残実装計画書（MVP 完了 → リリースまで）

- **作成日**: 2026-07-03
- **対象読者**: 本リポジトリで初めて作業する実装者（ジュニア想定）
- **前提**: S1〜S10 の全画面は実装済みで、実機通し確認（[manual-testing.md](manual-testing.md) §1〜§2）も完了している。残っているのは「画面以外」の仕上げ = 本書のタスク A〜E。
- **正典**: 仕様の根拠は必ず [requirements.md](requirements.md) / [architecture.md](architecture.md) / [test-strategy.md](test-strategy.md) / [ui-states.md](ui-states.md) に当たること。本書は「何をどの順でやるか」の作業指示であり、仕様の複製はしない。

## 0. 作業を始める前に（全タスク共通）

1. **ブランチを切る**。`master` で直接作業しない（作業原則 1）。ブランチ名は `feature/<タスク略称>`（例: `feature/ci-2-e2e`）。
2. コミットメッセージ・コード内コメント・ドキュメントは**日本語**（作業原則 2）。
3. jest は**カバレッジ 100% 強制**。実装を足したら同じ PR でテストも書かないと `npm test` が落ちる。
4. 完了報告前の定型フロー: `npm run typecheck` → `npm test` → `npm run test:e2e` → `npm run lint` → `npm run lint:css` → `npm run dev`（作業原則 7・8。CI は安全網であって代替ではない）。
5. UI に触るタスク（タスク C）は、**先に [ui-states.md](ui-states.md) の該当セクションを更新してから**実装する（作業原則 4「spec が先」）。
6. API キー・トークンをログ・チャット・コミットに出さない（作業原則 5）。

### タスク一覧と推奨順序

| 順 | タスク | 内容 | 依存 | 規模感 |
|---|---|---|---|---|
| A | ドキュメント整合の修正 | 古いステータス記述 3 箇所の更新 | なし | 小（半日未満） |
| B | CI-2 | Playwright E2E を GitHub Actions へ追加 | なし | 小（半日） |
| C | S11 Options 拡充 | 既定モデル設定の追加 | なし | 中（1〜2 日） |
| D | 抽出精度ベンチマーク（Q8） | `experiments/` でモデル比較 → 既定モデル確定 | C があると楽 | 大（数日 + 判断） |
| E | リリース準備 | README 仕上げ・Store 提出物・アルファ配布 | D の結果を反映 | 中 |

A・B・C は互いに独立なので並行可。D はベンチマーク結果の判断（採用基準）が入るため、**実行前に必ずユーザー承認を取る**チェックポイントがある。

---

## タスク A: ドキュメント整合の修正

### 目的

実装が進んだのにドキュメント上のステータス記述が「実装未着手」のまま残っており、新規参加者が混乱する。3 箇所を実態に合わせる。

### 変更対象と修正内容

1. **[requirements.md](requirements.md) 冒頭（4 行目付近）** — `**ステータス**: 要件定義フェーズ（実装未着手）` を「S1〜S10 実装済み・実機通し確認完了（2026-07-03）。残タスクは docs/remaining-work-plan.md」の趣旨に更新。Q8 の注記（閾値はベンチマーク設計時に最終確定）は残す。
2. **[README.md](../README.md) 冒頭（5 行目付近）** — `> **開発ステータス**: スケルトン段階（要件定義完了・画面実装はこれから）` を「MVP 機能実装済み（S1〜S10）・リリース準備中」の趣旨に更新。
3. **[CLAUDE.md](../CLAUDE.md) の Picker 注記** — 「**GitHub Pages（gh-pages ブランチ）へデプロイ済みだが実機での Picker 動作確認は未実施**」という記述は、2026-07-03 の通し確認（§1 Picker OK）と矛盾する古い記述。実機確認済みに書き換える。[hosted/README.md](../hosted/README.md) にも同様の注記があれば同時に更新する。

### 完了条件

- [ ] 上記 3（+1）箇所が更新され、他に「実装未着手」「これから」系の古い記述が grep（`実装未着手|画面実装はこれから|動作確認は未実施`）で出てこない
- [ ] コード変更なしのため CI-1 が通ればよい

---

## タスク B: CI-2（Playwright E2E を CI へ追加）

### 目的

[test-strategy.md](test-strategy.md) §4 で「CI-2: フェーズ 2〜3（E2E spec が安定してから）」と決めた段階導入の後半。ルート別 E2E spec は全画面分（`tests/e2e/` の 11 本）揃い、実機確認も終わったので着手条件を満たしている。

### 背景知識

- E2E は `npm run test:e2e`（= `playwright test`）で動く。[playwright.config.ts](../playwright.config.ts) の `webServer` が **`npm run dev` で dist/ をビルドしてから** `tools/playwright-server.js` で `http://localhost:4400` に静的配信する。つまり CI 側で別途ビルド手順は不要。
- 実 PDF fixture（pilot / verify spec が使う）はリポジトリにコミットされておらず、[tests/fixtures/pdf/fetch-pdfs.ps1](../tests/fixtures/pdf/fetch-pdfs.ps1) で PMC からダウンロードする。ubuntu ランナーには pwsh が同梱されているので ps1 がそのまま動く（test-strategy.md §4 の想定どおり）。
- `.env` は不要（dev ビルドは `OAUTH_CLIENT_ID` 空で通る。CI-1 が現に `npm run dev` を .env なしで回している）。

### 実装手順

1. [.github/workflows/ci.yml](../.github/workflows/ci.yml) に `e2e` ジョブを追加する。既存 `check` ジョブとは独立に並列実行させる（`needs:` は付けない。lint 失敗と E2E 失敗は別々に見えたほうがデバッグしやすい）:

   ```yaml
   e2e:
     runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v4
       - uses: actions/setup-node@v4
         with:
           node-version: 22
           cache: npm
       - name: 依存関係のインストール
         run: npm ci
       - name: Playwright ブラウザの取得
         run: npx playwright install --with-deps chromium
       - name: PDF fixture の取得
         run: pwsh -NoProfile -File tests/fixtures/pdf/fetch-pdfs.ps1
       - name: Playwright E2E
         run: npm run test:e2e
   ```

2. ファイル冒頭のコメント（「Playwright E2E は CI-2 で追加する」）を「CI-2 導入済み」に更新する。
3. PR を出して Actions 上で green になることを確認する。**flaky（再実行で通る失敗）が出たら握りつぶさず、spec 側の待ち条件を直すか報告する**（作業原則 3・6）。

### 落とし穴

- fetch-pdfs.ps1 は外部（PMC）へのダウンロードなので、まれに落ちる。落ちた場合は再実行でよいが、恒常的に落ちるなら URL 切れを疑い README（[tests/fixtures/pdf/README.md](../tests/fixtures/pdf/README.md)）の選定基準に従って対処を報告する。
- `--with-deps` を忘れると ubuntu で chromium の共有ライブラリ不足で落ちる。

### 完了条件

- [ ] push / PR で `check` と `e2e` の両ジョブが green
- [ ] [test-strategy.md](test-strategy.md) §4 の表に「CI-2 導入済み（日付）」を追記（ドキュメント同期・作業原則 4）

---

## タスク C: S11 Options 拡充 — 既定モデル設定

### 目的

requirements.md §4.1 の S11 は「API キー、モデル管理、表示言語」だが、現状の Options（[src/options/bootstrap.ts](../src/options/bootstrap.ts)）は **Gemini API キー保存のみ**。このタスクでは「既定モデルの設定」を追加する。

**スコープ外（P1。手を付けない）**: OpenRouter カスタムモデル管理（requirements.md §7 で P1 と明記）・表示言語切替（UI 英語化自体が P1 のため、切替 UI も P1 と同時）。

### 現状の仕様（読んでから始める）

- S5 スキーマ画面のモデル入力は**自由入力テキスト**（[schemaView.ts](../src/app/views/schemaView.ts) の placeholder `例: gemini-2.5-flash`）で、store の初期値は空文字（[store.ts](../src/app/store.ts) の `schema.model`）。
- S6 パイロット・S7 一括抽出は S5 で使ったモデルを引き継ぐ（extractService の「S6→S5 のモデル引き継ぎ」）。つまり**S5 の初期値に既定モデルを注入すれば下流全部に効く**。
- 単価表は [src/lib/llm/pricing.ts](../src/lib/llm/pricing.ts) の `MODEL_PRICING`（キーがモデル ID）。
- 秘密情報の保存パターンは [src/lib/storage/secretsStore.ts](../src/lib/storage/secretsStore.ts)（`chrome.storage.local` + trim + 空文字拒否）。モデル名は秘密情報ではないので **secretsStore には足さず、新規ファイルにする**。

### 実装手順

1. **spec 先行**: [ui-states.md](ui-states.md) §2（Options）に「既定モデル」の状態行を追記する（未設定 / 保存済み / 保存中 / 保存失敗。API キーと同じトンマナ）。
2. `src/lib/storage/settingsStore.ts` を新規作成:
   - 保存キー `settings.defaultModel`（`secrets.geminiApiKey` の命名に倣う）
   - `loadDefaultModel(): Promise<string | null>` / `saveDefaultModel(model: string): Promise<void>`（trim、空文字は `removeLocal` = 「未設定に戻す」扱いにする。API キーと違い空での解除を許す）
   - JSDoc コメントは日本語
3. **Options UI**（[options.html](../src/options/options.html) / [options.css](../src/options/options.css) / [bootstrap.ts](../src/options/bootstrap.ts)）:
   - 「既定モデル」テキスト入力 + `<datalist>`（候補 = `Object.keys(MODEL_PRICING)`）+ 保存ボタン
   - 起動時に保存値を input へ表示（API キーと違いマスク不要）
   - 保存時のステータス表示は既存の `options__status` を流用
   - 補足文: 「S5 スキーマ画面の初期値になります。単価表にないモデルはコスト概算が表示されません」
4. **S5 への注入**: schemaService（[src/app/services/schemaService.ts](../src/app/services/schemaService.ts)）のスキーマ素材読込時に、`schema.model` が空文字なら `loadDefaultModel()` の値で埋める。**ユーザーが画面で入力済みの値は上書きしない**（空のときだけ）。
5. **テスト**:
   - unit: settingsStore（保存 / trim / 空文字で解除 / 読み出し）、bootstrap（datalist 描画・保存フロー・失敗表示）、schemaService（空のときだけ注入されること）
   - カバレッジ 100% を維持
   - E2E: Options ページの spec は現状存在しないため新設は必須ではないが、`npm run test:e2e` 全体は必ず回す（作業原則 8）。余力があれば `options-smoke.spec.ts` を popup-smoke に倣って追加
6. **ドキュメント同期**: CLAUDE.md の「options〔API キー保存は実装済み〕」を更新。requirements.md の S11 行はそのまま（OpenRouter / 表示言語が P1 であることは §7 に記載済み）。

### 完了条件

- [ ] Options で既定モデルを保存 → S5 を新規に開くとモデル欄に反映される（実機で確認し、確認結果を報告に含める）
- [ ] 既定モデル未設定時の挙動が現状と同一（回帰なし）
- [ ] ui-states.md §2 と実装が一致
- [ ] 定型フロー（§0-4）全通過

---

## タスク D: 抽出精度ベンチマーク（Q8）→ 既定モデル確定

### 目的

requirements.md §8「既定 LLM モデルは抽出精度ベンチマークで確定してから固定する」（未決定事項 Q8）。現状 `experiments/` には anchor-spike しかなく、モデルベンチマークは未着手。これが**リリース（タスク E）前の最後の技術的ブロッカー**。

### 参照実装

tiab-review の `experiments/` 運用を踏襲する（tiab-review-plugin/AGENTS.md 参照。構成: `data/`（入力）+ `runner.ts`（tsx で実行）+ `results/`（JSON 出力）+ `logs/`）。原則:

- **採用基準を実行前に文書化する**（事前登録。結果を見てから基準を動かさない）
- **固定バージョンのモデル ID** を使う（`gemini-2.5-pro` のようなエイリアスではなく、日付付きスナップショットがあればそれ）
- API キーは `.env`（`experiments/` 直下、gitignore 済みであることを確認）

### 実装手順

1. `experiments/extraction-benchmark/` を新設し、`README.md` に**先に**以下を書いてユーザー承認を取る（ここがチェックポイント。承認前に API を叩かない）:
   - 比較対象モデル（候補: `MODEL_PRICING` にある Gemini 系。OpenRouter 系は P1 なので対象外でよい）
   - 評価指標（requirements.md §8 の案をそのまま採用: 項目レベル正確度 / not_reported 判定の感度・特異度 / quote アンカリング成功率）
   - 採用基準（例: 正確度最優先、同等ならコスト。「同等」の閾値もここで数値化する — Q8 で唯一残っている決め事）
   - データセット: 最小構成は fixture の実 RCT 2 本（[tests/fixtures/pdf/](../tests/fixtures/pdf/)。CC BY・アウトカム表あり・1 段組 + 2 段組）+ 手作業で作るゴールドスタンダード（各論文 × 代表スキーマ 15〜20 項目を人手で抽出した正解表 JSON）。本数を増やす場合は同 README の選定基準（PMC OA・CC BY）に従う
2. ランナーを実装する。**src/ の本番コードを最大限再利用する**こと（プロンプトの二重管理を避ける）:
   - プロンプト構築・応答パース: [src/features/extraction/skills/extractData.ts](../src/features/extraction/skills/extractData.ts)
   - 応答検証: `validateAiOutput`
   - アンカリング: anchoring 中核（anchor-spike が Node で pdfjs-dist を動かした実績があるので、その構成（tsx + @napi-rs/canvas 不要のテキスト層抽出）を流用する）
   - LLM 呼び出し: [src/lib/llm/](../src/lib/llm/) の `GeminiProvider` + `withRetry`
   - 実行は `npx tsx experiments/extraction-benchmark/runner.ts`（anchor-spike と同様に experiments 側に独立 package.json / tsconfig を置く）
3. `results/` に モデル × 論文 × 項目の生データ JSON と集計を保存し、`REPORT.md` に結果・採用モデル・判断根拠をまとめる（anchor-spike/REPORT.md のトンマナ）。
4. **確定の反映**（別コミット）:
   - [pricing.ts](../src/lib/llm/pricing.ts) の単価表を採用モデルの固定 ID で最新化
   - タスク C の既定モデルの「工場出荷値」（settingsStore 未設定時に schemaView placeholder へ出すモデル名）を採用モデルに更新
   - requirements.md の Q8 を「解決済み（日付・採用モデル・根拠は experiments/extraction-benchmark/REPORT.md）」に更新
   - CLAUDE.md の「既定 LLM モデルは…確定してから固定（Q8）」の注記を解決済みに更新

### 注意

- ベンチマークは実 API 課金が発生する。**実行前にコスト概算（モデル数 × 論文数 × トークン概算）を README に書き、ユーザー承認を得る**。
- ゴールドスタンダード作成（手作業）はユーザー（ドメインエキスパート）の作業になる可能性が高い。正解表の JSON スキーマだけ先に決めて依頼する形でよい。
- `experiments/` は jest のカバレッジ対象外（test-strategy.md §2「抽出精度はテストスイートの対象外」）。本体の `npm test` を巻き込まないこと。

### 完了条件

- [ ] README（事前登録）にユーザー承認が付いている
- [ ] REPORT.md に全モデルの指標と採用判断が記録されている
- [ ] 既定モデルが本体コード・ドキュメントに反映され、Q8 が解決済みになっている

---

## タスク E: リリース準備（アルファ配布 → Chrome Web Store）

### 目的

requirements.md §6（非機能要件）と §7（リリース計画 MVP 行）の「配る」部分。参照実装は **sr-query-builder のアルファ配布運用**（[sr-query-builder-plugin/CLAUDE.md](../sr-query-builder-plugin/CLAUDE.md) — サブモジュール内の記述を最優先）。

### チェックリスト

1. **README 仕上げ**: データフロー図・funding 表記（KAKENHI 25K13585）は済んでいる。残り: 開発ステータス更新（タスク A）、スクリーンショット（S3 / S8 / S9 あたり）、ユーザー向けセットアップ手順（開発者向けと分離）。
2. **本番ビルド確認**: `npm run build` が通り、`dist/` を chrome://extensions で読み込んで S1→S10 が動くこと（manual-testing.md のシナリオを smoke として流用）。
3. **manifest 最終確認**: version・description（日本語）・permissions が requirements.md §6 の説明（`spreadsheets` + `drive.file` のみ）と一致すること。余計な permission が残っていたら報告。
4. **アルファ配布**: sr-query-builder の運用に倣う（zip を GitHub Releases へ。手順・注意書きのトンマナはサブモジュール参照）。
5. **Chrome Web Store 提出物**（MVP リリース時）:
   - プライバシーポリシー（README のデータフロー節を独立ページ化。「外部サーバーなし・PDF の外部送信は LLM API のみ」）
   - permissions の使用理由説明文（審査フォーム用。日本語 + 英語）
   - ストア用アイコン・スクリーンショット
   - ※ Store 公開の可否・タイミングはユーザー判断。提出物の準備までがこのタスク。

### 完了条件

- [ ] GitHub Releases にアルファ zip が上がり、クリーンな Chrome プロファイルでインストール → プロジェクト作成 → 抽出 → エクスポートまで通る
- [ ] Store 提出物一式が `docs/store/`（新設）にまとまっている

---

## スコープ外（P1 以降。このマイルストーンでは着手しない）

| 項目 | 根拠 |
|---|---|
| relocate-quote skill（アンカリング失敗 quote の LLM 再特定） | [architecture.md](architecture.md) の src 構成案に「P1」と明記。`LLMApiLog.purpose` enum に `relocate_quote` が予約済みなので、着手時は enum 追加不要 |
| 二重独立抽出 + 不一致解決画面（Q4） | requirements.md §7 P1 |
| tiab-review プロジェクト引き継ぎ（Q2） | 同上 |
| OpenRouter カスタムモデル | 同上（providerFactory は現状 OpenRouter 指定で P1 エラーを投げる設計のまま維持） |
| RoB テンプレートスキーマ / UI 英語化・表示言語切替 | 同上 |

P1 に着手する際は本書を更新するのではなく、新しい計画書を起こすこと。
