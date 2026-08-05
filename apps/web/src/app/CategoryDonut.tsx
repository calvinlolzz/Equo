import { formatAmount } from "./formatAmount";
// The palette used to be a map in this file, which meant a category added in
// the console had no colour until somebody remembered to come back here. It is
// a column on the category row now.
import { categoryColor, categoryLabel } from "./catalog";

const R = 54;
const STROKE = 18;
const CIRC = 2 * Math.PI * R;

/**
 * 分類佔比 donut (mirrors the demo's analysis view): a ring of category arcs
 * with the total in the middle, plus a legend of colour / label / share% /
 * amount. Renders nothing when there is no spend.
 */
export function CategoryDonut({
  entries,
  currency,
}: {
  entries: Array<{ category: string; totalMinor: number }>;
  currency: string;
}) {
  const total = entries.reduce((sum, entry) => sum + entry.totalMinor, 0);
  if (total <= 0) return null;

  const sorted = [...entries].sort((a, b) => b.totalMinor - a.totalMinor);
  let offset = 0;
  const segments = sorted.map((entry) => {
    const frac = entry.totalMinor / total;
    const segment = {
      ...entry,
      frac,
      color: categoryColor(entry.category),
      length: frac * CIRC,
      offset,
    };
    offset += frac * CIRC;
    return segment;
  });

  return (
    <div className="category-donut">
      <svg viewBox="0 0 140 140" className="category-donut-svg" role="img" aria-label="分類佔比">
        <circle className="category-donut-track" cx="70" cy="70" r={R} fill="none" strokeWidth={STROKE} />
        {segments.map((segment) => (
          <circle
            key={segment.category}
            cx="70"
            cy="70"
            r={R}
            fill="none"
            stroke={segment.color}
            strokeWidth={STROKE}
            strokeDasharray={`${segment.length} ${CIRC - segment.length}`}
            strokeDashoffset={-segment.offset}
            transform="rotate(-90 70 70)"
          />
        ))}
        <text x="70" y="67" textAnchor="middle" className="category-donut-total">
          {formatAmount(total, currency)}
        </text>
        <text x="70" y="85" textAnchor="middle" className="category-donut-sub">
          {`${entries.length} 類`}
        </text>
      </svg>
      <ul className="category-legend">
        {segments.map((segment) => (
          <li key={segment.category}>
            <i style={{ background: segment.color }} aria-hidden="true" />
            <span>{categoryLabel(segment.category)}</span>
            <em>{Math.round(segment.frac * 100)}%</em>
            <strong>{formatAmount(segment.totalMinor, currency)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
