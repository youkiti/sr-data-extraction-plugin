# 実機確認手順（Picker 動作確認 + S1→S10 通し確認）

- **作成日**: 2026-07-03
- **位置付け**: フェーズ 1 の残タスク「実機での Picker 動作確認」（[hosted/README.md](../hosted/README.md)）と、
  全画面実装完了に伴う実機での通し確認のチェックリスト。自動テスト（jest 100% + Playwright）が
  カバーできない「本物の Chrome 拡張ランタイム + Google API」の結合部だけを確認する
- **使い方**: チェックボックスを埋めながら実施し、NG があれば「結果メモ」に症状を書き残す。
  完了したら CLAUDE.md の「次のステップ」を更新する

## 0. 前提準備（初回のみ）

### 0-1. GCP 側の設定確認

Picker 用の API キーとプロジェクト番号は [hosted/picker.html](../hosted/picker.html) に設定済み・
GitHub Pages（gh-pages ブランチ）へデプロイ済み。以下は GCP コンソール側の状態確認のみ：

- [ ] **Google Picker API** が有効化されている（APIs & Services → Enabled APIs）
- [ ] Sheets API / Drive API が有効化されている（プロジェクト作成・取り込みで使う）
- [ ] Picker 用ブラウザキーの制限: HTTP リファラー `https://youkiti.github.io/*` を許可している
  （無制限キーの場合はこの項目はスキップ可）
- [ ] OAuth クライアント（**Chrome 拡張機能**タイプ）が存在し、「アイテム ID」に拡張 ID（後述 0-3）が
  登録されている
- [ ] OAuth 同意画面がテストモードの場合、確認に使う Google アカウントが**テストユーザー**に登録されている

### 0-2. ビルドと拡張の読み込み

```
# .env に OAuth クライアント ID を設定（.env.example 参照。
# dev ビルド用に別クライアントを使う場合のみ LOCAL_OAUTH_CLIENT_ID も設定）
npm install
npm run dev
```

- [ ] `dist/manifest.json` の `oauth2.client_id` が実値になっている（`__OAUTH_CLIENT_ID__` のままなら .env 未設定）
- [ ] `chrome://extensions` → デベロッパーモード ON → 「パッケージ化されていない拡張機能を読み込む」で
  `dist/` を読み込む

### 0-3. 拡張 ID の確認

- [ ] `chrome://extensions` で拡張 ID を控える。manifest.json に `key` を固定してあるため、
  どの端末で読み込んでも**同じ ID** になるはず。この ID が
  - GCP の OAuth クライアント（Chrome 拡張機能タイプ）の「アイテム ID」
  と一致していることを確認する（不一致だとログインが `bad client id` 系で失敗する）

### 0-4. テスト素材

- [ ] 論文 PDF を 2〜3 本、自分の Google Drive（マイドライブ）に置く。
  うち 1 本はテキスト層のある通常の PDF、可能ならスキャン画像のみの PDF も 1 本
  （`no_text_layer` バッジの確認用）

## 1. Picker 動作確認（主目的）

### 1-0. 実施方法: Selenium 半自動ハーネス（推奨）

§1-1〜§1-3 の操作・検証は [tools/selenium/manualCheck.mjs](../tools/selenium/manualCheck.mjs) が
自動化する。人が行うのは **Google ログイン / OAuth 同意 / Picker のファイル選択**の 3 箇所だけで、
コンソールが都度案内する（タブが閉じたことなどは自動検知する）。

```
npm run dev                 # dist/ を生成（.env の OAUTH_CLIENT_ID 必須）
npm run manual:check -- prepare   # 初回のみ: 専用プロファイルに拡張を手動読込 + Google ログイン
npm run manual:check              # login → project → picker → home を順に実行
npm run manual:check -- cancel    # §1-3 のキャンセル系エッジ
# §2 の通し確認（S4→S10）。ユーザー操作（キー入力・エディタ確認・判定・目視）は
# Enter 待ちではなく DOM の状態変化で自動検知する
npm run manual:check -- options protocol schema pilot extract verify dashboard export offline
```

- Chrome 137+ は `--load-extension` フラグが使えないため、`prepare` で開く専用プロファイル
  （`.selenium-profile/`。gitignore 済み）に **chrome://extensions から dist/ を 1 回手動で読み込む**。
  以後の実行はこのプロファイルを再利用するため再読込は不要（`npm run dev` し直しても
  同じフォルダを指すので、chrome://extensions の「更新」だけでよい）
- 拡張 ID は manifest.json の `key` から決定的に導出され `ibpbkgffgkmdmflamhadbcfjgfljjgip`。
  ハーネスが起動時に表示するので、GCP の OAuth クライアント「アイテム ID」との一致確認（§0-3）に使う
- シーン対応: `login` = §1-1 #1〜2 / `project` = #3 / `picker` = #4〜9 + §1-2 #3 の一部 /
  `home` = §1-2 #3（`#/home` の batchGet 実弾）/ `cancel` = §1-3 #1〜2 /
  `options`〜`offline` = §2 #1〜#10（`verify` は S8 検証画面 = §2 #7）。
  §1-2 #1〜2（Sheets タブ・Drive フォルダの裏取り）と §1-3 #4、§2 の Sheets / Drive 裏取りは目視で行う
