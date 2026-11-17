import { readCurrentOutcomeList } from '../../../../src/app/services/outcomeListService';
import { readAllSchemaOutcomes } from '../../../../src/features/schema/schemaOutcomeRepository';
import { listSchemaVersions } from '../../../../src/features/schema/schemaRepository';
import type { SchemaOutcome } from '../../../../src/domain/schemaOutcome';
import type { SchemaVersion } from '../../../../src/domain/schemaVersion';

jest.mock('../../../../src/features/schema/schemaOutcomeRepository');
jest.mock('../../../../src/features/schema/schemaRepository');

test('最新確定版の一覧を一度だけ読み、run の版を使わない', async () => {
  jest.mocked(readAllSchemaOutcomes).mockResolvedValue([{ aliases: [] as string[], schemaVersion: 2, outcomeId: 'pain' } as SchemaOutcome]);
  jest.mocked(listSchemaVersions).mockResolvedValue([3, 2, 1].map((schemaVersion) => ({ schemaVersion } as SchemaVersion)));
  const google = { fetch: jest.fn(), getAccessToken: jest.fn() };
  expect((await readCurrentOutcomeList('sheet', google))?.currentIds).toEqual(new Set(['pain']));
  expect(readAllSchemaOutcomes).toHaveBeenCalledTimes(1);
  expect(listSchemaVersions).toHaveBeenCalledTimes(1);
});

test('確定版も一覧も無い旧プロジェクトは論文単位モードになる', async () => {
  jest.mocked(readAllSchemaOutcomes).mockResolvedValue([]);
  jest.mocked(listSchemaVersions).mockResolvedValue([]);
  expect(await readCurrentOutcomeList('sheet', { fetch: jest.fn(), getAccessToken: jest.fn() })).toBeNull();
});
