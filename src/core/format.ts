/** Signed number with an explicit + and a real minus sign. */
export function signed(v: number, digits: number) {
  const r = Number(v.toFixed(digits));
  if (r === 0) return '±' + (0).toFixed(digits);
  return (r > 0 ? '+' : '−') + Math.abs(r).toFixed(digits);
}

export const fixed = (v: number, digits: number) => v.toFixed(digits).replace('-', '−');

export const pct = (v: number, digits = 1) => (v * 100).toFixed(digits) + '%';