- 失敗時はブラウザを開いたまま停止するので、そのまま目視確認 → §3 の結果メモへ記録する

以降の表は手動で実施する場合（またはハーネスの結果を照合する場合）のチェックリスト。

### 1-1. 正常系: 取り込みまで通す

| # | 操作 | 期待結果 | OK |
|---|---|---|---|
| 1 | ツールバーの拡張アイコンで Popup を開く | 未ログインならログインボタンが出る | [ ] |
| 2 | ログイン | Chrome の OAuth 同意画面 → 承諾でログイン済み表示（スコープは spreadsheets + drive.file の 2 つ） | [ ] |
| 3 | 「新規作成」でプロジェクトを作る | Sheets（13 タブ）+ Drive `SR Data Extraction/{プロジェクト名}/` が生成され（ルートフォルダの色 = アイコン色に近いピンク）、メインビュータブが自動で開く | [ ] |
| 4 | サイドバーから `#/documents` へ | 空状態 + LLM 送信の注意書き + 「Drive から PDF を取り込む」ボタン | [ ] |
| 5 | 「Drive から PDF を取り込む」をクリック | **新規タブ**で `https://youkiti.github.io/sr-data-extraction-plugin/picker.html#extension_id={拡張 ID}` が開く | [ ] |
| 6 | Picker ページの表示を待つ | 「読み込み中…」→ Google Picker の UI が描画され、タブ 3 つ（マイドライブ〔PDF のみ〕/ 最近使用したファイル〔PDF 以外も出る = Picker API の仕様で mime フィルタ不可〕/ スター付き〔PDF のみ〕）が並ぶ。**エラー文言が出ないこと** | [ ] |
| 7 | PDF を 1〜2 本選択して「選択」 | Picker タブが**自動で閉じ**、元のタブに戻る | [ ] |
| 8 | 取り込み進捗を見る | ファイルごとの進捗行（コピー → テキスト抽出の 2 段階）→ 完了。取り込み中はボタンが無効化される | [ ] |
| 9 | 一覧を確認 | 取り込んだ PDF が一覧に出て、`text_status` バッジ（ok = 緑）と study_label 入力が使える | [ ] |

### 1-2. データの裏取り

| # | 確認箇所 | 期待結果 | OK |
|---|---|---|---|
| 1 | スプレッドシートの `Documents` タブ | 取り込んだ本数ぶんの行が追記されている（document_id / filename / text_status / page_count / char_count） | [ ] |
| 2 | Drive のプロジェクトフォルダ | `documents/` に PDF のコピー、`extracted_texts/` に同名の txt がある | [ ] |
| 3 | `#/home` へ戻る | 進捗サマリの「文献数」が取り込んだ本数になっている（今回実装した Sheets 読込の実機確認を兼ねる。タブを開き直すと batchGet 経由で同じ値になること） | [ ] |

### 1-3. 異常系・エッジ

| # | 操作 | 期待結果 | OK |
|---|---|---|---|
| 1 | 取り込みボタン → Picker の「キャンセル」 | タブが閉じ、取り込みは走らない（進捗行が出ない） | [ ] |
| 2 | 取り込みボタン → Picker タブを**手動で閉じる** | キャンセル扱い。元のタブが固まらず、再度取り込みボタンが押せる | [ ] |
| 3 | Picker ページの URL を直接開く（拡張を経由しない） | エラー表示（extension_id なし）。拡張側には何も起きない | [ ] |
| 4 | スキャン PDF（テキスト層なし）を取り込む | `no_text_layer` の赤バッジ + 「ハイライト不可」注記 | [x] |

### 1-4. トラブルシューティング

| 症状 | 見るところ |
|---|---|
| ログインが失敗する（bad client id / OAuth2 not granted） | 0-3 の拡張 ID と OAuth クライアントの「アイテム ID」の一致。同意画面のテストユーザー登録 |
| Picker ページが「読み込み中…」のまま | DevTools コンソール。`chrome.runtime` が無い → Chrome 以外のブラウザ。応答が無い → 拡張側の取り込みボタンを経由していない（ready への応答は取り込み実行中のみ購読される）/ manifest の `externally_connectable.matches` と URL のオリジン不一致 |
| Picker が開発者向けエラー・403 を出す | GCP の Picker API 有効化、API キーのリファラー制限、`PICKER_APP_ID`（プロジェクト番号）が OAuth クライアントと同一プロジェクトか |
| 選択後のコピーで 403 | drive.file スコープでは Picker 経由で選んだファイルだけにアクセス可。Picker の appId が別プロジェクトだと選択ファイルへの権限が付与されない |
| 取り込み行が「failed（コピー）」 | 対象 PDF の所有権・共有設定（閲覧のみの共有ファイルはコピー不可の場合がある） |

## 2. S1→S10 通し確認（Picker 確認の続きで実施）

セクション 1 の完了状態（プロジェクト + 文献 2〜3 本）から続ける。事前に Options で
Gemini API キーを保存しておく（S5 以降で使用。**キーはスクリーンショットに写さない**）。

