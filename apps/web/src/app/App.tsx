import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  ChartNoAxesColumn,
  Copy,
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
  Sun,
  UserRound,
  X,
} from "lucide-react";
import { syncAppBadge } from "./appBadge";
import { lazyChunk } from "./lazyChunk";
import { clearShortcutParam, readShortcutAction, type ShortcutAction } from "./appShortcuts";
import { clearShareParam, hasSharedReceipt, takeSharedReceiptFile } from "./sharedReceipt";
import { downscaleDataUrl, downscaleImageFileToDataUrl, RECEIPT_MAX_EDGE_PX } from "./expenseImage";
import { createAutoSync } from "./autoSync";
import { buildSettlementTransfers } from "./buildSettlementTransfers";
import { createApiClient } from "./apiClient";
import { dateKey, lastEightDays } from "./appDates";
import { describeCloudActionError } from "./describeCloudActionError";
import { MemberListPanel } from "./MemberListPanel";
import { type FeedbackType } from "./FeedbackDialog";
import { GroupHomeSkeleton } from "./GroupHomeSkeleton";
import { GroupMenu } from "./GroupMenu";
import { PanelSkeleton } from "./PanelSkeleton";
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
import { useRailState } from "./useRailState";
import { useSwipeToDismissX } from "./useSwipeToDismissX";
import { useDragScrollX } from "./useDragScrollX";
import { useSpendBreakdown } from "./useSpendBreakdown";
import { useRecurringExpenses } from "./useRecurringExpenses";
import { listSettlementRecords } from "./settlementHistory";
import { useSettlementHistory } from "./useSettlementHistory";
import { type ArchivedGroupData } from "./cloudStore";
import { useExpenseComments } from "./useExpenseComments";
import { useSiteNotice } from "./useSiteNotice";
import { SiteNoticeBar } from "./SiteNoticeBar";
import { categoryOptions } from "./catalog";
import { useAppShortcuts } from "./useAppShortcuts";
import { parseSettleAmountMinor, settleAmountInputValue, type SettlementIntent } from "./settlementActions";
import { recentExpenseTitles } from "./composerMemory";
import { type ExpenseDraft } from "./ExpenseComposerSheet";
import type { ScanSheetMode } from "./ScanSheet";
import { readInviteToken } from "./inviteToken";
import { grantScanConsent, hasScanConsent, revokeScanConsent } from "./scanConsent";
import type { ReceiptPrefill } from "./receiptPrefill";
import { CoverCropSheet } from "./CoverCropSheet";
import { GroupHome } from "./GroupHome";
import { GroupRail } from "./GroupRail";
// Eager, not a lazy chunk: this is the first thing a first-time visitor sees,
// and it is the one screen that must not wait on a second round-trip.
import { LandingPage } from "./LandingPage";
import { upscaleGoogleAvatar } from "./MemberAvatar";
import { isGroupOwner } from "./isGroupOwner";
import { resolveActiveTab } from "./resolveActiveTab";
import { resolveCurrentMember } from "./resolveCurrentMember";
import { StartFlow } from "./StartFlowPanel";
import { useSwipeToDismiss } from "./useSwipeToDismiss";
import { clearPendingRoute, readPendingRoute } from "./pendingRoute";
import { isPersonalGroup } from "./personalLedger";
import { resolveRootLanding } from "./resolveRootLanding";
import type { DialogMode, InfoDialogMode, Group, Member, StartMode } from "./appTypes";
import { formatAmount } from "./formatAmount";
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
import { copyText } from "./copyText";
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
 * Small dialogs get <Suspense fallback={null}>: they are overlays over a screen
 * that is already there, so "nothing yet" is the correct intermediate state -
 * a spinner would flash for a chunk that is usually already warm (see
 * prefetchOverlayChunks).
 *
 * The full-height PANELS do not, and that was a real bug rather than a matter
 * of taste: their sheet shell ships in the entry chunk, so `null` gave you an
 * empty strip stuck to the bottom of the screen for as long as the fetch took.
 * They reserve the height instead (PanelSkeleton).
 */
