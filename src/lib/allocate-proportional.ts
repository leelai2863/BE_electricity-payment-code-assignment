/**
 * Chia `total` theo tỷ lệ `weights`, làm tròn xuống từng phần và phân phối phần dư cho các dòng có phần thập phân lớn nhất.
 */
export function allocateProportionalInt(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const safeTotal = Math.max(0, Math.trunc(total));
  if (safeTotal === 0) return weights.map(() => 0);

  const sumW = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (sumW <= 0) return weights.map(() => 0);

  const raw = weights.map((w) => (safeTotal * Math.max(0, w)) / sumW);
  const floors = raw.map((x) => Math.floor(x));
  let remainder = safeTotal - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac)
    .map((x) => x.i);

  let k = 0;
  while (remainder > 0 && order.length > 0) {
    floors[order[k % order.length]] += 1;
    remainder -= 1;
    k += 1;
  }
  return floors;
}
