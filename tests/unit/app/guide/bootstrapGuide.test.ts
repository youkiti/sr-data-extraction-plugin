import { bootstrapApp } from '../../../../src/app/bootstrap';
import { initGuide } from '../../../../src/app/guide';
import { installChromeMock } from '../../../setup/chrome-mock';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

jest.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: jest.fn() }));
jest.mock('../../../../src/app/guide', () => ({ initGuide: jest.fn() }));

test('ツアー初期化の失敗でも起動を続け、ナビに対象属性を付ける', async () => {
  installChromeMock();
  document.documentElement.innerHTML = readFileSync(join(process.cwd(), 'src/app/app.html'), 'utf8');
  const error = new Error('ツアーの読込失敗');
  jest.mocked(initGuide).mockRejectedValue(error);
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const win = { document, location: { hash: '#/home' }, addEventListener: jest.fn() } as unknown as Window;
  const store = await bootstrapApp(win);
  expect(store).not.toBeNull();
  expect(initGuide).toHaveBeenCalledWith({ store, win, doc: document });
  expect(warn).toHaveBeenCalledWith('[guide] 起動に失敗:', error);
  expect(document.querySelector('[href="#/documents"]')!.getAttribute('data-tour')).toBe('nav-documents');
  warn.mockRestore();
});