const AnalysisPanel = lazyChunk(() => import("./AnalysisPanel").then((m) => ({ default: m.AnalysisPanel })));
const ArchivedListPanel = lazyChunk(() => import("./ArchivedListPanel").then((m) => ({ default: m.ArchivedListPanel })));
const ExpenseComposerSheet = lazyChunk(() =>
  import("./ExpenseComposerSheet").then((m) => ({ default: m.ExpenseComposerSheet })),
);
const ExpenseDetailDialog = lazyChunk(() =>
  import("./ExpenseDetailDialog").then((m) => ({ default: m.ExpenseDetailDialog })),
);
const FeedbackDialog = lazyChunk(() => import("./FeedbackDialog").then((m) => ({ default: m.FeedbackDialog })));
const RecurringPanel = lazyChunk(() => import("./RecurringPanel").then((m) => ({ default: m.RecurringPanel })));
const NotificationsPanel = lazyChunk(() =>
  import("./NotificationsPanel").then((m) => ({ default: m.NotificationsPanel })),
);
const ProfileDialog = lazyChunk(() => import("./ProfileDialog").then((m) => ({ default: m.ProfileDialog })));
const RecordsPanel = lazyChunk(() => import("./RecordsPanel").then((m) => ({ default: m.RecordsPanel })));
// The QR encoder and the camera/decoder are each behind a tap and are dead
// weight for everyone who never opens them - the decoder alone outweighs the
// rest of this list.
const InviteQrCode = lazyChunk(() => import("./InviteQrCode").then((m) => ({ default: m.InviteQrCode })));
const ScanSheet = lazyChunk(() => import("./ScanSheet").then((m) => ({ default: m.ScanSheet })));

/**
 * Warm every chunk that is one tap from the home screen, once the browser is
 * idle.
 *
 * Called only when there is a session (see the gate at the call site). Signed
 * out there is no home screen to be one tap from - the same component renders
 * the public landing page, and warming these there was 31.3 kB gzipped of
 * screens the visitor cannot open.
 *
 * Without this, splitting the composer out would trade 46KB off the critical
 * path for a stall on the 記一筆 tap - which is the one interaction this app
 * exists for. Fetching it after first paint costs nothing anybody can see and
 * makes the tap instant. requestIdleCallback is missing on iOS Safari, hence
 * the timeout fallback.
 *
 * ⚠️ The list has to match the bottom bar, and for a long time it did not: it
 * warmed the composer and the expense detail while 記錄 and 分析 - two of the
 * five buttons down there - were left cold. What that looks like was caught on
 * video: tap 分析, the scrim comes up, and an EMPTY sheet sits at the bottom of
 * the screen for two and a half seconds before the panel appears. The sheet
 * shell is in the entry chunk, so it arrives instantly and then waits, which
 * reads as the app hanging on the way up.
 */
