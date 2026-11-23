export function normalizeWeightPrices(value) {
  if (typeof value === 'string') value = [value];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) return value;

  return [...new Set(value)]
    .flatMap((entry) => entry.split(','))
    .map((entry) => {
      const [weight, price] = entry.split(':').map((part) => part.trim());
      return weight && price ? { weight, price: Number(price) } : null;
    })
    .filter((entry) => entry && Number.isFinite(entry.price));
}