| # | 画面 | 操作 → 期待結果 | OK |
|---|---|---|---|
| 1 | Options | Gemini API キーを保存 → 「保存しました。」 | [ ] |
| 2 | `#/protocol` | 手入力でプロトコルを保存 → v1 の読み取り専用表示。Drive `raw_protocols/` は手入力ではファイルなし（md / docx 取り込み時のみ） | [ ] |
| 3 | `#/schema` | サイドバーのディムが解除されている → サンプル 1〜2 本 + モデル指定でドラフト → エディタで軽く修正 → 版として確定 | [ ] |
| 4 | `#/pilot` | 既定選択（テキスト層あり先頭 3 本以内）+ コスト概算表示 → 実行 → 完了。埋め込み検証 UI で PDF ハイライトが該当箇所に出る | [ ] |
| 5 | `#/pilot` 検証 | accept / edit / reject / not_reported を各 1 回 → `Decisions` タブに追記、`StudyData` / `ResultsData` の human 行が更新される。キーボード（a / e / x / n / j / k / z）も確認 | [ ] |
| 6 | `#/extract` | 未抽出の既定選択 → 実行確認カード → 実行 → 完了（document 進捗リスト） | [ ] |
| 7 | `#/verify` | 文献切替で URL `?doc=` が同期。群構成の確定（arm があるスキーマの場合）→ `ArmStructures` 追記 | [ ] |
| 8 | `#/dashboard` | マトリクスと率が表示され、セルクリックで `#/verify?doc=&entity=` へ飛び該当セルにフォーカス | [ ] |
| 9 | `#/export` | 3 形式のプレビュー → 生成 → Drive `exports/` に CSV + `ExportLog` 追記。未検証セルが残る形式では警告ダイアログを経由する | [ ] |
| 10 | オフライン | DevTools で Offline にして検証判定 → 「オフライン: N 件キュー中」→ Online 復帰後の次の判定で自動再送されキュー表示が消える | [ ] |

## 3. 結果メモ

| 日付 | 実施者 | 範囲 | 結果 / 症状 |
|---|---|---|---|
| 2026-07-03 | youkiti + Selenium ハーネス | §1-1 #1〜9（login / project / picker）+ §1-2 #3（verify） | **OK**。プロジェクト「実機確認 20260703-0738」で Picker 起動 → handshake → PDF 2 本選択 → コピー + テキスト抽出 完了 ×2 → 一覧 text_status = ok ×2 → `#/home` batchGet 実弾で文献数 2。※一覧 2 行が同名（bmj-2025-088687.full.pdf ×2）— 中断時の孤児コピーも Picker に出るため同一ファイルを 2 回選択したもよう。※途中でハーネス側の不備 2 件（想定外タブの競合 / 再描画 stale）を修正して再実行 |
| 2026-07-03 | Claude（claude.ai Drive コネクタで API 裏取り） | §1-2 #1〜2 | **OK**。`Documents` タブに 2 行（text_status = ok / page_count = 14 / char_count = 73212 ×2。同一 PDF 2 回取り込みの記録と一致）。`documents/` に参照中 PDF 2 本 + `extracted_texts/` に text_ref どおりの txt 2 本（document_id 名）を確認。※中断 run の孤児は PDF 2 本（bmj-2025-088687 / bmj-2026-729694、22:44 作成）に加え **txt 1 本（04fa62e7-….txt）も残存**。うち孤児 PDF 1 本（1BkChk4w…）は行 8bbcd250 の source_file_id として参照されているため、削除する場合は出所ポインタが切れる点だけ留意（動作への影響はなし） |
| 2026-07-03 | youkiti + Selenium ハーネス | §1-3 #1〜3 | **OK**。#1 キャンセルボタン / #2 タブ手動クローズとも「取り込みは走らず、ボタンが再度押せる状態」を確認。#3 は headless Chrome で picker.html を直接開き「このページは SR データ抽出拡張から開いてください（extension_id がありません）。」の表示を確認 |
| 2026-07-03 | youkiti + Selenium ハーネス + Claude | §2 #1〜#10 通し確認 | **OK（実機バグ 2 件を発見・修正のうえ）**。#1 Gemini キー保存 / #2 プロトコル手入力 v1 / #3 スキーマ AI ドラフト 26 項目 → v1 確定 / #4 パイロット抽出（ハイライト 5 個）/ #5 判定（承認・修正・棄却・未報告の 4 種、Decisions 追記）/ #6 一括抽出（2 文献完了・partial_failure なし）/ #7 群構成確定（1 群 version 1・ArmStructures 追記）/ #8 ダッシュボード（検証進捗 6/20・anchor 失敗率 0%・not_reported 率 50%・セルクリックで `?doc=&entity=-` 遷移）/ #9 エクスポート（study_wide 生成 → Drive `exports/study_wide_20260703-012838.csv` 実体確認・未検証セル 4 件の警告ダイアログ中止/続行 両経路）/ #10 オフラインキュー（オフライン判定 → 「1 件キュー中」→ 復帰後の判定で再送・表示消去）。<br>**発見・修正した実機バグ**: (1) study レベルの `entity_key` をモデルが `-` でなく `study`/`_` と返し全 20 要素が破棄 → `validateAiOutput` で study は `-` へ正規化（commit ce30270）。(2) 検証パネルに全体の判定進捗表示が無く「どこまでやったか分からない」→ 判定進捗バーを追加（commit bb87bbc）。<br>**軽微な観察 → 修正済み**: `#/verify` 初回入場で URL に `?doc=` が付かなかった点を `history.replaceState` で既定文献を書き戻すよう修正（commit b20c6db）。実機で `#/verify?doc=8bbcd250-…` へ正規化を確認。サンプルが観察研究のため results_long は 0 行・arm ドラフト名が数値トークン（データ由来で挙動バグではない） |
| 2026-07-03 | youkiti + Selenium ハーネス + Claude | §1-3 #4（スキャン PDF） | **OK**。テキスト層なしの `quadas_image_only.pdf`（6 頁・3.0MB）を Picker 取り込み → 一覧で `text_status = no_text_layer` の赤バッジ + 「pdf_native 抽出のみ・ハイライト不可」注記を確認。裏取り: Drive `documents/` に取り込みコピー 1 本 / `extracted_texts/` に当該 txt は**作られない**（本文なしのため保存しない仕様どおり）。**§1〜§2 の全マニュアルテスト完了** |

