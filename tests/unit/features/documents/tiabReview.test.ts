// tiab-review 採用リスト取り込みの純ロジックのテスト（issue #68・requirements.md §4.5 / ※Q2）。
// tiab 側シートのヘッダ名ベースのパース・最終判定 include の抽出（相の選択 + OR 合議 +
// 最新判定への畳み込み + llm 判定の扱い）・study_label 生成・PDF 突き合わせ・反映プランを検証する
import type { DocumentRecord } from '../../../../src/domain/document';
import type { StudyRecord } from '../../../../src/domain/study';
import {
  buildTiabStudyLabel,
  extractDriveFileId,
  parseTiabDecisions,
  parseTiabReferences,
  parseTiabSpreadsheetId,
  planTiabImport,
  resolveAdoptedReferences,
  type TiabAdoptedList,
  type TiabDecision,
  type TiabReference,
} from '../../../../src/features/documents/tiabReview';

function makeRef(overrides: Partial<TiabReference> = {}): TiabReference {
  return {
    refId: 'ref-0001-uuid',
    title: 'Effect of X on Y',
    year: 2020,
    authors: 'Smith, John; Doe, Alice',
    doi: null,
    pmid: null,
    fulltextUrl: null,
    ...overrides,
  };
}

function makeDecision(overrides: Partial<TiabDecision> = {}): TiabDecision {
  return {
    refId: 'ref-0001-uuid',
    reviewerId: 'a@example.com',
    decision: 'include',
    decidedAt: '2026-07-01T00:00:00Z',
    screeningPhase: 'fulltext',
    ...overrides,
  };
}

function makeStudy(overrides: Partial<StudyRecord> = {}): StudyRecord {
  return {
    studyId: 'study-1',
    studyLabel: 'smith2020',
    registrationId: null,
    createdAt: 't1',
    createdBy: 'tester@example.com',
    note: null,
    ...overrides,
  };
}

function makeDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: 'doc-1',
    studyId: 'study-1',
    documentRole: 'article',
    driveFileId: 'drive-1',
    sourceFileId: 'src-1',
    filename: 'smith2020.pdf',
    pmid: null,
    doi: null,
    textRef: 'https://drive.google.com/file/d/txt-1/view',
    textStatus: 'ok',
    pageCount: 10,
    charCount: 20000,
    importedAt: '2026-07-02T00:00:00Z',
    importedBy: 'tester@example.com',
    note: null,
    excluded: false,
    exclusionReason: null,
    exclusionNote: null,
    excludedAt: null,
    ...overrides,
  };
}

describe('parseTiabSpreadsheetId', () => {
  test('URL から /spreadsheets/d/{id} を抽出する', () => {
    expect(
      parseTiabSpreadsheetId('https://docs.google.com/spreadsheets/d/1AbC_d-EfG9/edit#gid=0'),
    ).toBe('1AbC_d-EfG9');
  });

  test('ID 直指定（20 文字以上の英数・ハイフン・アンダースコア）を受け付ける', () => {
    expect(parseTiabSpreadsheetId('  1AbCdEfGhIjKlMnOpQrStUvWx  ')).toBe(
      '1AbCdEfGhIjKlMnOpQrStUvWx',
    );
  });

  test('空・短すぎる・不正な形式は null', () => {
    expect(parseTiabSpreadsheetId('')).toBeNull();
    expect(parseTiabSpreadsheetId('   ')).toBeNull();
    expect(parseTiabSpreadsheetId('short-id')).toBeNull();
    expect(parseTiabSpreadsheetId('https://example.com/notasheet')).toBeNull();
  });
});

