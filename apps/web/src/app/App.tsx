import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChartNoAxesColumn,
  ChevronRight,
  Copy,
  HandCoins,
  History,
  House,
  Inbox,
  Link,
  Menu,
  Moon,
  Pencil,
  Plus,
  Settings,
  Sun,
  UserRound,
  X,
} from "lucide-react";
import { createActionGuard } from "./actionGuard";
import { createAutoSync } from "./autoSync";
import { buildSettlementTransfers } from "./buildSettlementTransfers";
import { createApiClient, type ExpenseSummary } from "./apiClient";
import { dateKey, formatActivityTime, lastEightDays } from "./appDates";
import { AnalysisPanel } from "./AnalysisPanel";
import { ArchivedListPanel } from "./ArchivedListPanel";
import { MemberListPanel } from "./MemberListPanel";
import { RecordsPanel } from "./RecordsPanel";
import { buildExpenseCsv, csvFileName } from "./expenseCsv";
import { FeedbackDialog, type FeedbackType } from "./FeedbackDialog";
import { GroupSideNav } from "./GroupSideNav";
import { usePullToRefresh } from "./usePullToRefresh";
import { useSwipeToDismissX } from "./useSwipeToDismissX";
import { listSettlementRecords } from "./settlementHistory";
import { type ArchivedGroupData } from "./cloudStore";
import { ExpenseComposerSheet, type ExpenseDraft } from "./ExpenseComposerSheet";
import { ExpenseDetailDialog } from "./ExpenseDetailDialog";
import { downscaleImageFileToDataUrl } from "./expenseImage";
import { expenseToDraft } from "./expenseUndo";
import { GroupRail } from "./GroupRail";
import { LoginScreen } from "./LoginScreen";
import { MemberAvatar } from "./MemberAvatar";
import { ProfileDialog } from "./ProfileDialog";
import { isGroupOwner } from "./isGroupOwner";
import { resolveCurrentMember } from "./resolveCurrentMember";
import { StartFlow } from "./StartFlowPanel";
import { useSwipeToDismiss } from "./useSwipeToDismiss";
import { resolveRootLanding } from "./resolveRootLanding";
import type { Activity, Expense, Group, Member, StartMode } from "./appTypes";
import { formatAmount, formatSigned } from "./formatAmount";
import { DEFAULT_PROFILE, PROFILE_KEY, normalizeProfile, type ProfileData } from "./profileStore";
import { saveSession, type StoredSession } from "./sessionStore";
import { useIsMobileLayout } from "./useIsMobileLayout";
import { useThemeMode } from "./useThemeMode";
import { useArchivedGroups } from "./useArchivedGroups";
import { useAuthSession } from "./useAuthSession";
import { readRouteGroupId, useGroupRoute } from "./useGroupRoute";
import { useToast } from "./useToast";
import { UI_TEXT } from "./uiText";
type DialogMode =
  | "createGroup"
  | "editGroup"
  | "inviteMembers"
  | "inviteInput"
  | "currencyPanel"
  | "recordsPanel"
  | "analysisPanel"
  | "memberActions"
  | "memberList"
  | "virtualMember"
  | "archivedList"
  | "archive"
  | "delete"
  | "profile"
  | "expenseDetail"
  | null;

const CLOUD_ACTIVITIES_KEY = "equo.clean.cloud_activities";
const PENDING_INVITE_KEY = "equo.clean.pending_invite";

const text = UI_TEXT.app;

const templates = [
  { id: "trip", label: text.trip, defaultName: text.tripName },
  { id: "meal", label: text.meal, defaultName: text.mealName },
  { id: "home", label: text.home, defaultName: text.homeName },
  { id: "event", label: text.event, defaultName: text.eventName },
];


const currencyOptions = [
  { code: "TWD", label: UI_TEXT.currencies.twd },
  { code: "JPY", label: UI_TEXT.currencies.jpy },
  { code: "USD", label: UI_TEXT.currencies.usd },
  { code: "KRW", label: UI_TEXT.currencies.krw },
  { code: "EUR", label: UI_TEXT.currencies.eur },
];



function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

/**
 * Group rename/cover, archive, unarchive, and delete are owner-only on the
 * backend (see server/handlers/groups.ts's requireGroupOwner). The frontend
 * already hides the triggers for non-owners, but a stale UI state (e.g. a
 * cached member list, or ownership changing in another tab) can still let a
 * non-owner reach the action - map that 403 to a clear, specific toast
 * instead of the generic "sync failed: <message>" wording.
 */
function describeCloudActionError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === "FORBIDDEN") {
    return text.ownerOnlyAction;
  }
  return `${text.cloudSyncFailedPrefix}${(error as Error).message}`;
}

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

function formatTime(value: string) {
  const date = new Date(value);
  return date.toLocaleTimeString("zh-TW", { hour: "numeric", minute: "2-digit", second: "2-digit" });
}