## 4. 独立二重レビューの 2 アカウント通し確認（未実施）

- **作成日**: 2026-07-11（issue #44。独立二重レビュー機能のフェーズ 1〜3 実装〔コミット d9d5c72 / 3816ccc / 61be220 / 6f050be〕後に追記。**未実施**）
- **位置付け**: owner + reviewer の 2 つの実 Google アカウントを使い、盲検レビュー → 裁定 → エクスポートを通しで確認する。自動テスト（jest 144 suites / 2042 tests・E2E 64 本）は同一アカウント内の stub 前提のため、実アカウント間の共有・盲検・`drive.file` スコープでの他人所有ファイルへのアクセスは別途この手順で確認する必要がある。詳細設計は [docs/design-independent-dual-review.md](design-independent-dual-review.md) を参照

### 4-0. 前提準備

- [ ] owner アカウントでプロジェクトを作成済み（§1〜§2 の続きでよい。文献取り込み・スキーマ確定・パイロット/一括抽出まで完了していること）
- [ ] reviewer 用の Google アカウントを 1 つ用意する（owner とは別アカウント）

### 4-1. §7.3 drive.file 到達性確認（最優先。設計書に残る技術リスクのスパイク）

`docs/design-independent-dual-review.md` §7.3 のとおり、Picker で他人（owner）がオーナーのプロジェクトフォルダを選択したとき、`drive.file` スコープで配下ファイル（PDF / extracted_texts）まで読めるかは Google の仕様上未検証。まずこれを確認する。

| # | 操作 | 期待結果 | OK |
|---|---|---|---|
| 1 | owner: Home のレビュアー管理カードで reviewer の email + role（`reviewer`）+ review_mode（`with_ai` または `independent`）を登録 | `Reviewers` タブに 1 行追記され、**同時にスプレッドシート（編集可）とプロジェクトフォルダ（閲覧）が reviewer へ自動共有される**（2026-07-11 の Drive 自動共有）。トーストに「…を登録し、シート（編集可）とフォルダ（閲覧）を共有しました」。reviewer は Google の共有通知メールを受け取り、Drive でシート・フォルダを開ける | [ ] |
| 1b | （#1 の共有が失敗した場合）トーストが「…登録しました。ただし自動共有に失敗したため…手動共有してください」に縮退 → owner が Drive の共有設定でシート（編集者）＋フォルダ（閲覧者）を手動共有 | クロスドメイン制限等でも登録は残り、手動フォールバックで到達できる | [ ] |
| 3 | reviewer: 拡張をインストールしログイン → Popup「既存 ID」でスプレッドシート ID を開く | ロール解決後、`reviewer_with_ai` / `reviewer_independent` の縮退版 Home が表示される（進捗カウントは出ない） | [ ] |
| 4 | reviewer: Home の「プロジェクトフォルダへのアクセスを付与」→ Picker でプロジェクトフォルダを選択 | フォルダ選択後、`extracted_texts` の試し読みが成功し「プロジェクトフォルダへのアクセスを確認しました」トースト → 付与済み表示に変わる | [ ] |
| 5 | （#4 が失敗する場合）フォールバック 1: `pdfs/` / `extracted_texts/` サブフォルダを個別選択 | 到達性を確認できるか | [ ] |
| 6 | （#5 も失敗する場合）フォールバック 2: Picker のファイル複数選択で対象 PDF を明示選択 | 到達性を確認できるか | [ ] |

### 4-2. モード①・②での検証 → 裁定 → エクスポート

