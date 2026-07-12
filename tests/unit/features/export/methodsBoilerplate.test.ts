import {
  buildMethodsText,
  type MethodsFacts,
} from '../../../../src/features/export/methodsBoilerplate';

function makeFacts(overrides: Partial<MethodsFacts> = {}): MethodsFacts {
  return {
    toolVersion: null,
    modelIds: [],
    providers: [],
    pilotStudyCount: 0,
    scannedDocumentCount: 0,
    ...overrides,
  };
}

describe('buildMethodsText', () => {
  it('英語・単一レビュアーの文案が docs/methods-boilerplate.md §1.1 と一致する（見出しはプレーンテキスト）', () => {
    const result = buildMethodsText('en', 'single', makeFacts());
    expect(result.text.startsWith('Data extraction. Data were extracted using')).toBe(true);
    expect(result.text).not.toContain('**');
    expect(result.text).toContain(
      'One reviewer ({{reviewer_initials}}) checked every AI-extracted value',
    );
    expect(result.text).toContain(
      'every item — including accepted values — required an explicit decision',
    );
    // 二重独立版の文言は含まれない
    expect(result.text).not.toContain('Two reviewers');
    expect(result.text).not.toContain('adjudicator_initials');
  });

  it('英語・二重独立検証の文案は 2 段落目が差し替わる（§1.2）', () => {
    const result = buildMethodsText('en', 'dual', makeFacts());
    expect(result.text).toContain(
      'Two reviewers ({{reviewer_initials}}) independently verified the AI-extracted values',
    );
    expect(result.text).toContain('a third reviewer ({{adjudicator_initials}})');
    expect(result.text).not.toContain('One reviewer');
  });

  it('日本語・単一レビュアーの文案が §2.1 と一致する（見出しはプレーンテキスト）', () => {
    const result = buildMethodsText('ja', 'single', makeFacts());
    expect(result.text.startsWith('データ抽出. データ抽出には、オープンソースの')).toBe(true);
    expect(result.text).not.toContain('**');
    expect(result.text).toContain('レビュアー 1 名（{{reviewer_initials}}）がすべての');
    expect(result.text).not.toContain('レビュアー 2 名');
  });

  it('日本語・二重独立検証の文案は 2 段落目が差し替わる（§2.2）', () => {
    const result = buildMethodsText('ja', 'dual', makeFacts());
    expect(result.text).toContain('レビュアー 2 名（{{reviewer_initials}}）が独立に');
    expect(result.text).toContain('第 3 のレビュアー（{{adjudicator_initials}}）が裁定して');
    expect(result.text).not.toContain('レビュアー 1 名');
  });

  it('tool_version が反映され、未指定のプレースホルダは残る', () => {
    const result = buildMethodsText('en', 'single', makeFacts({ toolVersion: '1.4.0' }));
    expect(result.text).toContain('version 1.4.0 (https://github.com/youkiti/sr-data-extraction-plugin)');
    expect(result.text).not.toContain('{{tool_version}}');
    expect(result.unresolved).toContain('n_sample');
    expect(result.unresolved).toContain('reviewer_initials');
    expect(result.unresolved).toContain('supplement_ref');
  });

  it('toolVersion が null のときは {{tool_version}} が残り unresolved に含まれる', () => {
    const result = buildMethodsText('en', 'single', makeFacts());
    expect(result.text).toContain('{{tool_version}}');
    expect(result.unresolved).toContain('tool_version');
  });

  it('modelIds が複数のとき「, 」区切りで {{model_id}} へ列挙される', () => {
    const result = buildMethodsText(
      'en',
      'single',
      makeFacts({ modelIds: ['gemini-3.5-flash', 'gemini-3.5-pro'] }),
    );
    expect(result.text).toContain('LLM (gemini-3.5-flash, gemini-3.5-pro, accessed via the');
    expect(result.unresolved).not.toContain('model_id');
  });

  it('providers が複数のとき「, 」区切りで {{provider}} へ列挙される', () => {
    const result = buildMethodsText(
      'en',
      'single',
      makeFacts({ providers: ['Gemini', 'OpenRouter'] }),
    );
    expect(result.text).toContain('accessed via the Gemini, OpenRouter API');
    expect(result.unresolved).not.toContain('provider');
  });

  it('pilotStudyCount が 0 のときは {{n_pilot}} が反映されない', () => {
    const result = buildMethodsText('en', 'single', makeFacts({ pilotStudyCount: 0 }));
    expect(result.text).toContain('{{n_pilot}}');
    expect(result.unresolved).toContain('n_pilot');
  });

  it('pilotStudyCount > 0 のときは {{n_pilot}} が数値へ置き換わる', () => {
    const result = buildMethodsText('en', 'single', makeFacts({ pilotStudyCount: 5 }));
    expect(result.text).toContain('piloted on 5 studies');
    expect(result.unresolved).not.toContain('n_pilot');
  });

  it('scannedDocumentCount が 0 のときはオプション文（スキャン PDF）自体を出さない', () => {
    const result = buildMethodsText('en', 'single', makeFacts({ scannedDocumentCount: 0 }));
    expect(result.text).not.toContain('scanned PDFs');
    expect(result.unresolved).not.toContain('n_scanned');
  });

  it('scannedDocumentCount > 0 のときはオプション文が末尾に連結され {{n_scanned}} が反映される', () => {
    const result = buildMethodsText('en', 'single', makeFacts({ scannedDocumentCount: 3 }));
    expect(result.text).toContain('For 3 studies available only as scanned PDFs without a text layer');
    expect(result.unresolved).not.toContain('n_scanned');
  });

  it('日本語でもスキャン PDF のオプション文が {{n_scanned}} > 0 のときだけ連結される', () => {
    const withScanned = buildMethodsText('ja', 'single', makeFacts({ scannedDocumentCount: 2 }));
    expect(withScanned.text).toContain(
      'テキスト層を持たないスキャン PDF のみ入手可能であった 2 本については',
    );
    const withoutScanned = buildMethodsText('ja', 'single', makeFacts());
    expect(withoutScanned.text).not.toContain('スキャン PDF のみ入手可能であった');
  });

  it('unresolved は出現順・重複除去で列挙される（英語・単一・facts 全未指定）', () => {
    const result = buildMethodsText('en', 'single', makeFacts());
    expect(result.unresolved).toEqual([
      'tool_version',
      'model_id',
      'provider',
      'n_sample',
      'n_pilot',
      'reviewer_initials',
      'supplement_ref',
    ]);
  });

  it('unresolved は二重独立版で adjudicator_initials も含む', () => {
    const result = buildMethodsText('en', 'dual', makeFacts());
    expect(result.unresolved).toContain('adjudicator_initials');
  });

  it('全実績値が揃うと単一レビュアー版の unresolved は reviewer_initials / supplement_ref のみになる', () => {
    const result = buildMethodsText(
      'ja',
      'single',
      makeFacts({
        toolVersion: '2.0.0',
        modelIds: ['gemini-3.5-flash'],
        providers: ['Gemini'],
        pilotStudyCount: 3,
        scannedDocumentCount: 1,
      }),
    );
    expect(result.unresolved).toEqual(['n_sample', 'reviewer_initials', 'supplement_ref']);
  });
});
