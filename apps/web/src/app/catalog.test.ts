// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import {
  DEFAULT_CATALOG,
  FALLBACK_CATEGORY_COLOR,
  categoryColor,
  categoryLabel,
  categoryOptions,
  categoryOptionsFor,
  currencyOptions,
  defaultCategoryKey,
  hydrateCatalog,
  normalizeScope,
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

describe("normalizeScope", () => {
  test("passes through the two non-default scopes", () => {
    expect(normalizeScope("personal")).toBe("personal");
    expect(normalizeScope("income")).toBe("income");
  });

  test("anything else - missing, unrecognised, or the wrong type - becomes shared", () => {
    expect(normalizeScope("shared")).toBe("shared");
    expect(normalizeScope(undefined)).toBe("shared");
    expect(normalizeScope(null)).toBe("shared");
    expect(normalizeScope("")).toBe("shared");
    expect(normalizeScope("PERSONAL")).toBe("shared");
    expect(normalizeScope(42)).toBe("shared");
  });
});

describe("scope normalization on the way in", () => {
  test("a server response with no scope field hydrates every category as shared", () => {
    hydrateCatalog({
      categories: [{ key: "medical", label: "醫療", color: "#AA1122" }],
      currencies: [{ code: "TWD", label: "新台幣" }],
    });

    expect(categoryOptions()).toEqual([{ key: "medical", label: "醫療", color: "#AA1122", scope: "shared" }]);
  });

  test("a stored copy from before this client shipped is normalized on restore, not just on hydrate", () => {
    window.localStorage.setItem(
      "equo.clean.catalog",
      JSON.stringify({
        categories: [{ key: "medical", label: "醫療", color: "#AA1122" }],
        currencies: [{ code: "TWD", label: "新台幣" }],
      }),
    );

    resetCatalog();
    const restored = restoreCatalog();

    expect(restored.categories).toEqual([{ key: "medical", label: "醫療", color: "#AA1122", scope: "shared" }]);
  });
});

describe("categoryOptionsFor", () => {
  test("a shared group only ever offers shared categories", () => {
    const keys = categoryOptionsFor({ personal: false }).map((entry) => entry.key);

    expect(keys).toEqual(["food", "transport", "lodging", "shopping", "general", "other"]);
  });

  test("a personal ledger recording an expense offers shared AND personal categories, never income", () => {
    const keys = categoryOptionsFor({ personal: true, mode: "expense" }).map((entry) => entry.key);

    expect(keys).toEqual(
      expect.arrayContaining(["food", "general", "entertainment", "home", "bills", "health", "education"]),
    );
    expect(keys).not.toEqual(expect.arrayContaining(["salary"]));
  });

  test("a personal ledger recording income offers only income categories", () => {
    const keys = categoryOptionsFor({ personal: true, mode: "income" }).map((entry) => entry.key);

    expect(keys).toEqual(["salary", "bonus", "investment", "other_income"]);
  });

  // [MV]
  test("a server catalog with NO scope field at all falls back to the bundled income defaults", () => {
    // Simulates an old server (pre category_scope) or a stale stored copy:
    // every raw entry is missing `scope` outright, so this source says
    // nothing about what an admin actually wants for income - the personal
    // ledger's income picker must not come back empty.
    hydrateCatalog({
      categories: [{ key: "food", label: "餐飲", color: "#F0885A" }],
      currencies: [{ code: "TWD", label: "新台幣" }],
    });

    const keys = categoryOptionsFor({ personal: true, mode: "income" }).map((entry) => entry.key);

    expect(keys).toEqual(["salary", "bonus", "investment", "other_income"]);
  });

  // [MV]
  test("a server catalog that DOES carry scope, with every income category disabled, does NOT resurrect the bundled ones", () => {
    // Every entry carries a real `scope` (even "shared" ones do, on a modern
    // server) - an empty match here means an admin genuinely disabled every
    // income category, not that scope data is missing. Falling back to
    // DEFAULT_CATALOG's bundled income rows would bring a disabled category
    // back from the dead.
    hydrateCatalog({
      categories: [{ key: "food", label: "餐飲", color: "#F0885A", scope: "shared" }],
      currencies: [{ code: "TWD", label: "新台幣" }],
    });

    const keys = categoryOptionsFor({ personal: true, mode: "income" }).map((entry) => entry.key);

    // Not empty outright - a composer draft always needs SOME category to
    // select - but only the one bundled fallback, not the whole income list.
    expect(keys).toEqual(["other_income"]);
  });

  // [MV]
  test("a server catalog that DOES carry scope, with every shared+personal expense category disabled, returns an empty (not resurrected) list", () => {
    hydrateCatalog({
      categories: [{ key: "salary", label: "薪資", color: "#3DBE8B", scope: "income" }],
      currencies: [{ code: "TWD", label: "新台幣" }],
    });

    expect(categoryOptionsFor({ personal: false })).toEqual([]);
    expect(categoryOptionsFor({ personal: true, mode: "expense" })).toEqual([]);
  });
});

describe("defaultCategoryKey", () => {
  test("personal-ledger income starts on other_income", () => {
    expect(defaultCategoryKey({ personal: true, mode: "income" })).toBe("other_income");
  });

  test("every other context starts on general", () => {
    expect(defaultCategoryKey({ personal: false })).toBe("general");
    expect(defaultCategoryKey({ personal: true, mode: "expense" })).toBe("general");
  });
});
