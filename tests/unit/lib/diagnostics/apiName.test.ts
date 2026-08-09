import { apiNameFromEndpoint } from '../../../../src/lib/diagnostics/apiName';

describe('apiNameFromEndpoint', () => {
  test('不正な URL 文字列は unknown を返す', () => {
    expect(apiNameFromEndpoint('not a url')).toBe('unknown');
  });

  test('未知のホスト・パスは unknown を返す', () => {
    expect(apiNameFromEndpoint('https://example.com/foo')).toBe('unknown');
  });

  describe('Drive API', () => {
    test('files/{id}/copy → drive.files.copy', () => {
      expect(
        apiNameFromEndpoint('https://www.googleapis.com/drive/v3/files/FILE-1/copy?fields=id'),
      ).toBe('drive.files.copy');
    });

    test('files/{id}/permissions → drive.permissions.create', () => {
      expect(
        apiNameFromEndpoint(
          'https://www.googleapis.com/drive/v3/files/FILE-1/permissions?sendNotificationEmail=false&fields=id',
        ),
      ).toBe('drive.permissions.create');
    });

    test('files（q= あり）→ drive.files.list', () => {
      expect(
        apiNameFromEndpoint(
          "https://www.googleapis.com/drive/v3/files?fields=files(id,name)&pageSize=1&q=name%3D'x'",
        ),
      ).toBe('drive.files.list');
    });

    test('files（q= なし）→ drive.files.create（createFolder）', () => {
      expect(apiNameFromEndpoint('https://www.googleapis.com/drive/v3/files?fields=id,webViewLink')).toBe(
        'drive.files.create',
      );
    });

    test('upload/drive/v3/files（q= なし）→ drive.files.create（アップロード）', () => {
      expect(
        apiNameFromEndpoint(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
        ),
      ).toBe('drive.files.create');
    });

    test('files/{id}（addParents あり）→ drive.files.update（moveFileToFolder）', () => {
      expect(
        apiNameFromEndpoint(
          'https://www.googleapis.com/drive/v3/files/FILE-1?addParents=P1&removeParents=P0&fields=id,parents',
        ),
      ).toBe('drive.files.update');
    });

    test('files/{id}（alt=media）→ drive.files.get（getFileBinary / getFileText）', () => {
      expect(apiNameFromEndpoint('https://www.googleapis.com/drive/v3/files/FILE-1?alt=media')).toBe(
        'drive.files.get',
      );
    });

    test('files/{id}（fields=parents のみ）→ drive.files.get（メタデータ取得）', () => {
      expect(
        apiNameFromEndpoint('https://www.googleapis.com/drive/v3/files/FILE-1?fields=parents'),
      ).toBe('drive.files.get');
    });
  });

  describe('Sheets API', () => {
    test(':append → sheets.values.append', () => {
      expect(
        apiNameFromEndpoint(
          'https://sheets.googleapis.com/v4/spreadsheets/SID/values/Evidence%21A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
        ),
      ).toBe('sheets.values.append');
    });

    test(':batchGet → sheets.values.batchGet', () => {
      expect(
        apiNameFromEndpoint(
          'https://sheets.googleapis.com/v4/spreadsheets/SID/values:batchGet?ranges=Documents%21A2:A',
        ),
      ).toBe('sheets.values.batchGet');
    });

    test('values:batchUpdate → sheets.values.batchUpdate（batchUpdateRows）', () => {
      expect(
        apiNameFromEndpoint('https://sheets.googleapis.com/v4/spreadsheets/SID/values:batchUpdate'),
      ).toBe('sheets.values.batchUpdate');
    });

    test('{spreadsheetId}:batchUpdate → sheets.spreadsheets.batchUpdate（addSheetTab）', () => {
      expect(apiNameFromEndpoint('https://sheets.googleapis.com/v4/spreadsheets/SID:batchUpdate')).toBe(
        'sheets.spreadsheets.batchUpdate',
      );
    });

    test('values/{range}（valueInputOption あり）→ sheets.values.update（updateRow / writeHeaderRow）', () => {
      expect(
        apiNameFromEndpoint(
          'https://sheets.googleapis.com/v4/spreadsheets/SID/values/StudyData%21A1?valueInputOption=RAW',
        ),
      ).toBe('sheets.values.update');
    });

    test('values/{range}（valueInputOption なし）→ sheets.values.get（getSheetValues）', () => {
      expect(
        apiNameFromEndpoint('https://sheets.googleapis.com/v4/spreadsheets/SID/values/StudyData'),
      ).toBe('sheets.values.get');
    });

    test('/v4/spreadsheets（id なし）→ sheets.spreadsheets.create', () => {
      expect(apiNameFromEndpoint('https://sheets.googleapis.com/v4/spreadsheets')).toBe(
        'sheets.spreadsheets.create',
      );
    });

    test('/v4/spreadsheets/{id}（id のみ）→ sheets.spreadsheets.get（getSheetTitles）', () => {
      expect(
        apiNameFromEndpoint(
          'https://sheets.googleapis.com/v4/spreadsheets/SID?fields=sheets.properties.title',
        ),
      ).toBe('sheets.spreadsheets.get');
    });
  });
});
