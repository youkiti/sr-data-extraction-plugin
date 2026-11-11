import type { DocumentRecord } from '../../../../src/domain/document';
import { preparePreviewCheck } from '../../../../src/features/documents/preparePreviewCheck';

const doc = (documentId: string, textStatus: DocumentRecord['textStatus'] = 'ok'): DocumentRecord => ({
  documentId, filename: `${documentId}.pdf`, textStatus,
} as DocumentRecord);

test('確認時の警告と本文を返し、実行の再読込と同時呼出しもメモ化する', async () => {
  const pages = [{ page: 1, text: '本文\nPREVIEW' }, { page: 2, text: '本文\nPREVIEW' }];
  const load = jest.fn().mockResolvedValue(pages);
  const check = await preparePreviewCheck([doc('a'), doc('a'), doc('scan', 'no_text_layer')], load);
  expect(check.warnings[0]).toMatchObject({ kind: 'preview_pdf', documentId: 'a', filename: 'a.pdf' });
  expect(check.warnings[0]?.message).toContain('結果の章');
  expect(await check.loadDocumentPages('a')).toBe(pages);
  await Promise.all([check.loadDocumentPages('b'), check.loadDocumentPages('b')]);
  expect(load.mock.calls).toEqual([['a'], ['b']]);
});

test('通常文献は警告しない', async () => {
  const check = await preparePreviewCheck([doc('a')], jest.fn().mockResolvedValue([{ page: 1, text: '本文' }]));
  expect(check.warnings).toEqual([]);
});

test('読込失敗は判定せず他文書の警告を返し、失敗した文書は再読込する', async () => {
  const pages = [{ page: 1, text: 'PREVIEW' }, { page: 2, text: 'PREVIEW' }];
  const load = jest.fn((id: string) => id === 'failed'
    ? Promise.reject(new Error('読込失敗'))
    : Promise.resolve(pages));
  const check = await preparePreviewCheck([doc('failed'), doc('ok')], load);
  expect(check.warnings.map((warning) => warning.documentId)).toEqual(['ok']);
  await expect(check.loadDocumentPages('failed')).rejects.toThrow('読込失敗');
  await expect(check.loadDocumentPages('failed')).rejects.toThrow('読込失敗');
  expect(load.mock.calls).toEqual([['failed'], ['ok'], ['failed'], ['failed']]);
});

test('同時読込は最大4本で、完了順にかかわらず警告を文書順に返す', async () => {
  const pending = new Map<string, () => void>();
  const started = new Map<string, () => void>();
  const loading = Array.from({ length: 9 }, (_, i) => new Promise<void>((resolve) => {
    started.set(String(i), resolve);
  }));
  let active = 0;
  let maximum = 0;
  const pages = [{ page: 1, text: 'PREVIEW' }, { page: 2, text: 'PREVIEW' }];
  const load = jest.fn((id: string) => new Promise<typeof pages>((resolve) => {
    active += 1;
    maximum = Math.max(maximum, active);
    pending.set(id, () => {
      active -= 1;
      resolve(pages);
    });
    started.get(id)!();
  }));
  const result = preparePreviewCheck(Array.from({ length: 9 }, (_, i) => doc(String(i))), load);
  await Promise.resolve();
  expect(load).toHaveBeenCalledTimes(4);
  for (const id of ['3', '2', '1', '0', '7', '6', '5', '4', '8']) {
    await loading[Number(id)];
    pending.get(id)!();
  }
  const check = await result;
  expect(maximum).toBe(4);
  expect(active).toBe(0);
  expect(check.warnings.map((warning) => warning.documentId)).toEqual(
    Array.from({ length: 9 }, (_, i) => String(i)),
  );
});

test('対象が空なら読込しない', async () => {
  const load = jest.fn();
  expect((await preparePreviewCheck([], load)).warnings).toEqual([]);
  expect(load).not.toHaveBeenCalled();
});
