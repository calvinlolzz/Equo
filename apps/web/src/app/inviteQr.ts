import qrcode from "qrcode-generator";

/**
 * QR encoding for the invite sheet, kept apart from the component so the grid
 * can be asserted in a test without a DOM.
 *
 * Type number 0 lets the library pick the smallest version that fits, and "M"
 * (~15% recovery) is the usual trade for a code that is displayed on a bright
 * phone screen and scanned from a few centimetres away — "H" would survive more
 * damage at the cost of a denser grid, which is the wrong trade here.
 */
export function buildQrModules(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const rows: boolean[][] = [];
  for (let row = 0; row < count; row += 1) {
    const cells: boolean[] = [];
    for (let col = 0; col < count; col += 1) {
      cells.push(qr.isDark(row, col));
    }
    rows.push(cells);
  }
  return rows;
}

/**
 * One SVG path covering every dark module, as 1x1 squares in module space.
 *
 * A single <path> rather than a <rect> per module: a version-5 code is ~1400
 * elements, and React reconciling that many nodes is visible on a mid-range
 * phone. Horizontal runs are merged into one rectangle each, which roughly
 * halves the path length again.
 */
export function buildQrPath(modules: boolean[][]): string {
  const parts: string[] = [];
  modules.forEach((row, y) => {
    let runStart = -1;
    for (let x = 0; x <= row.length; x += 1) {
      const dark = x < row.length && row[x];
      if (dark && runStart < 0) {
        runStart = x;
      } else if (!dark && runStart >= 0) {
        parts.push(`M${runStart} ${y}h${x - runStart}v1h-${x - runStart}z`);
        runStart = -1;
      }
    }
  });
  return parts.join("");
}