describe('parseTiabReferences', () => {
  const HEADER = ['ref_id', 'title', 'abstract', 'year', 'authors', 'doi', 'pmid', 'fulltext_url'];

  test('ヘッダ名で列を解決して TiabReference へ変換する（列順に依存しない）', () => {
    const reordered = ['title', 'ref_id', 'authors', 'year', 'pmid', 'doi', 'fulltext_url'];
    const rows = parseTiabReferences([
      reordered,
      ['T1', 'r1', 'Smith, J', '2020', '123', '10.1/x', 'https://drive.google.com/file/d/f1/view'],
    ]);
    expect(rows).toEqual([
      {
        refId: 'r1',
        title: 'T1',
        year: 2020,
        authors: 'Smith, J',
        doi: '10.1/x',
        pmid: '123',
        fulltextUrl: 'https://drive.google.com/file/d/f1/view',
      },
    ]);
  });

  test('year が 4 桁数値でない・任意列が空のときは null にする', () => {
    const rows = parseTiabReferences([HEADER, ['r1', 'T1', '', '20xx', '', '', '', '']]);
    expect(rows[0]).toMatchObject({ year: null, authors: null, doi: null, pmid: null, fulltextUrl: null });
  });

  test('ref_id が空の行は読み飛ばす', () => {
    const rows = parseTiabReferences([HEADER, ['', 'T1'], ['r2', 'T2']]);
    expect(rows.map((r) => r.refId)).toEqual(['r2']);
  });

  test('ヘッダ行が無い・ref_id / title 列が無いシートは throw', () => {
    expect(() => parseTiabReferences([])).toThrow('tiab-review のスプレッドシート');
    expect(() => parseTiabReferences([['id', 'name'], ['1', 'x']])).toThrow(
      'References タブに ref_id / title 列が見つかりません。tiab-review のスプレッドシートを指定してください',
    );
  });

  test('重複ヘッダは最初の列を採用する', () => {
    const rows = parseTiabReferences([
      ['ref_id', 'title', 'title'],
      ['r1', 'first', 'second'],
    ]);
    expect(rows[0]?.title).toBe('first');
  });
});

