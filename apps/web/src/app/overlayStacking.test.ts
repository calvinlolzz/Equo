import { describe, expect, test } from "vitest";
import { readAppStylesheet, ruleFor } from "./cssDeclarations";

/**
 * A composer opened FROM a detail that is stacked over the records sheet
 * (編輯, 重複這筆, the N shortcut) has to paint OVER that records backdrop
 * even though .composer-backdrop's own z-index is otherwise below a plain
 * .modal-backdrop. See App.tsx's data-covered="composer" and the CSS rule
 * it drives.
 */

const dialogsCss = readAppStylesheet("app-dialogs.css");

describe("overlay stacking", () => {
  // [MV]
  test("a covered records backdrop drops below the composer", () => {
    const covered = Number(ruleFor(dialogsCss, '.modal-backdrop[data-covered="composer"]')["z-index"]);
    const composer = Number(ruleFor(dialogsCss, ".composer-backdrop")["z-index"]);
    expect(covered).toBeLessThan(composer);
  });

  test("an uncovered records backdrop still sits above the composer", () => {
    const plain = Number(ruleFor(dialogsCss, ".modal-backdrop")["z-index"]);
    const composer = Number(ruleFor(dialogsCss, ".composer-backdrop")["z-index"]);
    expect(plain).toBeGreaterThan(composer);
  });
});
