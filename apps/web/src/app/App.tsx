import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  Archive,
  ChartNoAxesColumn,
  Check,
  ChevronRight,
  CircleDollarSign,
  Copy,
  HandCoins,
  History,
  House,
  Inbox,
  Link,
  Menu,
  Pencil,
  Plus,
  ReceiptText,
  Settings,
  Trash2,
  UserMinus,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { createActionGuard } from "./actionGuard";
import { createAutoSync } from "./autoSync";
import { buildSettlementTransfers } from "./buildSettlementTransfers";
import { createApiClient, type ExpenseSummary } from "./apiClient";
import { buildExpenseCsv, csvFileName } from "./expenseCsv";
import { listSettlementRecords } from "./settlementHistory";
import { SpendBarChart } from "./SpendBarChart";
import { clearCloudCache } from "./cloudCache";
import { createCloudGroupsStore, type ArchivedGroupData, type CloudGroupsStore } from "./cloudStore";
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
import { buildAuthorizeUrl, parseOAuthFragment } from "./supabaseOAuth";
import type { Activity, Expense, Group, Member, StartMode } from "./appTypes";
import { formatAmount, formatSigned } from "./formatAmount";
import { DEFAULT_PROFILE, PROFILE_KEY, normalizeProfile, type ProfileData } from "./profileStore";
import { clearSession, loadSession, saveSession, type StoredSession } from "./sessionStore";
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

const sideNavItems: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: "home", label: text.groupHome, icon: House },
  { id: "currency", label: text.currency, icon: CircleDollarSign },
  { id: "records", label: text.records, icon: History },
  { id: "analysis", label: text.analysis, icon: ChartNoAxesColumn },
  { id: "members", label: text.members, icon: UserRound },
];

const currencyOptions = [
  { code: "TWD", label: UI_TEXT.currencies.twd },
  { code: "JPY", label: UI_TEXT.currencies.jpy },
  { code: "USD", label: UI_TEXT.currencies.usd },
  { code: "KRW", label: UI_TEXT.currencies.krw },
  { code: "EUR", label: UI_TEXT.currencies.eur },
];

