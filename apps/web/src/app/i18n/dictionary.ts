import type { ZH_HANT } from "./zhHant";

/**
 * The shape every locale must fill, derived from the 繁體中文 source rather
 * than written out by hand.
 *
 * Keys come from ZH_HANT so a new string there is immediately required
 * everywhere else; values are widened from the `as const` literals to plain
 * `string`, because a translation is obviously not the same text.
 */
export type UiDictionary = {
  [Section in keyof typeof ZH_HANT]: {
    [Key in keyof (typeof ZH_HANT)[Section]]: string;
  };
};