describe('parseTiabDecisions', () => {
  const HEADER = [
    'decision_id',
    'ref_id',
    'reviewer_id',
    'decision',
    'reason',
    'labels',
    'note',
    'decided_at',
    'client_version',
    'source_url',
    'screening_phase',
  ];

  test('ヘッダ名で列を解決し、screening_phase 空欄は tiab として読む', () => {
    const rows = parseTiabDecisions([
      HEADER,
      ['d1', 'r1', 'a@example.com', 'include', '', '', '', '2026-07-01T00:00:00Z', '', '', ''],
      ['d2', 'r1', 'b@example.com', 'exclude', 'pop', '', '', '2026-07-02T00:00:00Z', '', '', 'fulltext'],
    ]);
    expect(rows).toEqual([
      {
        refId: 'r1',
        reviewerId: 'a@example.com',
        decision: 'include',
        decidedAt: '2026-07-01T00:00:00Z',
        screeningPhase: 'tiab',
      },
      {
        refId: 'r1',
        reviewerId: 'b@example.com',
        decision: 'exclude',
        decidedAt: '2026-07-02T00:00:00Z',
        screeningPhase: 'fulltext',
      },
    ]);
  });

  test('ref_id / reviewer_id が空・decision が不正な行は読み飛ばす', () => {
    const rows = parseTiabDecisions([
      ['ref_id', 'reviewer_id', 'decision'],
      ['', 'a@example.com', 'include'],
      ['r1', '', 'include'],
      ['r1', 'a@example.com', 'banana'],
      ['r1', 'a@example.com', 'maybe'],
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.decision).toBe('maybe');
  });

  test('ヘッダ行が無い・必須列が無いシートは throw', () => {
    expect(() => parseTiabDecisions([])).toThrow('tiab-review のスプレッドシート');
    expect(() => parseTiabDecisions([['ref_id', 'decision'], ['r1', 'include']])).toThrow(
      'Decisions タブに ref_id / reviewer_id / decision 列が見つかりません。tiab-review のスプレッドシートを指定してください',
    );
  });
});

describe('extractDriveFileId', () => {
  test('webViewLink（/file/d/{id}）と open?id= 形式から ID を取り出す', () => {
    expect(extractDriveFileId('https://drive.google.com/file/d/abc_DEF-123/view?usp=sharing')).toBe(
      'abc_DEF-123',
    );
    expect(extractDriveFileId('https://drive.google.com/open?id=xyz-9')).toBe('xyz-9');
    expect(extractDriveFileId('https://drive.usercontent.google.com/download?id=q_1')).toBe('q_1');
  });

  test('Drive 以外の URL・不正な URL・不正な id は null', () => {
    expect(extractDriveFileId('https://example.com/file/d/abc/view')).toBeNull();
    expect(extractDriveFileId('not a url')).toBeNull();
    expect(extractDriveFileId('https://drive.google.com/open?id=a b')).toBeNull();
    expect(extractDriveFileId('https://drive.google.com/drive/folders/xyz')).toBeNull();
  });
});

describe('buildTiabStudyLabel', () => {
  test('「姓, 名」形式は姓 + (year)', () => {
    expect(buildTiabStudyLabel(makeRef())).toBe('Smith (2020)');
  });

  test('「Smith JP」形式（末尾イニシャル）は先頭側を姓とする', () => {
    expect(buildTiabStudyLabel(makeRef({ authors: 'Smith JP; Doe A' }))).toBe('Smith (2020)');
    expect(buildTiabStudyLabel(makeRef({ authors: 'van der Berg JP' }))).toBe('van der Berg (2020)');
  });

  test('「John Smith」形式は末尾トークンを姓とする', () => {
    expect(buildTiabStudyLabel(makeRef({ authors: 'John Smith' }))).toBe('Smith (2020)');
  });

  test('単一トークンの著者はそのまま使う', () => {
    expect(buildTiabStudyLabel(makeRef({ authors: 'Smith' }))).toBe('Smith (2020)');
  });

  test('year が無ければ括弧を付けない', () => {
    expect(buildTiabStudyLabel(makeRef({ year: null }))).toBe('Smith');
  });

  test('著者が無ければタイトル先頭 40 字へフォールバックする', () => {
    const longTitle = 'A'.repeat(60);
    expect(buildTiabStudyLabel(makeRef({ authors: null, title: longTitle }))).toBe(
      `${'A'.repeat(40)} (2020)`,
    );
  });

  test('第一著者が空（先頭が区切り・カンマ前が空）のときもタイトルへフォールバックする', () => {
    expect(buildTiabStudyLabel(makeRef({ authors: '; Doe, A', title: 'T' }))).toBe('T (2020)');
    expect(buildTiabStudyLabel(makeRef({ authors: ', John', title: 'T' }))).toBe('T (2020)');
  });

  test('著者もタイトルも無ければ ref_id 先頭 8 桁へフォールバックする', () => {
    expect(buildTiabStudyLabel(makeRef({ authors: null, title: '  ', year: null }))).toBe('ref-0001');
  });
});

describe('resolveAdoptedReferences', () => {
  const refs = [makeRef({ refId: 'r1' }), makeRef({ refId: 'r2' }), makeRef({ refId: 'r3' })];

  test('fulltext 相の判定があるシートは fulltext 相の OR 合議で include を決める', () => {
    const decisions = [
      // r1: fulltext で A exclude / B include → OR で include
      makeDecision({ refId: 'r1', reviewerId: 'a@example.com', decision: 'exclude' }),
      makeDecision({ refId: 'r1', reviewerId: 'b@example.com', decision: 'include' }),
      // r2: tiab include のみ（fulltext 未判定）→ 採用しない
      makeDecision({ refId: 'r2', screeningPhase: 'tiab', decision: 'include' }),
      // r3: fulltext exclude のみ → 採用しない
      makeDecision({ refId: 'r3', decision: 'exclude' }),
    ];
    const adopted = resolveAdoptedReferences(refs, decisions, null);
    expect(adopted.phase).toBe('fulltext');
    expect(adopted.totalReferences).toBe(3);
    expect(adopted.includes.map((r) => r.refId)).toEqual(['r1']);
  });

  test('fulltext 相の判定が無いシートは TiAb 相の OR 合議へフォールバックする', () => {
    const decisions = [
      makeDecision({ refId: 'r1', screeningPhase: 'tiab', decision: 'include' }),
      makeDecision({ refId: 'r2', screeningPhase: 'tiab', decision: 'exclude' }),
    ];
    const adopted = resolveAdoptedReferences(refs, decisions, null);
    expect(adopted.phase).toBe('tiab');
    expect(adopted.includes.map((r) => r.refId)).toEqual(['r1']);
  });

  test('同一（相・文献・判定者）は decided_at 最新の判定だけを有効にする', () => {
    const decisions = [
      makeDecision({ refId: 'r1', decision: 'include', decidedAt: '2026-07-01T00:00:00Z' }),
      makeDecision({ refId: 'r1', decision: 'exclude', decidedAt: '2026-07-02T00:00:00Z' }),
      // r2 は逆順（後から古い行を読んでも上書きしない）
      makeDecision({ refId: 'r2', decision: 'include', decidedAt: '2026-07-05T00:00:00Z' }),
      makeDecision({ refId: 'r2', decision: 'exclude', decidedAt: '2026-07-04T00:00:00Z' }),
    ];
    const adopted = resolveAdoptedReferences(refs, decisions, null);
    expect(adopted.includes.map((r) => r.refId)).toEqual(['r2']);
  });

  test('最新判定が pending の文献は未判定として扱う', () => {
    const decisions = [
      makeDecision({ refId: 'r1', decision: 'include', decidedAt: '2026-07-01T00:00:00Z' }),
      makeDecision({ refId: 'r1', decision: 'pending', decidedAt: '2026-07-02T00:00:00Z' }),
    ];
    expect(resolveAdoptedReferences(refs, decisions, null).includes).toEqual([]);
  });

  test('llm: 判定は fulltext 相の採用ラウンドのみ集計する', () => {
    const decisions = [
      makeDecision({ refId: 'r1', reviewerId: 'llm:round-1', decision: 'include' }),
      makeDecision({ refId: 'r2', reviewerId: 'llm:round-2', decision: 'include' }),
    ];
    const adopted = resolveAdoptedReferences(refs, decisions, 'llm:round-1');
    expect(adopted.phase).toBe('fulltext');
    expect(adopted.includes.map((r) => r.refId)).toEqual(['r1']);
  });

  test('採用ラウンド未設定なら llm: の fulltext 判定は集計せず、TiAb 相へフォールバックする', () => {
    const decisions = [
      makeDecision({ refId: 'r1', reviewerId: 'llm:round-1', decision: 'include' }),
      makeDecision({ refId: 'r2', screeningPhase: 'tiab', decision: 'include' }),
    ];
    const adopted = resolveAdoptedReferences(refs, decisions, null);
    expect(adopted.phase).toBe('tiab');
    expect(adopted.includes.map((r) => r.refId)).toEqual(['r2']);
  });

  test('TiAb 相の llm: 判定は集計しない', () => {
    const decisions = [
      makeDecision({ refId: 'r1', reviewerId: 'llm:exec-1', screeningPhase: 'tiab', decision: 'include' }),
    ];
    expect(resolveAdoptedReferences(refs, decisions, null).includes).toEqual([]);
  });
});

describe('planTiabImport', () => {
  function adoptedOf(includes: TiabReference[], totalReferences = includes.length): TiabAdoptedList {
    return { phase: 'fulltext', includes, totalReferences };
  }

  test('fulltext_url の Drive ファイル ID = source_file_id で突き合わせ、study_label と DOI / PMID を反映する', () => {
    const ref = makeRef({
      refId: 'r1',
      doi: '10.1000/XYZ',
      pmid: '123',
      fulltextUrl: 'https://drive.google.com/file/d/src-1/view',
    });
    const plan = planTiabImport({
      adopted: adoptedOf([ref]),
      studies: [makeStudy()],
      documents: [makeDoc()],
    });
    expect(plan.items).toEqual([
      {
        refId: 'r1',
        title: ref.title,
        studyLabel: 'Smith (2020)',
        status: 'update',
        matchedFilenames: ['smith2020.pdf'],
      },
    ]);
    expect(plan.studyUpdates).toEqual([makeStudy({ studyLabel: 'Smith (2020)' })]);
    expect(plan.documentUpdates).toEqual([makeDoc({ doi: '10.1000/XYZ', pmid: '123' })]);
    expect(plan.includeCount).toBe(1);
    expect(plan.phase).toBe('fulltext');
  });

  test('ファイル名の [ref_id 先頭 8 桁] タグで突き合わせる', () => {
    const ref = makeRef({ refId: 'abcdef1234567890' });
    const doc = makeDoc({ filename: 'Effect of X on Y [abcdef12].pdf', sourceFileId: null });
    const plan = planTiabImport({ adopted: adoptedOf([ref]), studies: [makeStudy()], documents: [doc] });
    expect(plan.items[0]?.status).toBe('update');
    expect(plan.items[0]?.matchedFilenames).toEqual(['Effect of X on Y [abcdef12].pdf']);
  });

  test('DOI（大文字小文字を無視）/ PMID の一致で突き合わせる', () => {
    const byDoi = planTiabImport({
      adopted: adoptedOf([makeRef({ doi: '10.1000/ABC' })]),
      studies: [makeStudy()],
      documents: [makeDoc({ doi: '10.1000/abc' })],
    });
    expect(byDoi.items[0]?.status).toBe('update');

    const byPmid = planTiabImport({
      adopted: adoptedOf([makeRef({ pmid: '999' })]),
      studies: [makeStudy()],
      documents: [makeDoc({ pmid: '999' })],
    });
    expect(byPmid.items[0]?.status).toBe('update');
  });

  test('突き合わせ先が無い include は unmatched（更新は出さない）', () => {
    const plan = planTiabImport({
      adopted: adoptedOf([makeRef({ refId: 'r-unmatched' })]),
      studies: [makeStudy()],
      documents: [makeDoc()],
    });
    expect(plan.items[0]).toMatchObject({ status: 'unmatched', matchedFilenames: [] });
    expect(plan.studyUpdates).toEqual([]);
    expect(plan.documentUpdates).toEqual([]);
  });

  test('label・識別子とも反映済みなら already（冪等）', () => {
    const ref = makeRef({ pmid: '123', fulltextUrl: 'https://drive.google.com/file/d/src-1/view' });
    const plan = planTiabImport({
      adopted: adoptedOf([ref]),
      studies: [makeStudy({ studyLabel: 'Smith (2020)' })],
      documents: [makeDoc({ pmid: '123' })],
    });
    expect(plan.items[0]?.status).toBe('already');
    expect(plan.studyUpdates).toEqual([]);
    expect(plan.documentUpdates).toEqual([]);
  });

  test('tiab 側に無い識別子は既存値を残す（null で上書きしない）', () => {
    const ref = makeRef({ doi: null, pmid: null, fulltextUrl: 'https://drive.google.com/file/d/src-1/view' });
    const plan = planTiabImport({
      adopted: adoptedOf([ref]),
      studies: [makeStudy({ studyLabel: 'Smith (2020)' })],
      documents: [makeDoc({ doi: '10.1/existing', pmid: '42' })],
    });
    expect(plan.items[0]?.status).toBe('already');
    expect(plan.documentUpdates).toEqual([]);
  });

  test('1 文書は 1 Reference にのみ紐付く（先勝ち）', () => {
    const ref1 = makeRef({ refId: 'r1', pmid: '1', fulltextUrl: 'https://drive.google.com/file/d/src-1/view' });
    const ref2 = makeRef({ refId: 'r2', pmid: '2', fulltextUrl: 'https://drive.google.com/file/d/src-1/view' });
    const plan = planTiabImport({
      adopted: adoptedOf([ref1, ref2]),
      studies: [makeStudy()],
      documents: [makeDoc()],
    });
    expect(plan.items[0]?.status).toBe('update');
    expect(plan.items[1]?.status).toBe('unmatched');
  });

  test('同一 study へ複数 include が紐付いたら study_label は先勝ちで 1 回だけ更新する', () => {
    const ref1 = makeRef({ refId: 'r1', authors: 'Smith, J', fulltextUrl: 'https://drive.google.com/file/d/src-1/view' });
    const ref2 = makeRef({ refId: 'r2', authors: 'Doe, A', fulltextUrl: 'https://drive.google.com/file/d/src-2/view' });
    const docs = [makeDoc(), makeDoc({ documentId: 'doc-2', sourceFileId: 'src-2', filename: 'doe.pdf' })];
    const plan = planTiabImport({ adopted: adoptedOf([ref1, ref2]), studies: [makeStudy()], documents: docs });
    expect(plan.studyUpdates).toEqual([makeStudy({ studyLabel: 'Smith (2020)' })]);
    // ref2 は label 更新を伴わない（識別子の変更も無い）ため already
    expect(plan.items.map((item) => item.status)).toEqual(['update', 'already']);
  });

  test('再実行で全件「適用済み」へ収束する（同一 study 複数 include でラベルが振動しない）', () => {
    const ref1 = makeRef({
      refId: 'r1',
      authors: 'Smith, J',
      pmid: '1',
      fulltextUrl: 'https://drive.google.com/file/d/src-1/view',
    });
    const ref2 = makeRef({
      refId: 'r2',
      authors: 'Doe, A',
      pmid: '2',
      fulltextUrl: 'https://drive.google.com/file/d/src-2/view',
    });
    // 統合済み study-1 に 2 文書（各 ref が別文書に一致）
    const docs = [makeDoc(), makeDoc({ documentId: 'doc-2', sourceFileId: 'src-2', filename: 'doe.pdf' })];
    const adopted = adoptedOf([ref1, ref2]);

    const first = planTiabImport({ adopted, studies: [makeStudy()], documents: docs });
    expect(first.studyUpdates).toEqual([makeStudy({ studyLabel: 'Smith (2020)' })]);

    // 1 回目の反映結果を適用した状態で再実行 → 更新 0 件・全件 already（A→B→A の振動をしない）
    const appliedDocs = docs.map(
      (doc) => first.documentUpdates.find((updated) => updated.documentId === doc.documentId) ?? doc,
    );
    const second = planTiabImport({ adopted, studies: first.studyUpdates, documents: appliedDocs });
    expect(second.studyUpdates).toEqual([]);
    expect(second.documentUpdates).toEqual([]);
    expect(second.items.map((item) => item.status)).toEqual(['already', 'already']);
  });

  test('現ラベルが先頭 ref と一致していても claim され、後続 ref がラベルを奪わない', () => {
    const ref1 = makeRef({
      refId: 'r1',
      authors: 'Smith, J',
      fulltextUrl: 'https://drive.google.com/file/d/src-1/view',
    });
    const ref2 = makeRef({
      refId: 'r2',
      authors: 'Doe, A',
      fulltextUrl: 'https://drive.google.com/file/d/src-2/view',
    });
    const docs = [makeDoc(), makeDoc({ documentId: 'doc-2', sourceFileId: 'src-2', filename: 'doe.pdf' })];
    // 単回実行でも、現ラベル == 先頭 ref のラベルから始まると後続 ref に奪われないこと
    const plan = planTiabImport({
      adopted: adoptedOf([ref1, ref2]),
      studies: [makeStudy({ studyLabel: 'Smith (2020)' })],
      documents: docs,
    });
    expect(plan.studyUpdates).toEqual([]);
    expect(plan.items.map((item) => item.status)).toEqual(['already', 'already']);
  });

  test('URL 形式の DOI（doi.org / dx.doi.org）も照合でき、転記はプレフィクスを剥がした形へ正規化する', () => {
    // ref 側が URL 形式 → 照合成功 + 正規形（10.…）への転記が走る
    const refUrl = planTiabImport({
      adopted: adoptedOf([makeRef({ doi: 'https://doi.org/10.1000/ABC' })]),
      studies: [makeStudy({ studyLabel: 'Smith (2020)' })],
      documents: [makeDoc({ doi: '10.1000/abc' })],
    });
    expect(refUrl.items[0]?.status).toBe('update');
    expect(refUrl.documentUpdates[0]?.doi).toBe('10.1000/ABC');

    // doc 側が URL 形式（dx.doi.org）→ 照合成功 + 正規形へ揃える
    const docUrl = planTiabImport({
      adopted: adoptedOf([makeRef({ doi: '10.1000/abc' })]),
      studies: [makeStudy({ studyLabel: 'Smith (2020)' })],
      documents: [makeDoc({ doi: 'http://dx.doi.org/10.1000/ABC' })],
    });
    expect(docUrl.items[0]?.status).toBe('update');
    expect(docUrl.documentUpdates[0]?.doi).toBe('10.1000/abc');
  });

  test('複数文書に一致した場合は全文書へ識別子を転記し、study は最初の文書のものを使う', () => {
    const ref = makeRef({ refId: 'abcdef1234567890', pmid: '7' });
    const docs = [
      makeDoc({ documentId: 'doc-1', studyId: 'study-1', filename: 'main [abcdef12].pdf' }),
      makeDoc({ documentId: 'doc-2', studyId: 'study-2', filename: 'suppl [abcdef12].pdf' }),
    ];
    const studies = [makeStudy(), makeStudy({ studyId: 'study-2', studyLabel: 'other' })];
    const plan = planTiabImport({ adopted: adoptedOf([ref]), studies, documents: docs });
    expect(plan.documentUpdates.map((doc) => doc.documentId)).toEqual(['doc-1', 'doc-2']);
    expect(plan.studyUpdates.map((study) => study.studyId)).toEqual(['study-1']);
    expect(plan.items[0]?.matchedFilenames).toEqual(['main [abcdef12].pdf', 'suppl [abcdef12].pdf']);
  });

  test('文書の study_id が Studies に無い場合も識別子の転記だけは行う', () => {
    const ref = makeRef({ pmid: '5', fulltextUrl: 'https://drive.google.com/file/d/src-1/view' });
    const plan = planTiabImport({
      adopted: adoptedOf([ref]),
      studies: [],
      documents: [makeDoc({ studyId: 'study-ghost' })],
    });
    expect(plan.items[0]?.status).toBe('update');
    expect(plan.studyUpdates).toEqual([]);
    expect(plan.documentUpdates).toHaveLength(1);
  });

  test('fulltext_url が Drive 以外でもタグ・DOI / PMID の突き合わせは機能する', () => {
    const ref = makeRef({ fulltextUrl: 'https://example.com/paper.pdf', pmid: '11' });
    const plan = planTiabImport({
      adopted: adoptedOf([ref]),
      studies: [makeStudy({ studyLabel: 'Smith (2020)' })],
      documents: [makeDoc({ pmid: '11' })],
    });
    expect(plan.items[0]?.status).toBe('already');
  });
});
