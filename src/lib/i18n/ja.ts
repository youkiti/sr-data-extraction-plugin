// UI 文言辞書（日本語 = 既定言語。issue #93）。
// キーは「画面.要素」形式（例: home.countsLoading）。共通文言のみ common.* を使う。
// この ja がキー集合の正典で、en.ts は Record<MessageKey, string> で全キーの網羅を型強制する。
// 注意: LLM プロンプト・Sheets のタブ名 / 列名・entity_key・enum 値は UI 文言ではないため
// ここには置かない（翻訳対象外）
export const ja = {
  // 共通（画面横断で完全に同一の意味を持つものだけ）
  'common.cancel': 'キャンセル',
  'common.reload': '再読み込み',
  'common.loading': '読み込み中…',

  // App シェル（app.html + app/bootstrap.ts）
  'app.documentTitle': 'SR Data Extraction Plugin — メインビュー',
  'app.contextStarting': '起動中',
  'app.contextShowing': '{screen} 画面を表示しています',
  'app.statusProject': 'プロジェクト: {name}',
  'app.statusNoProject':
    'プロジェクトが選択されていません。「プロジェクト選択を開く」から選択してください。',
  'app.openPopup': 'プロジェクト選択を開く',
  'app.openOptions': '設定',
  'app.openOptionsTitle': '設定を開く',
  'app.switchProject': '別のプロジェクトを開く',
  'app.navAriaLabel': 'ステップナビゲーション',
  'app.navHome': 'Home',
  'app.navDocuments': '文献取り込み',
  'app.navProtocol': 'プロトコル',
  'app.navSchema': '表のデザイン',
  'app.navPilot': 'パイロット抽出',
  'app.navExtract': '一括抽出',
  'app.navVerify': '検証',
  'app.navDashboard': 'ダッシュボード',
  'app.navExport': 'エクスポート',
  'app.navAdjudicate': '裁定',
  'app.navSettings': '設定',

  // 設定ビュー（アプリ内 #/options。settingsView.ts）
  'settings.title': '設定',
  'settings.back': '← 前の画面へ戻る',

  // Options の表示言語節（settingsSections.ts + options/bootstrap.ts。issue #93）
  'options.documentTitle': 'SR Data Extraction Plugin — 設定',
  'options.heading': '設定',
  'options.openApp': 'アプリを開く',
  'options.languageTitle': '表示言語',
  'options.languageHelp': 'UI の表示言語です。切り替えるとすぐに画面へ反映されます。',
  'options.languageLabel': '言語',
  'options.languageSaveFailed': '表示言語の保存に失敗しました。',

  // Popup S1（popup.html + popup/bootstrap.ts）
  'popup.loading': '読み込み中…',
  'popup.authLead':
    'プロジェクトは Google Sheets / Drive に保存されます。Google アカウントでログインしてください。',
  'popup.login': 'Google でログイン',
  'popup.loginFailed':
    'ログインに失敗しました。ブラウザに Google アカウントが追加されているか確認してください。',
  'popup.loggedInAs': 'ログイン中:',
  'popup.logout': 'ログアウト',
  'popup.recentTitle': '最近のプロジェクト',
  'popup.createTitle': '新規プロジェクト',
  'popup.createLead':
    'データ抽出プロジェクトを作成します（スプレッドシート + Drive フォルダを生成）。',
  'popup.createTitleLabel': 'プロジェクトタイトル',
  'popup.createSubmit': '作成',
  'popup.creating': '作成中…',
  'popup.openTitle': 'スプレッドシート ID / URL で開く',
  'popup.openIdLabel': 'スプレッドシート ID または URL',
  'popup.openIdPlaceholder': 'スプレッドシート ID または URL を貼り付け',
  'popup.openSubmit': '開く',
  'popup.openOptions': '設定を開く',
  'popup.statusLoginRequired': 'ログインが必要です。',
  'popup.statusPickRecent': '最近のプロジェクトから選ぶか、新しく作成してください。',
  'popup.statusCreateOrOpen':
    '新しいプロジェクトを作成するか、スプレッドシート ID から開いてください。',
  'popup.emailUnknown': '(不明)',

  // Home S2（homeView.ts）
  'home.title': 'プロジェクト概要',
  'home.projectNone': '未選択',
  'home.countsLoading': '進捗を読み込んでいます…',
  'home.countsError': '進捗を読み込めませんでした: {reason}',
  'home.summaryDocuments': '文献数',
  'home.summaryProtocolVersions': 'プロトコル版数',
  'home.summarySchemaVersions': '表のデザインの確定版数',
  'home.summaryEvidenceRows': 'AI 抽出済み Evidence 行数',
  'home.summaryDataRows': 'データ行数（StudyData + ResultsData）',
  'home.reviewersTitle': 'レビュアー管理',
  'home.reviewersNotice':
    '追加すると、対象アカウントへスプレッドシート（編集可）とプロジェクトフォルダ（閲覧）を自動で共有します。共有に失敗した場合は登録だけ残し、手動共有の案内を表示します。',
  'home.reviewersLoading': '読み込んでいます…',
  'home.reviewersError': '一覧を読み込めませんでした: {reason}',
  'home.reviewersEmpty': 'まだレビュアーが登録されていません。',
  'home.reviewersActions': '操作',
  'home.roleReviewer': 'レビュアー',
  'home.roleAdjudicator': '裁定者',
  'home.roleRevoked': '解除済み',
  'home.modeWithAi': '① AI の結果をレビュー',
  'home.modeIndependent': '② AI 抜きでレビュー',
  'home.revokeAria': '{email} を解除',
  'home.revokeTitle': '解除（削除）',
  'home.copyInviteAria': '{email} へのレビュー依頼文をコピー',
  'home.copyInviteTitle': 'レビュー依頼文をコピー',
  'home.modeConfirmTitle': 'レビューモードを変更しますか？',
  'home.modeConfirmBody':
    '{email} は既に登録済みです。モード変更（盲検の前提）は事後的に盲検を破る可能性があります。',
  'home.modeConfirmOk': '続行して変更する',
  'home.addReviewerEmailAria': '追加するレビュアーの email',
  'home.addReviewerRoleAria': '役割（role）',
  'home.addReviewerModeAria': 'レビューモード（review_mode）',
  'home.addSubmit': '追加',
  'home.folderAccessLead':
    '検証を始める前に、プロジェクトの Drive フォルダへのアクセスを付与してください（PDF・抽出テキストを読み込むために必要です）。',
  'home.grantFolderAccess': 'プロジェクトフォルダへのアクセスを付与',
  'home.folderAccessChecking': '確認しています…',
  'home.folderAccessError': 'アクセスを確認できませんでした: {reason}',
  'home.folderAccessGranted': 'プロジェクトフォルダへのアクセスは付与済みです。',
  'home.goVerify': '検証を開始する',
} as const;

/** 辞書キー（ja が正典。en は同一キー集合を型強制される） */
export type MessageKey = keyof typeof ja;
