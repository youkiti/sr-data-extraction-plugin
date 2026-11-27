import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { benchRoot, selectedTiers } from './config';
import { inputRoot, loadEvaluation } from './io';
import { cleanFootnotes } from './schema';
import { safeError } from './cost';

try {
  const set = await loadEvaluation(await inputRoot());
  const rows = set.values.filter((value) => value.needsRecheck).map((value) => {
    const study = set.studies.find((study) => study.studyKey === value.studyKey)!;
    const item = study.items[value.itemIndex - 1]!;
    const passedDocIds = set.documents.get(value.studyKey)!.map((doc) => doc.pmcid);
    return { tier: value.tier, studyKey: value.studyKey, rowId: value.rowId, field: value.field,
      item: { ...item, footnotes: cleanFootnotes(item.footnotes ?? '') }, gold: value.gold, upstreamLabel: value.upstreamLabel,
      passedDocIds, omittedDocIds: study.task.documents.map((doc) => doc.pmcid).filter((id) => !passedDocIds.includes(id)) };
  });
  const dir = path.join(benchRoot, 'outputs');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'recheck-needed.jsonl'), rows.map((row) => JSON.stringify(row) + '\n').join(''), 'utf8');
  for (const tier of selectedTiers()) {
    console.log(`${tier}: ${rows.filter((row) => row.tier === tier).length}`);
    for (const label of ['reported', 'derivable']) {
      console.log(`${tier} / ${label}: ${rows.filter((row) => row.tier === tier && row.upstreamLabel === label).length}`);
    }
  }
} catch (error) { console.error(safeError(error)); process.exitCode = 1; }
