# プライバシーポリシー — SR Data Extraction（sr-data-extraction-plugin）

- **最終更新**: 2026-07-06
- **対象**: Chrome 拡張機能「SR Data Extraction」（sr-data-extraction-plugin）
- **配布元**: 本拡張は MIT ライセンスの OSS です。開発は JSPS 科研費 25K13585 の助成を受けています。

このページは、Chrome ウェブストアの審査および利用者への開示のために、本拡張が扱うデータとその流通経路を説明します。README のデータフロー節（[../../README.md](../../README.md)）を独立ページ化したものです。

## 要点

**本拡張の開発者が運用するサーバーは存在しません。** 利用者のデータが開発者側に送信・保存・収集されることは一切ありません。データはすべて、利用者自身が契約・所有する以下の 3 者の間でのみ流通します。

1. **利用者のブラウザ**（本拡張の実行環境）
2. **利用者の Google アカウント**（Google Sheets = プロジェクト DB、Google Drive = PDF・抽出テキスト・ログの実体）
3. **利用者が自分の API キー（BYOK: Bring Your Own Key）で契約する LLM API**（Gemini API または OpenRouter）

## 取り扱うデータと送信先

| データ | どこへ | 目的 |
|---|---|---|
| 採用論文 PDF・そこから抽出したテキスト | 利用者の Google Drive | ファイル実体の保管 |
| 抽出スキーマ・抽出結果・判定履歴・監査証跡 | 利用者の Google Sheets | プロジェクト DB |
| 論文本文 + 抽出プロンプト | 利用者が契約する LLM API（Gemini / OpenRouter）**のみ** | AI によるデータ抽出。PDF 本文が外部へ送信されるのはこの経路だけです |
| Google OAuth トークン | 利用者のブラウザ内（`chrome.storage`）| Google API 認証。開発者へは送信されません |
| LLM API キー | 利用者のブラウザ内（`chrome.storage.local`）| LLM API 認証。開発者へは送信されません |

## Google ユーザーデータへのアクセス範囲

本拡張が要求する OAuth スコープは以下の 2 つ **のみ** です。

- `https://www.googleapis.com/auth/spreadsheets` — プロジェクト DB として利用する Google Sheets の読み書き
- `https://www.googleapis.com/auth/drive.file` — **利用者が Picker で明示的に選択したファイルと、本拡張が作成したファイルだけ** にアクセスします。Drive 全体を読むスコープ（`drive.readonly` 等）は要求しません

本拡張は、Google API から取得したユーザーデータを、上記の機能提供以外の目的（広告・分析・第三者への提供・機械学習モデルの学習等）に **一切使用しません**。Google API Services User Data Policy（Limited Use 要件を含む）を遵守します。

## LLM API への送信について

AI 抽出を実行すると、対象論文の本文テキストと抽出指示プロンプトが、利用者が設定した LLM API（Gemini API または OpenRouter）へ送信されます。送信先の LLM プロバイダによるデータの取り扱いは、各プロバイダの利用規約・プライバシーポリシーに従います。本拡張はプロバイダを仲介せず、利用者のブラウザから直接 API を呼び出します。

学術研究目的のデータ抽出（テキスト・データマイニング）は、日本の著作権法上の権利制限規定（第 30 条の 4 等）の範囲内であるとの整理に基づいています。

## データの保存・削除

- すべてのデータは利用者自身の Google アカウントとブラウザローカルストレージに保存されます。削除は、利用者が Google Drive / Sheets 上のファイルを削除し、拡張を削除（またはブラウザのストレージをクリア）することで完結します。
- 本拡張をアンインストールすると、`chrome.storage` 内の設定（API キー・OAuth トークン・既定モデル等）は Chrome によって削除されます。Google Drive / Sheets 上のファイルは利用者の資産としてそのまま残ります。

## 第三者提供・データ販売

本拡張は、利用者のデータを第三者へ販売・提供しません。開発者はデータを収集しないため、そもそも提供しうるデータを保持しません。

## お問い合わせ

本ポリシーに関する問い合わせは、GitHub リポジトリの Issues へお願いします: <https://github.com/youkiti/sr-data-extraction-plugin/issues>
