import { describe, expect, test, vi } from "vitest";
import {
  createExpenseCommentRoute,
  deleteExpenseCommentRoute,
  listExpenseCommentsRoute,
} from "./expenseRoutes.js";

/**
 * Route-level: a fake PostgrestClient stands in for the RPCs, so what is under
 * test is the payload shaping, the trimming, and the sentinel-to-HTTP mapping.
 */
function options(rpc: ReturnType<typeof vi.fn>) {
  return {
    client: { rpc } as never,
    verifier: {
      verify: async () => ({ sub: "google_1", email: "a@b.c", name: "A", picture: null }),
    } as never,
    idToken: "token",
  };
}

vi.mock("../auth/routeContext.js", () => ({
  buildAuthContext: async () => ({ ok: true, context: { user: { id: "user_1" } } }),
}));

const comment = {
  id: "comment_1",
  expense_id: "expense_1",
  member_id: "member_a",
  body: "這筆我請",
  created_at: "2026-08-26T02:00:00.000Z",
};

describe("listExpenseCommentsRoute", () => {
  test("returns the thread", async () => {
    const rpc = vi.fn(async () => [comment]);

    const result = await listExpenseCommentsRoute(options(rpc), "group_1", "expense_1");

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ comments: [comment] });
    expect(rpc).toHaveBeenCalledWith("list_expense_comments", {
      p_group_id: "group_1",
      p_user_id: "user_1",
      p_expense_id: "expense_1",
    });
  });

  test("an empty thread is an empty list, not a null", async () => {
    // The RPC coalesces to '[]', but a null from anywhere else must not reach
    // the client as `comments: null` for the dialog to then crash mapping.
    const result = await listExpenseCommentsRoute(options(vi.fn(async () => null)), "group_1", "expense_1");
    expect(result.body).toEqual({ comments: [] });
  });

  test("a non-member gets 403, not an unhandled 500", async () => {
    const rpc = vi.fn(async () => {
      throw new Error("NOT_A_GROUP_MEMBER");
    });

    const result = await listExpenseCommentsRoute(options(rpc), "group_1", "expense_1");
    expect(result.status).toBe(403);
  });
});

describe("createExpenseCommentRoute", () => {
  const body = { client_request_id: "req_1", body: "  這筆我請  " };

  test("trims before writing, and hands the entry title back for the push", async () => {
    const rpc = vi.fn(async () => ({ ...comment, expense_title: "晚餐" }));

    const result = await createExpenseCommentRoute(options(rpc), "group_1", "expense_1", body);

    expect(result.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("create_expense_comment", {
      p_group_id: "group_1",
      p_user_id: "user_1",
      p_expense_id: "expense_1",
      p_body: "這筆我請",
      p_client_request_id: "req_1",
    });
    expect("expenseTitle" in result && result.expenseTitle).toBe("晚餐");
  });

  test("the entry title never reaches the HTTP body", async () => {
    // It is a fact about the expense, borrowed for one notification string.
    const rpc = vi.fn(async () => ({ ...comment, expense_title: "晚餐" }));

    const result = await createExpenseCommentRoute(options(rpc), "group_1", "expense_1", body);

    expect(result.body).toEqual({ comment });
    expect(JSON.stringify(result.body)).not.toContain("expense_title");
  });

  test("a replay comes back with no title, which is what suppresses a second push", async () => {
    const rpc = vi.fn(async () => comment);

    const result = await createExpenseCommentRoute(options(rpc), "group_1", "expense_1", body);

    expect(result.status).toBe(201);
    expect("expenseTitle" in result && result.expenseTitle).toBeUndefined();
  });

  test.each([
    ["empty", ""],
    ["only whitespace", "   \n  "],
  ])("rejects a %s body with 400 and never calls the RPC", async (_label, text) => {
    const rpc = vi.fn();

    const result = await createExpenseCommentRoute(options(rpc), "group_1", "expense_1", {
      client_request_id: "req_1",
      body: text,
    });

    expect(result.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  test("rejects a body over the length cap", async () => {
    const rpc = vi.fn();

    const result = await createExpenseCommentRoute(options(rpc), "group_1", "expense_1", {
      client_request_id: "req_1",
      body: "字".repeat(501),
    });

    expect(result.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  test("rejects a missing client_request_id, so a retry can never duplicate", async () => {
    const rpc = vi.fn();

    const result = await createExpenseCommentRoute(
      options(rpc),
      "group_1",
      "expense_1",
      { body: "x" } as never,
    );

    expect(result.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  test("commenting on an entry in another group is 404", async () => {
    const rpc = vi.fn(async () => {
      throw new Error("EXPENSE_NOT_FOUND");
    });

    const result = await createExpenseCommentRoute(options(rpc), "group_1", "expense_1", body);
    expect(result.status).toBe(404);
  });
});

describe("deleteExpenseCommentRoute", () => {
  test("withdraws one", async () => {
    const rpc = vi.fn(async () => ({ id: "comment_1" }));

    const result = await deleteExpenseCommentRoute(options(rpc), "group_1", "comment_1");

    expect(result.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("delete_expense_comment", {
      p_group_id: "group_1",
      p_user_id: "user_1",
      p_comment_id: "comment_1",
    });
  });

  test("somebody else's comment is a 404, indistinguishable from a missing one", async () => {
    // Deliberate: answering "not yours" differently from "not there" turns this
    // endpoint into a way to test whether a comment id exists.
    const rpc = vi.fn(async () => {
      throw new Error("COMMENT_NOT_FOUND");
    });

    const result = await deleteExpenseCommentRoute(options(rpc), "group_1", "comment_1");
    expect(result.status).toBe(404);
  });
});
