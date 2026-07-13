// UI 文言辞書（英語。issue #93）。キー集合は ja.ts と同一であることを型で強制する
// （Record<MessageKey, string> = 欠落キーはコンパイルエラー、余剰キーは過剰プロパティ検査で弾く）。
// 用語は docs/requirements.md の英語用語（study / document / extraction / verification /
// adjudication 等）に合わせ、SR 方法論の術語（risk of bias / verbatim quote 等）は原語のまま使う
import type { MessageKey } from './ja';

export const en: Record<MessageKey, string> = {
  // 共通
  'common.cancel': 'Cancel',
  'common.reload': 'Reload',
  'common.loading': 'Loading…',

  // App シェル
  'app.documentTitle': 'SR Data Extraction Plugin — Main view',
  'app.contextStarting': 'Starting',
  'app.contextShowing': 'Showing the {screen} screen',
  'app.statusProject': 'Project: {name}',
  'app.statusNoProject': 'No project selected. Choose one via "Open project selection".',
  'app.openPopup': 'Open project selection',
  'app.openOptions': 'Settings',
  'app.openOptionsTitle': 'Open settings',
  'app.switchProject': 'Open another project',
  'app.navAriaLabel': 'Step navigation',
  'app.navHome': 'Home',
  'app.navDocuments': 'Documents',
  'app.navProtocol': 'Protocol',
  'app.navSchema': 'Table design',
  'app.navPilot': 'Pilot extraction',
  'app.navExtract': 'Full extraction',
  'app.navVerify': 'Verification',
  'app.navDashboard': 'Dashboard',
  'app.navExport': 'Export',
  'app.navAdjudicate': 'Adjudication',
  'app.navSettings': 'Settings',

  // 設定ビュー（アプリ内 #/options）
  'settings.title': 'Settings',
  'settings.back': '← Back to the previous screen',

  // Options の表示言語節
  'options.documentTitle': 'SR Data Extraction Plugin — Settings',
  'options.heading': 'Settings',
  'options.openApp': 'Open the app',
  'options.languageTitle': 'Display language',
  'options.languageHelp': 'Language of the user interface. Changes apply immediately.',
  'options.languageLabel': 'Language',
  'options.languageSaveFailed': 'Failed to save the display language.',

  // Popup S1
  'popup.loading': 'Loading…',
  'popup.authLead':
    'Projects are stored in Google Sheets / Drive. Please sign in with your Google account.',
  'popup.login': 'Sign in with Google',
  'popup.loginFailed': 'Sign-in failed. Make sure a Google account is added to your browser.',
  'popup.loggedInAs': 'Signed in as:',
  'popup.logout': 'Sign out',
  'popup.recentTitle': 'Recent projects',
  'popup.createTitle': 'New project',
  'popup.createLead':
    'Creates a data extraction project (generates a spreadsheet and a Drive folder).',
  'popup.createTitleLabel': 'Project title',
  'popup.createSubmit': 'Create',
  'popup.creating': 'Creating…',
  'popup.openTitle': 'Open by spreadsheet ID / URL',
  'popup.openIdLabel': 'Spreadsheet ID or URL',
  'popup.openIdPlaceholder': 'Paste a spreadsheet ID or URL',
  'popup.openSubmit': 'Open',
  'popup.openOptions': 'Open settings',
  'popup.statusLoginRequired': 'Sign-in required.',
  'popup.statusPickRecent': 'Choose a recent project or create a new one.',
  'popup.statusCreateOrOpen': 'Create a new project or open one from a spreadsheet ID.',
  'popup.emailUnknown': '(unknown)',

  // Home S2
  'home.title': 'Project overview',
  'home.projectNone': 'not selected',
  'home.countsLoading': 'Loading progress…',
  'home.countsError': 'Failed to load progress: {reason}',
  'home.summaryDocuments': 'Documents',
  'home.summaryProtocolVersions': 'Protocol versions',
  'home.summarySchemaVersions': 'Confirmed table design versions',
  'home.summaryEvidenceRows': 'AI-extracted Evidence rows',
  'home.summaryDataRows': 'Data rows (StudyData + ResultsData)',
  'home.reviewersTitle': 'Reviewer management',
  'home.reviewersNotice':
    'Adding a reviewer automatically shares the spreadsheet (editable) and the project folder (view-only) with the account. If sharing fails, the registration is kept and manual sharing instructions are shown.',
  'home.reviewersLoading': 'Loading…',
  'home.reviewersError': 'Failed to load the list: {reason}',
  'home.reviewersEmpty': 'No reviewers registered yet.',
  'home.reviewersActions': 'Actions',
  'home.roleReviewer': 'Reviewer',
  'home.roleAdjudicator': 'Adjudicator',
  'home.roleRevoked': 'Revoked',
  'home.modeWithAi': '① Review AI results',
  'home.modeIndependent': '② Review without AI',
  'home.revokeAria': 'Revoke {email}',
  'home.revokeTitle': 'Revoke (delete)',
  'home.copyInviteAria': 'Copy the review invitation for {email}',
  'home.copyInviteTitle': 'Copy the review invitation',
  'home.modeConfirmTitle': 'Change the review mode?',
  'home.modeConfirmBody':
    '{email} is already registered. Changing the mode (a premise of blinding) may break blinding after the fact.',
  'home.modeConfirmOk': 'Continue and change',
  'home.addReviewerEmailAria': 'Email of the reviewer to add',
  'home.addReviewerRoleAria': 'Role',
  'home.addReviewerModeAria': 'Review mode (review_mode)',
  'home.addSubmit': 'Add',
  'home.folderAccessLead':
    "Before starting verification, grant access to the project's Drive folder (required to load PDFs and extracted text).",
  'home.grantFolderAccess': 'Grant access to the project folder',
  'home.folderAccessChecking': 'Checking…',
  'home.folderAccessError': 'Could not confirm access: {reason}',
  'home.folderAccessGranted': 'Access to the project folder has been granted.',
  'home.goVerify': 'Start verification',
};