| # | 操作 | 期待結果 | OK |
|---|---|---|---|
| 1 | reviewer（`with_ai`）: `#/verify` で study を選択し判定（accept / edit / reject / not_reported を各 1 回） | 自分の `human_with_ai` 行が更新され `Decisions` に追記される。owner の判定・値は見えない | [ ] |
| 2 | reviewer（`independent`。別アカウントまたは review_mode を independent で登録した同アカウント）: `#/verify` を開く | AI 値・quote・ハイライトが一切表示されず、フィールドラベル + `extraction_instruction` のみが見える。操作は「入力して確定」/ `not_reported` / `undo` のみ | [ ] |
| 3 | owner: 同じ study を自分の `human_with_ai` 行として検証（未実施なら実施） | human annotator がちょうど 2 名（owner + reviewer）そろう | [ ] |
| 4 | owner（既定で adjudicator 兼務）: `#/adjudicate` を開く | 両者の検証が 100% 完了した study のみ「裁定を開始」できる。未完了 study は完了状況（n / m）のみ表示され、値・判定内訳は見えない | [ ] |
| 5 | 群構成の突き合わせ（一致なら「このまま採用」、不一致なら編集して確定）→ セル裁定（一致セルは「一致セルを一括採用」、不一致セルは個別に A / B / 第 3 の値 / not_reported / スキップ） | `ArmStructures` / `StudyData` / `ResultsData` へ `annotator='consensus'` の行が追記され、`Decisions` にも `decided_by` = 裁定者で追記される | [ ] |
| 6 | `#/export` で study_wide.csv を生成 | 裁定済み study の値が `consensus` 行優先（`selectFinalAnnotator`）でエクスポートされていることを確認 | [ ] |

### 4-3. 結果メモ

| 日付 | 実施者 | 範囲 | 結果 / 症状 |
|---|---|---|---|
| （未実施） | — | — | — |

## 5. 実機確認セッション 2026-07（Wave 3）: #62 / #63 / #68 / #102 / #95 層 1 / #106 一括実施

- **作成日**: 2026-07-13
- **位置付け**: [remaining-work-plan.md](remaining-work-plan.md)「実機 / 実 API テストが必要な項目」に残る 7 項目（#62 / #63 / #68 / #102 / #95 層 1 / #106 / #69 / #61）のうち、**今回のセッションで一括実施する 6 項目**（#69 は実 Sheets・数万行の負荷試験、#61 は実 LLM 課金判断待ちのため別セッション）をまとめてシナリオ化する。§4（独立二重レビューの 2 アカウント通し確認）は issue #63 実装前のドラフトのため、本節の 5-6 でその内容を土台にしつつ arm 並べ替えマッピング・3 人以上のレビュアー対応の確認手順を組み込んだ版として実施する（§4 自体は履歴として残し、変更しない）
- **対応 PR**（確認観点の一次情報）: #62 / #63 → PR #114（既存実装コミット d9d5c72 / 3816ccc / 61be220 / 6f050be 含む）/ #68 → PR #115 / #102 → PR #111 / #95 層 1 → PR #112 / #106 → PR #116

### 5-0. 前提準備

- [ ] §0（前提準備）が完了していること。今回のセッション用に dev zip / `dist/` を作り直す場合は `npm run dev` → `chrome://extensions` の「更新」でよい（§1-0 参照。拡張 ID は固定なので再読込だけで足りる）
- [ ] 実 Google アカウントを 2 つ用意する（owner 役 + reviewer 役。§4-0 と同じ）。**3 人以上のレビュアー対応（5-6-3）まで確認する場合は 3 アカウント目**もあるとよい（無ければ 5-6-3 は見送ってよい）
- [ ] 実 tiab-review のスプレッドシート 1 つ（5-5 用）。理想的には以下を満たすもの:
  - フルテキストスクリーニングが**途中**（全件確定していない状態を含む）のプロジェクト
  - `References` タブの `doi` 列に **URL 形式**（`https://doi.org/10.xxxx` 等）の値を含む行が 1 件以上
  - `Config` タブの `fulltext_ai_active_round` に実値が入っている（LLM 判定 run が動いたプロジェクト）
- [ ] v0.1.0 公開当時に作成した既存プロジェクトを 1 つ（5-4 用。`ExtractionRuns` タブが `field_ids` 列までの **15 列ヘッダ**で、`warnings` 列がまだ無い状態のもの）
- [ ] 和文 PDF fixture: `tests/fixtures/pdf/JSTAGE330303_kenkokyoiku_shika_ja.pdf`（未取得なら `tests/fixtures/pdf/fetch-pdfs.ps1` で取得）
- [ ] 通常 PDF 2〜3 本（5-2 の重複取り込み確認用。同一ファイルを Drive とローカルの両方に置いておくと①②両経路を確認しやすい）

### 5-1. 実施順序の推奨

1. **単一アカウントで完結する項目を先に**: 5-2（#102 重複取り込み防止）→ 5-3（#95 層 1 和文 CMap）→ 5-4（#106 15→16 列自動拡張）。同一プロジェクトを使い回してよい（例: 1 プロジェクトに和文 PDF と重複 PDF を両方取り込み、別途 v0.1.0 プロジェクトで 5-4 を確認）
2. **5-5（#68 tiab-review 取り込み）は実 tiab Sheet の準備が整い次第**、単一アカウントで実施
3. **5-6（#62 + #63 の 2 アカウント通し）は後半にまとめて実施**（招待 → 共有 → 検証 → 裁定 → エクスポートの一連が長丁場のため、他の単一アカウント項目を先に終えてから着手する）

