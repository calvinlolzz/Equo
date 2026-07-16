// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CloudGroupsStore } from "./cloudStore";
import type { Group } from "./appTypes";
import type { StoredSession } from "./sessionStore";
import { useInviteFlow } from "./useInviteFlow";

const PENDING_INVITE_KEY = "equo.clean.pending_invite";
const group: Group = { id: "group_1", name: "東京旅行", currency: "TWD" };

const session: StoredSession = {
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  user: { id: "user_alice", email: "alice@example.com", displayName: "Alice" },
};

function setup(
  overrides: {
    cloudStore?: Partial<CloudGroupsStore>;
    session?: StoredSession | null;
    profileName?: string;
  } = {},
) {
  const showToast = vi.fn();
  const beginAction = vi.fn(() => true);
  const endAction = vi.fn();
  const setDialog = vi.fn();
  const openGroup = vi.fn();
  const closeDrawers = vi.fn();
  const cloudStore = {
    createInvite: vi.fn(async () => "INVITE_TOKEN"),
    acceptInvite: vi.fn(async () => ({ id: "group_2", name: "室友開銷", currency: "TWD" })),
    ...overrides.cloudStore,
  } as unknown as CloudGroupsStore;

  const hook = renderHook(() =>
    useInviteFlow({
      activeGroup: group,
      cloudStore,
      session: overrides.session === undefined ? session : overrides.session,
      profileName: overrides.profileName ?? "Alice",
      showToast,
      beginAction,
      endAction,
      setDialog,
      openGroup,
      closeDrawers,
    }),
  );

  return { hook, cloudStore, showToast, setDialog, openGroup, closeDrawers };
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
  // The clipboard test defines navigator.clipboard; restoreAllMocks doesn't undo
  // a defineProperty, so drop it here to keep it from leaking to later tests.
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("useInviteFlow", () => {
  test("openInviteMembers closes drawers, opens the dialog and mints an invite code", async () => {
    const { hook, cloudStore, closeDrawers, setDialog } = setup();

    await act(async () => {
      await hook.result.current.openInviteMembers();
    });

    expect(closeDrawers).toHaveBeenCalled();
    expect(setDialog).toHaveBeenCalledWith("inviteMembers");
    expect(cloudStore.createInvite).toHaveBeenCalledWith("group_1");
    expect(hook.result.current.cloudInviteToken).toBe("INVITE_TOKEN");
  });

  test("re-opening the invite dialog for the same group reuses the cached code", async () => {
    const { hook, cloudStore } = setup();

    await act(async () => {
      await hook.result.current.openInviteMembers();
    });
    await act(async () => {
      await hook.result.current.openInviteMembers();
    });

    // Cached: minted once, not on every open.
    expect(cloudStore.createInvite).toHaveBeenCalledTimes(1);
  });

  test("submitInviteInput joins with the typed code and the profile name", async () => {
    const { hook, cloudStore, openGroup, setDialog } = setup();

    act(() => hook.result.current.setInviteInputValue("  CODE123  "));
    await act(async () => {
      await hook.result.current.submitInviteInput();
    });

    expect(cloudStore.acceptInvite).toHaveBeenCalledWith("CODE123", "Alice");
    expect(openGroup).toHaveBeenCalledWith("group_2");
    expect(setDialog).toHaveBeenCalledWith(null);
    expect(hook.result.current.inviteInputValue).toBe("");
  });

  test("a bad invite code becomes an inline error, and the dialog stays open", async () => {
    const { hook, setDialog } = setup({
      cloudStore: {
        acceptInvite: vi.fn(async () => {
          throw new Error("邀請碼無效");
        }),
      },
    });

    act(() => hook.result.current.setInviteInputValue("BAD"));
    await act(async () => {
      await hook.result.current.submitInviteInput();
    });

    expect(hook.result.current.inviteInputError).toBe("邀請碼無效");
    // The dialog is NOT dismissed on failure - the user gets to fix the code.
    expect(setDialog).not.toHaveBeenCalledWith(null);
  });

  test("submitInviteInput refuses a blank code without hitting the API", async () => {
    const { hook, cloudStore } = setup();

    await act(async () => {
      await hook.result.current.submitInviteInput();
    });

    expect(cloudStore.acceptInvite).not.toHaveBeenCalled();
  });

  test("copyInviteText writes the value to the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { hook, showToast } = setup();

    await act(async () => {
      await hook.result.current.copyInviteText("INVITE_TOKEN");
    });

    expect(writeText).toHaveBeenCalledWith("INVITE_TOKEN");
    expect(showToast).toHaveBeenCalled();
  });

  test("a ?invite token in the URL is stashed for after the OAuth round-trip", () => {
    window.history.replaceState(null, "", "/?invite=TOK_FROM_LINK");

    setup({ session: null });

    // Survives the redirect via sessionStorage, and is stripped from the URL.
    expect(window.sessionStorage.getItem(PENDING_INVITE_KEY)).toBe("TOK_FROM_LINK");
    expect(window.location.search).toBe("");
  });

  test("a stashed invite pre-fills the join dialog once a session exists", async () => {
    window.sessionStorage.setItem(PENDING_INVITE_KEY, "TOK_STASHED");

    const { hook, setDialog } = setup({ session });

    await waitFor(() => expect(hook.result.current.inviteInputValue).toBe("TOK_STASHED"));
    expect(setDialog).toHaveBeenCalledWith("inviteInput");
    // Consumed, so it doesn't re-fire on the next render.
    expect(window.sessionStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
  });
});
