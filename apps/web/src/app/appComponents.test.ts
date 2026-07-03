import { describe, expect, test } from "vitest";
import { GroupRail } from "./GroupRail";
import { StartFlow } from "./StartFlowPanel";

describe("app component boundaries", () => {
  test("exports the high-level app sections as standalone components", () => {
    expect(StartFlow).toBeTypeOf("function");
    expect(GroupRail).toBeTypeOf("function");
  });
});
