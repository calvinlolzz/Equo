import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  BellRing,
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
  Scan,
  ScanLine,
  Settings,
  Share,
  Sun,
  UserRound,
  X,
} from "lucide-react";
import { clearShortcutParam, readShortcutAction, type ShortcutAction } from "./appShortcuts";
import { createAutoSync } from "./autoSync";
import { buildSettlementTransfers } from "./buildSettlementTransfers";
import { createApiClient } from "./apiClient";
import { dateKey, formatActivityTime, lastEightDays } from "./appDates";
import { describeCloudActionError } from "./describeCloudActionError";
import { MemberListPanel } from "./MemberListPanel";
import { type FeedbackType } from "./FeedbackDialog";
import { GroupHomeSkeleton } from "./GroupHomeSkeleton";
import { InstallHint } from "./InstallHint";
import { useInstallPrompt } from "./useInstallPrompt";
import { GroupSideNav } from "./GroupSideNav";
import { haptic } from "./haptics";
import { useBodyScrollLock } from "./useBodyScrollLock";
import { mergeRefs, useDialogChrome } from "./useDialogChrome";
import { useOnlineStatus } from "./useOnlineStatus";
import { useCatalog } from "./useCatalog";
import { useNotifications } from "./useNotifications";
import { useOverlayHistory } from "./useOverlayHistory";
import { usePullToRefresh } from "./usePullToRefresh";
import { useSwipeToDismissX } from "./useSwipeToDismissX";
import { useDragScrollX } from "./useDragScrollX";
import { listSettlementRecords } from "./settlementHistory";
import { type ArchivedGroupData } from "./cloudStore";
import { type ExpenseDraft } from "./ExpenseComposerSheet";
import type { ScanSheetMode } from "./ScanSheet";
import { readInviteToken } from "./inviteToken";
import { grantScanConsent, hasScanConsent, revokeScanConsent } from "./scanConsent";
import type { ReceiptPrefill } from "./receiptPrefill";
import { GroupRail } from "./GroupRail";
import { LoginScreen } from "./LoginScreen";
import { MemberAvatar, upscaleGoogleAvatar } from "./MemberAvatar";
import { isGroupOwner } from "./isGroupOwner";
import { resolveActiveTab } from "./resolveActiveTab";
import { resolveCurrentMember } from "./resolveCurrentMember";
import { StartFlow } from "./StartFlowPanel";
import { useSwipeToDismiss } from "./useSwipeToDismiss";
import { clearPendingRoute, readPendingRoute } from "./pendingRoute";
import { resolveRootLanding } from "./resolveRootLanding";
import type { DialogMode, InfoDialogMode, Group, Member, StartMode } from "./appTypes";
import { formatAmount, formatSigned } from "./formatAmount";
import { DEFAULT_PROFILE, PROFILE_KEY, normalizeProfile, type ProfileData } from "./profileStore";
import { saveSession, type StoredSession } from "./sessionStore";
import { useActionGuard } from "./useActionGuard";
import { useExpenseComposer } from "./useExpenseComposer";
import { useGroupMutations } from "./useGroupMutations";
import { useIsMobileLayout } from "./useIsMobileLayout";
import { useInviteFlow } from "./useInviteFlow";
import { useMemberMutations } from "./useMemberMutations";
import { useThemeMode } from "./useThemeMode";
import { useArchivedGroups } from "./useArchivedGroups";
import { useAuthSession } from "./useAuthSession";
import { readRouteGroupId, useGroupRoute } from "./useGroupRoute";
import { useToast } from "./useToast";
import { useCloudActivities } from "./useCloudActivities";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

const templates = [
  { id: "trip", label: text.trip, defaultName: text.tripName },
  { id: "meal", label: text.meal, defaultName: text.mealName },
  { id: "home", label: text.home, defaultName: text.homeName },
  { id: "event", label: text.event, defaultName: text.eventName },
];


/**
 * Everything below is behind a tap, so none of it belongs in the chunk that
 * has to arrive before the app can paint. Splitting these out is worth roughly
 * a third of the entry bundle, most of it the composer.
 *
 * Each render site gets its own <Suspense fallback={null}>: they are overlays
 * over a screen that is already there, so "nothing yet" is the correct
 * intermediate state - a spinner would flash for a chunk that is usually
 * already warm (see prefetchOverlayChunks).
 */
const AnalysisPanel = lazy(() => import("./AnalysisPanel").then((m) => ({ default: m.AnalysisPanel })));
const ArchivedListPanel = lazy(() => import("./ArchivedListPanel").then((m) => ({ default: m.ArchivedListPanel })));
const ExpenseComposerSheet = lazy(() =>
  import("./ExpenseComposerSheet").then((m) => ({ default: m.ExpenseComposerSheet })),
);
const ExpenseDetailDialog = lazy(() =>
  import("./ExpenseDetailDialog").then((m) => ({ default: m.ExpenseDetailDialog })),
);
const FeedbackDialog = lazy(() => import("./FeedbackDialog").then((m) => ({ default: m.FeedbackDialog })));
const NotificationsPanel = lazy(() =>
  import("./NotificationsPanel").then((m) => ({ default: m.NotificationsPanel })),
);
const ProfileDialog = lazy(() => import("./ProfileDialog").then((m) => ({ default: m.ProfileDialog })));
const RecordsPanel = lazy(() => import("./RecordsPanel").then((m) => ({ default: m.RecordsPanel })));
// The QR encoder and the camera/decoder are each behind a tap and are dead
// weight for everyone who never opens them - the decoder alone outweighs the
// rest of this list.
const InviteQrCode = lazy(() => import("./InviteQrCode").then((m) => ({ default: m.InviteQrCode })));
const ScanSheet = lazy(() => import("./ScanSheet").then((m) => ({ default: m.ScanSheet })));

/**
 * Warm the two chunks a user reaches for first, once the browser is idle.
 *
 * Without this, splitting the composer out would trade 46KB off the critical
 * path for a stall on the 記一筆 tap - which is the one interaction this app
 * exists for. Fetching it after first paint costs nothing anybody can see and
 * makes the tap instant. requestIdleCallback is missing on iOS Safari, hence
 * the timeout fallback.
 */
