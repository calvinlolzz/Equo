// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import {
  DEFAULT_CATALOG,
  FALLBACK_CATEGORY_COLOR,
  categoryColor,
  categoryLabel,
  categoryOptions,
  currencyOptions,
  hydrateCatalog,
  resetCatalog,
  restoreCatalog,
} from "./catalog";

afterEach(() => {
  resetCatalog();
  window.localStorage.clear();
});

describe("the catalog", () => {
  test("starts as what the bundle shipped", () => {
    expect(categoryOptions()).toEqual(DEFAULT_CATALOG.categories);
    expect(currencyOptions()).toEqual(DEFAULT_CATALOG.currencies);
  });

  test("adopts what the server sent, in the order it sent it", () => {
    hydrateCatalog({
      categories: [
        { key: "medical", label: "醫療", color: "#AA1122" },
        { key: "food", label: "吃飯", color: "#F0885A" },
      ],
      currencies: [{ code: "SGD", label: "新加坡幣" }],
    });

    expect(categoryOptions().map((entry) => entry.key)).toEqual(["medical", "food"]);
    // The label an admin changed wins over the one in the bundle.
    expect(categoryLabel("food")).toBe("吃飯");
    expect(currencyOptions()).toEqual([{ code: "SGD", label: "新加坡幣" }]);
  });

  test("an expense filed under a category that no longer exists still renders", () => {
    hydrateCatalog({ categories: [{ key: "food", label: "餐飲", color: "#F0885A" }], currencies: [{ code: "TWD", label: "新台幣" }] });

    // Its own key beats a blank, and the donut gets a colour rather than
    // undefined.
    expect(categoryLabel("lodging")).toBe("lodging");
    expect(categoryColor("lodging")).toBe(FALLBACK_CATEGORY_COLOR);
  });

  test("a malformed or empty payload is ignored rather than emptying the picker", () => {
    hydrateCatalog({ categories: [], currencies: [] });
    expect(categoryOptions()).toEqual(DEFAULT_CATALOG.categories);

    hydrateCatalog(null);
    hydrateCatalog({ categories: "nope" });
    expect(categoryOptions()).toEqual(DEFAULT_CATALOG.categories);
  });

  test("what was learned survives a cold start, so the first paint is not the bundle's", () => {
    hydrateCatalog({
      categories: [{ key: "medical", label: "醫療", color: "#AA1122" }],
      currencies: [{ code: "SGD", label: "新加坡幣" }],
    });

    resetCatalog();
    expect(categoryLabel("medical")).toBe("medical");

    restoreCatalog();
    expect(categoryLabel("medical")).toBe("醫療");
  });

  test("a category with no colour falls back rather than rendering as transparent", () => {
    hydrateCatalog({
      categories: [{ key: "medical", label: "醫療", color: "" }],
      currencies: [{ code: "TWD", label: "新台幣" }],
    });

    expect(categoryColor("medical")).toBe(FALLBACK_CATEGORY_COLOR);
  });
});