function dateKey(value: string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function lastEightDays() {
  const days: { key: string; day: number; month: number }[] = [];
  for (let offset = 7; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    days.push({ key: dateKey(date.toISOString()), day: date.getDate(), month: date.getMonth() + 1 });
  }
  return days;
}

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

function getRouteGroupId() {
  const match = window.location.pathname.match(/^\/group\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function setGroupRoute(groupId: string | null, mode: "push" | "replace" = "push") {
  const nextPath = groupId ? `/group/${encodeURIComponent(groupId)}` : "/";
  if (window.location.pathname === nextPath) return;
  if (mode === "replace") {
    window.history.replaceState(null, document.title, nextPath);
  } else {
    window.history.pushState(null, document.title, nextPath);
  }
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

function formatActivityTime(value: string) {
  const date = new Date(value);
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${String(
    date.getHours(),
  ).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function App() {
  const [activeGroupId, setActiveGroupId] = useState(() => getRouteGroupId());
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
  const [toast, setToast] = useState<{
    id: number;
    text: string;
    action?: { label: string; onAction: () => void };
  } | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  // pendingAction gates every mutation control's disabled/busy label. The
  // guard (see actionGuard.ts) is the synchronous double-submit check -
  // begin()/end() mutate a plain field, not React state, so two clicks in
  // the same tick can't both pass; pendingAction (state) just re-renders the
  // button to show the busy label.
  const actionGuardRef = useRef(createActionGuard());
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [spendTab, setSpendTab] = useState<"personal" | "group">("personal");
  const [selectedDateKey, setSelectedDateKey] = useState(() => dateKey(new Date().toISOString()));
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  // Tracks the responsive breakpoint independently of CSS so the desktop
  // rails and the mobile tab bar can be made inert/aria-hidden when hidden -
  // a display:none in CSS alone still leaves the buttons in the a11y tree.
  const [isMobileLayout, setIsMobileLayout] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches,
  );
  const [inviteInputValue, setInviteInputValue] = useState("");
  const [inviteInputError, setInviteInputError] = useState("");
  const [profile, setProfile] = useState<ProfileData>(() => normalizeProfile(readJson<Partial<ProfileData>>(PROFILE_KEY, DEFAULT_PROFILE)));
  const [session, setSession] = useState<StoredSession | null>(() => loadSession(Date.now()));
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
  const [selectedExpenseId, setSelectedExpenseId] = useState<string>("");
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [cloudInviteToken, setCloudInviteToken] = useState("");
  const [cloudInviteLoading, setCloudInviteLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [cloudActivities, setCloudActivities] = useState<Record<string, Activity[]>>(() =>
    readJson<Record<string, Activity[]>>(CLOUD_ACTIVITIES_KEY, {}),
  );
  const [archivedGroups, setArchivedGroups] = useState<ArchivedGroupData[]>([]);
  const [archivedGroupsLoading, setArchivedGroupsLoading] = useState(false);
  const [unarchivingGroupId, setUnarchivingGroupId] = useState<string>("");
  const [groupCoverDataUrl, setGroupCoverDataUrl] = useState<string>("");
  const [groupCoverUrl, setGroupCoverUrl] = useState<string>("");
  const cloudInviteGroupIdRef = useRef("");

  function handleSessionExpired() {
    clearSession();
    clearCloudCache();
    setSession(null);
    showToast(text.sessionExpired);
  }

  const cloudStore = useMemo<CloudGroupsStore | null>(() => {
    if (!session) return null;
    return createCloudGroupsStore({
      apiClient: createApiClient({ authToken: session.token }),
      onSessionExpired: handleSessionExpired,
      userId: session.user.id,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  const cloudState = useSyncExternalStore(
    (listener) => (cloudStore ? cloudStore.subscribe(listener) : () => {}),
    () => (cloudStore ? cloudStore.getState() : null),
    () => (cloudStore ? cloudStore.getState() : null),
  );

  useEffect(() => {
    if (!cloudStore) return;
    cloudStore.refreshGroups().catch(() => showToast(`${text.cloudSyncFailedPrefix}${text.groupNotFound}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudStore]);

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
  const aggregates = cloudActiveDetail?.aggregates ?? { expenseCount: 0, spendTotalMinor: 0, spendByDay: [], memberDayShares: [] };
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

  async function handleExportCsv() {
    if (!activeGroup || !session) return;
    if (!beginAction("exportCsv")) return;
    try {
      // The loaded window may be paginated - walk listExpensesPage until a
      // short page so the export always covers the group's full history.
      const client = createApiClient({ authToken: session.token });
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
    const routeId = getRouteGroupId();
    if (!routeId) {
      // Root URL: land the user on their most-recent group instead of the
      // create-first-group start flow. Groups are loaded here (the guard
      // above cleared loadingGroups); a null landing means zero groups, so
      // fall through to the StartFlow empty state. Once forwarded, the route
      // is no longer empty, so this branch won't re-fire (no redirect loop).
      const landingId = resolveRootLanding(cloudGroups);
      if (landingId) {
        setActiveGroupId(landingId);
        setGroupRoute(landingId, "replace");
      }
      return;
    }
    const routeGroupExists = cloudGroups.some((group) => group.id === routeId);
    if (routeId === activeGroupId) {
      if (!routeGroupExists) {
        setActiveGroupId("");
        setGroupRoute(null, "replace");
        showToast(text.groupNotFound);
      }
      return;
    }
    if (routeGroupExists) {
      setActiveGroupId(routeId);
      return;
    }
    setActiveGroupId("");
    setGroupRoute(null, "replace");
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

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 960px)");
    const update = () => setIsMobileLayout(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // Stash any ?invite=TOKEN before the OAuth redirect (or immediately, if
  // already logged in) so it survives the round-trip and query-param loss.
  useEffect(() => {
    const token = getInviteTokenFromUrl();
    if (!token) return;
    clearInviteTokenFromUrl();
    window.sessionStorage.setItem(PENDING_INVITE_KEY, token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // OAuth fragment handling: exchange an access_token for a session on boot,
  // or surface an OAuth error. Runs once.
  useEffect(() => {
    const parsed = parseOAuthFragment(window.location.hash);
    if (!parsed) return;

    window.history.replaceState(null, document.title, window.location.pathname + window.location.search);

    if ("error" in parsed) {
      setAuthError(`${UI_TEXT.login.oauthErrorPrefix}${parsed.error}`);
      return;
    }

    setAuthLoading(true);
    const client = createApiClient({ authToken: "" });
    client
      .exchangeSupabaseToken(parsed.accessToken)
      .then(({ session: nextSession }) => {
        const stored: StoredSession = {
          token: nextSession.token,
          expiresAt: nextSession.expires_at,
          user: {
            id: nextSession.user.id,
            email: nextSession.user.email,
            displayName: nextSession.user.display_name,
            avatarUrl: nextSession.user.avatar_url ?? undefined,
          },
        };
        saveSession(stored);
        setSession(stored);
        setProfile((current) => {
          if (current.name !== DEFAULT_PROFILE.name) return current;
          return normalizeProfile({ ...current, name: stored.user.displayName });
        });
        showToast(`${text.loginSuccessPrefix}${stored.user.displayName}`);
      })
      .catch((error: { code?: string }) => {
        setAuthError(error?.code === "ACCOUNT_DISABLED" ? text.accountDisabled : text.loginFailed);
      })
      .finally(() => {
        setAuthLoading(false);
      });
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

  function showToast(message: string, action?: { label: string; onAction: () => void }) {
    if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
    const id = Date.now();
    setToast({ id, text: message, action });
    // Actionable toasts (e.g. an undo) linger longer so the user has time to
    // reach the button before it auto-dismisses.
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, action ? 6000 : 2600);
  }

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
    setActiveGroupId(group.id);
    setGroupRoute(group.id);
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
      setActiveGroupId(group.id);
      setGroupRoute(group.id, "replace");
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

  async function openArchivedGroups() {
    if (!cloudStore) return;
    setDialog("archivedList");
    setArchivedGroupsLoading(true);
    try {
      const groups = await cloudStore.listArchivedGroups();
      setArchivedGroups(groups);
    } catch (error) {
      showToast(`${text.cloudSyncFailedPrefix}${(error as Error).message}`);
    } finally {
      setArchivedGroupsLoading(false);
    }
  }

  async function unarchiveGroup(group: ArchivedGroupData) {
    if (!cloudStore || unarchivingGroupId) return;
    // Defense in depth: the restore button itself is only rendered for
    // groups the caller owns (see the archivedList dialog below), but this
    // guards the handler directly too in case that ever drifts.
    if (group.callerMemberId !== group.ownerMemberId) {
      showToast(text.ownerOnlyAction);
      return;
    }
    setUnarchivingGroupId(group.id);
    try {
      await cloudStore.unarchiveGroup(group.id);
      setArchivedGroups((current) => current.filter((item) => item.id !== group.id));
      showToast(`${text.restoredGroupPrefix}${group.name}`);
    } catch (error) {
      showToast(describeCloudActionError(error));
    } finally {
      setUnarchivingGroupId("");
    }
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

  function startGoogleLogin() {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    if (!supabaseUrl) {
      showToast(UI_TEXT.login.missingSupabaseUrl);
      return;
    }
    window.location.href = buildAuthorizeUrl(supabaseUrl, window.location.origin);
  }

  function logout() {
    clearSession();
    clearCloudCache();
    setSession(null);
    setActiveGroupId("");
    setGroupRoute(null, "replace");
    showToast(text.logoutSuccess);
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
        const apiClient = createApiClient({ authToken: session.token });
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
      setActiveGroupId(group.id);
      setGroupRoute(group.id);
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
      setActiveGroupId("");
      setGroupRoute(null);
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
      setActiveGroupId("");
      setGroupRoute(null);
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
      setActiveGroupId(landingId);
      setGroupRoute(landingId, "replace");
    } else {
      setActiveGroupId("");
      setGroupRoute(null);
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

  function renderGroupSideNavContent(insideDrawer = false) {
    if (!activeGroup) return null;
    const closeDrawer = () => {
      if (insideDrawer) setSettingsDrawerOpen(false);
    };
    return (
      <>
        <div className="profile-dot-row">
          <button
            className="profile-dot"
            type="button"
            aria-label={text.profile}
            onClick={() => {
              closeDrawer();
              openProfileDialog();
            }}
          >
            <UserRound aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="side-group-card">
          <div className="side-cover">
            {activeGroup.coverImageUrl ? <img src={activeGroup.coverImageUrl} alt="" /> : null}
          </div>
          <div className="side-group-name">
            <div className="side-group-title-row">
              <h2>{activeGroup.name}</h2>
              {isCurrentMemberOwner ? (
                <button
                  className="side-edit-group"
                  type="button"
                  aria-label={text.editGroup}
                  onClick={() => {
                    closeDrawer();
                    openEditGroup();
                  }}
                >
                  <Pencil aria-hidden="true" size={15} />
                </button>
              ) : null}
            </div>
            <span>
              {members.length} {text.people}
            </span>
          </div>
        </div>
        <nav className="side-nav-list" aria-label={text.groupHome}>
          {sideNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={item.id === "home" ? "side-nav-item active" : "side-nav-item"}
                type="button"
                key={item.id}
                onClick={() => {
                  closeDrawer();
                  handleSideNavClick(item.id);
                }}
              >
                <Icon aria-hidden="true" size={19} />
                {item.id === "currency" ? `${item.label} ${activeGroup.currency}` : item.label}
              </button>
            );
          })}
        </nav>
        {isCurrentMemberOwner ? (
          <div className="side-danger-actions">
            <button
              className="side-archive-action"
              type="button"
              onClick={() => {
                closeDrawer();
                setDialog("archive");
              }}
            >
              <Archive aria-hidden="true" size={16} />
              {text.archiveGroup}
            </button>
            <button
              className="side-delete-action"
              type="button"
              onClick={() => {
                closeDrawer();
                setDialog("delete");
              }}
            >
              <Trash2 aria-hidden="true" size={16} />
              {text.deleteGroup}
            </button>
          </div>
        ) : null}
      </>
    );
  }

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
            <div className="side-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setGroupDrawerOpen(false); }}>
              <div className="side-drawer side-drawer-left" role="dialog" aria-modal="true" aria-label={text.groupList}>
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
            {renderGroupSideNavContent()}
          </aside>

          {settingsDrawerOpen ? (
            <div className="side-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsDrawerOpen(false); }}>
              <div className="side-drawer side-drawer-right" role="dialog" aria-modal="true" aria-label={text.groupManage}>
                {renderGroupSideNavContent(true)}
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
          onLogout={logout}
        />
      ) : null}

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
              <>
                <div className="dialog-header">
                  <h3>{text.records}</h3>
                  <p>{"\u67e5\u770b\u7fa4\u7d44\u7684\u652f\u51fa\u8207\u8fd1\u671f\u6d3b\u52d5\u3002"}</p>
                </div>
                <div className="panel-stat-grid">
                  <div>
                    <span>{"\u7b46\u6578"}</span>
                    <strong>{aggregates.expenseCount}</strong>
                  </div>
                  <div>
                    <span>{"\u7e3d\u652f\u51fa"}</span>
                    <strong>{formatAmount(totalExpenseMinor, activeGroup?.currency ?? "TWD")}</strong>
                  </div>
                </div>
                <button
                  className="text-action records-export"
                  type="button"
                  disabled={pendingAction === "exportCsv"}
                  onClick={handleExportCsv}
                >
                  {pendingAction === "exportCsv" ? text.processing : text.exportCsv}
                </button>
                <div className="dialog-section-list">
                  <span className="dialog-list-title">{text.expense}</span>
                  {expenses.length ? (
                    expenses.map((expense) => (
                      <button
                        className="record-dialog-row"
                        type="button"
                        key={expense.id}
                        onClick={() => openExpenseDetail(expense.id)}
                      >
                        {expense.imageUrl ? (
                          <span className="record-dialog-thumb">
                            <img src={expense.imageUrl} alt="" />
                          </span>
                        ) : (
                          <span className="record-dialog-icon">
                            {expense.kind === "settlement" ? (
                              <History aria-hidden="true" size={18} />
                            ) : expense.kind === "income" ? (
                              <HandCoins aria-hidden="true" size={18} />
                            ) : (
                              <ReceiptText aria-hidden="true" size={18} />
                            )}
                          </span>
                        )}
                        <span>
                          <strong>{expense.title}</strong>
                          <small>{expense.note ? expense.note : formatActivityTime(expense.createdAt)}</small>
                        </span>
                        <b className={expense.kind === "income" ? "amount-income" : undefined}>
                          {expense.kind === "income"
                            ? `+${formatAmount(expense.amountMinor, expense.currency)}`
                            : formatAmount(expense.amountMinor, expense.currency)}
                        </b>
                      </button>
                    ))
                  ) : (
                    <p className="dialog-empty">{text.noRecords}</p>
                  )}
                  {canLoadMoreExpenses ? (
                    <button
                      className="text-action records-load-more"
                      type="button"
                      disabled={pendingAction === "loadMoreExpenses" || loadingMoreExpenses}
                      onClick={handleLoadMoreExpenses}
                    >
                      {pendingAction === "loadMoreExpenses" || loadingMoreExpenses ? text.processing : text.loadMoreRecords}
                    </button>
                  ) : null}
                </div>
                <div className="dialog-section-list">
                  <span className="dialog-list-title">{text.recentActivity}</span>
                  {activities.length ? (
                    activities.map((activity) => (
                      <div className="record-dialog-row" key={activity.id}>
                        <span className="record-dialog-icon">
                          <History aria-hidden="true" size={18} />
                        </span>
                        <span>
                          <strong>{activity.text}</strong>
                          <small>{formatActivityTime(activity.createdAt)}</small>
                        </span>
                        <b />
                      </div>
                    ))
                  ) : (
                    <p className="dialog-empty">{text.noActivity}</p>
                  )}
                </div>
              </>
            ) : null}

            {dialog === "analysisPanel" ? (
              <>
                <div className="dialog-header">
                  <h3>{text.analysis}</h3>
                  <p>{"\u4ee5\u76ee\u524d\u8cc7\u6599\u7d71\u8a08\u7fa4\u7d44\u6d88\u8cbb\u8207\u6210\u54e1\u9918\u984d\u3002"}</p>
                </div>
                <div className="panel-stat-grid">
                  <div>
                    <span>{"\u7e3d\u91d1\u984d"}</span>
                    <strong>{formatAmount(totalExpenseMinor, activeGroup?.currency ?? "TWD")}</strong>
                  </div>
                  <div>
                    <span>{text.members}</span>
                    <strong>{members.length}</strong>
                  </div>
                  <div>
                    <span>{text.debt}</span>
                    <strong>{debt ? formatAmount(debt.amountMinor, activeGroup?.currency ?? "TWD") : formatAmount(0, activeGroup?.currency ?? "TWD")}</strong>
                  </div>
                </div>
                <div className="dialog-section-list">
                  <span className="dialog-list-title">{text.spendChartTitle}</span>
                  <SpendBarChart
                    days={dateChips}
                    spendByDay={aggregates.spendByDay}
                    currency={activeGroup?.currency ?? "TWD"}
                    selectedKey={selectedDateKey}
                    onSelect={setSelectedDateKey}
                    emptyText={text.spendChartEmpty}
                  />
                </div>
                <div className="dialog-section-list">
                  <span className="dialog-list-title">{"\u6210\u54e1\u9918\u984d"}</span>
                  {members.map((member) => {
                    const balance = balances.get(member.id) ?? 0;
                    const width = balance === 0 ? "0%" : `${Math.max(8, Math.round((Math.abs(balance) / maxBalanceMinor) * 100))}%`;
                    return (
                      <div className="analysis-balance-row" key={member.id}>
                        <span>{member.name}</span>
                        <div className="analysis-bar-track">
                          <i style={{ width }} />
                        </div>
                        <strong>{formatSigned(balance, activeGroup?.currency ?? "TWD")}</strong>
                      </div>
                    );
                  })}
                </div>
                <div className="dialog-section-list">
                  <span className="dialog-list-title">{UI_TEXT.settlement.suggestionSectionTitle}</span>
                  {settlementTransfers.length ? (
                    settlementTransfers.map((transfer) => {
                      const from = members.find((member) => member.id === transfer.fromMemberId);
                      const to = members.find((member) => member.id === transfer.toMemberId);
                      return (
                        <div className="settlement-suggestion-row" key={`${transfer.fromMemberId}_${transfer.toMemberId}`}>
                          <div className="settlement-suggestion-person">
                            <MemberAvatar className="member-avatar lime" name={from?.name} avatarUrl={from?.avatarUrl} />
                            <strong>{from?.name ?? ""}</strong>
                          </div>
                          <b>{"\u2192"}</b>
                          <div className="settlement-suggestion-person">
                            <MemberAvatar className="member-avatar photo" name={to?.name} avatarUrl={to?.avatarUrl} />
                            <strong>{to?.name ?? ""}</strong>
                          </div>
                          <span className="settlement-suggestion-amount">{formatAmount(transfer.amount.amount_minor, transfer.amount.currency)}</span>
                          <button
                            className="composer-mini-action"
                            type="button"
                            disabled={pendingAction === `settle:${transfer.fromMemberId}:${transfer.toMemberId}`}
                            onClick={() => settleTransfer(transfer.fromMemberId, transfer.toMemberId, transfer.amount.amount_minor)}
                          >
                            {pendingAction === `settle:${transfer.fromMemberId}:${transfer.toMemberId}`
                              ? text.processing
                              : UI_TEXT.settlement.settleAction}
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <p className="dialog-empty">{UI_TEXT.settlement.settled}</p>
                  )}
                </div>
                <div className="dialog-section-list">
                  <span className="dialog-list-title">{text.settlementHistoryTitle}</span>
                  {settlementRecords.length ? (
                    settlementRecords.map((record) => {
                      const from = members.find((member) => member.id === record.fromMemberId);
                      const to = members.find((member) => member.id === record.toMemberId);
                      return (
                        <div className="settlement-suggestion-row" key={record.id}>
                          <div className="settlement-suggestion-person">
                            <MemberAvatar className="member-avatar lime" name={from?.name} avatarUrl={from?.avatarUrl} />
                            <strong>{from?.name ?? ""}</strong>
                          </div>
                          <b>{"→"}</b>
                          <div className="settlement-suggestion-person">
                            <MemberAvatar className="member-avatar photo" name={to?.name} avatarUrl={to?.avatarUrl} />
                            <strong>{to?.name ?? ""}</strong>
                          </div>
                          <span className="settlement-suggestion-amount">{formatAmount(record.amountMinor, record.currency)}</span>
                          <small className="settlement-history-time">{formatActivityTime(record.createdAt)}</small>
                        </div>
                      );
                    })
                  ) : (
                    <p className="dialog-empty">{text.noSettlementHistory}</p>
                  )}
                </div>
              </>
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
              <>
                <div className="dialog-header">
                  <h3>{text.members}</h3>
                  <p>
                    {members.length} {text.people}
                  </p>
                </div>
                <div className="dialog-section-list">
                  <span className="dialog-list-title">{text.members}</span>
                  {members.map((member) => {
                    // Only VIRTUAL members can be renamed/removed - real users
                    // own their names via their profile, and the owner is
                    // protected. (A virtual member is never the owner.)
                    const manageable = Boolean(member.virtual);
                    const isRenaming = manageable && renamingMemberId === member.id;
                    const renamePending = pendingAction === `renameMember:${member.id}`;
                    const removePending = pendingAction === `removeMember:${member.id}`;
                    return (
                      <div
                        className={manageable ? "member-dialog-row has-member-actions" : "member-dialog-row"}
                        key={member.id}
                      >
                        <MemberAvatar className="member-avatar" name={member.name} avatarUrl={member.avatarUrl} />
                        {isRenaming ? (
                          <>
                            <input
                              className="member-rename-input"
                              value={renameMemberValue}
                              onChange={(event) => setRenameMemberValue(event.target.value)}
                              maxLength={50}
                              aria-label={text.renameMember}
                              autoFocus
                            />
                            <span className="member-row-actions">
                              <button
                                className="member-icon-action confirm"
                                type="button"
                                aria-label={text.confirm}
                                disabled={!renameMemberValue.trim() || renamePending}
                                onClick={() => submitRenameMember(member)}
                              >
                                <Check aria-hidden="true" size={15} />
                              </button>
                              <button
                                className="member-icon-action"
                                type="button"
                                aria-label={text.cancel}
                                disabled={renamePending}
                                onClick={cancelRenameMember}
                              >
                                <X aria-hidden="true" size={15} />
                              </button>
                            </span>
                          </>
                        ) : (
                          <>
                            <span>
                              <strong>{member.name}</strong>
                              <small>{member.virtual ? text.virtualMember : member.role === "owner" ? text.owner : text.member}</small>
                            </span>
                            {manageable ? (
                              <span className="member-row-actions">
                                <button
                                  className="member-icon-action"
                                  type="button"
                                  aria-label={text.renameMember}
                                  disabled={removePending}
                                  onClick={() => startRenameMember(member)}
                                >
                                  <Pencil aria-hidden="true" size={14} />
                                </button>
                                <button
                                  className={
                                    confirmingRemoveMemberId === member.id
                                      ? "member-icon-action danger confirming"
                                      : "member-icon-action danger"
                                  }
                                  type="button"
                                  aria-label={text.removeMember}
                                  disabled={removePending}
                                  onClick={() => removeMember(member)}
                                >
                                  {confirmingRemoveMemberId === member.id ? (
                                    text.confirmRemoveMember
                                  ) : (
                                    <UserMinus aria-hidden="true" size={14} />
                                  )}
                                </button>
                              </span>
                            ) : null}
                            <b>{formatSigned(balances.get(member.id) ?? 0, activeGroup?.currency ?? "TWD")}</b>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="dialog-action-row">
                  <button className="secondary-action" type="button" onClick={openInviteMembers}>
                    <Inbox aria-hidden="true" size={18} />
                    {text.inviteMembers}
                  </button>
                  <button className="primary-action" type="button" onClick={() => setDialog("virtualMember")}>
                    <UserRound aria-hidden="true" size={18} />
                    {text.addVirtualMember}
                  </button>
                </div>
              </>
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
              <>
                <div className="dialog-header">
                  <h3>{text.archivedGroups}</h3>
                  <p>{"\u5c01\u5b58\u5f8c\u7684\u7fa4\u7d44\u6703\u653e\u5728\u9019\u88e1\uff0c\u4e0d\u6703\u51fa\u73fe\u5728\u5de6\u5074\u4e3b\u5217\u8868\u3002"}</p>
                </div>
                <div className="dialog-section-list archived-dialog-list">
                  {archivedGroupsLoading ? (
                    <div className="cloud-loading-skeleton" aria-busy="true">
                      <span className="pulse-dot active" />
                    </div>
                  ) : archivedGroups.length ? (
                    archivedGroups.map((group) => (
                      <div className="archived-dialog-row" key={group.id}>
                        {group.coverImageUrl ? (
                          <span className="record-dialog-thumb">
                            <img src={group.coverImageUrl} alt="" />
                          </span>
                        ) : (
                          <span className="record-dialog-icon">
                            <Archive aria-hidden="true" size={18} />
                          </span>
                        )}
                        <span>
                          <strong>{group.name}</strong>
                          <small>{group.currency}</small>
                        </span>
                        {group.callerMemberId === group.ownerMemberId ? (
                          <button
                            className="composer-mini-action"
                            type="button"
                            disabled={Boolean(unarchivingGroupId)}
                            onClick={() => unarchiveGroup(group)}
                          >
                            {unarchivingGroupId === group.id ? text.restoringGroup : text.restoreGroup}
                          </button>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <p className="dialog-empty">{text.noArchivedGroups}</p>
                  )}
                </div>
              </>
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