function prefetchOverlayChunks(): void {
  const warm = () => {
    void import("./ExpenseComposerSheet");
    void import("./ExpenseDetailDialog");
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(warm, { timeout: 3_000 });
  } else {
    window.setTimeout(warm, 1_500);
  }
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

function formatTime(value: string) {
  const date = new Date(value);
  return date.toLocaleTimeString("zh-TW", { hour: "numeric", minute: "2-digit", second: "2-digit" });
}


export function App() {
  const { activeGroupId, openGroup, closeGroup } = useGroupRoute();
  const [startMode, setStartMode] = useState<StartMode>("create");
  const [selectedTemplate, setSelectedTemplate] = useState("trip");
  const [dialog, setDialog] = useState<DialogMode>(null);
  // The privacy/terms sheet that stacks on top of the profile dialog. Lifted out
  // of ProfileDialog so it can be a layer of its own in the Back-button stack.
  const [infoDialog, setInfoDialog] = useState<InfoDialogMode>(null);
  // Swipe-to-dismiss for the shared bottom-sheet dialog shell (records /
  // analysis / members / etc.). Kept mounted across open/close cycles.
  const dialogSwipe = useSwipeToDismiss(() => closeDialog());
  const { toast, showToast } = useToast();
  const [busy, setBusy] = useState(false);
  // The double-submit guard for every mutation control (see useActionGuard /
  // actionGuard.ts): pendingAction drives the busy label, actionGuardRef is the
  // synchronous gate, and the auto-sync loop reads the ref to skip refreshes
  // while a mutation is in flight.
  const { pendingAction, actionGuardRef, beginAction, endAction } = useActionGuard();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  // Reported up by the composer sheet, because the Back button closes it from
  // out here and never passes through the sheet's own dismiss handlers.
  const [composerDirty, setComposerDirty] = useState(false);
  /** Which full-screen camera is up, if any: "receipt" reads a bill, "invite" reads a join QR. */
  const [scanMode, setScanMode] = useState<ScanSheetMode | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  /** The one-time "your receipt goes to a third-party model" ask (see scanConsent.ts). */
  const [scanConsentOpen, setScanConsentOpen] = useState(false);
  const [scanConsentGranted, setScanConsentGranted] = useState(() => hasScanConsent());
  /**
   * Reminders sent while this screen has been open. Kept in memory only: the
   * server's cooldown is the real rule, and this just stops the button
   * inviting a second tap it would refuse.
   */
  const [nudgedMemberIds, setNudgedMemberIds] = useState<string[]>([]);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [spendTab, setSpendTab] = useState<"personal" | "group">("personal");
  const [selectedDateKey, setSelectedDateKey] = useState(() => dateKey(new Date().toISOString()));
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const { theme, toggleTheme } = useThemeMode();
  // Mobile drawer swipe gestures: each drawer dismisses toward the edge it
  // slid in from (left drawer <- swipe left, right drawer -> swipe right).
  const groupDrawerSwipe = useSwipeToDismissX("left", () => setGroupDrawerOpen(false));
  const settingsDrawerSwipe = useSwipeToDismissX("right", () => setSettingsDrawerOpen(false));

  // Modal focus/keyboard contract (Esc, focus-trap, focus-return) for the three
  // in-file overlays. Each chrome ref is merged with the gesture ref and
  // memoised so it doesn't detach/reattach the node every render.
  const dialogChromeRef = useDialogChrome(dialogSwipe.requestClose);
  const dialogRef = useMemo(
    () => mergeRefs<HTMLElement>(dialogSwipe.dragProps.ref, dialogChromeRef),
    [dialogSwipe.dragProps.ref, dialogChromeRef],
  );
  const groupDrawerChromeRef = useDialogChrome(groupDrawerSwipe.requestClose);
  const groupDrawerRef = useMemo(
    () => mergeRefs<HTMLElement>(groupDrawerSwipe.dragProps.ref, groupDrawerChromeRef),
    [groupDrawerSwipe.dragProps.ref, groupDrawerChromeRef],
  );
  const settingsDrawerChromeRef = useDialogChrome(settingsDrawerSwipe.requestClose);
  const settingsDrawerRef = useMemo(
    () => mergeRefs<HTMLElement>(settingsDrawerSwipe.dragProps.ref, settingsDrawerChromeRef),
    [settingsDrawerSwipe.dragProps.ref, settingsDrawerChromeRef],
  );
  const isMobileLayout = useIsMobileLayout();
  /**
   * One client for the things that poll rather than react to a tap. Everything
   * else calls createApiClient() at the point of use, which is fine for a
   * one-shot request but would re-arm the inbox's poll on every render here.
   */
  const pollingClient = useMemo(() => createApiClient(), []);
  const [profile, setProfile] = useState<ProfileData>(() => normalizeProfile(readJson<Partial<ProfileData>>(PROFILE_KEY, DEFAULT_PROFILE)));
  const { cloudActivities, recordCloudActivity } = useCloudActivities();

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

  // Signed-in only: the inbox belongs to an account, and polling it while
  // signed out would be a 401 every five minutes.
  const notifications = useNotifications(pollingClient, Boolean(session));
  // The category and currency lists, which an admin can now change without a
  // deploy. Held here rather than read at module load so the fetched copy
  // re-renders the composer that uses it.
  const catalog = useCatalog(pollingClient, Boolean(session));
  const currencyOptions = catalog.currencies;

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

  const {
    expenseComposerOpen,
    editingExpense,
    duplicatingExpense,
    receiptPrefill,
    openExpenseFromReceipt,
    setReceiptScan,
    selectedExpenseId,
    setSelectedExpenseId,
    openExpenseComposer,
    openExpenseEdit,
    openExpenseDuplicate,
    closeExpenseComposer,
    openExpenseDetail,
    handleExpenseDraftSubmit,
    deleteExpense,
    handleLoadMoreExpenses,
    handleExportCsv,
  } = useExpenseComposer({
    activeGroup,
    cloudStore,
    members,
    session,
    showToast,
    recordCloudActivity,
    beginAction,
    endAction,
    setDialog,
    setBusy,
  });

  const {
    groupName,
    setGroupName,
    groupCoverDataUrl,
    setGroupCoverDataUrl,
    groupCoverUrl,
    createGroup,
    openCreateGroupDialog,
    openEditGroup,
    handleGroupCoverPick,
    updateActiveGroup,
    openArchivedGroups,
    archiveActiveGroup,
    deleteActiveGroup,
  } = useGroupMutations({
    activeGroup,
    cloudStore,
    showToast,
    recordCloudActivity,
    beginAction,
    endAction,
    setDialog,
    setBusy,
    openGroup,
    closeGroup,
    loadArchivedGroups,
  });

  const {
    virtualMemberName,
    setVirtualMemberName,
    renamingMemberId,
    renameMemberValue,
    setRenameMemberValue,
    confirmingRemoveMemberId,
    resetMemberManagement,
    addVirtualMember,
    startRenameMember,
    cancelRenameMember,
    submitRenameMember,
    removeMember,
  } = useMemberMutations({
    activeGroup,
    cloudStore,
    showToast,
    recordCloudActivity,
    beginAction,
    endAction,
    setDialog,
  });

  // Both mobile drawers close together whenever a dialog takes over the screen.
  function closeDrawers() {
    setGroupDrawerOpen(false);
    setSettingsDrawerOpen(false);
  }

  const {
    cloudInviteToken,
    cloudInviteLoading,
    inviteInputValue,
    setInviteInputValue,
    inviteInputError,
    setInviteInputError,
    openInviteMembers,
    copyInviteText,
    submitInviteInput,
  } = useInviteFlow({
    activeGroup,
    cloudStore,
    session,
    profileName: profile.name,
    showToast,
    beginAction,
    endAction,
    setDialog,
    openGroup,
    closeDrawers,
  });

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
    !notificationsOpen &&
    !groupDrawerOpen &&
    !settingsDrawerOpen;
  const pullStatus = usePullToRefresh(pullEnabled, async () => {
    if (!cloudStore || !activeGroup) return;
    await Promise.all([cloudStore.refreshGroups(), cloudStore.refreshGroupDetail(activeGroup.id)]);
  });

  // Freeze the page behind any open overlay (sheet / drawer / dialog) so it
  // can't scroll or rubber-band under the finger — mobile only, where the
  // overlays are full-bleed and there is no persistent scrollbar to disturb.
  useBodyScrollLock(
    isMobileLayout &&
      (Boolean(dialog) ||
        expenseComposerOpen ||
        discardConfirmOpen ||
        feedbackOpen ||
        notificationsOpen ||
        groupDrawerOpen ||
        settingsDrawerOpen),
  );

  /** Dismiss the shared dialog slot, clearing whatever it was showing. */
  function closeDialog() {
    setDialog(null);
    setInfoDialog(null);
    setSelectedExpenseId("");
  }

  /**
   * The way a *person* closes the shared dialog: play the slide-out, then clear
   * the slot. Every dismissal affordance goes through this — X, backdrop, 取消,
   * Back, the 首頁 tab — so the sheet leaves the way it arrived instead of
   * blinking out. closeDialog stays the terminal step this hands off to, and
   * remains what action handlers call when the dialog closes as the *result* of
   * finished work (a save, a pick) rather than as the dismissal itself.
   *
   * On desktop and under reduced motion requestClose skips the wait and closes
   * at once — the slide-out CSS only exists in the ≤620px media query.
   */
  const dismissDialog = dialogSwipe.requestClose;

  /**
   * The one way the composer closes without submitting — backdrop, Esc, swipe
   * and Back all land here — so a half-filled expense can't be thrown away by
   * a stray gesture. Back makes this matter: it is far easier to hit by
   * accident than the backdrop ever was.
   */
  function requestCloseComposer() {
    if (composerDirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    closeExpenseComposer();
  }

  function discardComposerDraft() {
    setDiscardConfirmOpen(false);
    closeExpenseComposer();
  }

  // Back / edge-swipe closes the topmost overlay instead of leaving the screen.
  // Ordered bottom of the stack to top: a drawer is what a dialog opens over,
  // the info sheet sits on top of the profile dialog, and the composer and the
  // feedback sheet are the last things opened over anything else.
  const overlayDepth = useOverlayHistory([
    // requestClose, not the raw setters: Back is the phone's primary dismiss, so
    // it should look like every other way of closing rather than cutting.
    { open: groupDrawerOpen, close: groupDrawerSwipe.requestClose },
    { open: settingsDrawerOpen, close: settingsDrawerSwipe.requestClose },
    { open: Boolean(dialog), close: dismissDialog },
    { open: dialog === "profile" && infoDialog !== null, close: () => setInfoDialog(null) },
    // Above the dialog layer: the invite scanner is opened FROM the 輸入邀請碼
    // dialog and leaves it standing underneath, so Back must peel the camera
    // off first rather than dismissing both at once.
    { open: scanMode !== null, close: () => setScanMode(null) },
    // The consent ask stands alone (the camera is not open yet), so Back
    // simply declines it.
    { open: scanConsentOpen, close: () => setScanConsentOpen(false) },
    // Back on a dirty composer raises the discard confirm instead of closing;
    // the confirm then sits above it, so a second Back answers 繼續編輯.
    { open: expenseComposerOpen, close: requestCloseComposer },
    { open: discardConfirmOpen, close: () => setDiscardConfirmOpen(false) },
    { open: feedbackOpen, close: () => setFeedbackOpen(false) },
    { open: notificationsOpen, close: () => setNotificationsOpen(false) },
  ]);

  // Mirror "something is covering the screen" onto <html> so the WebGL backdrop
  // can pause itself. It cannot be a prop: main.tsx renders GlassBackground as a
  // SIBLING of <App />, so this state is not on its path — and an attribute is
  // what that component already watches (it observes data-theme on the same
  // element). Every overlay in the app is a full-viewport layer over a scrim, so
  // while one is open the field underneath is animating at 30fps to be seen
  // through 10px of blur at 44% black — and, worse, keeps invalidating the
  // scrim's own backdrop-filter every frame. Frozen, that blur is cached.
  useEffect(() => {
    const root = document.documentElement;
    if (overlayDepth > 0) root.setAttribute("data-overlay", "1");
    else root.removeAttribute("data-overlay");
    // Unmounting with an overlay open would otherwise strand the attribute on
    // <html> and leave the backdrop paused for good. (Re-running on a depth
    // change clears and re-sets it in one commit; the observer on the other end
    // reads the live attribute, so it only ever sees the settled state.)
    return () => root.removeAttribute("data-overlay");
  }, [overlayDepth]);

  // Which bottom tab reads as selected. Derived, not stored: three of the tabs
  // open the shared sheet rather than navigating, so the dialog IS the state.
  const activeTab = resolveActiveTab(dialog, settingsDrawerOpen);

  // "Add to home screen". Only offered on the phone layout, and only once the
  // user actually has a group open — asking someone to install the app before
  // they have used it is how a prompt gets dismissed forever on reflex.
  const install = useInstallPrompt();

  const online = useOnlineStatus();

  // Expense writes recorded while the network was unreachable and not yet sent
  // (see offlineQueue.ts). Counted across every group, not just the open one:
  // "你還有 N 筆沒送出" is only reassuring if it means all of them.
  const pendingWriteCount = cloudState?.pendingWrites.length ?? 0;
  const flushingWrites = Boolean(cloudState?.flushingWrites);
  const pendingWriteIds = useMemo(
    () => new Set((cloudState?.pendingWrites ?? []).map((write) => write.expenseId)),
    [cloudState?.pendingWrites],
  );

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
  // Mouse drag + wheel panning for the day strip, and it keeps the selected
  // day scrolled into view (today starts at the far end).
  const dateStripRef = useDragScrollX(selectedDateKey);
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
  /**
   * Whether the top debt's payer can be reminded from the home card: somebody
   * other than you, with an account to deliver a notification to.
   *
   * Same rule as the member list's button (and the server checks all of it
   * again). This is the placement that matters: the card already says "A 需付
   * B $500" next to 清償, which is exactly where somebody thinking "he still
   * hasn't paid me" is looking - the member sheet is two taps away behind a
   * 設定 tab, and nobody goes there to chase a debt.
   */
  const debtNudgeable = Boolean(debt && !debt.from.virtual && debt.from.id !== currentMember?.id);
  const debtNudged = Boolean(debt && nudgedMemberIds.includes(debt.from.id));
  const maxBalanceMinor = Math.max(1, ...members.map((member) => Math.abs(balances.get(member.id) ?? 0)));
  const selectedExpense = expenses.find((expense) => expense.id === selectedExpenseId) ?? null;
  const selectedExpenseIndex = expenses.findIndex((expense) => expense.id === selectedExpenseId);
  const canLoadMoreExpenses = expenses.length < aggregates.expenseCount;

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

  /**
   * Erase the account, then tear the session down locally. The server has
   * already cleared the equo_session cookie and removed the user row (so the
   * next request would 401 anyway); signOut() drops the local session + cloud
   * cache and returns to the login wall, which unmounts the profile dialog.
   * On failure nothing is torn down and the dialog stays open with a toast.
   */
  async function handleDeleteAccount() {
    if (!session) return;
    try {
      await createApiClient().deleteMyAccount();
      signOut();
      showToast(text.accountDeleted);
    } catch (error) {
      // Stay on the (still-open) confirm dialog and say what went wrong; the
      // dialog's own finally clears its spinner so the user can retry or cancel.
      showToast(describeCloudActionError(error));
    }
  }

  useEffect(() => writeJson(PROFILE_KEY, profile), [profile]);

  /**
   * PWA home-screen shortcuts (`/?shortcut=…`, see site.webmanifest).
   *
   * 加入群組 opens as soon as there is a session. 新增支出 has to wait for a
   * group to be resolved — the composer needs one — so it fires on the first
   * render where activeGroup is set. The param is cleared once consumed so a
   * reload doesn't reopen the sheet.
   */
  const shortcutRef = useRef<ShortcutAction | null>(readShortcutAction(window.location.search));

  // Once, after the first paint: pull the composer's chunk down while nothing
  // else is competing for the connection.
  useEffect(prefetchOverlayChunks, []);

  useEffect(() => {
    if (!session || !shortcutRef.current) return;

    if (shortcutRef.current === "join") {
      shortcutRef.current = null;
      clearShortcutParam();
      setDialog("inviteInput");
      return;
    }
    if (shortcutRef.current === "add-expense" && activeGroup) {
      shortcutRef.current = null;
      clearShortcutParam();
      openExpenseComposer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, activeGroup]);

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
      // A deep link that went through the login wall lands here at the bare
      // origin - honour it before falling back to the most-recent group, or
      // the recipient of a shared link ends up somewhere they weren't sent.
      const pendingId = readPendingRoute();
      if (pendingId) {
        if (cloudGroups.some((group) => group.id === pendingId)) {
          clearPendingRoute();
          openGroup(pendingId, "replace");
          return;
        }
        // Only give up on it once there is a real list to have missed it in:
        // this effect also runs before the groups arrive, and clearing on that
        // pass would drop the link before it ever had a chance to match.
        if (cloudGroups.length > 0) clearPendingRoute();
      }
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

  // Opening a group counts as reading it. Keyed on the group's unread count as
  // well as its id, so a refresh that brings in something new while the user
  // is sitting on the group clears the badge again rather than leaving it lit
  // on the screen it belongs to. No-ops when the count is already zero.
  const activeGroupUnread = cloudGroups.find((group) => group.id === activeGroupId)?.unreadCount ?? 0;
  // The mobile top-bar dot means "another group has something new" — the one
  // you are looking at is about to be marked read anyway, so counting it would
  // light the dot for a group already on screen.
  const otherGroupsUnread = cloudGroups.reduce(
    (total, group) => (group.id === activeGroupId ? total : total + (group.unreadCount ?? 0)),
    0,
  );

  useEffect(() => {
    if (!cloudStore || !activeGroupId || activeGroupUnread === 0) return;
    cloudStore.markGroupRead(activeGroupId);
  }, [activeGroupId, activeGroupUnread, cloudStore]);

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

  function selectGroup(group: Group) {
    openGroup(group.id);
    setGroupDrawerOpen(false);
  }

  function openMemberList() {
    if (!activeGroup) return;
    closeDrawers();
    resetMemberManagement();
    setDialog("memberList");
  }

  function openProfileDialog() {
    closeDrawers();
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

  function handleSideNavClick(id: string) {
    closeDrawers();
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
    showToast(text.groupHome);
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
      haptic("success");
      showToast(`${text.clearDebt}: ${fromMember.name} → ${toMember.name}`);
    } catch (error) {
      showToast(describeCloudActionError(error));
    } finally {
      endAction();
    }
  }

  function settleDebt() {
    if (!debt) return;
    settleTransfer(debt.from.id, debt.to.id, debt.amountMinor);
  }

  function openReceiptScan() {
    closeDrawers();
    setDialog(null);
    // Asked once per device, before the camera rather than after the photo:
    // consent given while holding a captured receipt is not much of a choice.
    if (!scanConsentGranted) {
      setScanConsentOpen(true);
      return;
    }
    setScanMode("receipt");
  }

  function acceptScanConsent() {
    grantScanConsent();
    setScanConsentGranted(true);
    setScanConsentOpen(false);
    setScanMode("receipt");
  }

  /**
   * Turned off from 個人資料 → 其他設定. The next scan asks again, and until
   * then no photo goes anywhere near the model — the composer's own camera and
   * photo picker are unaffected, since those only ever attach the image to the
   * expense.
   */
  function disableScanConsent() {
    revokeScanConsent();
    setScanConsentGranted(false);
    showToast(text.scanConsentRevoked);
  }

  /**
   * "Pay me back." Sends a push to one member who owes the group.
   *
   * Every refusal has its own sentence: reminded-too-recently and owes-nothing
   * are both normal answers, and a generic 失敗 would leave the sender
   * wondering whether to press it again.
   */
  async function nudgeMember(member: Member) {
    if (!activeGroup) return;
    const actionKey = `nudge:${member.id}`;
    if (!beginAction(actionKey)) return;

    try {
      await createApiClient().nudgeMember(activeGroup.id, member.id);
      setNudgedMemberIds((current) => (current.includes(member.id) ? current : [...current, member.id]));
      haptic("success");
      showToast(`${text.nudgeSentToast}${member.name}`);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "NUDGE_COOLDOWN") {
        // Already reminded by somebody - mark it spent here too, or the button
        // keeps offering an action the server will keep refusing.
        setNudgedMemberIds((current) => (current.includes(member.id) ? current : [...current, member.id]));
        showToast(text.nudgeCooldown);
      } else if (code === "NUDGE_NOT_NEEDED") {
        showToast(text.nudgeNotNeeded);
      } else {
        showToast(describeCloudActionError(error));
      }
    } finally {
      endAction();
    }
  }

  /**
   * A captured receipt: open the composer at once, recognise in the background.
   *
   * Recognition takes around five seconds, and nobody standing at a till wants
   * to spend them watching a spinner. So the sheet opens on the captured photo
   * immediately and the recognised fields drop in when they arrive; anyone who
   * gets impatient and types the amount themselves simply keeps their number
   * (see the composer's own late-scan effect).
   *
   * Recognition is a shortcut, not a gate - a failed or unconfigured scan still
   * leaves the user in the composer with the photo attached, which is exactly
   * where the 相機 button in the composer would have put them.
   */
  async function handleReceiptCaptured(dataUrl: string) {
    if (!activeGroup) return;
    // Pinned: the request outlives this screen, and the user may well have
    // switched groups by the time it answers.
    const { currency } = activeGroup;

    setScanMode(null);
    openExpenseFromReceipt({ imageDataUrl: dataUrl, scan: null });
    setScanBusy(true);

    let scan: ReceiptPrefill["scan"] = null;
    try {
      scan = await createApiClient().scanReceipt({
        client_request_id: crypto.randomUUID(),
        data_url: dataUrl,
        currency,
      });
    } catch {
      // Left null: RECEIPT_SCAN_UNAVAILABLE, offline, rate-limited - all the
      // same downgrade from the user's point of view.
    }

    setScanBusy(false);
    setReceiptScan(scan);
    showToast(scan?.recognised ? text.scanReceiptDone : text.scanReceiptFailed);
  }

  /**
   * A QR seen by the invite scanner. Returning false keeps the camera running,
   * which is what should happen when the user happens to sweep past some other
   * code on the table.
   */
  function handleInviteQrDetected(payload: string): boolean {
    const token = readInviteToken(payload);
    if (!token) return false;
    setInviteInputValue(token);
    setInviteInputError("");
    setScanMode(null);
    return true;
  }

  /**
   * Hand the invite link to the OS share sheet. Falls back to the clipboard
   * where Web Share is missing (every desktop browser, and Firefox), so the
   * button always does something useful rather than being conditionally absent.
   */
  async function shareInviteLink() {
    if (!inviteLink) return;
    if (!navigator.share) {
      await copyInviteText(inviteLink);
      return;
    }
    try {
      await navigator.share({ title: activeGroup?.name ?? "Equo", text: text.inviteJoinAsNewMember, url: inviteLink });
    } catch (error) {
      // A user who taps outside the share sheet cancelled on purpose; only a
      // real failure is worth falling back for.
      if ((error as Error)?.name === "AbortError") return;
      showToast(text.shareInviteFailed);
      await copyInviteText(inviteLink);
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
        />
      </main>
    );
  }

  return (
    <main className="app-shell">
      {!online || pendingWriteCount > 0 ? (
        <div className="offline-banner" role="status" aria-live="polite">
          {!online ? text.offlineNotice : flushingWrites ? text.offlineSyncing : ""}
          {pendingWriteCount > 0 ? (
            <span className="offline-banner__pending">
              {!online ? "・" : null}
              {pendingWriteCount}
              {text.offlinePendingSuffix}
            </span>
          ) : null}
        </div>
      ) : null}
      {pullStatus !== "idle" ? (
        <div className="ptr-indicator" role="status" aria-live="polite">
          {pullStatus === "refreshing" ? "重新整理中…" : pullStatus === "armed" ? "放開以重新整理" : "下拉重新整理"}
        </div>
      ) : null}
      <header className="top-bar">
        {activeGroup ? (
          <button className="top-bar-icon-button mobile-only" type="button" aria-label={text.groupList} inert={!isMobileLayout} aria-hidden={!isMobileLayout || undefined} onClick={() => setGroupDrawerOpen(true)}>
            <Menu aria-hidden="true" size={22} />
            {/* The drawer is closed by default on mobile, so without this the
                per-group badges inside it are invisible until you go looking.
                A dot, not a count: which group it is lives one tap away. */}
            {otherGroupsUnread > 0 ? <span className="top-bar-unread-dot" aria-hidden="true" /> : null}
          </button>
        ) : null}
        {/* The phone shell puts the group's name where the reference app does
            - centred between the drawer button and the avatar - because on a
            screen this narrow "which group am I in" beats the brand. Wider
            layouts keep the brand, which is also the way home. */}
        <button
          className={isMobileLayout && activeGroup ? "brand-mark brand-mark--title" : "brand-mark"}
          type="button"
          onClick={openHome}
        >
          {isMobileLayout && activeGroup ? activeGroup.name : "Equo"}
        </button>
        <div className="top-actions">
          {/* The inbox. A count rather than a dot, unlike the group drawer's
              badge: those are "there is activity in another group", this is
              "somebody wrote to you", and how many matters. */}
          <button
            className="top-bar-icon-button notifications-button"
            type="button"
            aria-label={text.notifications}
            onClick={() => setNotificationsOpen(true)}
          >
            <Bell aria-hidden="true" size={20} />
            {notifications.unread > 0 ? (
              <span className="top-bar-unread-count" aria-hidden="true">
                {notifications.unread > 9 ? "9+" : notifications.unread}
              </span>
            ) : null}
          </button>
          <button
            className="top-bar-icon-button theme-toggle-button"
            type="button"
            aria-label={theme === "light" ? text.themeToDark : text.themeToLight}
            onClick={toggleTheme}
          >
            {theme === "light" ? <Moon aria-hidden="true" size={20} /> : <Sun aria-hidden="true" size={20} />}
          </button>
          {/* Profile sits next to the theme toggle on every screen, in a group
              or not. It used to move into the group rail once you opened a
              group, which left a gap up here and pushed the group's cover down
              a row - and meant "where is my account" had two answers.

              It shows the Google picture when there is one: an avatar is how
              people recognise "this is my account", and a generic outline of a
              person is not. */}
          <button className="profile-dot" type="button" aria-label={text.profile} onClick={openProfileDialog}>
            {displayAvatarUrl ? (
              <img src={upscaleGoogleAvatar(displayAvatarUrl)} alt="" />
            ) : (
              <UserRound aria-hidden="true" size={18} />
            )}
          </button>
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
          <GroupHomeSkeleton />
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
              <div className={groupDrawerSwipe.closing ? "side-drawer side-drawer-left closing" : "side-drawer side-drawer-left"} role="dialog" aria-modal="true" aria-label={text.groupList} {...groupDrawerSwipe.dragProps} ref={groupDrawerRef}>
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
            {/* Root the mobile heading outline: the desktop <h1> lives in the
                group rail, which is inert on mobile, so the workspace would
                otherwise start at <h2>. */}
            {isMobileLayout ? <h1 className="visually-hidden">{activeGroup.name}</h1> : null}
            {isMobileLayout ? (
              <InstallHint state={install.state} onInstall={install.promptInstall} onDismiss={install.dismiss} />
            ) : null}
            {cloudActiveLoading && !cloudActiveDetail ? <GroupHomeSkeleton /> : null}
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

              {/* 新增成員 keeps the width because it is the one action most
                  people are here for; invite and scan are recognisable enough
                  as icons that spelling them out would crowd the card. */}
              <div className="member-quick-actions">
                <button className="member-add-action" type="button" onClick={() => setDialog("memberActions")}>
                  {text.addMember}
                  <Plus aria-hidden="true" size={18} />
                </button>
                <button
                  className="member-icon-button"
                  type="button"
                  aria-label={text.inviteMembers}
                  onClick={openInviteMembers}
                >
                  <Share aria-hidden="true" size={20} />
                </button>
                <button
                  className="member-icon-button"
                  type="button"
                  aria-label={text.scanReceipt}
                  onClick={openReceiptScan}
                >
                  <Scan aria-hidden="true" size={20} />
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
                <div className="date-chip-row" aria-label="日期" ref={dateStripRef}>
                  {dateChips.map((chip) => (
                    <button
                      className={chip.key === selectedDateKey ? "date-chip active" : "date-chip"}
                      type="button"
                      key={chip.key}
                      data-active={chip.key === selectedDateKey}
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
                  <div className="pizo-debt-actions">
                    <button
                      className="settlement-clear-action"
                      type="button"
                      disabled={pendingAction === `settle:${debt.from.id}:${debt.to.id}`}
                      onClick={settleDebt}
                    >
                      {pendingAction === `settle:${debt.from.id}:${debt.to.id}` ? text.processing : text.clearDebt}
                    </button>
                    {/* 清償 is "I have been paid"; 提醒 is "you haven't paid me
                        yet". Two answers to the same moment, so they belong
                        side by side - 清償 keeps the filled treatment because
                        it is the one that changes the ledger. */}
                    {debtNudgeable ? (
                      <button
                        className={debtNudged ? "pizo-debt-nudge-action sent" : "pizo-debt-nudge-action"}
                        type="button"
                        aria-label={`${text.nudgeAria}: ${debt.from.name}`}
                        disabled={debtNudged || pendingAction === `nudge:${debt.from.id}`}
                        onClick={() => nudgeMember(debt.from)}
                      >
                        <BellRing aria-hidden="true" size={16} />
                        {debtNudged ? text.nudgeSent : text.nudge}
                      </button>
                    ) : null}
                  </div>
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
                coverImageUrl={activeGroup.coverImageUrl}
                memberCount={members.length}
                isOwner={isCurrentMemberOwner}
                onEditGroup={openEditGroup}
                onNavigate={handleSideNavClick}
                onArchive={() => setDialog("archive")}
                onDelete={() => setDialog("delete")}
              />
            ) : null}
          </aside>

          {settingsDrawerOpen ? (
            <div className={settingsDrawerSwipe.closing ? "side-drawer-backdrop closing" : "side-drawer-backdrop"} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) settingsDrawerSwipe.requestClose(); }}>
              <div className={settingsDrawerSwipe.closing ? "side-drawer side-drawer-right closing" : "side-drawer side-drawer-right"} role="dialog" aria-modal="true" aria-label={text.groupManage} {...settingsDrawerSwipe.dragProps} ref={settingsDrawerRef}>
                {activeGroup ? (
              <GroupSideNav
                groupName={activeGroup.name}
                coverImageUrl={activeGroup.coverImageUrl}
                memberCount={members.length}
                isOwner={isCurrentMemberOwner}
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
            onClick={openExpenseComposer}
          >
            <Plus aria-hidden="true" size={34} />
          </button>

          <nav className="mobile-tab-bar" aria-label={text.groupHome} inert={!isMobileLayout} aria-hidden={!isMobileLayout || undefined}>
            <button
              className={activeTab === "home" ? "mobile-tab-item active" : "mobile-tab-item"}
              type="button"
              aria-label={text.navHome}
              aria-current={activeTab === "home" ? "page" : undefined}
              onClick={() => {
                dismissDialog();
                closeExpenseComposer();
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              <House aria-hidden="true" size={20} />
              <span>{text.navHome}</span>
            </button>
            <button
              className={activeTab === "records" ? "mobile-tab-item active" : "mobile-tab-item"}
              type="button"
              aria-label={text.navRecords}
              aria-current={activeTab === "records" ? "page" : undefined}
              onClick={() => setDialog("recordsPanel")}
            >
              <History aria-hidden="true" size={20} />
              <span>{text.navRecords}</span>
            </button>
            <button
              className="mobile-tab-center"
              type="button"
              aria-label={text.addExpense}
              onClick={openExpenseComposer}
            >
              <Plus aria-hidden="true" size={26} />
            </button>
            <button
              className={activeTab === "analysis" ? "mobile-tab-item active" : "mobile-tab-item"}
              type="button"
              aria-label={text.navAnalysis}
              aria-current={activeTab === "analysis" ? "page" : undefined}
              onClick={() => setDialog("analysisPanel")}
            >
              <ChartNoAxesColumn aria-hidden="true" size={20} />
              <span>{text.navAnalysis}</span>
            </button>
            {/* 設定, not 群組成員: the member list lives one row inside this
                drawer, and a settings destination is what the fifth slot is for
                on every phone app people already use. It also gives the gear
                that used to sit in the top bar a home. */}
            <button
              className={activeTab === "settings" ? "mobile-tab-item active" : "mobile-tab-item"}
              type="button"
              aria-label={text.navSettings}
              aria-current={activeTab === "settings" ? "page" : undefined}
              onClick={() => setSettingsDrawerOpen(true)}
            >
              <Settings aria-hidden="true" size={20} />
              <span>{text.navSettings}</span>
            </button>
          </nav>
        </section>
      )}

      {/* Above every sheet and drawer: it takes the whole screen and owns the
          camera while it is up. Unmounting is what stops the stream, so this
          must never be merely hidden. */}
      {scanMode ? (
        <Suspense fallback={null}>
          <ScanSheet
            mode={scanMode}
            onClose={() => setScanMode(null)}
            onCaptureReceipt={handleReceiptCaptured}
            onDetectInvite={handleInviteQrDetected}
            onImageError={() => showToast(text.photoError)}
          />
        </Suspense>
      ) : null}

      {expenseComposerOpen ? (
        <Suspense fallback={null}>
        <ExpenseComposerSheet
          members={members}
          groupId={activeGroup?.id ?? ""}
          groupCurrency={activeGroup?.currency ?? "TWD"}
          currencyOptions={currencyOptions}
          initialExpense={editingExpense ?? duplicatingExpense ?? undefined}
          duplicating={Boolean(duplicatingExpense)}
          receiptPrefill={receiptPrefill ?? undefined}
          scanPending={scanBusy}
          onClose={requestCloseComposer}
          onDirtyChange={setComposerDirty}
          onSubmit={handleExpenseDraftSubmit}
          onImageError={() => showToast(text.photoError)}
        />
        </Suspense>
      ) : null}

      {/* Asked before the camera ever opens. Declining is a plain button, not
          a hidden backdrop tap, and it leaves the user exactly where they
          were - the composer's own camera still attaches photos without any
          of this. */}
      {scanConsentOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setScanConsentOpen(false);
          }}
        >
          <section className="flow-dialog glass-panel" role="dialog" aria-modal="true" aria-label={text.scanConsentTitle}>
            <div className="dialog-header centered">
              <ScanLine aria-hidden="true" size={28} />
              <h3>{text.scanConsentTitle}</h3>
              <p>{text.scanConsentBody}</p>
            </div>
            <p className="scan-consent-note">{text.scanConsentNote}</p>
            <button
              className="text-action"
              type="button"
              onClick={() => {
                setScanConsentOpen(false);
                setDialog("profile");
                setInfoDialog("privacy");
              }}
            >
              {text.scanConsentPrivacyLink}
            </button>
            <div className="dialog-action-row">
              <button className="secondary-action" type="button" onClick={() => setScanConsentOpen(false)}>
                {text.scanConsentDecline}
              </button>
              <button className="primary-action" type="button" onClick={acceptScanConsent}>
                {text.scanConsentAccept}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {discardConfirmOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDiscardConfirmOpen(false);
          }}
        >
          <section className="flow-dialog glass-panel" role="dialog" aria-modal="true" aria-label={text.discardExpenseTitle}>
            <div className="dialog-header centered">
              <AlertTriangle aria-hidden="true" size={28} />
              <h3>{text.discardExpenseTitle}</h3>
              <p>{text.discardExpenseBody}</p>
            </div>
            <div className="dialog-action-row">
              <button className="secondary-action" type="button" onClick={() => setDiscardConfirmOpen(false)}>
                {text.discardExpenseCancel}
              </button>
              <button className="danger-action" type="button" onClick={discardComposerDraft}>
                {text.discardExpenseConfirm}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {dialog === "profile" ? (
        <Suspense fallback={null}>
        <ProfileDialog
          profile={profile}
          displayAvatarUrl={displayAvatarUrl ?? undefined}
          session={session}
          infoDialog={infoDialog}
          onOpenInfoDialog={setInfoDialog}
          theme={theme}
          onToggleTheme={toggleTheme}
          onClose={closeDialog}
          onSave={saveProfile}
          onToast={showToast}
          onLogout={signOut}
          onDeleteAccount={handleDeleteAccount}
          scanConsentGranted={scanConsentGranted}
          onDisableScanConsent={disableScanConsent}
          onFeedback={() => {
            closeDialog();
            setFeedbackOpen(true);
          }}
        />
        </Suspense>
      ) : null}

      {feedbackOpen ? (
        <Suspense fallback={null}>
          <FeedbackDialog onClose={() => setFeedbackOpen(false)} onSubmit={handleFeedbackSubmit} />
        </Suspense>
      ) : null}

      {notificationsOpen ? (
        <Suspense fallback={null}>
          <NotificationsPanel
            items={notifications.items}
            loading={notifications.loading}
            onClose={() => setNotificationsOpen(false)}
            onOpened={() => void notifications.markAllRead()}
            onDelete={(id) => void notifications.remove(id)}
            onClearAll={() => {
              void notifications.clearAll();
              setNotificationsOpen(false);
            }}
            onNavigate={(link) => {
              setNotificationsOpen(false);
              // Only the one shape the console can send. Anything else is
              // ignored rather than handed to the router: a notification is
              // not a place to accept an arbitrary destination from.
              const groupId = /^\/group\/([^/?#]+)$/.exec(link)?.[1];
              if (groupId) openGroup(groupId);
            }}
          />
        </Suspense>
      ) : null}

      {dialog === "expenseDetail" && selectedExpense ? (
        <Suspense fallback={null}>
        <ExpenseDetailDialog
          expense={selectedExpense}
          members={members}
          onClose={closeDialog}
          onEdit={openExpenseEdit}
          onDuplicate={openExpenseDuplicate}
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
        </Suspense>
      ) : null}

      {dialog && dialog !== "profile" && dialog !== "expenseDetail" ? (
        <div
          className={dialogSwipe.closing ? "modal-backdrop closing" : "modal-backdrop"}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) dismissDialog();
          }}
        >
          <section
            className={`${panelDialogOpen ? "flow-dialog panel-dialog glass-panel" : "flow-dialog glass-panel"}${dialogSwipe.closing ? " closing" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={text.groupHome}
            {...dialogSwipe.dragProps}
            ref={dialogRef}
          >
            <div className="dialog-drag-handle" aria-hidden="true" />
            <button className="dialog-close" type="button" aria-label={text.cancel} onClick={dismissDialog}>
              <X aria-hidden="true" size={18} />
            </button>

            {/* Keyed on `dialog` so switching panels from the tab bar remounts
                the body and replays its entrance. Without this the shell stays
                mounted across 記錄 -> 分析 and the content simply swaps between
                two frames, which is the "生硬" part of tab switching. Carries
                the parent's grid + gap so wrapping the body changes nothing
                about the layout. */}
            <div className="dialog-body" key={dialog}>
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
                      <img src={groupCoverDataUrl || groupCoverUrl} alt="" loading="lazy" decoding="async" />
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
                    <button className="secondary-action" type="button" onClick={dismissDialog}>
                      {text.cancel}
                    </button>
                    <button className="primary-action" type="button" disabled={!groupName.trim() || pendingAction === "editGroup"} onClick={updateActiveGroup}>
                      {pendingAction === "editGroup" ? text.savingChanges : text.save}
                    </button>
                  </div>
                </>
              ) : null}


              {dialog === "recordsPanel" ? (
                <Suspense fallback={null}>
                <RecordsPanel
                  expenseCount={aggregates.expenseCount}
                  totalExpenseMinor={totalExpenseMinor}
                  currency={activeGroup?.currency ?? "TWD"}
                  expenses={expenses}
                  members={members}
                  activities={activities}
                  canLoadMoreExpenses={canLoadMoreExpenses}
                  loadingMoreExpenses={loadingMoreExpenses}
                  pendingAction={pendingAction}
                  pendingWriteIds={pendingWriteIds}
                  onLoadMore={handleLoadMoreExpenses}
                  onExportCsv={handleExportCsv}
                  onOpenExpense={openExpenseDetail}
                />
                </Suspense>
              ) : null}

              {dialog === "analysisPanel" ? (
                <Suspense fallback={null}>
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
                </Suspense>
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
                    <p>
                      <strong className="invite-group-name">{activeGroup?.name ?? ""}</strong>
                      <span>{text.inviteJoinAsNewMember}</span>
                    </p>
                  </div>
                  <div className="invite-dialog-card">
                    {/* The QR is the primary affordance: the other phone points
                        its camera and is done, no code to read out or mistype. */}
                    <Suspense fallback={<div className="invite-qr-frame invite-qr-frame--empty" aria-hidden="true" />}>
                      <InviteQrCode value={cloudInviteLoading ? "" : inviteLink} />
                    </Suspense>
                    <button
                      className="invite-code-row"
                      type="button"
                      aria-label={`${text.copyCode} ${inviteCode}`}
                      disabled={!inviteCode}
                      onClick={() => copyInviteText(inviteCode)}
                    >
                      <Copy aria-hidden="true" size={18} />
                      <span>{text.inviteCode}</span>
                      <strong>{cloudInviteLoading ? "..." : inviteCode}</strong>
                    </button>
                    <button
                      className="primary-action"
                      type="button"
                      disabled={!inviteLink}
                      onClick={() => copyInviteText(inviteLink)}
                    >
                      <Link aria-hidden="true" size={18} />
                      {text.copyLink}
                    </button>
                    <button className="text-action invite-share-action" type="button" disabled={!inviteLink} onClick={shareInviteLink}>
                      {text.shareInvite}
                    </button>
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
                      onKeyDown={(event) => {
                        // Make the keyboard's "Go" key actually join (no <form> to
                        // submit) — matches the enterKeyHint promise below.
                        if (event.key === "Enter" && inviteInputValue.trim() && pendingAction !== "joinGroup") {
                          submitInviteInput();
                        }
                      }}
                      placeholder={text.inviteInputPlaceholder}
                      aria-label={text.inviteCode}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      autoComplete="off"
                      spellCheck={false}
                      enterKeyHint="go"
                    />
                  </label>
                  {inviteInputError ? <p className="dialog-inline-error">{inviteInputError}</p> : null}
                  <button className="invite-scan-action" type="button" onClick={() => setScanMode("invite")}>
                    <Scan aria-hidden="true" size={18} />
                    {text.scanInviteQr}
                  </button>
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
                  currentMemberId={currentMember?.id}
                  nudgedMemberIds={nudgedMemberIds}
                  onNudge={nudgeMember}
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
                    <button className="secondary-action" type="button" onClick={dismissDialog}>
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
                <Suspense fallback={null}>
                  <ArchivedListPanel
                    archivedGroups={archivedGroups}
                    loading={archivedGroupsLoading}
                    unarchivingGroupId={unarchivingGroupId}
                    onUnarchive={unarchiveGroup}
                  />
                </Suspense>
              ) : null}

              {dialog === "archive" || dialog === "delete" ? (
                <>
                  <div className="dialog-header centered">
                    <AlertTriangle aria-hidden="true" size={28} />
                    <h3>{dialog === "archive" ? text.archiveGroup : text.deleteGroup}</h3>
                    <p>{dialog === "archive" ? "\u5c01\u5b58\u5f8c\u53ef\u5f9e\u5de6\u5074\u4e0a\u65b9\u7684\u5c01\u5b58\u5165\u53e3\u67e5\u770b\u3002" : "刪除後這個群組與所有記錄將永久移除，無法復原。"}</p>
                  </div>
                  <div className="dialog-action-row">
                    <button className="secondary-action" type="button" onClick={dismissDialog}>
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
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
