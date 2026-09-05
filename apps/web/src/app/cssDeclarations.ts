import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolved once, from this module rather than cwd, so the suite does not care
 * which directory it was started from.
 *
 * Built with `path`, NOT `new URL("./styles/" + name, import.meta.url)`: Vite
 * claims that shape as its dynamic-asset syntax and rewrites it, and what came
 * back under Vitest was this module's own source text - a "stylesheet" with no
 * rules in it, so every declaration lookup returned nothing and the assertions
 * phrased as `not.toContain` passed on the emptiness.
 */
const APP_DIR = dirname(fileURLToPath(import.meta.url));

/** Read a file from the web app's tree, by path segments relative to src/app. */
export function readAppFile(...segments: string[]): string {
  return readFileSync(join(APP_DIR, ...segments), "utf8");
}

/**
 * Read a stylesheet the suite wants to make assertions about.
 *
 * Read off disk, not imported. `import css from "./x.css?raw"` looks like the
 * idiomatic way and is a trap here: Vitest stubs CSS imports (css: false), so
 * the `?raw` suffix is swallowed and the import resolves to an EMPTY STRING. A
 * test written on top of that parses nothing, finds nothing, and - depending on
 * how it is phrased - can pass.
 *
 * Test-only, but it lives beside the code because it reads that code's files.
 */
export function readAppStylesheet(fileName: string): string {
  const css = readAppFile("styles", fileName);

  // Both ways this has gone wrong so far end in a string that is perfectly
  // readable and simply is not CSS. Fail here rather than let a test assert
  // against an empty rule set.
  if (!css.includes("{")) throw new Error(`${fileName} was read but contains no CSS rules`);

  return css;
}

/**
 * The CSS inside a document's <style> elements.
 *
 * Needed before asking `ruleFor` anything about a stylesheet that lives in an
 * HTML file: the flat scan reads a rule's selector as everything since the
 * previous `}`, so for the FIRST rule in the file that is the entire document
 * head - and the rule is silently invisible. Everything after it parses fine,
 * which makes this a trap you only hit on one rule out of twenty.
 */
export function styleBlocks(html: string): string {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(([, css]) => css ?? "").join("\n");
}

export type Declarations = Record<string, string>;

/** Everything from the opening brace at `open` to its matching close. */
function blockEnd(css: string, open: number): number {
  let depth = 0;

  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return css.length;
}

/**
 * The stylesheet minus every at-rule block.
 *
 * Without this a class that is also mentioned under `@media (prefers-reduced-
 * motion)` reports the override as its base value - `transition: none` for a
 * rule whose whole point is the transition - because the flat scan below has no
 * idea it walked into a nested block. Ask for those deliberately, with
 * `insideAtRule`.
 */
function topLevelRules(css: string): string {
  let kept = "";
  let index = 0;

  while (index < css.length) {
    const at = css.indexOf("@", index);
    if (at === -1) return kept + css.slice(index);

    const open = css.indexOf("{", at);
    const statementEnd = css.indexOf(";", at);
    kept += css.slice(index, at);

    // A statement at-rule (@import, @charset) has no block to skip.
    if (open === -1 || (statementEnd !== -1 && statementEnd < open)) {
      index = statementEnd === -1 ? css.length : statementEnd + 1;
      continue;
    }

    index = blockEnd(css, open) + 1;
  }

  return kept;
}

/**
 * Every declaration that applies to one selector, in file order.
 *
 * Deliberately exact-match, whitespace and all: `.record-dialog-row:active` and
 * `.record-swipe > .record-dialog-row` are different rules with different jobs,
 * and folding them in would hide the base rule going missing.
 */
export function ruleFor(css: string, selector: string): Declarations {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = topLevelRules(withoutComments).matchAll(/([^{}]+)\{([^{}]*)\}/g);
  const merged: Declarations = {};

  for (const [, selectorText, body] of blocks) {
    const selectors = (selectorText ?? "").split(",").map((entry) => entry.trim().replace(/\s+/g, " "));
    if (!selectors.includes(selector)) continue;

    for (const declaration of (body ?? "").split(";")) {
      const separator = declaration.indexOf(":");
      if (separator === -1) continue;
      merged[declaration.slice(0, separator).trim()] = declaration.slice(separator + 1).trim();
    }
  }

  return merged;
}

/** `ruleFor` for the common case of a bare class. */
export function declarationsFor(css: string, className: string): Declarations {
  return ruleFor(css, `.${className}`);
}

/**
 * The body of one @keyframes block, for asking what it actually animates.
 */
export function keyframesBody(css: string, name: string): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const match = new RegExp(String.raw`@keyframes\s+${name}\s*\{`).exec(withoutComments);
  if (!match) return "";

  const open = match.index + match[0].length - 1;
  return withoutComments.slice(open + 1, blockEnd(withoutComments, open));
}

/**
 * The bodies of every at-rule whose prelude contains `query` - e.g. the
 * reduced-motion blocks. Returned as text for `declarationsFor` to read, so an
 * override can be checked without the base rules bleeding in.
 */
export function insideAtRule(css: string, query: string): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const bodies: string[] = [];

  for (const match of withoutComments.matchAll(/@media([^{]*)\{/g)) {
    if (!(match[1] ?? "").includes(query)) continue;

    const open = (match.index ?? 0) + match[0].length - 1;
    bodies.push(withoutComments.slice(open + 1, blockEnd(withoutComments, open)));
  }

  return bodies.join("\n");
}
