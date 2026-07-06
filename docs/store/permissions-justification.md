# 権限の使用理由説明（Chrome ウェブストア審査フォーム用）

- **最終更新**: 2026-07-06
- **用途**: Chrome ウェブストアのアイテム登録時、各権限に求められる「使用理由（justification）」欄へそのまま貼り付けるための原稿。日本語と英語を併記します。
- **正典**: 権限の一覧は [src/manifest.json](../../src/manifest.json)、データフローは [privacy-policy.md](privacy-policy.md) を参照。

## permissions

### `identity` / `identity.email`

- **JA**: Google OAuth 2.0（`chrome.identity`）でユーザーの Google アカウントにサインインし、プロジェクト DB である Google Sheets とファイル実体の Google Drive にアクセスするために使用します。`identity.email` はログイン中アカウントのメールアドレスを画面に表示し、複数アカウント誤用を防ぐために使用します。取得した情報を開発者サーバーへ送信することはありません（開発者サーバーは存在しません）。
- **EN**: Used to sign in to the user's Google account via Google OAuth 2.0 (`chrome.identity`) so the extension can access the user's Google Sheets (used as the project database) and Google Drive (used to store files). `identity.email` is used only to display the signed-in account's email address in the UI to prevent using the wrong account. No information is sent to any developer-operated server (there is none).

### `storage`

- **JA**: ユーザーの API キー（LLM 用、BYOK）・OAuth トークン・既定モデルなどのアプリ設定を、ブラウザローカル（`chrome.storage`）に保存するために使用します。これらは端末外へ送信されません。
- **EN**: Used to store application settings in the browser's local storage (`chrome.storage`), such as the user's LLM API key (BYOK), OAuth token, and default model. None of these leave the user's device.

### `tabs`

- **JA**: メインの作業画面はポップアップに収まらないため、`chrome.tabs.create` でフルページのアプリ画面（`app.html`）を新しいタブで開くために使用します。ブラウジング履歴の閲覧や他タブの内容取得には使用しません。
- **EN**: Used with `chrome.tabs.create` to open the full-page application view (`app.html`) in a new tab, because the main workspace does not fit in the popup. It is not used to read browsing history or the contents of other tabs.

## host_permissions

### `https://sheets.googleapis.com/*` / `https://www.googleapis.com/*`

- **JA**: プロジェクト DB である Google Sheets の読み書き、および Google Drive へのファイル（PDF コピー・抽出テキスト・ログ）の保存・取得に使用します。アクセス範囲は OAuth スコープ `spreadsheets` と `drive.file`（ユーザーが選択したファイル + 拡張が作成したファイルのみ）に限定されます。
- **EN**: Used to read/write the user's Google Sheets (project database) and to store/retrieve files (PDF copies, extracted text, logs) in Google Drive. Access is limited by the OAuth scopes `spreadsheets` and `drive.file` (only files the user selects and files the extension creates).

### `https://generativelanguage.googleapis.com/*`

- **JA**: ユーザーが設定した Gemini API キー（BYOK）で、論文本文からのデータ抽出リクエストを送信するために使用します。
- **EN**: Used to send data-extraction requests to the Gemini API with the user's own API key (BYOK).

### `https://openrouter.ai/*`

- **JA**: LLM プロバイダとして OpenRouter を選んだユーザーが、自分の OpenRouter API キー（BYOK）で抽出リクエストを送信するために使用します。
- **EN**: Used to send extraction requests to OpenRouter with the user's own OpenRouter API key (BYOK), for users who choose OpenRouter as their LLM provider.

## externally_connectable — `https://youkiti.github.io/*`

- **JA**: Manifest V3 のリモートコード制約により、Google Picker（ファイル選択 UI）を拡張内から直接ロードできません。GitHub Pages 上にホストした `picker.html` を経由し、`externally_connectable` で当該ページから拡張へ選択結果を受け取るために使用します。
- **EN**: Due to Manifest V3 remote-code restrictions, the Google Picker (file chooser) cannot be loaded directly inside the extension. A `picker.html` page hosted on GitHub Pages is used instead, and `externally_connectable` allows that page to return the selection result to the extension.

## OAuth スコープ（審査の Google 用データアクセス欄）

| スコープ | 用途 |
|---|---|
| `.../auth/spreadsheets` | プロジェクト DB としての Google Sheets 読み書き |
| `.../auth/drive.file` | ユーザーが選択したファイル + 拡張が作成したファイルのみへのアクセス（Drive 全体は読まない） |

いずれのスコープで取得したデータも、機能提供以外の目的（広告・分析・第三者提供・モデル学習）には使用しません。Google API Services User Data Policy（Limited Use を含む）を遵守します。
