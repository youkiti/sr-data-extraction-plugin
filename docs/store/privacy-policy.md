# プライバシーポリシー — SR Data Extraction（sr-data-extraction-plugin）

- **最終更新**: 2026-10-20
- **対象**: Chrome 拡張機能「SR Data Extraction」（sr-data-extraction-plugin）
- **配布元**: 本拡張は MIT ライセンスの OSS です。開発は JSPS 科研費 25K13585 の助成を受けています。

このページは、Chrome ウェブストアの審査および利用者への開示のために、本拡張が扱うデータとその流通経路を説明します。README のデータフロー節（[../../README.md](../../README.md)）を独立ページ化したものです。

## 要点

**本拡張の開発者が運用するサーバーは存在しません。** 利用者のデータが開発者側に送信・保存・収集されることは一切ありません。データはすべて、利用者自身が契約・所有する以下の 3 者の間でのみ流通します。

1. **利用者のブラウザ**（本拡張の実行環境）
2. **利用者の Google アカウント**（Google Sheets = プロジェクト DB、Google Drive = PDF・抽出テキスト・ログの実体）
3. **利用者が自分の API キー（BYOK: Bring Your Own Key）で契約または指定する LLM API**（Gemini API、OpenRouter、Anthropic、Azure OpenAI、利用者指定の OpenAI 互換 API）