### 5-2. #102 同一 PDF の重複取り込み防止

参照: PR #111。`Documents.source_file_id` 一致（same_source）と、`documents/` 配下の凍結コピーの `md5Checksum` 一致（same_content）の 2 段階判定。`Documents` タブへのチェックサム列追加は行わず、取り込み時に Drive API から都度取得する設計のため、**`files.list` / `files.get` の `md5Checksum` フィールドが `drive.file` スコープの実環境で期待どおり返るか**が実機確認の主眼。

| # | 操作 | 期待結果 | OK |
|---|---|---|---|
| 1 | `#/documents` で Drive から PDF を 1 本取り込む | 一覧に 1 件追加される | [ ] |
| 2 | 同じ PDF を Picker で再度選択して取り込みを実行 | 進捗行が「スキップ（取り込み済みのためスキップ）」と表示され、`Documents` に新規行が増えない | [ ] |
| 3 | 同一内容だが別ファイル実体（別アップロード・別コピー）の PDF、またはローカルファイル選択 / ドラッグ&ドロップで同一 PDF を取り込む | 進捗行が「スキップ（内容が同一の PDF が取り込み済みのためスキップ）」と表示される（MD5 一致判定） | [ ] |
| 4 | 1 回の取り込み操作で同じファイルを 2 つ選択する | 2 件目がバッチ内重複としてスキップされる | [ ] |
| 5 | スプレッドシート `Documents` タブを確認 | スキップ分の行が増えていない（取り込み済み分のみ） | [ ] |

**結果メモ**

| 日付 | 実施者 | 結果 / 症状 |
|---|---|---|
| | | |

### 5-3. #95 層 1 和文 PDF の同梱 CMap 実機ロード

参照: PR #112。`dist/cmaps/` を `chrome-extension://` URL 経由でロードできるかは jest（`getDocument` モック）・E2E（合成 PDF は CMap を要求しない）のいずれでも検証できず、実機のみで確認可能。

| # | 操作 | 期待結果 | OK |
|---|---|---|---|
| 1 | `JSTAGE330303_kenkokyoiku_shika_ja.pdf` を自分の Drive に置き、`#/documents` から Picker で取り込む | 取り込み完了 | [ ] |
| 2 | 一覧の `text_status` バッジを確認 | `ok`（緑）。`no_text_layer`（赤）になっていないこと（CMap 未同梱だと和文 CID フォントの抽出がほぼ空になり判定ごと壊れる） | [ ] |
| 3 | スキーマ確定 → パイロットまたは一括抽出をこの文書に対して実行 | 抽出が完了する（`partial_failure` にならないこと） | [ ] |
| 4 | `#/verify` でこの文書を開く | AI が返した quote に対応する箇所が PDF 上でハイライト表示される（和文の verbatim quote が exact / normalized マッチすること） | [ ] |

**結果メモ**

| 日付 | 実施者 | 結果 / 症状 |
|---|---|---|
| | | |

### 5-4. #106 ExtractionRuns 15→16 列（`warnings` 列）自動拡張

参照: PR #116。#80（`field_ids` 列・14→15 列。2026-07-13 実機確認済み）と同型の後方互換移行だが、対象列（`warnings`）が異なるため別途確認する。

| # | 操作 | 期待結果 | OK |
|---|---|---|---|
| 1 | v0.1.0 時代の既存プロジェクト（`ExtractionRuns` が 15 列ヘッダ）を開く | 従来どおり `#/home` / `#/extract` が読み込める | [ ] |
| 2 | `#/extract` で新規 run を実行する（パイロットまたは一括） | 実行が完了する | [ ] |
| 3 | スプレッドシートの `ExtractionRuns` タブのヘッダ行を直接確認する | 16 列目に `warnings` 列が自動追加されている | [ ] |
| 4 | 実行前から存在した旧 run 行（15 列時代のデータ）を `#/extract` の履歴・`#/verify` の合成表示で確認する | 読み出しが壊れない（`warnings` 列欠落を null 扱いできる） | [ ] |
| 5 | （データがあれば）arm 構成のあるスキーマで、AI が一部 arm を返さない応答が出た場合 | `#/extract` に黄色バナー（`#extract-arm-warnings`）、`#/verify` にも同様のバナー（`#verify-arm-completeness-warning`）が出る（該当データが無ければこの項目は見送ってよい） | [ ] |

**結果メモ**

| 日付 | 実施者 | 結果 / 症状 |
|---|---|---|
| | | |

### 5-5. #68 tiab-review 採用リスト読み込み

参照: PR #115。`#/documents` の「tiab-review から採用リストを読み込む」カード。

