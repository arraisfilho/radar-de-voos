// Prices are integer cents. Tick spacing never rounds distinct ticks to one label.
export function priceAxis(values: number[]) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length)
    return { low: 0, high: 400, ticks: [0, 100, 200, 300, 400] };
  const min = Math.min(...finite),
    max = Math.max(...finite);
  const padding = Math.max(200, (max - min || max * 0.1) * 0.1);
  const from = Math.max(0, min - padding),
    to = max + padding;
  const rough = Math.max(100, (to - from) / 4),
    power = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(
    100,
    ([1, 2, 5, 10].find((n) => n * power >= rough) || 10) * power,
  );
  const low = Math.floor(from / step) * step,
    high = Math.max(low + step, Math.ceil(to / step) * step);
  const ticks = Array.from(
    { length: Math.round((high - low) / step) + 1 },
    (_, i) => low + i * step,
  );
  return { low, high, ticks };
}

export function visiblePricePoints<T extends { price: number | null }>(
  points: T[],
) {
  return points.filter(
    (p, i) =>
      i === 0 ||
      i === points.length - 1 ||
      p.price !== points[i - 1].price ||
      p.price !== points[i + 1].price,
  );
}