例外として、Google Drive のファイルを選ぶときだけ、開発者が GitHub Pages に置いた静的ページと Google Picker を使います（→ [ファイル選択（Google Picker）](#ファイル選択google-picker)）。このページもデータを保存・送信しません。

開発者は、利用者が取り込む論文・プロトコル・抽出結果について権利を主張せず、それらを受け取らず、AI の学習にも使いません。

## 取り扱うデータと送信先

| データ | どこへ | 目的 |
|---|---|---|
| 採用論文 PDF・そこから抽出したテキスト | 利用者の Google Drive | ファイル実体の保管 |
| 抽出スキーマ・抽出結果・判定履歴・監査証跡 | 利用者の Google Sheets | プロジェクト DB |
| 論文本文 + 抽出プロンプト | 利用者が設定した LLM API（Gemini / OpenRouter / Anthropic / Azure OpenAI / OpenAI 互換 API）**のみ** | AI によるデータ抽出。本文が外部へ送信されるのはこの経路だけです |
| スキャン PDF（本文テキストの無い PDF）のページ画像 | 利用者が設定した LLM API | AI によるデータ抽出 |
| 研究プロトコルの本文・抽出項目の定義 | 利用者が設定した LLM API | 抽出スキーマの作成（AI ドラフト）と AI 抽出 |
| 「論文に質問」の質問文 + 論文本文・抽出項目の定義 | 利用者が設定した LLM API | 質問への回答。質問と回答の本文は保存しません |
| サインイン中のメールアドレス | 利用者の Google Sheets（記録者の列）、ブラウザ内（`chrome.storage.local`）、Google の認可画面（`login_hint`） | 「誰が抽出・判定したか」の記録と、次回サインイン時のアカウント指定 |
| 共同研究者のメールアドレス（利用者が入力したもの） | Google Drive の共有 API、利用者の Google Sheets（`Reviewers` タブ） | プロジェクトのファイルの共有設定と、役割の管理 |
| LLM に送ったプロンプトと応答の全文（ページ画像は伏字） | 利用者の Google Drive（`logs/llm/`） | 監査と再現のための記録 |
| Google OAuth アクセストークン | 利用者のブラウザ内（`chrome.storage.session`。ブラウザを閉じると消えます）| Google API 認証。開発者のサーバーへは送信されません（ファイル選択時の受け渡しは [ファイル選択（Google Picker）](#ファイル選択google-picker)） |
| LLM API キー | 利用者のブラウザ内（`chrome.storage.local`。**暗号化せずに保存します**）| 対応する LLM API への認証にだけ送ります。開発者へは送信されません |

## Google ユーザーデータへのアクセス範囲

本拡張が要求する OAuth スコープは以下の 2 つ **のみ** です。

- `https://www.googleapis.com/auth/userinfo.email` — サインインしたアカウントのメールアドレスの取得。「誰が抽出・判定したか」の記録（監査証跡）と、次回サインイン時のアカウント指定にのみ使用します
- `https://www.googleapis.com/auth/drive.file` — **利用者が Picker で明示的に選択したファイルと、本拡張が作成したファイルだけ** にアクセスします（プロジェクト DB の Google Sheets の読み書きもこの範囲で行います）。Drive 全体を読むスコープ（`drive.readonly` 等）や、全スプレッドシートへアクセスする `spreadsheets` スコープは要求しません

本拡張は、Google API から取得したユーザーデータを、上記の機能提供以外の目的（広告・分析・第三者への提供・機械学習モデルの学習等）に **一切使用しません**。Google API Services User Data Policy（Limited Use 要件を含む）を遵守します。

## LLM API への送信について

AI 抽出を実行すると、対象論文の本文テキストと抽出指示プロンプトが、利用者が設定した LLM API（Gemini API、OpenRouter、Anthropic、Azure OpenAI、または利用者指定の OpenAI 互換 API）へ送信されます。送信先によるデータの取り扱いは、その運営者の利用規約・プライバシーポリシーに従います。本拡張はプロバイダを仲介せず、利用者のブラウザから直接 API を呼び出します。OpenAI 互換 API を指定する場合、本拡張は保存前に接続先の scheme + hostname pattern を表示し、Chrome の実行時ホスト権限を利用者へ要求します。HTTP は `localhost`、`127.0.0.1`、`[::1]` に限って許可します。loopback HTTP の通信は暗号化されません。

学術研究目的のデータ抽出（テキスト・データマイニング）は、日本の著作権法上の権利制限規定（第 30 条の 4 等）の範囲内であるとの整理に基づいています。

なお、AI 機能を使うと、PDF の本文やページ画像が利用者の選んだ LLM へ送られます。出版社の利用条件と送信先の規約を確かめてください。

## プロバイダごとのデータの扱い

送った内容をプロバイダがどう扱うか（保存期間・人によるレビュー・モデルの学習への利用）は、プロバイダと契約の種類によって違います。使う前に各社の規約を確認してください。

- **Gemini API**: 無料枠（課金を有効にしていない Google Cloud プロジェクト）では、送った内容と応答が Google の製品の改善に使われ、人が読むことがあります。Google は無料枠へ機密情報や個人情報を送らないよう求めています。未公開のデータや機密資料を扱うときは、課金を有効にした有料枠で使ってください。根拠: [Gemini API 追加利用規約](https://ai.google.dev/gemini-api/terms)
- **OpenRouter**: リクエストを上流のプロバイダへ転送します。データの扱いはモデルと上流のプロバイダごとに違います。OpenRouter の設定とプライバシーポリシーを確認してください
- **Anthropic・Azure OpenAI・利用者指定の接続先（ローカル LLM を含む）**: 各社（接続先の運営者）の規約に従います

## ファイル選択（Google Picker）

Manifest V3 では Google Picker のスクリプトを拡張の中で読み込めないため、Drive のファイルやスプレッドシートを選ぶときだけ、次の流れを使います。

1. 拡張が、開発者が GitHub Pages に置いた静的ページ <https://youkiti.github.io/sr-data-extraction-plugin/picker.html> を新しいタブで開きます。このページが Google Picker（`apis.google.com`）を読み込みます
2. ページから要求を受けると、拡張は送信元のタブ・ページの URL・起動ごとの使い捨ての値（nonce）を確かめたうえで、`drive.file` スコープの OAuth アクセストークンを拡張のメッセージ応答で渡します。トークンは URL に載せません
3. ページはトークンを Picker の呼び出しにだけ使い、保存も外部への送信もしません。選ばれたファイルの ID と名前を拡張へ返し、タブは閉じられます

ページのソースは [hosted/picker.html](../../hosted/picker.html) で公開しています。GitHub Pages の配信は GitHub の、Picker は Google の規約に従います。

## データの保存・削除

- すべてのデータは利用者自身の Google アカウントとブラウザ内のストレージに保存されます。削除は、利用者が Google Drive / Sheets 上のファイルを削除し、拡張を削除（またはブラウザのストレージをクリア）することで完結します。
- OAuth アクセストークンは `chrome.storage.session` に置き、ブラウザを閉じると消えます。サインアウトするとトークンを失効させます。
- LLM API キーは暗号化せずに `chrome.storage.local` に保存します。同じ Chrome プロファイルを使える人は読める可能性があります。共用の PC では、自分専用の Chrome プロファイルで使うか、使い終わったら拡張を削除してください（拡張を削除するとキーも消えます）。
- 本拡張をアンインストールすると、`chrome.storage` 内の設定（API キー・メールアドレス・既定モデル等）は Chrome によって削除されます。Google Drive / Sheets 上のファイルは利用者の資産としてそのまま残ります。

## 第三者提供・データ販売

本拡張は、利用者のデータを第三者へ販売・提供しません。開発者はデータを収集しないため、そもそも提供しうるデータを保持しません。

## お問い合わせ

本ポリシーに関する問い合わせは、GitHub リポジトリの Issues へお願いします: <https://github.com/youkiti/sr-data-extraction-plugin/issues>