| # | 操作 | 期待結果 | OK |
|---|---|---|---|
| 1 | `#/documents` で「tiab-review から採用リストを読み込む」を開き、実 tiab Sheet の URL または ID を貼る | プレビューが読み込まれ、include 件数・study_label 生成結果・DOI / PMID 転記内容・各行のステータスバッジ（更新予定 / 適用済み / PDF 未取り込み）が表示される | [ ] |
| 2 | プレビューの採用相を確認する | フルテキストスクリーニングが一部でも確定していれば fulltext 相の OR 合議、無ければ TiAb 相の OR 合議で include が決まっていること | [ ] |
| 3 | URL 形式 DOI（`https://doi.org/10.xxxx`）を持つ include 行を確認する | study_label 生成・PDF 突き合わせ（DOI 一致判定）が URL プレフィクスを正しく剥がして機能している（`stripDoiUrlPrefix` の実機確認） | [ ] |
| 4 | 「取り込みを実行」を押す | `Studies.study_label` が「著者 (year)」形式で更新され、`Documents.pmid` / `doi` に転記される | [ ] |
| 5 | 同じ Sheet で「取り込みを実行」をもう一度実行する（再実行） | 全件が「適用済み」になり、二重に転記・上書きされない（冪等性。全件「適用済み」への収束を確認） | [ ] |
| 6 | PDF がまだ取り込まれていない include 行があれば、その後 PDF を取り込んでから再実行する | 「PDF 未取り込み」だった行が「更新予定」→ 実行後「適用済み」に変わる | [ ] |

**結果メモ**

| 日付 | 実施者 | 結果 / 症状 |
|---|---|---|
| | | |

### 5-6. #62 + #63 独立二重レビュー 2 アカウント通し確認（§7.3 成立条件確認 + arm マッピング・3 人以上対応）

参照: [design-independent-dual-review.md](design-independent-dual-review.md) §7.3・§13、PR #114。**本項の主眼は §7.3「Picker でプロジェクトフォルダ（他人がオーナー）を選択したとき、`drive.file` スコープで配下ファイルの `files.get?alt=media`（PDF バイナリ / extracted_texts）まで読めるか」という設計の成立条件そのものを確認すること**（issue #62 が「最優先」と明記する理由。ここが崩れると reviewer の PDF 表示が成立せず、独立二重レビュー機能自体が成り立たない）。

#### 5-6-0. 前提

- [ ] §4-0 と同じ（owner アカウントでプロジェクトを作成済み・文献取り込み・スキーマ確定・パイロット/一括抽出まで完了していること）
- [ ] reviewer 役の Google アカウントを 1 つ用意する（owner とは別アカウント）

#### 5-6-1. §7.3 drive.file 到達性確認（最優先）

| # | 操作 | 期待結果 | OK |
|---|---|---|---|
| 1 | owner: Home のレビュアー管理カードで reviewer の email + role（`reviewer`）+ review_mode（`with_ai` または `independent`）を登録 | `Reviewers` タブに 1 行追記され、同時にスプレッドシート（編集可）とプロジェクトフォルダ（閲覧）が reviewer へ自動共有される。トーストに「…を登録し、シート（編集可）とフォルダ（閲覧）を共有しました」 | [ ] |
| 1b | （#1 の共有が失敗した場合）トーストが「…登録しました。ただし自動共有に失敗したため…手動共有してください」に縮退 | owner が Drive の共有設定でシート（編集者）＋フォルダ（閲覧者）を手動共有すれば登録は残り到達できる | [ ] |
| 2 | reviewer: 拡張をインストールしログイン → Popup「既存 ID」でスプレッドシート ID / URL を開く | ロール解決後、`reviewer_with_ai` / `reviewer_independent` の縮退版 Home が表示される | [ ] |
| 3 | reviewer: Home の「プロジェクトファイルへのアクセスを付与」→ Picker に列挙された必要ファイル（PDF + 抽出テキスト）を**すべて選択**（先頭を選択 → 末尾を Shift+クリック）（issue #139 でフォルダ選択方式から変更） | 全選択後、`extracted_texts` の試し読みが成功し「プロジェクトファイルへのアクセスを確認しました」トースト → 付与済み表示に変わる。一部のみ選択した場合は「選択されていないファイルが {n} 件あります…」で弾かれ、フラグは立たない | [ ] |
| 4 | （成功した場合）reviewer: `#/verify` を開き、対象文書の PDF が実際に描画されることを確認する | PDF ビューアが正常表示される | [ ] |

**結果メモ**（フォールバックを使った場合はどの段階で成功したかを明記）

| 日付 | 実施者 | 結果 / 症状 |
|---|---|---|
| 2026-07-18 | owner + reviewer 実機 | **旧フォルダ選択方式は不成立が確定**: 共有プロジェクトフォルダの Picker 選択後も到達性確認が `Google API failed: HTTP 404`。トップフォルダ・`extracted_texts` サブフォルダ直接選択・時間を置いた再試行のいずれも 404（= 他人所有の共有フォルダでは Picker のフォルダ選択は直下ファイルにすら drive.file を付与しない）。issue #139 でファイル単位付与（`view=files` + `setFileIds` 全選択）へ設計変更し、上記 #3 を差し替え。新方式の再検証はページ / 拡張のデプロイ後に実施 |

#### 5-6-2. モード①・②の検証 → arm マッピング → 裁定 → エクスポート（2 アカウントで完結）

