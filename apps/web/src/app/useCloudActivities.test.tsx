// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
import { useCloudActivities } from "./useCloudActivities";

const KEY = "equo.clean.cloud_activities";

beforeEach(() => {
  window.localStorage.clear();
});

describe("useCloudActivities", () => {
  test("records activities newest-first, scoped to their group", () => {
    const { result } = renderHook(() => useCloudActivities());

    act(() => result.current.recordCloudActivity("group_1", "第一筆"));
    act(() => result.current.recordCloudActivity("group_1", "第二筆"));
    act(() => result.current.recordCloudActivity("group_2", "別組"));

    expect(result.current.cloudActivities.group_1.map((a) => a.text)).toEqual(["第二筆", "第一筆"]);
    expect(result.current.cloudActivities.group_2.map((a) => a.text)).toEqual(["別組"]);
  });

  test("caps each group's log at 8, dropping the oldest", () => {
    const { result } = renderHook(() => useCloudActivities());

    act(() => {
      for (let i = 1; i <= 9; i += 1) result.current.recordCloudActivity("group_1", `活動 ${i}`);
    });

    const texts = result.current.cloudActivities.group_1.map((a) => a.text);
    expect(texts).toHaveLength(8);
    // Newest kept, oldest (活動 1) dropped.
    expect(texts[0]).toBe("活動 9");
    expect(texts).not.toContain("活動 1");
  });

  test("persists to localStorage so a reload keeps the log", () => {
    const { result } = renderHook(() => useCloudActivities());

    act(() => result.current.recordCloudActivity("group_1", "要被存起來"));

    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    expect(stored.group_1[0].text).toBe("要被存起來");
  });

  test("hydrates its initial state from localStorage", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ group_1: [{ id: "a1", text: "上次的活動", createdAt: "2026-07-16T00:00:00.000Z" }] }),
    );

    const { result } = renderHook(() => useCloudActivities());

    expect(result.current.cloudActivities.group_1[0].text).toBe("上次的活動");
  });
});
