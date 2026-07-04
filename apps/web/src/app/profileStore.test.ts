import { describe, expect, test } from "vitest";
import { DEFAULT_PROFILE, normalizeProfile, readProfile, type ProfileData } from "./profileStore";

function fakeReadJson<T>(value: Partial<ProfileData>): (key: string, fallback: T) => T {
  return () => value as unknown as T;
}

describe("normalizeProfile", () => {
  test("falls back to the default name when missing", () => {
    expect(normalizeProfile(null)).toEqual(DEFAULT_PROFILE);
    expect(normalizeProfile(undefined)).toEqual(DEFAULT_PROFILE);
    expect(normalizeProfile({})).toEqual(DEFAULT_PROFILE);
  });

  test("falls back to the default name when blank", () => {
    expect(normalizeProfile({ name: "   " })).toEqual(DEFAULT_PROFILE);
  });

  test("trims the provided name and keeps the avatar", () => {
    expect(normalizeProfile({ name: "  小明  ", avatarDataUrl: "data:image/png;base64,abc" })).toEqual({
      name: "小明",
      avatarDataUrl: "data:image/png;base64,abc",
    });
  });

  test("drops an empty avatar string", () => {
    expect(normalizeProfile({ name: "小明", avatarDataUrl: "" })).toEqual({ name: "小明", avatarDataUrl: undefined });
  });
});

describe("readProfile", () => {
  test("reads through the provided storage accessor and normalizes the result", () => {
    const profile = readProfile(fakeReadJson({ name: " 我的名字 " }));
    expect(profile).toEqual({ name: "我的名字", avatarDataUrl: undefined });
  });

  test("uses the default profile fallback when storage returns nothing usable", () => {
    const profile = readProfile((_key, fallback) => fallback);
    expect(profile).toEqual(DEFAULT_PROFILE);
  });
});