| # | 操作 | 期待結果 | OK |
|---|---|---|---|
| 1 | reviewer（`with_ai`）: `#/verify` で study を選択し判定（accept / edit / reject / not_reported を各 1 回） | 自分の `human_with_ai` 行が更新され `Decisions` に追記される。owner の判定・値は見えない | [ ] |
| 2 | reviewer（`independent`。Reviewers 登録の review_mode を切り替えるか、別途 independent で登録し直す）: `#/verify` を開く | AI 値・quote・ハイライトが一切表示されず、フィールドラベル + `extraction_instruction` のみが見える。操作は「入力して確定」/ `not_reported` / `undo` のみ | [ ] |
| 3 | owner: 同じ study を自分の `human_with_ai` 行として検証（未実施なら実施） | human annotator がちょうど 2 名（owner + reviewer）そろう | [ ] |
| 4 | arm があるスキーマで、owner と reviewer が**わざと異なる順序**で群構成を確定する（例: owner は 1 群目=対照群・2 群目=介入群、reviewer は独立入力モードの自己申告 UI で逆順に確定） | 双方の `ArmStructures` に順序が食い違う版が記録される（後続の arm マッピング確認の材料） | [ ] |
| 5 | owner（既定で adjudicator 兼務）: `#/adjudicate` を開き、対象 study の裁定を開始する | 両者の検証が 100% 完了した study のみ「裁定を開始」できる（未完了 study は完了状況 n/m のみ表示） | [ ] |
| 6 | 群構成の突き合わせ画面（マッピングテーブル）を確認する | #4 で順序を変えていても、**名称一致による自動対応**で正しく突き合わされる（同名同順なら従来どおり全一致、同名別順でも自動対応。ずれる場合はセレクトで手動修正できる） | [ ] |
| 7 | マッピングを確定 → 一旦 `#/adjudicate` を離れて再入場する | 直前に確定・変更したマッピングが復元される（`ArmStructures` の note への `arm_mapping:{...}` 永続化を実機で確認。note が無い旧データは既定マッピングへフォールバックする設計） | [ ] |
| 8 | セル裁定: 一致セルは「一致セルを一括採用」、不一致セルは個別に A / B / 第 3 の値 / not_reported / スキップ | `ArmStructures` / `StudyData` / `ResultsData` へ `annotator='consensus'` の行が追記され、`Decisions` にも `decided_by` = 裁定者で追記される | [ ] |
| 9 | `#/export` で study_wide.csv を生成する | 裁定済み study の値が `consensus` 行優先（`selectFinalAnnotator`）でエクスポートされていることを確認 | [ ] |

**結果メモ**

| 日付 | 実施者 | 結果 / 症状 |
|---|---|---|
| | | |

#### 5-6-3. （任意・3 アカウント目を用意できた場合）3 人以上のレビュアー対応（issue #63）

`#/adjudicate` の一覧でペア選択が現れるのは、Reviewers タブへの**登録**ではなく、対象 study に対して実際に人間の判定行（`human_with_ai` / `human_independent`）を残した email が 3 名以上になったときだけ（`resolveAnnotatorPair` が `StudyData` / `ResultsData` / `Decisions` を実データで数える）。そのため 3 人目も実際にログインし、ファイルアクセスを付与したうえで最低 1 件 `#/verify` の判定を行う必要がある（3 アカウント目を用意できない場合はこの小項目は見送ってよい。5-6-1・5-6-2 の 2 アカウント確認が優先度が高い）。

| # | 操作 | 期待結果 | OK |
|---|---|---|---|
| 1 | 3 人目の reviewer を登録 → 自動共有 → ファイルアクセス付与 → 同じ study を `#/verify` で最低 1 件判定する | 3 人目の human annotator 行が追加される | [ ] |
| 2 | owner: `#/adjudicate` の一覧を開く | 対象 study の行にペア選択セレクト（`.adjudicate__pair-select`）が表示され、「レビュアーが 3 名以上います。裁定する 2 名の組を選択してください」の案内が出る | [ ] |
| 3 | owner + reviewer（5-6-2 で判定した 2 名）の組を選択する | 選択ペアの完了状況（n/m）が表示され、両者 100% なら「裁定を開始」できる | [ ] |
| 4 | 選択したペアで裁定を進める | 5-6-2 と同じ裁定パイプラインが動く。3 人目の判定はこの裁定の比較・consensus に関与しない | [ ] |
| 5 | （可能なら）別ペア（owner + 3 人目）を選び直して同じ study を追加で裁定する | 既裁定セルは「裁定済み」表示になり、別ペアでの裁定も独立して進められる | [ ] |

**結果メモ**

| 日付 | 実施者 | 結果 / 症状 |
|---|---|---|
| | | |

### 5-7. セッション総括

全項目（5-2〜5-6、5-6-3 は任意）が完了したら、対応する GitHub issue（#62 / #63 / #68 / #102 / #95 / #106）を実機確認済みとしてクローズし、[remaining-work-plan.md](remaining-work-plan.md)「実機 / 実 API テストが必要な項目」表の該当行に確認日を追記する（本セッションの docs PR ではこの一覧は変更しない。反映は実施後の別 PR で行う）。
