import { goldLockPath } from './config';
import { inputRoot, loadEvaluation, writeJson } from './io';
import { assertLabels, goldHashes } from './goldLock';
import { safeError } from './cost';

try {
  const root = await inputRoot();
  const set = await loadEvaluation(root);
  assertLabels(set.values);
  const lock = await goldHashes(root);
  await writeJson(goldLockPath(), lock);
  for (const [file, hash] of Object.entries(lock.hashes)) console.log(`${file}\t${hash}`);
  console.log(`taskDigest\t${lock.taskDigest}`);
} catch (error) { console.error(safeError(error)); process.exitCode = 1; }