export function App() {
  const { activeGroupId, openGroup, closeGroup } = useGroupRoute();
  const [startMode, setStartMode] = useState<StartMode>("create");
  const [selectedTemplate, setSelectedTemplate] = useState("trip");
  const [groupName, setGroupName] = useState<string>("");
  const [virtualMemberName, setVirtualMemberName] = useState("");
  const [renamingMemberId, setRenamingMemberId] = useState("");
  const [renameMemberValue, setRenameMemberValue] = useState("");
  const [confirmingRemoveMemberId, setConfirmingRemoveMemberId] = useState("");
  const [dialog, setDialog] = useState<DialogMode>(null);
  // Swipe-to-dismiss for the shared bottom-sheet dialog shell (records /
  // analysis / members / etc.). Kept mounted across open/close cycles.
  const dialogSwipe = useSwipeToDismiss(() => setDialog(null));
  const [expenseComposerOpen, setExpenseComposerOpen] = useState(false);
  const { toast, showToast } = useToast();
  const [busy, setBusy] = useState(false);
  // pendingAction gates every mutation control's disabled/busy label. The
  // guard (see actionGuard.ts) is the synchronous double-submit check -
  // begin()/end() mutate a plain field, not React state, so two clicks in
  // the same tick can't both pass; pendingAction (state) just re-renders the
  // button to show the busy label.
  const actionGuardRef = useRef(createActionGuard());
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [spendTab, setSpendTab] = useState<"personal" | "group">("personal");
  const [selectedDateKey, setSelectedDateKey] = useState(() => dateKey(new Date().toISOString()));
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const { theme, toggleTheme } = useThemeMode();
  // Mobile drawer swipe gestures: each drawer dismisses toward the edge it
  // slid in from (left drawer <- swipe left, right drawer -> swipe right).
  const groupDrawerSwipe = useSwipeToDismissX("left", () => setGroupDrawerOpen(false));
  const settingsDrawerSwipe = useSwipeToDismissX("right", () => setSettingsDrawerOpen(false));
  const isMobileLayout = useIsMobileLayout();
  const [inviteInputValue, setInviteInputValue] = useState("");
  const [inviteInputError, setInviteInputError] = useState("");
  const [profile, setProfile] = useState<ProfileData>(() => normalizeProfile(readJson<Partial<ProfileData>>(PROFILE_KEY, DEFAULT_PROFILE)));
  const [selectedExpenseId, setSelectedExpenseId] = useState<string>("");
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [cloudInviteToken, setCloudInviteToken] = useState("");
  const [cloudInviteLoading, setCloudInviteLoading] = useState(false);
  const [cloudActivities, setCloudActivities] = useState<Record<string, Activity[]>>(() =>
    readJson<Record<string, Activity[]>>(CLOUD_ACTIVITIES_KEY, {}),
  );
  const [groupCoverDataUrl, setGroupCoverDataUrl] = useState<string>("");
  const [groupCoverUrl, setGroupCoverUrl] = useState<string>("");
  const cloudInviteGroupIdRef = useRef("");

  const {
    session,
    setSession,
    cloudStore,
    cloudState,
    authLoading,
    authError,
    startGoogleLogin,
    signOut,
  } = useAuthSession({
    showToast,
    // A brand-new account still carries the placeholder profile name; seed it
    // from the account. Someone who has since renamed themselves keeps their name.
    onSignedIn: (nextSession) =>
      setProfile((current) =>
        current.name === DEFAULT_PROFILE.name
          ? normalizeProfile({ ...current, name: nextSession.user.displayName })
          : current,
      ),
    // Signing out has to close the open group too - that is the route's business.
    onSignedOut: () => closeGroup("replace"),
  });

  /**
   * The avatar shown on the profile dot/dialog: the freshest server-known
   * avatar_url from session state takes priority (this is the custom
   * uploaded avatar once the user has set one - see updateMyAvatar/
   * saveProfile - or their Google picture as the login-seeded default),
   * falling back to the local profileStore cache for the rare moment right
   * after a fresh login before any avatar has ever round-tripped through
   * the session, and finally to no avatar (icon fallback) if neither exists.
   */
  const displayAvatarUrl = session?.user.avatarUrl ?? profile.avatarDataUrl;

  const {
    archivedGroups,
    loading: archivedGroupsLoading,
    unarchivingGroupId,
    loadArchivedGroups,
    unarchiveGroup,
  } = useArchivedGroups({ cloudStore, showToast, describeError: describeCloudActionError });

  const cloudGroups = useMemo(() => cloudState?.groups ?? [], [cloudState]);
  const cloudActiveDetail = activeGroupId ? cloudState?.groupDetails[activeGroupId] ?? null : null;
  const cloudActiveLoading = activeGroupId ? Boolean(cloudState?.loadingGroupIds[activeGroupId]) : false;

  const displayGroups = cloudGroups;

  const activeGroup = cloudActiveDetail?.group ?? (cloudGroups.find((group) => group.id === activeGroupId) ?? null);
  const members = cloudActiveDetail?.members ?? [];
  const expenses = cloudActiveDetail?.expenses ?? [];
  const activities = cloudActivities[activeGroupId] ?? [];
  const loadingMoreExpenses = activeGroupId ? Boolean(cloudState?.loadingMoreExpenseIds[activeGroupId]) : false;

  function recordCloudActivity(groupId: string, activityText: string) {
    const activity: Activity = { id: crypto.randomUUID(), text: activityText, createdAt: new Date().toISOString() };
    setCloudActivities((current) => ({
      ...current,
      [groupId]: [activity, ...(current[groupId] ?? [])].slice(0, 8),
    }));
  }

  // Server-authoritative aggregates (get_group_detail v3 - see
  // detailAggregates.ts). expenseCount counts every non-deleted entry
  // regardless of kind; spendTotalMinor/spendByDay/memberDayShares only
  // ever accumulate kind==="expense" entries (settlements/transfers move
  // money between members without spending it, and income entries are
  // money received, not spent - both excluded), matching detailAggregates'
  // isSpendableExpense rule exactly. The 平均 (average) tile that used to
  // sit next to 總支出 has been removed: it can't be derived server-side
  // once the expenses array is truncated to a window, and re-deriving it
  // from only the loaded page would silently understate the true average
  // for any group with more history than the window.
  const aggregates = cloudActiveDetail?.aggregates ?? { expenseCount: 0, spendTotalMinor: 0, spendByDay: [], spendByCategory: [], memberDayShares: [] };
  const totalExpenseMinor = aggregates.spendTotalMinor;

  // Group-level balances come straight from the server (get_group_detail's
  // balances array), NOT a client-side recompute - the loaded expenses are
  // only a capped window, so computeMemberBalances over them would silently
  // under/overstate balances for any group with more history than the
  // window. computeMemberBalances/groupBalances.ts remain in use for the
  // composer's per-expense split preview only (see ExpenseComposerSheet),
  // which is unrelated to group-level state.
  const serverBalances = cloudActiveDetail?.balances ?? [];
  const balances = useMemo(
    () => new Map(serverBalances.map((entry) => [entry.memberId, entry.balance.amount_minor])),
    [serverBalances],
  );

  // 清償紀錄 for the analysis panel - settlement-kind entries from the loaded
  // expense window (older history pages in via the records panel's load-more).
  const settlementRecords = useMemo(() => listSettlementRecords(expenses), [expenses]);

  // Pull-to-refresh on the mobile home screen: active only while no overlay
  // is open, so the gesture never fights dialogs, drawers, or the composer.
  const pullEnabled =
    isMobileLayout &&
    Boolean(session && activeGroup && cloudStore) &&
    !dialog &&
    !expenseComposerOpen &&
    !feedbackOpen &&
    !groupDrawerOpen &&
    !settingsDrawerOpen;
  const pullStatus = usePullToRefresh(pullEnabled, async () => {
    if (!cloudStore || !activeGroup) return;
    await Promise.all([cloudStore.refreshGroups(), cloudStore.refreshGroupDetail(activeGroup.id)]);
  });

  // The logged-in user's own member row within the active group - NOT
  // necessarily the group owner (joined-via-invite members are non-owners).
  // See resolveCurrentMember.ts for the matching/fallback rules.
  const currentMember = resolveCurrentMember(members, session?.user.id);
  const isCurrentMemberOwner = isGroupOwner(currentMember);

  const dateChips = useMemo(() => lastEightDays(), []);
  // 群組消費 for the selected day = that day's spendByDay total; 個人消費 =
  // the current member's memberDayShares entry for that day. Both come
  // straight from the server aggregates (see detailAggregates.ts's day-key
  // format, which matches dateKey() here).
  const groupSpendMinor = useMemo(
    () => aggregates.spendByDay.find((entry) => entry.day === selectedDateKey)?.totalMinor ?? 0,
    [aggregates.spendByDay, selectedDateKey],
  );
  const personalSpendMinor = useMemo(() => {
    if (!currentMember) return 0;
    return (
      aggregates.memberDayShares.find((entry) => entry.day === selectedDateKey && entry.memberId === currentMember.id)
        ?.shareMinor ?? 0
    );
  }, [aggregates.memberDayShares, selectedDateKey, currentMember]);
  const selectedDateChip = dateChips.find((chip) => chip.key === selectedDateKey);
  const spendDisplayAmountMinor = spendTab === "group" ? groupSpendMinor : personalSpendMinor;

  const settlementTransfers = useMemo(() => buildSettlementTransfers(serverBalances), [serverBalances]);
  const firstTransfer = settlementTransfers[0] ?? null;
  const debt = useMemo(() => {
    if (!firstTransfer) return null;
    const from = members.find((member) => member.id === firstTransfer.fromMemberId);
    const to = members.find((member) => member.id === firstTransfer.toMemberId);
    if (!from || !to) return null;
    return { from, to, amountMinor: firstTransfer.amount.amount_minor };
  }, [firstTransfer, members]);
  const extraTransferCount = Math.max(0, settlementTransfers.length - 1);
  const maxBalanceMinor = Math.max(1, ...members.map((member) => Math.abs(balances.get(member.id) ?? 0)));
  const selectedExpense = expenses.find((expense) => expense.id === selectedExpenseId) ?? null;
  const selectedExpenseIndex = expenses.findIndex((expense) => expense.id === selectedExpenseId);
  const canLoadMoreExpenses = expenses.length < aggregates.expenseCount;

  async function handleLoadMoreExpenses() {
    if (!activeGroup || !cloudStore) return;
    if (!beginAction("loadMoreExpenses")) return;
    try {
      await cloudStore.loadMoreExpenses(activeGroup.id);
    } catch (error) {
      showToast(`${text.cloudSyncFailedPrefix}${(error as Error).message}`);
    } finally {
      endAction();
    }
  }

  async function handleFeedbackSubmit(payload: { type: FeedbackType; message: string }) {
    if (!session) return;
    try {
      const client = createApiClient();
      await client.createFeedback({ ...payload, page: window.location.pathname });
      setFeedbackOpen(false);
      showToast(text.feedbackDone);
    } catch {
      showToast(text.feedbackFailed);
    }
  }

  async function handleExportCsv() {
    if (!activeGroup || !session) return;
    if (!beginAction("exportCsv")) return;
    try {
      // The loaded window may be paginated - walk listExpensesPage until a
      // short page so the export always covers the group's full history.
      const client = createApiClient();
      const pageLimit = 100;
      const all: ExpenseSummary[] = [];
      let cursor: { beforeDate?: string; beforeCreatedAt?: string } = {};

      for (;;) {
        const page = await client.listExpensesPage(activeGroup.id, { limit: pageLimit, ...cursor });
        all.push(...page.expenses);
        if (page.expenses.length < pageLimit) break;
        const last = page.expenses[page.expenses.length - 1];
        if (!last.expense_date || !last.created_at) break;
        cursor = { beforeDate: last.expense_date, beforeCreatedAt: last.created_at };
      }

      const memberName = (memberId: string | null | undefined) =>
        members.find((member) => member.id === memberId)?.name ?? "";
      const csv = buildExpenseCsv(all, memberName);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = csvFileName(activeGroup.name, dateKey(new Date().toISOString()));
      anchor.click();
      URL.revokeObjectURL(url);
      showToast(text.exportCsvDone);
    } catch {
      showToast(text.exportCsvFailed);
    } finally {
      endAction();
    }
  }

  useEffect(() => writeJson(PROFILE_KEY, profile), [profile]);
  useEffect(() => writeJson(CLOUD_ACTIVITIES_KEY, cloudActivities), [cloudActivities]);

  useEffect(() => {
    if (!session) return;
    if (!cloudState || cloudState.loadingGroups) return;
    const routeId = readRouteGroupId();
    if (!routeId) {
      // Root URL: land the user on their most-recent group instead of the
      // create-first-group start flow. Groups are loaded here (the guard
      // above cleared loadingGroups); a null landing means zero groups, so
      // fall through to the StartFlow empty state. Once forwarded, the route
      // is no longer empty, so this branch won't re-fire (no redirect loop).
      const landingId = resolveRootLanding(cloudGroups);
      if (landingId) {
        openGroup(landingId, "replace");
      }
      return;
    }
    const routeGroupExists = cloudGroups.some((group) => group.id === routeId);
    if (routeId === activeGroupId) {
      if (!routeGroupExists) {
        closeGroup("replace");
        showToast(text.groupNotFound);
      }
      return;
    }
    if (routeGroupExists) {
      openGroup(routeId, "replace");
      return;
    }
    closeGroup("replace");
    showToast(text.groupNotFound);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupId, cloudGroups, session, cloudState?.loadingGroups]);

  useEffect(() => {
    if (!session || !cloudStore || !activeGroupId) return;
    if (cloudState?.groupDetails[activeGroupId]) return;
    cloudStore
      .refreshGroupDetail(activeGroupId)
      .catch(() => showToast(`${text.cloudSyncFailedPrefix}${text.groupNotFound}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupId, session, cloudStore]);

  // Near-realtime auto-sync: background focus/interval revalidation while
  // logged in. Reads activeGroupId/cloudStore via refs (rather than as
  // effect deps) so the interval/listeners aren't torn down and rebuilt on
  // every group navigation - only when the cloudStore instance itself
  // changes (login/logout). Background failures are silent by design (see
  // autoSync.ts) - no toast spam for a revalidation that will just retry on
  // the next tick.
  const activeGroupIdRef = useRef(activeGroupId);
  activeGroupIdRef.current = activeGroupId;

  useEffect(() => {
    if (!cloudStore) return;
    const autoSync = createAutoSync({
      callbacks: {
        // Skip while a mutation is in flight (actionGuard.current is set) so
        // a background refresh never lands in the middle of an
        // optimistic-update mutation; it'll simply run on the next tick.
        refreshActiveGroup: () => {
          if (actionGuardRef.current.current) return Promise.resolve();
          const groupId = activeGroupIdRef.current;
          if (!groupId) return Promise.resolve();
          return cloudStore.refreshGroupDetail(groupId);
        },
        refreshGroups: () => {
          if (actionGuardRef.current.current) return Promise.resolve();
          return cloudStore.refreshGroups();
        },
      },
    });
    autoSync.start();
    return () => autoSync.stop();
  }, [cloudStore]);

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

  /**
   * Synchronous double-submit guard for mutation controls: returns false
   * (does nothing else) if an action is already in flight, so callers can
   * bail out before doing any work. See actionGuard.ts for why this can't
   * just be a useState flag.
   */
  function beginAction(key: string): boolean {
    if (!actionGuardRef.current.begin(key)) return false;
    setPendingAction(key);
    return true;
  }

  function endAction() {
    actionGuardRef.current.end();
    setPendingAction(null);
  }

  function selectGroup(group: Group) {
    openGroup(group.id);
    setGroupDrawerOpen(false);
  }

  async function createGroup() {
    if (!cloudStore) return;
    // Require a typed, non-empty name - the template no longer supplies a
    // fallback, so an empty field must not silently create a group named
    // after the template placeholder.
    const name = groupName.trim();
    if (!name) return;
    // Synchronous guard checked before anything else, including the
    // cloudStore null-check above having already run: two fast clicks both
    // enter this function, but only the first passes beginAction.
    if (!beginAction("createGroup")) return;
    const pickedCover = groupCoverDataUrl;

    try {
      const group = await cloudStore.createGroup({ name, currency: "TWD" });
      openGroup(group.id, "replace");
      setDialog(null);
      setGroupName("");
      setGroupCoverDataUrl("");
      setGroupCoverUrl("");
      showToast(`${text.createGroup}: ${name}`);

      if (pickedCover) {
        try {
          const uploadedUrl = await cloudStore.uploadGroupImage(group.id, "cover", pickedCover);
          await cloudStore.updateGroupCover(group.id, name, uploadedUrl);
        } catch {
          showToast(text.coverUploadFailedAfterCreate);
        }
      }
    } catch (error) {
      showToast(`${text.cloudSyncFailedPrefix}${(error as Error).message}`);
    } finally {
      endAction();
    }
  }

  function openCreateGroupDialog() {
    // Start from a clean slate so a name left over from a prior edit (or a
    // previous create) never leaks into the create form.
    setGroupName("");
    setGroupCoverDataUrl("");
    setGroupCoverUrl("");
    setDialog("createGroup");
  }

  function openEditGroup() {
    if (!activeGroup) return;
    setGroupName(activeGroup.name);
    setGroupCoverDataUrl("");
    setGroupCoverUrl(activeGroup.coverImageUrl ?? "");
    setDialog("editGroup");
  }

  async function handleGroupCoverPick(file: File | null) {
    if (!file) return;
    try {
      const dataUrl = await downscaleImageFileToDataUrl(file);
      setGroupCoverDataUrl(dataUrl);
    } catch {
      showToast(text.photoError);
    }
  }

  async function updateActiveGroup() {
    if (!activeGroup || !cloudStore) return;
    const name = groupName.trim();
    if (!name) return;
    if (!beginAction("editGroup")) return;

    setBusy(true);
    try {
      if (groupCoverDataUrl) {
        const uploadedUrl = await cloudStore.uploadGroupImage(activeGroup.id, "cover", groupCoverDataUrl);
        await cloudStore.updateGroupCover(activeGroup.id, name, uploadedUrl);
      } else {
        await cloudStore.renameGroup(activeGroup.id, name);
      }
      recordCloudActivity(activeGroup.id, `${text.editGroup}: ${name}`);
      setDialog(null);
      setGroupCoverDataUrl("");
      showToast(`${text.editGroup}: ${name}`);
    } catch (error) {
      showToast(describeCloudActionError(error));
    } finally {
      setBusy(false);
      endAction();
    }
  }

  function openArchivedGroups() {
    if (!cloudStore) return;
    setDialog("archivedList");
    void loadArchivedGroups();
  }

  function updateActiveCurrency(currency: string) {
    if (!activeGroup || activeGroup.currency === currency) {
      setDialog(null);
      return;
    }

    setDialog(null);
    showToast(text.cloudCurrencyUnsupported);
  }

  async function openInviteMembers() {
    if (!activeGroup || !cloudStore) return;
    setGroupDrawerOpen(false);
    setSettingsDrawerOpen(false);
    setDialog("inviteMembers");

    if (cloudInviteGroupIdRef.current === activeGroup.id && cloudInviteToken) return;
    setCloudInviteLoading(true);
    try {
      const token = await cloudStore.createInvite(activeGroup.id);
      cloudInviteGroupIdRef.current = activeGroup.id;
      setCloudInviteToken(token);
    } catch (error) {
      showToast(`${text.cloudSyncFailedPrefix}${(error as Error).message}`);
    } finally {
      setCloudInviteLoading(false);
    }
  }

  function resetMemberManagement() {
    setRenamingMemberId("");
    setRenameMemberValue("");
    setConfirmingRemoveMemberId("");
  }

  function openMemberList() {
    if (!activeGroup) return;
    setGroupDrawerOpen(false);
    setSettingsDrawerOpen(false);
    resetMemberManagement();
    setDialog("memberList");
  }

  function openProfileDialog() {
    setGroupDrawerOpen(false);
    setSettingsDrawerOpen(false);
    setDialog("profile");
  }


  /**
   * Saves both the name (always local-only, per profileStore) and, when the
   * user picked a new photo, the avatar - which now round-trips through the
   * server (PATCH /me/avatar) instead of staying purely local, so it
   * propagates to every device/member row instead of just this browser.
   *
   * Avatar upload flow on success:
   * 1. sessionStore + session state get the new avatarUrl - this alone makes
   *    the profile dot/dialog re-render with the new photo instantly, since
   *    displayAvatarUrl reads session.user.avatarUrl first.
   * 2. profileStore's cached copy is updated too, so the local cache/fallback
   *    layer agrees (offline reads, pre-login flashes) and no longer holds a
   *    stale avatar.
   * 3. The active group's detail is refreshed in the background so this
   *    user's OWN member row picks up the new avatar_url without waiting for
   *    the next auto-sync tick. Other devices/members catch up via the
   *    existing auto-sync polling - no realtime push needed here.
   *
   * If the upload fails, the name (if changed) still saves locally and the
   * user sees an error toast instead of losing the whole edit.
   */
  async function saveProfile(nextProfile: ProfileData) {
    const normalized = normalizeProfile(nextProfile);
    const avatarChanged = normalized.avatarDataUrl && normalized.avatarDataUrl !== session?.user.avatarUrl;

    if (avatarChanged && session) {
      try {
        const apiClient = createApiClient();
        const { avatar_url } = await apiClient.updateMyAvatar({
          client_request_id: crypto.randomUUID(),
          data_url: normalized.avatarDataUrl!,
        });
        const nextSession: StoredSession = { ...session, user: { ...session.user, avatarUrl: avatar_url } };
        saveSession(nextSession);
        setSession(nextSession);
        setProfile({ ...normalized, avatarDataUrl: avatar_url });
        setDialog(null);
        showToast(UI_TEXT.profile.avatarUpdated);
        if (activeGroupId) {
          cloudStore?.refreshGroupDetail(activeGroupId).catch(() => {});
        }
        return;
      } catch {
        showToast(UI_TEXT.profile.avatarUploadFailed);
        setProfile((current) => normalizeProfile({ ...current, name: normalized.name }));
        setDialog(null);
        return;
      }
    }

    setProfile(normalized);
    setDialog(null);
    showToast(`${text.profile}: ${normalized.name}`);
  }

  async function copyInviteText(value: string) {
    if (!value) return;
    try {
      await navigator.clipboard?.writeText(value);
      showToast("\u5df2\u8907\u88fd\u5230\u526a\u8cbc\u7c3f\u3002");
    } catch {
      showToast("\u526a\u8cbc\u7c3f\u7121\u6cd5\u4f7f\u7528\uff0c\u8acb\u624b\u52d5\u8907\u88fd\u3002");
    }
  }

  function handleSideNavClick(id: string) {
    setGroupDrawerOpen(false);
    setSettingsDrawerOpen(false);
    if (id === "members") {
      resetMemberManagement();
      setDialog("memberList");
      return;
    }
    if (id === "records") {
      setDialog("recordsPanel");
      return;
    }
    if (id === "analysis") {
      setDialog("analysisPanel");
      return;
    }
    if (id === "currency") {
      setDialog("currencyPanel");
      return;
    }
    showToast(text.groupHome);
  }

  async function addVirtualMember() {
    if (!activeGroup || !cloudStore || !virtualMemberName.trim()) return;
    if (!beginAction("addVirtualMember")) return;
    const name = virtualMemberName.trim();

    try {
      await cloudStore.addVirtualMember(activeGroup.id, name);
      recordCloudActivity(activeGroup.id, `${text.addVirtualMember}: ${name}`);
      setVirtualMemberName("");
      setDialog(null);
      showToast(`${text.addVirtualMember}: ${name}`);
    } catch (error) {
      showToast(`${text.cloudSyncFailedPrefix}${(error as Error).message}`);
    } finally {
      endAction();
    }
  }

  function startRenameMember(member: Member) {
    setConfirmingRemoveMemberId("");
    setRenamingMemberId(member.id);
    setRenameMemberValue(member.name);
  }

  function cancelRenameMember() {
    setRenamingMemberId("");
    setRenameMemberValue("");
  }

  async function submitRenameMember(member: Member) {
    if (!activeGroup || !cloudStore) return;
    const name = renameMemberValue.trim();
    if (!name) return;
    if (name === member.name) {
      cancelRenameMember();
      return;
    }
    if (!beginAction(`renameMember:${member.id}`)) return;

    try {
      await cloudStore.renameMember(activeGroup.id, member.id, name);
      recordCloudActivity(activeGroup.id, `${text.renameMember}: ${member.name} → ${name}`);
      cancelRenameMember();
      showToast(text.memberRenamed);
    } catch (error) {
      showToast(`${text.cloudSyncFailedPrefix}${(error as Error).message}`);
    } finally {
      endAction();
    }
  }

  async function removeMember(member: Member) {
    if (!activeGroup || !cloudStore) return;
    if (confirmingRemoveMemberId !== member.id) {
      setRenamingMemberId("");
      setRenameMemberValue("");
      setConfirmingRemoveMemberId(member.id);
      return;
    }
    if (!beginAction(`removeMember:${member.id}`)) return;

    try {
      await cloudStore.removeMember(activeGroup.id, member.id);
      recordCloudActivity(activeGroup.id, `${text.removeMember}: ${member.name}`);
      setConfirmingRemoveMemberId("");
      showToast(text.memberRemoved);
    } catch (error) {
      const code = (error as { code?: string }).code;
      setConfirmingRemoveMemberId("");
      showToast(
        code === "MEMBER_HAS_BALANCE"
          ? text.memberHasBalance
          : `${text.cloudSyncFailedPrefix}${(error as Error).message}`,
      );
    } finally {
      endAction();
    }
  }

  async function handleExpenseDraftSubmit(draft: ExpenseDraft) {
    if (!activeGroup || !cloudStore) return;
    const editingId = editingExpense?.id;

    let finalDraft = draft;
    if (draft.imageDataUrl) {
      setBusy(true);
      try {
        const uploadedUrl = await cloudStore.uploadGroupImage(activeGroup.id, "expense", draft.imageDataUrl);
        finalDraft = { ...draft, imageUrl: uploadedUrl, imageDataUrl: undefined };
      } catch {
        setBusy(false);
        showToast(text.imageUploadFailed);
        return;
      }
      setBusy(false);
    }

    try {
      if (editingId) {
        await cloudStore.editExpense(activeGroup.id, editingId, finalDraft, activeGroup.currency);
      } else {
        await cloudStore.addExpense(activeGroup.id, finalDraft, activeGroup.currency);
      }
      recordCloudActivity(
        activeGroup.id,
        editingId
          ? `${text.editExpense}: ${draft.title}`
          : `${text.addExpense}: ${draft.title} (${formatAmount(draft.amountMinor, activeGroup.currency)})`,
      );
      setExpenseComposerOpen(false);
      setEditingExpense(null);
      showToast(editingId ? `${text.editExpense}: ${draft.title}` : `${text.addExpense}: ${draft.title}`);
    } catch (error) {
      showToast(`${text.cloudSyncFailedPrefix}${(error as Error).message}`);
    }
  }

  function openExpenseDetail(expenseId: string) {
    setSelectedExpenseId(expenseId);
    setDialog("expenseDetail");
  }

  function openExpenseEdit(expense: Expense) {
    setDialog(null);
    setSelectedExpenseId("");
    setEditingExpense(expense);
    setExpenseComposerOpen(true);
  }

  async function deleteExpense(expense: Expense) {
    if (!activeGroup || !cloudStore) return;
    // Capture the target group up front so undo re-creates the expense in the
    // right group even if the user navigates away before tapping 復原.
    const groupId = activeGroup.id;
    const groupCurrency = activeGroup.currency;

    try {
      await cloudStore.deleteExpense(groupId, expense.id);
      recordCloudActivity(groupId, `${text.deleteExpense}: ${expense.title}`);
      setDialog(null);
      setSelectedExpenseId("");
      showToast(`${text.deleteExpense}: ${expense.title}`, {
        label: text.undo,
        onAction: () => restoreExpense(groupId, groupCurrency, expense),
      });
    } catch (error) {
      showToast(`${text.cloudSyncFailedPrefix}${(error as Error).message}`);
    }
  }

  // Re-create a just-deleted expense from its captured snapshot. The recreated
  // expense gets a new id (a delete is not reversible server-side) - that is
  // acceptable; the split, payers, note, image and timestamp are preserved.
  async function restoreExpense(groupId: string, groupCurrency: string, expense: Expense) {
    if (!cloudStore) return;
    if (!beginAction("undoDeleteExpense")) return;

    try {
      await cloudStore.addExpense(groupId, expenseToDraft(expense), groupCurrency);
      recordCloudActivity(groupId, `${text.undoRestored}: ${expense.title}`);
      showToast(text.undoRestored);
    } catch (error) {
      showToast(`${text.cloudSyncFailedPrefix}${(error as Error).message}`);
    } finally {
      endAction();
    }
  }

  async function submitInviteInput() {
    if (!inviteInputValue.trim() || !cloudStore) return;
    if (!beginAction("joinGroup")) return;

    try {
      const group = await cloudStore.acceptInvite(inviteInputValue.trim(), profile.name);
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

  async function settleTransfer(fromId: string, toId: string, amountMinor: number) {
    if (!activeGroup || !cloudStore) return;
    const fromMember = members.find((member) => member.id === fromId);
    const toMember = members.find((member) => member.id === toId);
    if (!fromMember || !toMember) return;
    const actionKey = `settle:${fromId}:${toId}`;
    if (!beginAction(actionKey)) return;

    try {
      await cloudStore.settleTransfer(activeGroup.id, fromId, toId, amountMinor, activeGroup.currency);
      recordCloudActivity(
        activeGroup.id,
        `${text.clearDebt}: ${fromMember.name} → ${toMember.name} ${formatAmount(amountMinor, activeGroup.currency)}`,
      );
      showToast(`${text.clearDebt}: ${fromMember.name} → ${toMember.name}`);
    } catch (error) {
      showToast(`${text.cloudSyncFailedPrefix}${(error as Error).message}`);
    } finally {
      endAction();
    }
  }

  function settleDebt() {
    if (!debt) return;
    settleTransfer(debt.from.id, debt.to.id, debt.amountMinor);
  }

  async function archiveActiveGroup() {
    if (!activeGroup || !cloudStore) return;
    if (!beginAction("archiveGroup")) return;
    setBusy(true);

    try {
      await cloudStore.archiveGroup(activeGroup.id);
      closeGroup();
      setDialog(null);
      showToast(`${text.archiveGroup}: ${activeGroup.name}`);
    } catch (error) {
      showToast(describeCloudActionError(error));
    }
    setBusy(false);
    endAction();
  }

  async function deleteActiveGroup() {
    if (!activeGroup || !cloudStore) return;
    if (!beginAction("deleteGroup")) return;

    try {
      await cloudStore.deleteGroup(activeGroup.id);
      closeGroup();
      setDialog(null);
      showToast(`${text.deleteGroup}: ${activeGroup.name}`);
    } catch (error) {
      showToast(describeCloudActionError(error));
    } finally {
      endAction();
    }
  }

  function openHome() {
    // The Equo brand mark goes to the user's primary (newest) group, or the
    // create-first-group start flow when they have none - never a bare root
    // that would flash the start flow before the routing effect forwards.
    const landingId = resolveRootLanding(cloudGroups);
    if (landingId) {
      openGroup(landingId, "replace");
    } else {
      closeGroup();
    }
  }

  const selectedTemplateLabel = templates.find((template) => template.id === selectedTemplate)?.label ?? text.createGroup;
  const selectedTemplateName = templates.find((template) => template.id === selectedTemplate)?.defaultName ?? "";
  const inviteCode = cloudInviteToken;
  const inviteLink =
    activeGroup && inviteCode && typeof window !== "undefined"
      ? `${window.location.origin}/?invite=${encodeURIComponent(inviteCode)}`
      : "";
  const panelDialogOpen =
    dialog === "archivedList" ||
    dialog === "inviteMembers" ||
    dialog === "memberList" ||
    dialog === "currencyPanel" ||
    dialog === "recordsPanel" ||
    dialog === "analysisPanel";


  if (!session) {
    return (
      <main className="app-shell">
        {toast ? (
          <div className="toast-dock" role="status" aria-live="polite">
            <span className={busy ? "pulse-dot active" : "pulse-dot"} />
            <p>{toast.text}</p>
            {toast.action ? (
              <button className="toast-action" type="button" onClick={toast.action.onAction}>
                {toast.action.label}
              </button>
            ) : null}
          </div>
        ) : null}
        <LoginScreen
          loading={authLoading}
          errorMessage={authError || undefined}
          onGoogleLogin={startGoogleLogin}
          onAppleLogin={() => showToast(`${UI_TEXT.login.appleLogin}${UI_TEXT.login.appleComingSoon}`)}
        />
      </main>
    );
  }

  return (
    <main className="app-shell">
      {pullStatus !== "idle" ? (
        <div className="ptr-indicator" role="status" aria-live="polite">
          {pullStatus === "refreshing" ? "重新整理中…" : pullStatus === "armed" ? "放開以重新整理" : "下拉重新整理"}
        </div>
      ) : null}
      <header className="top-bar">
        {activeGroup ? (
          <button className="top-bar-icon-button mobile-only" type="button" aria-label={text.groupList} inert={!isMobileLayout} aria-hidden={!isMobileLayout || undefined} onClick={() => setGroupDrawerOpen(true)}>
            <Menu aria-hidden="true" size={22} />
          </button>
        ) : null}
        <button className="brand-mark" type="button" onClick={openHome}>
          Equo
        </button>
        <div className="top-actions">
          <button
            className="top-bar-icon-button theme-toggle-button"
            type="button"
            aria-label={theme === "light" ? text.themeToDark : text.themeToLight}
            onClick={toggleTheme}
          >
            {theme === "light" ? <Moon aria-hidden="true" size={20} /> : <Sun aria-hidden="true" size={20} />}
          </button>
          {activeGroup ? (
            <button className="top-bar-icon-button mobile-only" type="button" aria-label={text.groupManage} inert={!isMobileLayout} aria-hidden={!isMobileLayout || undefined} onClick={() => setSettingsDrawerOpen(true)}>
              <Settings aria-hidden="true" size={22} />
            </button>
          ) : (
            <button className="profile-dot" type="button" aria-label={text.profile} onClick={openProfileDialog}>
              <UserRound aria-hidden="true" size={18} />
            </button>
          )}
        </div>
      </header>

      {toast ? (
        <div className="toast-dock" role="status" aria-live="polite">
          <span className={busy ? "pulse-dot active" : "pulse-dot"} />
          <p>{toast.text}</p>
          {toast.action ? (
            <button className="toast-action" type="button" onClick={toast.action.onAction}>
              {toast.action.label}
            </button>
          ) : null}
        </div>
      ) : null}

      {!activeGroup && (!cloudState || cloudState.loadingGroups) ? (
        <section className="workspace-grid">
          <div className="group-home-card glass-panel cloud-loading-skeleton" aria-busy="true">
            <span className="pulse-dot active" />
          </div>
        </section>
      ) : !activeGroup ? (
        <StartFlow
          groups={displayGroups}
          groupName={groupName}
          groupNamePlaceholder={selectedTemplateName}
          isCreatingGroup={pendingAction === "createGroup"}
          selectedTemplate={selectedTemplate}
          selectedTemplateLabel={selectedTemplateLabel}
          startMode={startMode}
          templates={templates}
          onCreateGroup={createGroup}
          onGroupNameChange={setGroupName}
          onSelectGroup={selectGroup}
          onSelectTemplate={(template) => {
            // Only switch the selected template - the name field stays whatever
            // the user typed, with the template name shown as a placeholder.
            setSelectedTemplate(template.id);
          }}
          onSetStartMode={setStartMode}
          onOpenInviteInput={() => setDialog("inviteInput")}
        />
      ) : (
        <section className="workspace-grid">
          <GroupRail
            activeGroup={activeGroup}
            groups={displayGroups}
            inert={isMobileLayout}
            onCreateGroup={openCreateGroupDialog}
            onOpenArchivedGroups={openArchivedGroups}
            onRefresh={() => showToast("\u5df2\u91cd\u65b0\u6574\u7406\u76ee\u524d\u7fa4\u7d44\u3002")}
            onSelectGroup={selectGroup}
            onShowInviteCode={() => setDialog("inviteInput")}
          />

          {groupDrawerOpen ? (
            <div className={groupDrawerSwipe.closing ? "side-drawer-backdrop closing" : "side-drawer-backdrop"} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) groupDrawerSwipe.requestClose(); }}>
              <div className={groupDrawerSwipe.closing ? "side-drawer side-drawer-left closing" : "side-drawer side-drawer-left"} role="dialog" aria-modal="true" aria-label={text.groupList} {...groupDrawerSwipe.dragProps}>
                <GroupRail
                  activeGroup={activeGroup}
                  groups={displayGroups}
                  onCreateGroup={() => { setGroupDrawerOpen(false); openCreateGroupDialog(); }}
                  onOpenArchivedGroups={() => { setGroupDrawerOpen(false); openArchivedGroups(); }}
                  onRefresh={() => showToast("\u5df2\u91cd\u65b0\u6574\u7406\u76ee\u524d\u7fa4\u7d44\u3002")}
                  onSelectGroup={selectGroup}
                  onShowInviteCode={() => { setGroupDrawerOpen(false); setDialog("inviteInput"); }}
                />
              </div>
            </div>
          ) : null}

          <section className="group-room pizo-home" aria-label={text.groupHome}>
            {cloudActiveLoading && !cloudActiveDetail ? (
              <div className="group-home-card glass-panel cloud-loading-skeleton" aria-busy="true">
                <span className="pulse-dot active" />
              </div>
            ) : null}
            <article className="group-home-card glass-panel" id="group-home">
              <div className="home-title-row">
                <div>
                  <h2>{activeGroup.name}</h2>
                  <p>
                    {text.members} <strong>{members.length}</strong> {text.total} <strong>{formatAmount(totalExpenseMinor, activeGroup.currency)}</strong>
                  </p>
                </div>
              </div>

              <div className="hero-summary-grid" id="group-members" aria-label={text.members}>
                <div className="hero-member-summary">
                  <div className="hero-avatar-stack" aria-label={text.members}>
                    {members.map((member) => (
                      <MemberAvatar
                        className="hero-avatar"
                        key={member.id}
                        name={member.name}
                        avatarUrl={member.avatarUrl}
                      />
                    ))}
                  </div>
                  <div className="hero-balance-list" aria-label={text.analysis}>
                    {members.slice(0, 2).map((member) => (
                      <div className="hero-balance-row" key={member.id}>
                        <MemberAvatar className="member-avatar" name={member.name} avatarUrl={member.avatarUrl} />
                        <span>
                          {member.name}
                          {member.role === "owner" ? <small>{text.owner}</small> : null}
                        </span>
                        <strong>{formatSigned(balances.get(member.id) ?? 0, activeGroup.currency)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="hero-donut" aria-label={text.debt}>
                  <div className="hero-donut-ring">
                    <div>
                      <span>{debt?.to.name ?? text.settled}</span>
                      <strong>{debt ? formatAmount(debt.amountMinor, activeGroup.currency) : formatAmount(0, activeGroup.currency)}</strong>
                    </div>
                  </div>
                </div>
              </div>

              <div className="member-quick-actions">
                <button className="primary-action" type="button" onClick={() => setDialog("memberActions")}>
                  <UserRound aria-hidden="true" size={18} />
                  {text.addMember}
                </button>
                <button className="secondary-action" type="button" onClick={openInviteMembers}>
                  <Inbox aria-hidden="true" size={18} />
                  {text.inviteMembers}
                </button>
              </div>
            </article>

            <section className="spending-card glass-panel" id="group-analysis" aria-label={text.personalSpend}>
              <div className="section-title-row">
                <div className="tab-pair" aria-label={text.personalSpend}>
                  <button className={spendTab === "personal" ? "soft-tab active" : "soft-tab"} type="button" onClick={() => setSpendTab("personal")}>
                    {text.personalSpend}
                  </button>
                  <button className={spendTab === "group" ? "soft-tab active" : "soft-tab"} type="button" onClick={() => setSpendTab("group")}>
                    {text.groupSpend}
                  </button>
                </div>
                <button className="text-action" type="button" onClick={() => setDialog("analysisPanel")}>
                  {text.viewAll} <ChevronRight aria-hidden="true" size={14} />
                </button>
              </div>
              <div className="spending-date-row">
                <div>
                  <span>{selectedDateChip ? `${selectedDateChip.month}月${selectedDateChip.day}日` : `${new Date().getMonth() + 1}月${new Date().getDate()}日`}</span>
                  <strong>{formatAmount(spendDisplayAmountMinor, activeGroup.currency)}</strong>
                </div>
                <div className="date-chip-row" aria-label="日期">
                  {dateChips.map((chip) => (
                    <button
                      className={chip.key === selectedDateKey ? "date-chip active" : "date-chip"}
                      type="button"
                      key={chip.key}
                      onClick={() => setSelectedDateKey(chip.key)}
                    >
                      {chip.day}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="home-section pizo-debt-section" aria-label={text.debt}>
              <div className="section-title-row">
                <h3>{text.debt}</h3>
                <button className="text-action" type="button" onClick={() => setDialog("analysisPanel")}>
                  {text.viewAll} <ChevronRight aria-hidden="true" size={14} />
                </button>
              </div>
              <div className="pizo-debt-card">
                {debt ? (
                  <>
                    <div className="pizo-debt-person">
                      <MemberAvatar className="member-avatar lime" name={debt.from.name} avatarUrl={debt.from.avatarUrl} />
                      <strong>{debt.from.name}</strong>
                    </div>
                    <div className="pizo-debt-center">
                      <span>{text.needPay}</span>
                      <b>{"\u2192"}</b>
                      <strong>{formatAmount(debt.amountMinor, activeGroup.currency)}</strong>
                    </div>
                    <div className="pizo-debt-person right">
                      <MemberAvatar className="member-avatar photo" name={debt.to.name} avatarUrl={debt.to.avatarUrl} />
                      <strong>{debt.to.name}</strong>
                    </div>
                  </>
                ) : (
                  <div className="pizo-debt-empty">{text.settled}</div>
                )}
                {debt ? (
                  <button
                    className="settlement-clear-action"
                    type="button"
                    disabled={pendingAction === `settle:${debt.from.id}:${debt.to.id}`}
                    onClick={settleDebt}
                  >
                    {pendingAction === `settle:${debt.from.id}:${debt.to.id}` ? text.processing : text.clearDebt}
                  </button>
                ) : null}
              </div>
              {extraTransferCount > 0 ? (
                <button className="text-action settlement-more-line" type="button" onClick={() => setDialog("analysisPanel")}>
                  {`${UI_TEXT.settlement.moreTransfersPrefix} ${extraTransferCount} ${UI_TEXT.settlement.moreTransfersSuffix}`}
                </button>
              ) : null}
            </section>

            <section className="home-section pizo-record-section" id="group-records" aria-label={text.records}>
              <div className="section-title-row">
                <h3>{text.records}</h3>
                <button className="text-action" type="button" onClick={() => setDialog("recordsPanel")}>
                  {text.viewAll} <ChevronRight aria-hidden="true" size={14} />
                </button>
              </div>
              {expenses.length ? (
                <div className="expense-record-list">
                  {expenses.slice(0, 5).map((expense) => {
                    const payer = members.find((member) => member.id === expense.payerId);
                    const shareMembers = expense.shareMemberIds
                      .map((id) => members.find((member) => member.id === id))
                      .filter((member): member is Member => Boolean(member))
                      .slice(0, 3);
                    const isSettlement = expense.kind === "settlement";
                    const isIncome = expense.kind === "income";
                    const extraPayerCount = (expense.payments?.length ?? 0) - 1;
                    return (
                      <button
                        className="expense-record-row pizo-expense-row"
                        type="button"
                        key={expense.id}
                        onClick={() => openExpenseDetail(expense.id)}
                      >
                        {isSettlement ? (
                          <span className="member-avatar photo settlement-avatar">
                            <History aria-hidden="true" size={16} />
                          </span>
                        ) : isIncome ? (
                          <span className="member-avatar photo income-avatar">
                            <HandCoins aria-hidden="true" size={16} />
                          </span>
                        ) : extraPayerCount > 0 ? (
                          <span className="payer-avatar-stack">
                            <MemberAvatar className="member-avatar photo" name={payer?.name} avatarUrl={payer?.avatarUrl} />
                            <i className="payer-count-badge" aria-hidden="true">{`+${extraPayerCount}`}</i>
                          </span>
                        ) : (
                          <MemberAvatar className="member-avatar photo" name={payer?.name} avatarUrl={payer?.avatarUrl} />
                        )}
                        <span className="expense-record-main">
                          <strong>{expense.title}</strong>
                          <small>{formatTime(expense.createdAt)}</small>
                        </span>
                        <span className={isIncome ? "expense-record-amount amount-income" : "expense-record-amount"}>
                          <small>{expense.currency}</small>
                          {isIncome ? `+${formatAmount(expense.amountMinor, expense.currency)}` : formatAmount(expense.amountMinor, expense.currency)}
                          <i className="mini-avatar-stack" aria-hidden="true">
                            {shareMembers.map((member) => (
                              <em key={member.id}>
                                <MemberAvatar name={member.name} avatarUrl={member.avatarUrl} />
                              </em>
                            ))}
                          </i>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="empty-copy">{text.noRecords}</p>
              )}
            </section>

            <section className="home-section pizo-activity-section" aria-label={text.recentActivity}>
              <div className="section-title-row">
                <h3>{text.recentActivity}</h3>
                <button className="text-action" type="button" onClick={() => setDialog("recordsPanel")}>
                  {text.viewAll} <ChevronRight aria-hidden="true" size={14} />
                </button>
              </div>
              {activities.length ? (
                <div className="pizo-activity-list">
                  {activities.slice(0, 5).map((activity) => (
                    <div className="activity-row pizo-activity-row" key={activity.id}>
                      <strong>{activity.text}</strong>
                      <span>{formatActivityTime(activity.createdAt)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-copy">{text.noActivity}</p>
              )}
            </section>

          </section>

          <aside className="group-side-nav glass-panel" aria-label={text.groupHome} inert={isMobileLayout} aria-hidden={isMobileLayout || undefined}>
            {activeGroup ? (
              <GroupSideNav
                groupName={activeGroup.name}
                groupCurrency={activeGroup.currency}
                coverImageUrl={activeGroup.coverImageUrl}
                memberCount={members.length}
                isOwner={isCurrentMemberOwner}
                onProfile={openProfileDialog}
                onEditGroup={openEditGroup}
                onNavigate={handleSideNavClick}
                onArchive={() => setDialog("archive")}
                onDelete={() => setDialog("delete")}
              />
            ) : null}
          </aside>

          {settingsDrawerOpen ? (
            <div className={settingsDrawerSwipe.closing ? "side-drawer-backdrop closing" : "side-drawer-backdrop"} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) settingsDrawerSwipe.requestClose(); }}>
              <div className={settingsDrawerSwipe.closing ? "side-drawer side-drawer-right closing" : "side-drawer side-drawer-right"} role="dialog" aria-modal="true" aria-label={text.groupManage} {...settingsDrawerSwipe.dragProps}>
                {activeGroup ? (
              <GroupSideNav
                groupName={activeGroup.name}
                groupCurrency={activeGroup.currency}
                coverImageUrl={activeGroup.coverImageUrl}
                memberCount={members.length}
                isOwner={isCurrentMemberOwner}
                onProfile={openProfileDialog}
                onEditGroup={openEditGroup}
                onNavigate={handleSideNavClick}
                onArchive={() => setDialog("archive")}
                onDelete={() => setDialog("delete")}
                onBeforeNavigate={() => setSettingsDrawerOpen(false)}
              />
            ) : null}
              </div>
            </div>
          ) : null}

          <button
            className="floating-action"
            type="button"
            aria-label={text.addExpense}
            inert={isMobileLayout}
            aria-hidden={isMobileLayout || undefined}
            onClick={() => {
              setEditingExpense(null);
              setExpenseComposerOpen(true);
            }}
          >
            <Plus aria-hidden="true" size={34} />
          </button>

          <nav className="mobile-tab-bar" aria-label={text.groupHome} inert={!isMobileLayout} aria-hidden={!isMobileLayout || undefined}>
            <button
              className="mobile-tab-item"
              type="button"
              aria-label={text.navHome}
              onClick={() => {
                setDialog(null);
                setExpenseComposerOpen(false);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              <House aria-hidden="true" size={20} />
              <span>{text.navHome}</span>
            </button>
            <button className="mobile-tab-item" type="button" aria-label={text.navRecords} onClick={() => setDialog("recordsPanel")}>
              <History aria-hidden="true" size={20} />
              <span>{text.navRecords}</span>
            </button>
            <button
              className="mobile-tab-center"
              type="button"
              aria-label={text.addExpense}
              onClick={() => {
                setEditingExpense(null);
                setExpenseComposerOpen(true);
              }}
            >
              <Plus aria-hidden="true" size={26} />
            </button>
            <button className="mobile-tab-item" type="button" aria-label={text.navAnalysis} onClick={() => setDialog("analysisPanel")}>
              <ChartNoAxesColumn aria-hidden="true" size={20} />
              <span>{text.navAnalysis}</span>
            </button>
            <button className="mobile-tab-item" type="button" aria-label={text.navMembers} onClick={openMemberList}>
              <UserRound aria-hidden="true" size={20} />
              <span>{text.navMembers}</span>
            </button>
          </nav>
        </section>
      )}

      {expenseComposerOpen ? (
        <ExpenseComposerSheet
          members={members}
          groupCurrency={activeGroup?.currency ?? "TWD"}
          currencyOptions={currencyOptions}
          initialExpense={editingExpense ?? undefined}
          onClose={() => {
            setExpenseComposerOpen(false);
            setEditingExpense(null);
          }}
          onSubmit={handleExpenseDraftSubmit}
          onImageError={() => showToast(text.photoError)}
        />
      ) : null}

      {dialog === "profile" ? (
        <ProfileDialog
          profile={profile}
          displayAvatarUrl={displayAvatarUrl ?? undefined}
          session={session}
          onClose={() => setDialog(null)}
          onSave={saveProfile}
          onToast={showToast}
          onLogout={signOut}
          onFeedback={() => {
            setDialog(null);
            setFeedbackOpen(true);
          }}
        />
      ) : null}

      {feedbackOpen ? <FeedbackDialog onClose={() => setFeedbackOpen(false)} onSubmit={handleFeedbackSubmit} /> : null}

      {dialog === "expenseDetail" && selectedExpense ? (
        <ExpenseDetailDialog
          expense={selectedExpense}
          members={members}
          onClose={() => {
            setDialog(null);
            setSelectedExpenseId("");
          }}
          onEdit={openExpenseEdit}
          onDelete={deleteExpense}
          onPrev={
            selectedExpenseIndex > 0
              ? () => setSelectedExpenseId(expenses[selectedExpenseIndex - 1].id)
              : undefined
          }
          onNext={
            selectedExpenseIndex >= 0 && selectedExpenseIndex < expenses.length - 1
              ? () => setSelectedExpenseId(expenses[selectedExpenseIndex + 1].id)
              : undefined
          }
        />
      ) : null}

      {dialog && dialog !== "profile" && dialog !== "expenseDetail" ? (
        <div
          className={dialogSwipe.closing ? "modal-backdrop closing" : "modal-backdrop"}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialog(null);
          }}
        >
          <section
            className={`${panelDialogOpen ? "flow-dialog panel-dialog glass-panel" : "flow-dialog glass-panel"}${dialogSwipe.closing ? " closing" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={text.groupHome}
            {...dialogSwipe.dragProps}
          >
            <div className="dialog-drag-handle" aria-hidden="true" />
            <button className="dialog-close" type="button" aria-label={text.cancel} onClick={() => setDialog(null)}>
              <X aria-hidden="true" size={18} />
            </button>

            {dialog === "createGroup" ? (
              <>
                <div className="dialog-header">
                  <h3>{text.createGroup}</h3>
                  <p>{"\u65b0\u7fa4\u7d44\u6703\u7acb\u5373\u51fa\u73fe\u5728\u5de6\u5074\u5217\u8868\u3002"}</p>
                </div>
                <label className="group-edit-cover" aria-label={text.coverImage}>
                  {groupCoverDataUrl ? (
                    <img src={groupCoverDataUrl} alt="" />
                  ) : (
                    <span>
                      <Pencil aria-hidden="true" size={22} />
                    </span>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => handleGroupCoverPick(event.target.files?.[0] ?? null)}
                  />
                </label>
                <label>
                  <span>{text.name}</span>
                  <input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder={selectedTemplateName} aria-label={text.groupName} />
                </label>
                <div className="dialog-action-row">
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => {
                      setDialog(null);
                      setGroupCoverDataUrl("");
                    }}
                  >
                    {text.cancel}
                  </button>
                  <button className="primary-action" type="button" disabled={!groupName.trim() || pendingAction === "createGroup"} onClick={createGroup}>
                    {pendingAction === "createGroup" ? text.creatingGroup : text.createGroup}
                  </button>
                </div>
              </>
            ) : null}

            {dialog === "editGroup" ? (
              <>
                <div className="dialog-header">
                  <h3>{text.editGroup}</h3>
                  <p>{"\u66f4\u65b0\u7fa4\u7d44\u540d\u7a31\uff0c\u53f3\u5074\u8207\u5de6\u5074\u5217\u8868\u6703\u540c\u6b65\u986f\u793a\u3002"}</p>
                </div>
                <label className="group-edit-cover" aria-label={text.coverImage}>
                  {groupCoverDataUrl || groupCoverUrl ? (
                    <img src={groupCoverDataUrl || groupCoverUrl} alt="" />
                  ) : (
                    <span>
                      <Pencil aria-hidden="true" size={22} />
                    </span>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => handleGroupCoverPick(event.target.files?.[0] ?? null)}
                  />
                </label>
                <label>
                  <span>{text.name}</span>
                  <input value={groupName} onChange={(event) => setGroupName(event.target.value)} aria-label={text.groupName} />
                </label>
                <label>
                  <span>{text.currency}</span>
                  <input value={activeGroup?.currency ?? "TWD"} aria-label={text.currency} readOnly />
                </label>
                <div className="dialog-action-row">
                  <button className="secondary-action" type="button" onClick={() => setDialog(null)}>
                    {text.cancel}
                  </button>
                  <button className="primary-action" type="button" disabled={!groupName.trim() || pendingAction === "editGroup"} onClick={updateActiveGroup}>
                    {pendingAction === "editGroup" ? text.savingChanges : text.save}
                  </button>
                </div>
              </>
            ) : null}

            {dialog === "currencyPanel" ? (
              <>
                <div className="dialog-header">
                  <h3>{text.currency}</h3>
                  <p>{"\u9078\u64c7\u9019\u500b\u7fa4\u7d44\u7684\u9810\u8a2d\u5e63\u5225\u3002"}</p>
                </div>
                <div className="currency-list" aria-label={text.currency}>
                  {currencyOptions.map((currency) => (
                    <button
                      className={currency.code === activeGroup?.currency ? "currency-option active" : "currency-option"}
                      type="button"
                      key={currency.code}
                      onClick={() => updateActiveCurrency(currency.code)}
                    >
                      <span>{currency.label}</span>
                      <strong>{currency.code}</strong>
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {dialog === "recordsPanel" ? (
              <RecordsPanel
                expenseCount={aggregates.expenseCount}
                totalExpenseMinor={totalExpenseMinor}
                currency={activeGroup?.currency ?? "TWD"}
                expenses={expenses}
                activities={activities}
                canLoadMoreExpenses={canLoadMoreExpenses}
                loadingMoreExpenses={loadingMoreExpenses}
                pendingAction={pendingAction}
                onLoadMore={handleLoadMoreExpenses}
                onExportCsv={handleExportCsv}
                onOpenExpense={openExpenseDetail}
              />
            ) : null}

            {dialog === "analysisPanel" ? (
              <AnalysisPanel
                totalExpenseMinor={totalExpenseMinor}
                currency={activeGroup?.currency ?? "TWD"}
                members={members}
                balances={balances}
                maxBalanceMinor={maxBalanceMinor}
                debtAmountMinor={debt?.amountMinor ?? 0}
                settlementTransfers={settlementTransfers}
                settlementRecords={settlementRecords}
                dateChips={dateChips}
                spendByDay={aggregates.spendByDay}
                spendByCategory={aggregates.spendByCategory}
                selectedDateKey={selectedDateKey}
                pendingAction={pendingAction}
                onSelectDate={setSelectedDateKey}
                onSettleTransfer={settleTransfer}
              />
            ) : null}

            {dialog === "memberActions" ? (
              <>
                <div className="dialog-header">
                  <h3>{text.addMember}</h3>
                  <p>{"\u9080\u8acb\u771f\u5be6\u6210\u54e1\uff0c\u6216\u5148\u5efa\u7acb\u865b\u64ec\u6210\u54e1\u4f86\u8a18\u9304\u5206\u5e33\u3002"}</p>
                </div>
                <div className="dialog-option-list">
                  <button className="dialog-option" type="button" onClick={openInviteMembers}>
                    <Inbox aria-hidden="true" size={20} />
                    <span>
                      <strong>{text.inviteMembers}</strong>
                      <small>{"\u8907\u88fd\u9080\u8acb\u78bc\u6216\u9023\u7d50\u7d66\u670b\u53cb\u3002"}</small>
                    </span>
                  </button>
                  <button className="dialog-option" type="button" onClick={() => setDialog("virtualMember")}>
                    <UserRound aria-hidden="true" size={20} />
                    <span>
                      <strong>{text.addVirtualMember}</strong>
                      <small>{"適合幫沒有帳號的人代記支出。"}</small>
                    </span>
                  </button>
                </div>
              </>
            ) : null}

            {dialog === "inviteMembers" ? (
              <>
                <div className="dialog-header">
                  <h3>{text.inviteMembers}</h3>
                  <p>{`${text.inviteMembers}: ${activeGroup?.name ?? ""}`}</p>
                </div>
                <div className="invite-dialog-card">
                  <div className="invite-dialog-code">
                    <span>{text.inviteCode}</span>
                    <strong>{cloudInviteLoading ? "..." : inviteCode}</strong>
                  </div>
                  <div className="invite-link-box">
                    <span>{text.inviteLink}</span>
                    <strong>{cloudInviteLoading ? "..." : inviteLink}</strong>
                  </div>
                  <div className="invite-action-grid">
                    <button className="secondary-action" type="button" onClick={() => copyInviteText(inviteCode)}>
                      <Copy aria-hidden="true" size={18} />
                      {text.copyCode}
                    </button>
                    <button className="primary-action" type="button" onClick={() => copyInviteText(inviteLink)}>
                      <Link aria-hidden="true" size={18} />
                      {text.copyLink}
                    </button>
                  </div>
                </div>
              </>
            ) : null}

            {dialog === "inviteInput" ? (
              <>
                <div className="dialog-header">
                  <h3>{text.inviteInputTitle}</h3>
                  <p>{text.inviteInputDescription}</p>
                </div>
                <label>
                  <span>{text.inviteCode}</span>
                  <input
                    value={inviteInputValue}
                    onChange={(event) => {
                      setInviteInputValue(event.target.value);
                      setInviteInputError("");
                    }}
                    placeholder={text.inviteInputPlaceholder}
                    aria-label={text.inviteCode}
                  />
                </label>
                {inviteInputError ? <p className="dialog-inline-error">{inviteInputError}</p> : null}
                <div className="dialog-action-row">
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => {
                      setDialog(null);
                      setInviteInputValue("");
                      setInviteInputError("");
                    }}
                  >
                    {text.cancel}
                  </button>
                  <button
                    className="primary-action"
                    type="button"
                    disabled={!inviteInputValue.trim() || pendingAction === "joinGroup"}
                    onClick={submitInviteInput}
                  >
                    {pendingAction === "joinGroup" ? text.joiningGroup : text.joinGroupAction}
                  </button>
                </div>
              </>
            ) : null}

            {dialog === "memberList" ? (
              <MemberListPanel
                members={members}
                balances={balances}
                currency={activeGroup?.currency ?? "TWD"}
                renamingMemberId={renamingMemberId}
                renameMemberValue={renameMemberValue}
                confirmingRemoveMemberId={confirmingRemoveMemberId}
                pendingAction={pendingAction}
                onRenameValueChange={setRenameMemberValue}
                onStartRename={startRenameMember}
                onCancelRename={cancelRenameMember}
                onSubmitRename={submitRenameMember}
                onRemove={removeMember}
                onInvite={openInviteMembers}
                onAddVirtualMember={() => setDialog("virtualMember")}
              />
            ) : null}

            {dialog === "virtualMember" ? (
              <>
                <div className="dialog-header">
                  <h3>{text.addVirtualMember}</h3>
                  <p>{"\u8f38\u5165\u540d\u7a31\u5f8c\uff0c\u9019\u4f4d\u6210\u54e1\u6703\u7acb\u5373\u51fa\u73fe\u5728\u7fa4\u7d44\u5167\u3002"}</p>
                </div>
                <label>
                  <span>{text.virtualMemberName}</span>
                  <input
                    value={virtualMemberName}
                    onChange={(event) => setVirtualMemberName(event.target.value)}
                    placeholder="輸入成員名稱"
                    aria-label={text.virtualMemberName}
                  />
                </label>
                <div className="dialog-action-row">
                  <button className="secondary-action" type="button" onClick={() => setDialog(null)}>
                    {text.cancel}
                  </button>
                  <button
                    className="primary-action"
                    type="button"
                    disabled={!virtualMemberName.trim() || pendingAction === "addVirtualMember"}
                    onClick={addVirtualMember}
                  >
                    {pendingAction === "addVirtualMember" ? text.processing : text.addMember}
                  </button>
                </div>
              </>
            ) : null}

            {dialog === "archivedList" ? (
              <ArchivedListPanel
                archivedGroups={archivedGroups}
                loading={archivedGroupsLoading}
                unarchivingGroupId={unarchivingGroupId}
                onUnarchive={unarchiveGroup}
              />
            ) : null}

            {dialog === "archive" || dialog === "delete" ? (
              <>
                <div className="dialog-header centered">
                  <AlertTriangle aria-hidden="true" size={28} />
                  <h3>{dialog === "archive" ? text.archiveGroup : text.deleteGroup}</h3>
                  <p>{dialog === "archive" ? "\u5c01\u5b58\u5f8c\u53ef\u5f9e\u5de6\u5074\u4e0a\u65b9\u7684\u5c01\u5b58\u5165\u53e3\u67e5\u770b\u3002" : "刪除後這個群組與所有記錄將永久移除，無法復原。"}</p>
                </div>
                <div className="dialog-action-row">
                  <button className="secondary-action" type="button" onClick={() => setDialog(null)}>
                    {text.cancel}
                  </button>
                  <button
                    className={dialog === "delete" ? "danger-action" : "primary-action"}
                    type="button"
                    disabled={pendingAction === "archiveGroup" || pendingAction === "deleteGroup"}
                    onClick={dialog === "archive" ? archiveActiveGroup : deleteActiveGroup}
                  >
                    {pendingAction === "archiveGroup" || pendingAction === "deleteGroup" ? text.processing : text.confirm}
                  </button>
                </div>
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}
