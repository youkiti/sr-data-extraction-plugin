import { goldLockPath } from './config';
import { inputRoot, loadEvaluation, writeJson } from './io';
import { assertLabels, goldHashes } from './goldLock';
import { safeError } from './cost';
import { loadRecheck } from './recheck';

try {
  const root = await inputRoot();
  const set = await loadEvaluation(root);
  assertLabels(set.values);
  const lock = await goldHashes(root);
  lock.recheckLabelsSha256 = (await loadRecheck(set.values)).hash;
  await writeJson(goldLockPath(), lock);
  for (const [file, hash] of Object.entries(lock.hashes)) console.log(`${file}\t${hash}`);
  console.log(`taskDigest\t${lock.taskDigest}`);
} catch (error) { console.error(safeError(error)); process.exitCode = 1; }