function prefetchOverlayChunks(): void {
  const warm = () => {
    // Swallowed, unlike the render-time imports: this is speculative warming,
    // and a stale chunk here is neither worth an entry in the error log nor
    // worth reloading the page out from under someone who has not asked for
    // either sheet yet. The real import when they do tap is what recovers.
    void import("./ExpenseComposerSheet").catch(() => {});
    void import("./ExpenseDetailDialog").catch(() => {});
    void import("./RecordsPanel").catch(() => {});
    void import("./AnalysisPanel").catch(() => {});
    void import("./ProfileDialog").catch(() => {});
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

export function App() {
  const { activeGroupId, openGroup, closeGroup } = useGroupRoute();
  const [startMode, setStartMode] = useState<StartMode>("create");
  const [selectedTemplate, setSelectedTemplate] = useState("trip");
  const [dialog, setDialog] = useState<DialogMode>(null);
  /** Bumped by `/` to move the cursor into the records search. See useAppShortcuts. */
  const [focusSearchSignal, setFocusSearchSignal] = useState(0);
  // The privacy/terms sheet that stacks on top of the profile dialog. Lifted out
  // of ProfileDialog so it can be a layer of its own in the Back-button stack.
  const [infoDialog, setInfoDialog] = useState<InfoDialogMode>(null);
  // The picked cover, waiting for its crop. Held here rather than inside the
  // group dialogs because both 建立群組 and 編輯群組 pick covers and the sheet
  // has to sit above whichever one is open.
  const [coverToCrop, setCoverToCrop] = useState<string | null>(null);
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
  /**
   * The settlement waiting on a yes. 清償 writes a real entry into the ledger
   * saying somebody has already handed money over, so it does not fire from a
   * single tap on the home screen — the app asks before a draft is thrown
   * away, and this is worth more than a draft.
   */
  const [settleConfirm, setSettleConfirm] = useState<{ fromId: string; toId: string; amountMinor: number } | null>(null);
  /**
   * What is actually going to be recorded, as typed.
   *
   * Separate from settleConfirm.amountMinor, which stays the FULL balance: the
   * dialog needs both to offer 全額 and to refuse anything above it.
   */
  const [settleAmountInput, setSettleAmountInput] = useState("");
  const [spendTab, setSpendTab] = useState<"personal" | "group">("personal");
  const [selectedDateKey, setSelectedDateKey] = useState(() => dateKey(new Date().toISOString()));
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const { theme, toggleTheme } = useThemeMode();
  const { railExpanded, toggleRail } = useRailState();
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
  /**
   * The settle confirm's Esc key and focus trap.
   *
   * It had neither: it is a plain backdrop plus a panel rather than one of the
   * sheets, so it never picked up the chrome the rest of the app's dialogs
   * share. Two buttons could be tabbed to and clicked, so nobody noticed —
   * but it now holds a focused text field, and a box you are typing in that
   * Esc cannot close is the one place that gap is felt.
   */
  const settleConfirmChromeRef = useDialogChrome(() => setSettleConfirm(null));
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
  // Not gated on the session, unlike the two above: an announcement has to
  // reach the login screen, and during maintenance the people who most need the
  // explanation are the ones who cannot get past it.
  const fetchSiteNotice = useMemo(() => () => pollingClient.getSiteNotice(), [pollingClient]);
  // Also ungated: it is what the landing page shows somebody who arrived from
  // an invite link, which by definition happens before they sign in.
  const fetchInvitePreview = useMemo(
    () => (token: string) => pollingClient.getInvitePreview(token),
    [pollingClient],
  );
  const siteNotice = useSiteNotice(fetchSiteNotice);
  // Clearing the cookie is the whole operation; the reload is what makes the
  // app stop being somebody else, since every module resolved its data from
  // that cookie on the way in.
  const stopViewAs = () => {
    void pollingClient
      .stopViewAs()
      .catch(() => {})
      .finally(() => window.location.assign("/admin"));
  };
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
    monthlyBudget,
    setMonthlyBudget,
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
    onCropRequested: setCoverToCrop,
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
    editingPaymentNoteMemberId,
    paymentNoteValue,
    setPaymentNoteValue,
    resetMemberManagement,
    addVirtualMember,
    startRenameMember,
    cancelRenameMember,
    submitRenameMember,
    startEditPaymentNote,
    cancelEditPaymentNote,
    submitPaymentNote,
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
  // Only the settlements inside the loaded expense window. The full history
  // comes from the server (useSettlementHistory) and these are merged in, so a
  // 清償 tapped a second ago shows before the fetch catches up.
  const localSettlementRecords = useMemo(() => listSettlementRecords(expenses), [expenses]);

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
        Boolean(settleConfirm) ||
        feedbackOpen ||
        notificationsOpen ||
        groupDrawerOpen ||
        settingsDrawerOpen),
  );

  /**
   * The two keyboard shortcuts, and the conditions under which they mean
   * anything.
   *
   * Off whenever something is already on top: the keystroke belongs to that,
   * and a second sheet arriving over the one somebody is reading is worse than
   * no shortcut. Off without a group for the plainer reason that there is
   * nothing to record an expense against.
   */
  const shortcutsEnabled =
    Boolean(session && activeGroup) &&
    !expenseComposerOpen &&
    !discardConfirmOpen &&
    !settleConfirm &&
    !feedbackOpen &&
    !notificationsOpen &&
    !groupDrawerOpen &&
    !settingsDrawerOpen &&
    // The records sheet is the exception: `/` is for putting the cursor in ITS
    // search box, and refusing while it is open would mean the shortcut only
    // worked the first time.
    (!dialog || dialog === "recordsPanel");

  useAppShortcuts({
    enabled: shortcutsEnabled,
    onNewExpense: openExpenseComposer,
    onFocusSearch: () => {
      setDialog("recordsPanel");
      setFocusSearchSignal((signal) => signal + 1);
    },
  });

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
    // Opened FROM the group create/edit dialog and leaves it standing, so Back
    // peels the cropper off first — same rule as the invite scanner above.
    { open: coverToCrop !== null, close: () => setCoverToCrop(null) },
  ]);

  // Mirror "something is covering the screen" onto <html>. This used to let
  // the WebGL backdrop (GlassBackground) pause itself while covered — it is
  // unmounted now (see main.tsx; the aurora field is static CSS instead, see
  // `body` in app-base.css), so this effect currently has no observer and is
  // a no-op DOM write. Left in place rather than pulled: it is cheap, and a
  // future surface (or a rolled-back GlassBackground) could read it the same
  // way this was originally wired for.
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

  // Loaded whenever the detail dialog has an entry open, and cleared when it
  // does not: the hook takes a null expenseId and holds nothing.
  const expenseComments = useExpenseComments(
    cloudStore,
    activeGroupId,
    dialog === "expenseDetail" ? selectedExpenseId : null,
  );

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

  // The records panel owns the filter state, so it gets a searcher already
  // bound to the active group rather than the group id plus a raw client.
  // Memoised because the search hook's debounce effect keys on its identity.
  const searchExpensesInGroup = useMemo(() => {
    if (!cloudStore || !activeGroupId) return null;
    return (search: Parameters<typeof cloudStore.searchExpenses>[1]) =>
      cloudStore.searchExpenses(activeGroupId, search);
  }, [cloudStore, activeGroupId]);

  // 清償紀錄 over the whole history, fetched when the 分析 panel opens.
  const settlementHistory = useSettlementHistory({
    searchExpenses: searchExpensesInGroup,
    enabled: dialog === "analysisPanel",
    localRecords: localSettlementRecords,
  });

  // 循環支出 rules, loaded only while their panel is open.
  const recurring = useRecurringExpenses({
    store: cloudStore,
    groupId: activeGroupId,
    enabled: dialog === "recurringList",
    showToast,
    describeError: describeCloudActionError,
  });

  // 分析 panel's period stats. Fetched only while that panel is open - the
  // numbers span the group's whole history, which no other screen shows.
  const spendBreakdown = useSpendBreakdown({
    fetchSpendBreakdown: cloudStore?.fetchSpendBreakdown ?? null,
    groupId: activeGroupId,
    enabled: dialog === "analysisPanel",
    describeError: describeCloudActionError,
  });
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
  const settleAmount = parseSettleAmountMinor(settleAmountInput, settleConfirm?.amountMinor ?? 0);
  /**
   * Typed a real number, and it is over the balance.
   *
   * Told apart from "not a number yet" on purpose: an empty field mid-typing
   * disables the button quietly, while asking to settle more than is owed gets
   * an explanation, because it is a thing somebody meant to do.
   */
  const settleAmountTooMuch =
    Boolean(settleConfirm) && !settleAmount.valid && settleAmount.minor > settleConfirm!.amountMinor;

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

  /**
   * What this group has called things before, for the composer's title field.
   *
   * Built here because this is where the expenses already are - the composer
   * should not need its own copy of the ledger to fill one dropdown. Category
   * labels are excluded: the composer writes those itself when the title is
   * left blank, so offering them back is offering somebody their own blank.
   */
  const recentExpenseTitleSuggestions = useMemo(
    () => recentExpenseTitles(expenses, new Set(categoryOptions().map((option) => option.label))),
    [expenses],
  );

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

  // Once there is a session, after the first paint: pull the composer's chunk
  // down while nothing else is competing for the connection.
  //
  // Gated, and the gate is the point. Signed out, this is the marketing page,
  // and every chunk below is a screen that page cannot reach - measured on
  // production, an unauthenticated visitor was fetching 31.3 kB gzipped
  // (93.7 kB to parse) of composer, records, analysis, profile and the legal
  // documents that ride along with the profile dialog. Depending on the
  // boolean rather than the session object so this fires at most twice: once
  // for somebody who arrives already signed in, once at the moment somebody
  // signs in - not again every time the session is refreshed underneath.
  const hasSession = Boolean(session);

  useEffect(() => {
    if (!hasSession) return;
    prefetchOverlayChunks();
  }, [hasSession]);

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

  /**
   * A photo shared into Equo from the OS share sheet (see sharedReceipt.ts).
   *
   * Same shape as the add-expense shortcut above — wait for a session and a
   * group, then consume the intent exactly once — but with a file to collect
   * from the worker's handover cache first.
   *
   * Recognition is gated on the consent the user has already given (or not) for
   * the scan button, and for the same reason: sharing a photo into the app is
   * not consent to forward it to a third-party model. Without that consent the
   * photo is simply attached, which is precisely what the composer's own 相機
   * button does — the expense still gets its receipt, the amount gets typed.
   */
  const sharedReceiptRef = useRef(hasSharedReceipt(window.location.search));

  useEffect(() => {
    if (!session || !sharedReceiptRef.current || !activeGroup) return;
    sharedReceiptRef.current = false;
    clearShareParam();

    let cancelled = false;
    void (async () => {
      const file = await takeSharedReceiptFile();
      if (!file || cancelled) return;

      // Sized for what is about to happen to it: the recognition-grade capture
      // only when recognition is actually going to run (handleReceiptCaptured
      // cuts it back down before storing), otherwise straight to the ordinary
      // photo size, since nothing is going to read the small print.
      const maxEdge = scanConsentGranted ? RECEIPT_MAX_EDGE_PX : undefined;
      let dataUrl: string;
      try {
        dataUrl = await downscaleImageFileToDataUrl(file, maxEdge);
      } catch {
        // Something that claimed to be an image and wasn't decodable. Nothing
        // to attach, and nothing worth interrupting the launch over.
        return;
      }
      if (cancelled) return;

      if (scanConsentGranted) void handleReceiptCaptured(dataUrl);
      else openExpenseFromReceipt({ imageDataUrl: dataUrl, scan: null });
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, activeGroup]);

  useEffect(() => {
    if (!session) return;
    // groupsSynced, NOT groupsSyncAttempted: every branch below decides something
    // about a group id (land on it, forward to it, or throw it away with a
    // 「群組不存在」 toast), and those may only be judged against the server's
    // list. The cloud cache can seed a list from a previous session that
    // predates the very group a fresh invite link points at.
    if (!cloudState || !cloudState.groupsSynced) return;
    const routeId = readRouteGroupId();
    if (!routeId) {
      // Root URL: land the user on their most-recent group instead of the
      // create-first-group start flow. Groups are loaded here (the guard
      // above waited for the server list); a null landing means zero groups, so
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
  }, [activeGroupId, cloudGroups, session, cloudState?.groupsSynced]);

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

  /**
   * The same unread total, on the installed app's icon (see appBadge.ts).
   *
   * Everything the app itself calls unread counts: group activity plus the
   * bell's inbox. Note this uses the *total* across groups rather than the
   * top-bar's otherGroupsUnread — the icon is read from outside the app, where
   * "the group you happen to have open" isn't a meaningful exclusion. The
   * active group is marked read by the effect above within a tick anyway, so in
   * practice the two agree.
   *
   * Signed out is an explicit zero, not a skip: leaving the previous account's
   * count on the icon after a logout would be a small privacy leak on a shared
   * phone, and would be plain wrong on the next login.
   */
  useEffect(() => {
    if (!session) {
      syncAppBadge(0);
      return;
    }
    syncAppBadge(otherGroupsUnread + activeGroupUnread + notifications.unread);
  }, [session, otherGroupsUnread, activeGroupUnread, notifications.unread]);

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
          return cloudStore.refreshGroupDetail(groupId, { background: true });
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
    if (id === "recurring") {
      setDialog("recurringList");
      return;
    }
    showToast(text.groupHome);
  }

  /** Hand the payee's 收款資訊 to the clipboard, so it can be pasted into a bank app. */
  async function copyPaymentNote(note: string) {
    showToast((await copyText(note)) ? UI_TEXT.paymentNote.copied : UI_TEXT.paymentNote.copyUnavailable);
  }

  /**
   * Every 清償 affordance lands here — the home card's, the analysis panel's,
   * and the member list's.
   *
   * amountMinor is the whole balance between the two. The confirm seeds its
   * field with it, so agreeing with the suggestion is still one tap and paying
   * part of it is a number away.
   */
  function settleTransfer(fromId: string, toId: string, amountMinor: number) {
    setSettleConfirm({ fromId, toId, amountMinor });
    setSettleAmountInput(settleAmountInputValue(amountMinor));
  }

  async function confirmSettleTransfer() {
    if (!settleConfirm) return;
    const { fromId, toId } = settleConfirm;
    const typed = parseSettleAmountMinor(settleAmountInput, settleConfirm.amountMinor);
    if (!typed.valid) return;
    const amountMinor = typed.minor;
    setSettleConfirm(null);
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

  /**
   * 清償 from a member row, for a pair the minimal-transfer suggestions never
   * named. The row worked out the direction and the amount from the balances
   * it was already showing; this just closes the sheet and puts the same
   * confirm up, so partial payment works here exactly as it does on the card.
   */
  function settleWithMember(_member: Member, intent: SettlementIntent) {
    setDialog(null);
    settleTransfer(intent.fromMemberId, intent.toMemberId, intent.amountMinor);
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
   * "提醒 N 位成員" on the home screen — every debtor at once, in parallel.
   *
   * Not `targets.map(nudgeMember)`: that would fire N toasts (one per
   * member) and, worse, `beginAction` guards a single global key, so every
   * call after the first would be refused outright and silently do nothing.
   * This owns one action key for the whole batch and reports one outcome.
   *
   * The server's cooldown is per-(group, target member), so a mix of
   * results is the normal case, not an edge case: whoever somebody else
   * already reminded today comes back as NUDGE_COOLDOWN, not a failure.
   * That is folded into "reminded" here — the person doesn't need a second
   * reminder sent on their behalf, they need the button to stop asking
   * about them.
   */
  async function nudgeEveryDebtor(targets: Member[]) {
    if (!activeGroup || targets.length === 0) return;
    if (!beginAction("nudgeAll")) return;

    try {
      const api = createApiClient();
      const results = await Promise.allSettled(targets.map((member) => api.nudgeMember(activeGroup.id, member.id)));

      // Members who don't need offering a reminder again, whatever the
      // reason: sent, already reminded by somebody else, or turned out not
      // to owe anything any more. A rate-limited or otherwise-failed target
      // is NOT spent - nothing about their debt changed, so the button
      // should still offer to try them again.
      const spent: string[] = [];
      let sent = 0;
      let cooled = 0;
      let rateLimited = 0;
      let failed = 0;
      results.forEach((result, index) => {
        const memberId = targets[index].id;
        if (result.status === "fulfilled") {
          sent += 1;
          spent.push(memberId);
          return;
        }
        const code = (result.reason as { code?: string } | null)?.code;
        if (code === "NUDGE_COOLDOWN") {
          cooled += 1;
          spent.push(memberId);
        } else if (code === "NUDGE_NOT_NEEDED") {
          spent.push(memberId);
        } else if (code === "RATE_LIMITED") {
          // The write-rate limiter's bucket is per user, not per nudge - a
          // large group's "提醒 N 位成員" can burn through it in one tap.
          // Distinct from a generic failure: nothing is broken, and the
          // existing copy already says so instead of implying an outage.
          rateLimited += 1;
        } else {
          failed += 1;
        }
      });

      if (spent.length) {
        setNudgedMemberIds((current) => [...new Set([...current, ...spent])]);
      }
      if (rateLimited > 0) {
        // Told first, even over a partial success: it's the one actionable
        // fact ("this exact tap is being throttled, not that reminders are
        // broken"), and pairing it with 已提醒 would bury it.
        showToast(describeCloudActionError({ code: "RATE_LIMITED" }));
      } else if (sent > 0 && failed > 0) {
        // "3 成功 2 失敗" has to read differently from "5 全成功" - a bare
        // 已提醒 would claim more than happened.
        showToast(`${text.nudgeSentToast} · ${text.nudgeFailed}`);
      } else if (sent > 0) {
        haptic("success");
        showToast(text.nudgeSentToast);
      } else if (cooled > 0) {
        showToast(text.nudgeCooldown);
      } else if (failed > 0) {
        showToast(text.nudgeFailed);
      }
      // Every target turned out NUDGE_NOT_NEEDED and nothing else: none of
      // the branches above is true, so none is shown.
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
   *
   * The capture arrives at RECEIPT_MAX_EDGE_PX because recognition has to read
   * the small print; what gets attached to the expense is cut back to the
   * ordinary photo size first. Recognition is kicked off against the big one
   * before that happens, so the extra decode costs the sheet a few tens of
   * milliseconds and costs the five-second round trip nothing.
   */
  async function handleReceiptCaptured(dataUrl: string) {
    if (!activeGroup) return;
    // Pinned: the request outlives this screen, and the user may well have
    // switched groups by the time it answers.
    const { currency } = activeGroup;

    setScanMode(null);
    setScanBusy(true);

    const scanRequest = createApiClient()
      .scanReceipt({
        client_request_id: crypto.randomUUID(),
        data_url: dataUrl,
        currency,
      })
      .catch(() => {
        // Null: RECEIPT_SCAN_UNAVAILABLE, offline, rate-limited - all the same
        // downgrade from the user's point of view.
        return null;
      });

    // Best effort by contract: this resolves to the capture itself rather than
    // failing or hanging, so the sheet opens either way. An oversized photo on
    // the expense is a cost; a sheet that never arrives is a broken feature.
    const storedDataUrl = await downscaleDataUrl(dataUrl);
    openExpenseFromReceipt({ imageDataUrl: storedDataUrl, scan: null });

    const scan: ReceiptPrefill["scan"] = await scanRequest;

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
    dialog === "recurringList" ||
    dialog === "analysisPanel";


  if (!session) {
    return (
      // The landing page is full-bleed: it runs its own scrim and column widths
      // edge to edge, where the shell's centred 1180px box would leave strips of
      // raw backdrop down both sides of it.
      <main className="app-shell app-shell--landing">
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
        <SiteNoticeBar notice={siteNotice} onStopViewAs={stopViewAs} />
        <LandingPage
          loading={authLoading}
          errorMessage={authError || undefined}
          onGoogleLogin={startGoogleLogin}
          fetchInvitePreview={fetchInvitePreview}
        />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <SiteNoticeBar notice={siteNotice} onStopViewAs={stopViewAs} />
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
          {pullStatus === "refreshing"
            ? UI_TEXT.misc.pullRefreshing
            : pullStatus === "armed"
              ? UI_TEXT.misc.pullArmed
              : UI_TEXT.misc.pullIdle}
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

      {/* Above the group create/edit dialog that opened it (see the overlay
          stack), so Back peels the cropper off and leaves the form standing. */}
      {coverToCrop ? (
        <CoverCropSheet
          imageDataUrl={coverToCrop}
          onCancel={() => setCoverToCrop(null)}
          onConfirm={(cropped) => {
            setGroupCoverDataUrl(cropped);
            setCoverToCrop(null);
          }}
        />
      ) : null}

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

      {/* 建立或加入一個群組 answers "you have no groups". Until the server's
          list has been read it is not an answer to anything — see
          groupsSyncAttempted, and the note on it about what a returning
          visitor used to be shown while GET /groups was in flight. */}
      {!activeGroup && (!cloudState || !cloudState.groupsSyncAttempted) ? (
        <section className="workspace-grid workspace-grid--solo">
          <GroupHomeSkeleton />
        </section>
      ) : !activeGroup ? (
        <StartFlow
          // The ledger is not a destination StartFlow offers to "continue" -
          // it is created lazily and silently on first list fetch, so it
          // must stay invisible to the create-first-group flow's own count
          // and list (see resolveRootLanding for where it lands instead).
          groups={displayGroups.filter((group) => !isPersonalGroup(group))}
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
            railExpanded={railExpanded}
            onToggleRail={toggleRail}
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

          <GroupHome
            isMobileLayout={isMobileLayout}
            group={activeGroup}
            install={install}
            showSkeleton={cloudActiveLoading && !cloudActiveDetail}
            hasLoadedDetail={Boolean(cloudActiveDetail)}
            headerMenu={
              <GroupMenu
                groupName={activeGroup.name}
                coverImageUrl={activeGroup.coverImageUrl}
                memberCount={members.length}
                currency={activeGroup.currency}
                exporting={pendingAction === "exportCsv"}
                onExportCsv={handleExportCsv}
                isOwner={isCurrentMemberOwner}
                onEditGroup={openEditGroup}
                onNavigate={handleSideNavClick}
                onArchive={() => setDialog("archive")}
                onDelete={() => setDialog("delete")}
              />
            }
            members={members}
            currentMember={currentMember}
            balances={balances}
            totalExpenseMinor={totalExpenseMinor}
            expenseCount={aggregates.expenseCount}
            settlementTransfers={settlementTransfers}
            expenses={expenses}
            activities={activities}
            nudgedMemberIds={nudgedMemberIds}
            pendingAction={pendingAction}
            spendTab={spendTab}
            onSelectSpendTab={setSpendTab}
            spendDisplayAmountMinor={spendDisplayAmountMinor}
            dateChips={dateChips}
            selectedDateKey={selectedDateKey}
            selectedDateChip={selectedDateChip}
            onSelectDateKey={setSelectedDateKey}
            dateStripRef={dateStripRef}
            onOpenDialog={setDialog}
            onInviteMembers={openInviteMembers}
            onScanReceipt={openReceiptScan}
            onOpenExpenseComposer={openExpenseComposer}
            onSettleTransfer={settleTransfer}
            onNudgeMember={nudgeMember}
            onNudgeAll={nudgeEveryDebtor}
            onOpenExpenseDetail={openExpenseDetail}
          />

          {/* Phase 3: the wide layout's right column is gone — its content
              moved to the ▾ menu beside the group's name (see headerMenu
              above). This <aside> is kept in the tree rather than deleted
              (the mobile 設定 drawer mounts its OWN GroupSideNav
              variant="drawer" elsewhere, not this one), but it never paints
              at any width now, so it is permanently out of the tab order and
              the accessibility tree. */}
          <aside className="group-side-nav glass-panel" aria-label={text.groupHome} inert aria-hidden="true">
            {activeGroup ? (
              <GroupSideNav
                groupName={activeGroup.name}
                coverImageUrl={activeGroup.coverImageUrl}
                memberCount={members.length}
                currency={activeGroup.currency}
                exporting={pendingAction === "exportCsv"}
                onExportCsv={handleExportCsv}
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
                variant="drawer"
                groupName={activeGroup.name}
                coverImageUrl={activeGroup.coverImageUrl}
                memberCount={members.length}
                currency={activeGroup.currency}
                exporting={pendingAction === "exportCsv"}
                onExportCsv={handleExportCsv}
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
            /* The only place the N shortcut is advertised. A hover tooltip
               rather than a visible <kbd>: this is a round icon button with no
               room for one, and hovering is something only the people who have
               a keyboard can do anyway. */
            title={text.addExpenseShortcutHint}
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
          currentMemberId={currentMember?.id}
          groupId={activeGroup?.id ?? ""}
          recentTitles={recentExpenseTitleSuggestions}
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
          comments={cloudStore ? expenseComments : undefined}
          currentMemberId={currentMember?.id}
          isGroupOwner={isCurrentMemberOwner}
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
                    <span>{UI_TEXT.budget.label}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      value={monthlyBudget}
                      onChange={(event) => setMonthlyBudget(event.target.value)}
                      placeholder={UI_TEXT.budget.placeholder}
                      aria-label={UI_TEXT.budget.label}
                    />
                    <small className="dialog-field-hint">{UI_TEXT.budget.hint}</small>
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
                <Suspense fallback={<PanelSkeleton />}>
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
                  onOpenExpense={openExpenseDetail}
                  onEditExpense={openExpenseEdit}
                  onDeleteExpense={deleteExpense}
                  searchExpenses={searchExpensesInGroup}
                  describeError={describeCloudActionError}
                  focusSearchSignal={focusSearchSignal}
                />
                </Suspense>
              ) : null}

              {dialog === "recurringList" ? (
                <Suspense fallback={<PanelSkeleton />}>
                  <RecurringPanel
                    members={members}
                    currency={activeGroup?.currency ?? "TWD"}
                    currentMemberId={currentMember?.id ?? null}
                    rules={recurring.rules}
                    loading={recurring.loading}
                    error={recurring.error}
                    savingId={recurring.savingId}
                    onSave={recurring.save}
                    onDelete={recurring.remove}
                    onRetry={recurring.retry}
                  />
                </Suspense>
              ) : null}

              {dialog === "analysisPanel" ? (
                <Suspense fallback={<PanelSkeleton />}>
                <AnalysisPanel
                  totalExpenseMinor={totalExpenseMinor}
                  currency={activeGroup?.currency ?? "TWD"}
                  monthlyBudgetMinor={activeGroup?.monthlyBudgetMinor}
                  members={members}
                  balances={balances}
                  maxBalanceMinor={maxBalanceMinor}
                  debtAmountMinor={debt?.amountMinor ?? 0}
                  settlementTransfers={settlementTransfers}
                  settlementHistory={settlementHistory}
                  dateChips={dateChips}
                  spendByDay={aggregates.spendByDay}
                  selectedDateKey={selectedDateKey}
                  pendingAction={pendingAction}
                  currentMemberId={currentMember?.id}
                  onSelectDate={setSelectedDateKey}
                  onCopyPaymentNote={copyPaymentNote}
                  onSettleTransfer={settleTransfer}
                  spendTab={spendTab}
                  onSelectSpendTab={setSpendTab}
                  spendBreakdown={spendBreakdown}
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
                        <small>{UI_TEXT.misc.virtualMemberHint}</small>
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
                  onSettleWith={settleWithMember}
                  onRenameValueChange={setRenameMemberValue}
                  onStartRename={startRenameMember}
                  onCancelRename={cancelRenameMember}
                  onSubmitRename={submitRenameMember}
                  editingPaymentNoteMemberId={editingPaymentNoteMemberId}
                  paymentNoteValue={paymentNoteValue}
                  onPaymentNoteValueChange={setPaymentNoteValue}
                  onStartEditPaymentNote={startEditPaymentNote}
                  onCancelEditPaymentNote={cancelEditPaymentNote}
                  onSubmitPaymentNote={submitPaymentNote}
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
                      placeholder={UI_TEXT.misc.memberNamePlaceholder}
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
                <Suspense fallback={<PanelSkeleton />}>
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
                    <p>{dialog === "archive" ? UI_TEXT.misc.archiveGroupWarning : UI_TEXT.misc.deleteGroupWarning}</p>
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

      {/* Last in the tree on purpose: 清償 can be fired from the analysis
          panel, which is rendered above, and a confirm that appears behind the
          thing that raised it is worse than no confirm. */}
      {settleConfirm ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettleConfirm(null);
          }}
        >
          <section
            className="flow-dialog glass-panel"
            role="dialog"
            aria-modal="true"
            aria-label={text.settleConfirmTitle}
            ref={settleConfirmChromeRef}
          >
            <div className="dialog-header centered">
              <AlertTriangle aria-hidden="true" size={28} />
              <h3>{text.settleConfirmTitle}</h3>
              {/* The sentence reads back the amount in the field, not the
                  suggested one — so what it promises to record is what will be
                  recorded, including after somebody types over it. */}
              <p>
                {text.settleConfirmBody
                  .replace("{from}", members.find((member) => member.id === settleConfirm.fromId)?.name ?? "")
                  .replace("{to}", members.find((member) => member.id === settleConfirm.toId)?.name ?? "")
                  .replace(
                    "{amount}",
                    formatAmount(
                      settleAmount.valid ? settleAmount.minor : settleConfirm.amountMinor,
                      activeGroup?.currency ?? "TWD",
                    ),
                  )}
              </p>
            </div>
            {/* Part of a debt is the common case nobody could record: "先給你
                一千" went through the composer's 轉帳 mode or not at all. */}
            <label className="settle-amount-field">
              <span>{text.settleConfirmAmountLabel}</span>
              <input
                value={settleAmountInput}
                onChange={(event) => setSettleAmountInput(event.target.value)}
                inputMode="decimal"
                aria-label={text.settleConfirmAmountLabel}
                autoFocus
              />
              <button
                className="text-action"
                type="button"
                disabled={settleAmount.minor === settleConfirm.amountMinor}
                onClick={() => setSettleAmountInput(settleAmountInputValue(settleConfirm.amountMinor))}
              >
                {text.settleConfirmFull}
              </button>
            </label>
            {settleAmountTooMuch ? (
              <p className="settle-amount-error" role="alert">
                {text.settleConfirmTooMuch}
              </p>
            ) : null}
            <div className="dialog-action-row">
              <button className="secondary-action" type="button" onClick={() => setSettleConfirm(null)}>
                {text.settleConfirmCancel}
              </button>
              <button
                className="primary-action"
                type="button"
                disabled={!settleAmount.valid}
                onClick={confirmSettleTransfer}
              >
                {text.settleConfirmAction}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
