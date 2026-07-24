import { useEffect, useRef, useState } from "react";
import type { CloudGroupsStore } from "./cloudStore";
import { describeCloudActionError } from "./describeCloudActionError";
import type { DialogMode, Group } from "./appTypes";
import type { StoredSession } from "./sessionStore";
import type { ToastAction } from "./useToast";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

const PENDING_INVITE_KEY = "equo.clean.pending_invite";

function getInviteTokenFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("invite") ?? "";
}

function clearInviteTokenFromUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("invite")) return;
  url.searchParams.delete("invite");
  window.history.replaceState(null, document.title, `${url.pathname}${url.search}${url.hash}`);
}

type UseInviteFlowDeps = {
  activeGroup: Group | null;
  cloudStore: CloudGroupsStore | null;
  session: StoredSession | null;
  profileName: string;
  showToast: (message: string, action?: ToastAction) => void;
  beginAction: (key: string) => boolean;
  endAction: () => void;
  setDialog: (dialog: DialogMode) => void;
  openGroup: (groupId: string, mode?: "push" | "replace") => void;
  closeDrawers: () => void;
};

/**
 * Both sides of an invite: minting/sharing a group's invite code, and joining a
 * group from one.
 *
 * A ?invite=TOKEN link has to survive the Google OAuth round-trip, which drops
 * query params. So the token is stashed in sessionStorage on boot (before the
 * redirect, or immediately if already logged in) and popped once a session
 * exists, pre-filling the join dialog. cloudInviteGroupIdRef caches which
 * group's code is currently loaded so re-opening the invite dialog for the same
 * group doesn't re-mint a token.
 */
export function useInviteFlow({
  activeGroup,
  cloudStore,
  session,
  profileName,
  showToast,
  beginAction,
  endAction,
  setDialog,
  openGroup,
  closeDrawers,
}: UseInviteFlowDeps) {
  const [cloudInviteToken, setCloudInviteToken] = useState("");
  const [cloudInviteLoading, setCloudInviteLoading] = useState(false);
  const [inviteInputValue, setInviteInputValue] = useState("");
  const [inviteInputError, setInviteInputError] = useState("");
  const cloudInviteGroupIdRef = useRef("");

  // Stash any ?invite=TOKEN before the OAuth redirect (or immediately, if
  // already logged in) so it survives the round-trip and query-param loss.
  useEffect(() => {
    const token = getInviteTokenFromUrl();
    if (!token) return;
    clearInviteTokenFromUrl();
    window.sessionStorage.setItem(PENDING_INVITE_KEY, token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!session) return;
    const stashedInvite = window.sessionStorage.getItem(PENDING_INVITE_KEY);
    if (!stashedInvite) return;
    window.sessionStorage.removeItem(PENDING_INVITE_KEY);
    setInviteInputValue(stashedInvite);
    setDialog("inviteInput");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function openInviteMembers() {
    if (!activeGroup || !cloudStore) return;
    closeDrawers();
    setDialog("inviteMembers");

    if (cloudInviteGroupIdRef.current === activeGroup.id && cloudInviteToken) return;
    setCloudInviteLoading(true);
    try {
      const token = await cloudStore.createInvite(activeGroup.id);
      cloudInviteGroupIdRef.current = activeGroup.id;
      setCloudInviteToken(token);
    } catch (error) {
      showToast(describeCloudActionError(error));
    } finally {
      setCloudInviteLoading(false);
    }
  }

  async function copyInviteText(value: string) {
    if (!value) return;
    try {
      await navigator.clipboard?.writeText(value);
      showToast("已複製到剪貼簿。");
    } catch {
      showToast("剪貼簿無法使用，請手動複製。");
    }
  }

  async function submitInviteInput() {
    if (!inviteInputValue.trim() || !cloudStore) return;
    if (!beginAction("joinGroup")) return;

    try {
      const group = await cloudStore.acceptInvite(inviteInputValue.trim(), profileName);
      setInviteInputValue("");
      setInviteInputError("");
      setDialog(null);
      showToast(`${text.cloudInviteJoinedPrefix}${group.name}`);
      openGroup(group.id);
    } catch (error) {
      setInviteInputError((error as Error).message || text.inviteNotFound);
    } finally {
      endAction();
    }
  }

  return {
    cloudInviteToken,
    cloudInviteLoading,
    inviteInputValue,
    setInviteInputValue,
    inviteInputError,
    setInviteInputError,
    openInviteMembers,
    copyInviteText,
    submitInviteInput,
  };
}
