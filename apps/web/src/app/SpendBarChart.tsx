import { useMemo } from "react";
import { formatAmount } from "./formatAmount";
import {
  buildSpendChart,
  roundedBarPath,
  type SpendByDayEntry,
  type SpendChartDay,
} from "./spendChart";

/**
 * 近 8 日支出 bar chart for the analysis panel. Single series, so identity
 * comes from the section title - no legend. The selected day (shared with
 * the home view's date chips via selectedKey/onSelect) gets a direct value
 * label; every band is a full-width tap target with a native tooltip.
 * Bar color #2aa77b: the app's mint accent snapped one step darker to pass
 * the dark-surface lightness/contrast checks (dataviz validator, surface
 * #14201d).
 */
const BAR_COLOR = "#2aa77b";
const BAR_COLOR_MUTED = "rgba(42, 167, 123, 0.45)";
const INK_MUTED = "rgba(247, 251, 248, 0.55)";
const INK = "rgba(247, 251, 248, 0.92)";
const BASELINE = "rgba(247, 251, 248, 0.16)";

type SpendBarChartProps = {
  days: SpendChartDay[];
  spendByDay: SpendByDayEntry[];
  currency: string;
  selectedKey: string;
  onSelect: (key: string) => void;
  emptyText: string;
};

export function SpendBarChart({ days, spendByDay, currency, selectedKey, onSelect, emptyText }: SpendBarChartProps) {
  const layout = useMemo(() => buildSpendChart(days, spendByDay), [days, spendByDay]);

  if (layout.maxMinor === 0) {
    return <p className="dialog-empty">{emptyText}</p>;
  }

  const selectedBar = layout.bars.find((bar) => bar.key === selectedKey);

  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width="100%"
      role="img"
      aria-label={layout.bars
        .filter((bar) => bar.totalMinor > 0)
        .map((bar) => `${bar.label} ${formatAmount(bar.totalMinor, currency)}`)
        .join("、")}
      style={{ display: "block" }}
    >
      <line x1={0} y1={layout.plotBottom} x2={layout.width} y2={layout.plotBottom} stroke={BASELINE} strokeWidth={1} />
      {layout.bars.map((bar) => {
        const selected = bar.key === selectedKey;
        return (
          <g
            key={bar.key}
            onClick={() => onSelect(bar.key)}
            style={{ cursor: "pointer" }}
            role="button"
            aria-label={`${bar.label} ${formatAmount(bar.totalMinor, currency)}`}
          >
            <title>{`${bar.label}：${formatAmount(bar.totalMinor, currency)}`}</title>
            {/* Invisible full-band hit target - taps land even on short bars. */}
            <rect x={bar.bandX} y={0} width={bar.bandWidth} height={layout.height} fill="transparent" />
            {bar.barHeight > 0 && (
              <path d={roundedBarPath(bar, layout.plotBottom)} fill={selected ? BAR_COLOR : BAR_COLOR_MUTED} />
            )}
            <text
              x={bar.centerX}
              y={layout.plotBottom + 15}
              textAnchor="middle"
              fontSize={10}
              fill={selected ? INK : INK_MUTED}
            >
              {bar.label}
            </text>
          </g>
        );
      })}
      {selectedBar && selectedBar.totalMinor > 0 && (
        <text
          x={Math.min(Math.max(selectedBar.centerX, 28), layout.width - 28)}
          y={selectedBar.yTop - 8}
          textAnchor="middle"
          fontSize={11}
          fontWeight={600}
          fill={INK}
        >
          {formatAmount(selectedBar.totalMinor, currency)}
        </text>
      )}
    </svg>
  );
}
