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

- [ ] **著作権フリー / 利用許諾済み**の論文 PDF を 2〜3 本、自分の Google Drive（マイドライブ）に置く。
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
npm run manual:check              # login → project → picker → verify を順に実行
npm run manual:check -- cancel    # §1-3 のキャンセル系エッジ
```

- Chrome 137+ は `--load-extension` フラグが使えないため、`prepare` で開く専用プロファイル
  （`.selenium-profile/`。gitignore 済み）に **chrome://extensions から dist/ を 1 回手動で読み込む**。
  以後の実行はこのプロファイルを再利用するため再読込は不要（`npm run dev` し直しても
  同じフォルダを指すので、chrome://extensions の「更新」だけでよい）
- 拡張 ID は manifest.json の `key` から決定的に導出され `ibpbkgffgkmdmflamhadbcfjgfljjgip`。
  ハーネスが起動時に表示するので、GCP の OAuth クライアント「アイテム ID」との一致確認（§0-3）に使う
- シーン対応: `login` = §1-1 #1〜2 / `project` = #3 / `picker` = #4〜9 + §1-2 #3 の一部 /
  `verify` = §1-2 #3（`#/home` の batchGet 実弾）/ `cancel` = §1-3 #1〜2。
  §1-2 #1〜2（Sheets タブ・Drive フォルダの裏取り）と §1-3 #3〜4 は目視で行う
- 失敗時はブラウザを開いたまま停止するので、そのまま目視確認 → §3 の結果メモへ記録する

以降の表は手動で実施する場合（またはハーネスの結果を照合する場合）のチェックリスト。

### 1-1. 正常系: 取り込みまで通す

| # | 操作 | 期待結果 | OK |
|---|---|---|---|
| 1 | ツールバーの拡張アイコンで Popup を開く | 未ログインならログインボタンが出る | [ ] |
| 2 | ログイン | Chrome の OAuth 同意画面 → 承諾でログイン済み表示（スコープは spreadsheets + drive.file の 2 つ） | [ ] |
| 3 | 「新規作成」でプロジェクトを作る | Sheets（13 タブ）+ Drive `SR Data Extraction/{プロジェクト名}/` が生成され（ルートフォルダの色 = アイコン色に近いピンク）、メインビュータブが自動で開く | [ ] |
| 4 | サイドバーから `#/documents` へ | 空状態 + 著作権の注意書き + 「Drive から PDF を取り込む」ボタン | [ ] |
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
| 4 | スキャン PDF（テキスト層なし）を取り込む | `no_text_layer` の赤バッジ + 「ハイライト不可」注記 | [ ] |

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
| 未実施 | | §1-3（cancel エッジ）、§2 通し確認 | |
