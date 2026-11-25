import { BOOTSTRAP } from './config';
import { sensitivity, type ScoredValue } from './score';

export function mulberry32(seed: number): () => number {
  return () => {
    let t = seed += 0x6d2b79f5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function quantile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  return sorted[lower]! + (sorted[Math.ceil(index)]! - sorted[lower]!) * (index - lower);
}
export function bootstrap(models: string[], rowsByModel: Map<string, ScoredValue[]>, options = BOOTSTRAP) {
  const base = rowsByModel.get(models[0]!) ?? [];
  const reviews = [...new Set(base.map((row) => row.reviewId))].sort();
  const studies = new Map(reviews.map((review) => [review, [...new Set(base.filter((row) => row.reviewId === review).map((row) => row.studyKey))].sort()]));
  const counts = new Map(models.map((model) => {
    const byStudy = new Map<string, { matched: number; reported: number }>();
    for (const row of rowsByModel.get(model) ?? []) {
      const previous = byStudy.get(row.studyKey) ?? { matched: 0, reported: 0 };
      if (row.label === 'reported') { previous.reported++; if (row.answer.state === 'match') previous.matched++; }
      byStudy.set(row.studyKey, previous);
    }
    return [model, byStudy];
  }));
  const random = mulberry32(options.seed);
  const samples = new Map(models.map((model) => [model, [] as number[]]));
  const differences: number[] = [];
  const differenceSamples = new Map(models.slice(1).map((model) => [model, [] as number[]]));
  let omittedReviewDraws = 0;
  for (let replicate = 0; replicate < options.replicates; replicate++) {
    const sums = models.map(() => 0);
    let used = 0;
    for (let draw = 0; draw < reviews.length; draw++) {
      const review = reviews[Math.floor(random() * reviews.length)]!;
      const pool = studies.get(review)!;
      const totals = models.map(() => ({ matched: 0, reported: 0 }));
      for (let s = 0; s < pool.length; s++) {
        const study = pool[Math.floor(random() * pool.length)]!;
        models.forEach((model, index) => {
          const count = counts.get(model)!.get(study)!;
          totals[index]!.matched += count.matched; totals[index]!.reported += count.reported;
        });
      }
      if (!totals[0]?.reported) { omittedReviewDraws++; continue; }
      used++;
      totals.forEach((total, index) => { sums[index]! += total.matched / total.reported; });
    }
    if (used) {
      models.forEach((model, index) => samples.get(model)!.push(sums[index]! / used));
      if (models.length >= 2) differences.push((sums[1]! - sums[0]!) / used);
      models.slice(1).forEach((model, index) => differenceSamples.get(model)!.push((sums[index + 1]! - sums[0]!) / used));
    }
  }
  const interval = (point: number | null, values: number[]) => ({ point, lower: quantile(values, 0.025), upper: quantile(values, 0.975) });
  const results = Object.fromEntries(models.map((model) => [model, interval(sensitivity(rowsByModel.get(model) ?? []).primary, samples.get(model)!)]));
  const first = results[models[0]!]?.point, second = results[models[1]!]?.point;
  const difference = models.length >= 2 ? interval(first != null && second != null ? second - first : null, differences) : null;
  // 対応差は最初のモデル（既定の Gemini 3.8 Flash）を基準に、2番目以降の各モデルから引く（2026-11-25 本人の決定）。`difference` は従来どおり 2番目 − 最初.
  const pairedDifferences = Object.fromEntries(models.slice(1).map((model) => {
    const point = results[model]!.point;
    const paired = interval(first != null && point != null ? point - first : null, differenceSamples.get(model)!);
    return [model, { base: models[0]!, ...paired, crossesZero: paired.lower !== null && paired.upper !== null ? paired.lower <= 0 && paired.upper >= 0 : null }];
  }));
  return { models: results, difference: difference ? { ...difference, crossesZero: difference.lower !== null && difference.upper !== null ? difference.lower <= 0 && difference.upper >= 0 : null } : null,
    differences: pairedDifferences,
    omittedReviewDraws, emptyReplicates: options.replicates - (samples.get(models[0]!)?.length ?? 0), ...options };
}
