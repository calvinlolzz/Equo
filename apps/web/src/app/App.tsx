import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  Archive,
  ChartNoAxesColumn,
  ChevronRight,
  CircleDollarSign,
  Copy,
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
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { buildSettlementTransfers } from "./buildSettlementTransfers";
import { createApiClient } from "./apiClient";
import { createCloudGroupsStore, type CloudGroupsStore } from "./cloudStore";
import { ExpenseComposerSheet, type ExpenseDraft } from "./ExpenseComposerSheet";
import { ExpenseDetailDialog } from "./ExpenseDetailDialog";
import { GroupRail } from "./GroupRail";
import { ProfileDialog } from "./ProfileDialog";
import { StartFlow } from "./StartFlowPanel";
import type { Activity, ArchivedGroup, Expense, Group, GroupData, Member, StartMode } from "./appTypes";
import { getMemberShareMinor } from "./expenseShareSplit";
import { computeMemberBalances } from "./groupBalances";
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

const GROUPS_KEY = "equo.clean.groups";
const GROUP_DATA_KEY = "equo.clean.group_data";
const ARCHIVED_GROUPS_KEY = "equo.clean.archived_groups";
const CLOUD_ACTIVITIES_KEY = "equo.clean.cloud_activities";

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

function formatTwd(amountMinor: number) {
  return `$${Math.round(amountMinor / 100).toLocaleString("zh-TW")}`;
}

function formatSigned(amountMinor: number) {
  if (amountMinor > 0) return `+${formatTwd(amountMinor)}`;
  if (amountMinor < 0) return `-${formatTwd(Math.abs(amountMinor))}`;
  return "$0";
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

function initial(name: string | undefined) {
  return (name || "?").slice(0, 1).toUpperCase();
}

function createGroupData(group: Group): GroupData {
  const now = new Date().toISOString();
  return {
    members: [{ id: `${group.id}_owner`, name: "我", role: "owner" }],
    expenses: [],
    activities: [{ id: crypto.randomUUID(), text: `${text.createGroup}: ${group.name}`, createdAt: now }],
  };
}

export function App() {
  const [groups, setGroups] = useState<Group[]>(() => readJson<Group[]>(GROUPS_KEY, []));
  const [groupData, setGroupData] = useState<Record<string, GroupData>>(() => readJson<Record<string, GroupData>>(GROUP_DATA_KEY, {}));
  const [archivedGroups, setArchivedGroups] = useState<ArchivedGroup[]>(() => readJson<ArchivedGroup[]>(ARCHIVED_GROUPS_KEY, []));
  const [activeGroupId, setActiveGroupId] = useState(() => getRouteGroupId());
  const [startMode, setStartMode] = useState<StartMode>("create");
  const [selectedTemplate, setSelectedTemplate] = useState("trip");
  const [groupName, setGroupName] = useState<string>(text.tripName);
  const [virtualMemberName, setVirtualMemberName] = useState("");
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [expenseComposerOpen, setExpenseComposerOpen] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [spendTab, setSpendTab] = useState<"personal" | "group">("personal");
  const [selectedDateKey, setSelectedDateKey] = useState(() => dateKey(new Date().toISOString()));
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const [inviteInputValue, setInviteInputValue] = useState("");
  const [inviteInputError, setInviteInputError] = useState("");
  const [profile, setProfile] = useState<ProfileData>(() => normalizeProfile(readJson<Partial<ProfileData>>(PROFILE_KEY, DEFAULT_PROFILE)));
  const [session, setSession] = useState<StoredSession | null>(() => loadSession(Date.now()));
  const [selectedExpenseId, setSelectedExpenseId] = useState<string>("");
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [localGroupsHintDismissed, setLocalGroupsHintDismissed] = useState(false);
  const [cloudInviteToken, setCloudInviteToken] = useState("");
  const [cloudInviteLoading, setCloudInviteLoading] = useState(false);
  const [pendingInviteToken, setPendingInviteToken] = useState("");
  const [cloudActivities, setCloudActivities] = useState<Record<string, Activity[]>>(() =>
    readJson<Record<string, Activity[]>>(CLOUD_ACTIVITIES_KEY, {}),
  );
  const cloudInviteGroupIdRef = useRef("");

  const cloudMode = Boolean(session);

  function handleSessionExpired() {
    clearSession();
    setSession(null);
    showToast(text.sessionExpired);
  }

  const cloudStore = useMemo<CloudGroupsStore | null>(() => {
    if (!session) return null;
    return createCloudGroupsStore({
      apiClient: createApiClient({ authToken: session.token }),
      onSessionExpired: handleSessionExpired,
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
  const cloudActiveDetail = cloudMode && activeGroupId ? cloudState?.groupDetails[activeGroupId] ?? null : null;
  const cloudActiveLoading = cloudMode && activeGroupId ? Boolean(cloudState?.loadingGroupIds[activeGroupId]) : false;

  const localGroups = groups;
  const displayGroups = cloudMode ? cloudGroups : localGroups;

  const activeGroup = cloudMode
    ? cloudActiveDetail?.group ?? (cloudGroups.find((group) => group.id === activeGroupId) ?? null)
    : groups.find((group) => group.id === activeGroupId) ?? null;
  const activeData = cloudMode
    ? null
    : activeGroup
      ? groupData[activeGroup.id] ?? createGroupData(activeGroup)
      : null;
  const members = cloudMode ? cloudActiveDetail?.members ?? [] : activeData?.members ?? [];
  const expenses = cloudMode ? cloudActiveDetail?.expenses ?? [] : activeData?.expenses ?? [];
  const activities = cloudMode ? cloudActivities[activeGroupId] ?? [] : activeData?.activities ?? [];

  function recordCloudActivity(groupId: string, activityText: string) {
    const activity: Activity = { id: crypto.randomUUID(), text: activityText, createdAt: new Date().toISOString() };
    setCloudActivities((current) => ({
      ...current,
      [groupId]: [activity, ...(current[groupId] ?? [])].slice(0, 8),
    }));
  }
  const spendableExpenses = useMemo(() => expenses.filter((expense) => expense.kind !== "settlement"), [expenses]);
  const totalExpenseMinor = spendableExpenses.reduce((sum, expense) => sum + expense.amountMinor, 0);
  const averageExpenseMinor = spendableExpenses.length ? Math.round(totalExpenseMinor / spendableExpenses.length) : 0;

  const balances = useMemo(() => computeMemberBalances(members, expenses), [expenses, members]);

  const ownerMember = members.find((member) => member.role === "owner") ?? members[0];

  const dateChips = useMemo(() => lastEightDays(), []);
  const selectedDayExpenses = useMemo(
    () => spendableExpenses.filter((expense) => dateKey(expense.createdAt) === selectedDateKey),
    [spendableExpenses, selectedDateKey],
  );
  const groupSpendMinor = selectedDayExpenses.reduce((sum, expense) => sum + expense.amountMinor, 0);
  const personalSpendMinor = useMemo(() => {
    if (!ownerMember) return 0;
    return selectedDayExpenses.reduce((sum, expense) => sum + getMemberShareMinor(expense, ownerMember.id), 0);
  }, [selectedDayExpenses, ownerMember]);
  const selectedDateChip = dateChips.find((chip) => chip.key === selectedDateKey);
  const spendDisplayAmountMinor = spendTab === "group" ? groupSpendMinor : personalSpendMinor;

  const settlementTransfers = useMemo(
    () => (activeGroup ? buildSettlementTransfers(members, expenses, activeGroup.currency) : []),
    [members, expenses, activeGroup],
  );
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

  useEffect(() => writeJson(GROUPS_KEY, groups), [groups]);
  useEffect(() => writeJson(GROUP_DATA_KEY, groupData), [groupData]);
  useEffect(() => writeJson(ARCHIVED_GROUPS_KEY, archivedGroups), [archivedGroups]);
  useEffect(() => writeJson(PROFILE_KEY, profile), [profile]);
  useEffect(() => writeJson(CLOUD_ACTIVITIES_KEY, cloudActivities), [cloudActivities]);

  useEffect(() => {
    if (cloudMode) return;
    const routeId = getRouteGroupId();
    if (!routeId) return;
    const routeGroupExists = groups.some((group) => group.id === routeId);
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
  }, [activeGroupId, groups, cloudMode]);

  useEffect(() => {
    if (!cloudMode) return;
    if (!cloudState || cloudState.loadingGroups) return;
    const routeId = getRouteGroupId();
    if (!routeId) return;
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
  }, [activeGroupId, cloudGroups, cloudMode, cloudState?.loadingGroups]);

  useEffect(() => {
    if (!cloudMode || !cloudStore || !activeGroupId) return;
    if (cloudState?.groupDetails[activeGroupId]) return;
    cloudStore
      .refreshGroupDetail(activeGroupId)
      .catch(() => showToast(`${text.cloudSyncFailedPrefix}${text.groupNotFound}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupId, cloudMode, cloudStore]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const token = getInviteTokenFromUrl();
    if (!token) return;
    clearInviteTokenFromUrl();
    if (session) {
      setCloudInviteToken(token);
      setDialog("inviteInput");
    } else {
      setPendingInviteToken(token);
      showToast(text.cloudInviteLoginRequired);
      setDialog("profile");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function showToast(message: string) {
    if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
    const id = Date.now();
    setToast({ id, text: message });
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, 2600);
  }

  function selectGroup(group: Group) {
    setActiveGroupId(group.id);
    setGroupRoute(group.id);
    setGroupDrawerOpen(false);
  }

  async function createGroup() {
    const template = templates.find((item) => item.id === selectedTemplate) ?? templates[0];
    const name = groupName.trim() || template.defaultName;

    if (cloudMode && cloudStore) {
      try {
        const group = await cloudStore.createGroup({ name, currency: "TWD" });
        setActiveGroupId(group.id);
        setGroupRoute(group.id, "replace");
        setDialog(null);
        showToast(`${text.createGroup}: ${name}`);
      } catch (error) {
        showToast(`${text.cloudSyncFailedPrefix}${(error as Error).message}`);
      }
      return;
    }

    const group: Group = { id: `demo_group_${crypto.randomUUID()}`, name, currency: "TWD" };
    setGroups((current) => [group, ...current.filter((item) => item.id !== group.id)].slice(0, 8));
    setGroupData((current) => ({ ...current, [group.id]: createGroupData(group) }));
    setActiveGroupId(group.id);
    setGroupRoute(group.id, "replace");
    setDialog(null);
    showToast(`${text.createGroup}: ${name}`);
  }

  function openEditGroup() {
    if (!activeGroup) return;
    setGroupName(activeGroup.name);
    setDialog("editGroup");
  }

  async function updateActiveGroup() {
    if (!activeGroup) return;
    const name = groupName.trim();
    if (!name) return;

    if (cloudMode && cloudStore) {
      try {
        await cloudStore.renameGroup(activeGroup.id, name);
        recordCloudActivity(activeGroup.id, `${text.editGroup}: ${name}`);
        setDialog(null);
        showToast(`${text.editGroup}: ${name}`);
      } catch (error) {
        showToast(`${text.cloudSyncFailedPrefix}${(error as Error).message}`);
      }
      return;
    }

    setGroups((current) => current.map((group) => (group.id === activeGroup.id ? { ...group, name } : group)));
    setGroupData((current) => {
      const data = current[activeGroup.id] ?? createGroupData(activeGroup);
      const activity: Activity = {
        id: crypto.randomUUID(),
        text: `${text.editGroup}: ${name}`,
        createdAt: new Date().toISOString(),
      };
      return { ...current, [activeGroup.id]: { ...data, activities: [activity, ...data.activities].slice(0, 8) } };
    });
    setDialog(null);
    showToast(`${text.editGroup}: ${name}`);
  }

  function updateActiveCurrency(currency: string) {
    if (!activeGroup || activeGroup.currency === currency) {
      setDialog(null);
      return;
    }

    if (cloudMode) {
      setDialog(null);
      showToast(text.cloudCurrencyUnsupported);
      return;
    }

    setGroups((current) => current.map((group) => (group.id === activeGroup.id ? { ...group, currency } : group)));
    setGroupData((current) => {
      const data = current[activeGroup.id] ?? createGroupData(activeGroup);
      const activity: Activity = {
        id: crypto.randomUUID(),
        text: `${text.currency}: ${currency}`,
        createdAt: new Date().toISOString(),
      };
      return { ...current, [activeGroup.id]: { ...data, activities: [activity, ...data.activities].slice(0, 8) } };
    });
    setDialog(null);
    showToast(`${text.currency}: ${currency}`);
  }

  async function openInviteMembers() {
    if (!activeGroup) return;
    setGroupDrawerOpen(false);
    setSettingsDrawerOpen(false);
    setDialog("inviteMembers");

    if (cloudMode && cloudStore) {
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
  }

  function openMemberList() {
    if (!activeGroup) return;
    setGroupDrawerOpen(false);
    setSettingsDrawerOpen(false);
    setDialog("memberList");
  }

  function openProfileDialog() {
    setGroupDrawerOpen(false);
    setSettingsDrawerOpen(false);
    setDialog("profile");
  }

  async function loginWithGoogleCredential(credential: string) {
    try {
      const client = createApiClient({ authToken: "" });
      const { session: nextSession } = await client.exchangeGoogleToken(credential);
      const stored: StoredSession = {
        token: nextSession.token,
        expiresAt: nextSession.expires_at,
        user: {
          id: nextSession.user.id,
          email: nextSession.user.email,
          displayName: nextSession.user.display_name,
        },
      };
      saveSession(stored);
      setSession(stored);
      setProfile((current) => {
        if (current.name !== DEFAULT_PROFILE.name) return current;
        return normalizeProfile({ ...current, name: stored.user.displayName });
      });
      setActiveGroupId("");
      setGroupRoute(null, "replace");
      showToast(`${text.loginSuccessPrefix}${stored.user.displayName}`);
      if (pendingInviteToken) {
        setCloudInviteToken(pendingInviteToken);
        setPendingInviteToken("");
        setDialog("inviteInput");
      }
    } catch {
      showToast(text.loginFailed);
    }
  }

  function logout() {
    clearSession();
    setSession(null);
    setActiveGroupId("");
    setGroupRoute(null, "replace");
    showToast(text.logoutSuccess);
  }

  function saveProfile(nextProfile: ProfileData) {
    const normalized = normalizeProfile(nextProfile);
    setProfile(normalized);
    setGroupData((current) => {
      const next: Record<string, GroupData> = {};
      Object.entries(current).forEach(([groupId, data]) => {
        next[groupId] = {
          ...data,
          members: data.members.map((member) => (member.role === "owner" ? { ...member, name: normalized.name } : member)),
        };
      });
      return next;
    });
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
    if (!activeGroup || !virtualMemberName.trim()) return;
    const name = virtualMemberName.trim();

    if (cloudMode && cloudStore) {
      try {
        await cloudStore.addVirtualMember(activeGroup.id, name);
        recordCloudActivity(activeGroup.id, `${text.addVirtualMember}: ${name}`);
        setVirtualMemberName("");
        setDialog(null);
        showToast(`${text.addVirtualMember}: ${name}`);
      } catch (error) {
        showToast(`${text.cloudSyncFailedPrefix}${(error as Error).message}`);
      }
      return;
    }

    const member: Member = { id: `${activeGroup.id}_member_${crypto.randomUUID()}`, name, virtual: true };
    const activity: Activity = {
      id: crypto.randomUUID(),
      text: `${text.addVirtualMember}: ${member.name}`,
      createdAt: new Date().toISOString(),
    };
    setGroupData((current) => {
      const data = current[activeGroup.id] ?? createGroupData(activeGroup);
      return { ...current, [activeGroup.id]: { ...data, members: [...data.members, member], activities: [activity, ...data.activities].slice(0, 8) } };
    });
    setVirtualMemberName("");
    setDialog(null);
    showToast(`${text.addVirtualMember}: ${member.name}`);
  }

  async function handleExpenseDraftSubmit(draft: ExpenseDraft) {
    if (!activeGroup) return;
    const editingId = editingExpense?.id;

    if (cloudMode && cloudStore) {
      try {
        if (editingId) {
          await cloudStore.editExpense(activeGroup.id, editingId, draft, activeGroup.currency);
        } else {
          await cloudStore.addExpense(activeGroup.id, draft, activeGroup.currency);
        }
        recordCloudActivity(
          activeGroup.id,
          editingId
            ? `${text.editExpense}: ${draft.title}`
            : `${text.addExpense}: ${draft.title} (${formatTwd(draft.amountMinor)})`,
        );
        setExpenseComposerOpen(false);
        setEditingExpense(null);
        showToast(editingId ? `${text.editExpense}: ${draft.title}` : `${text.addExpense}: ${draft.title}`);
      } catch (error) {
        showToast(`${text.cloudSyncFailedPrefix}${(error as Error).message}`);
      }
      return;
    }

    const now = new Date().toISOString();
    const expense: Expense = {
      id: editingId ?? crypto.randomUUID(),
      title: draft.title,
      amountMinor: draft.amountMinor,
      currency: activeGroup.currency,
      createdAt: draft.createdAt,
      payerId: draft.payerId,
      shareMemberIds: draft.shareMemberIds,
      kind: "expense",
      category: draft.category,
      note: draft.note,
      imageDataUrl: draft.imageDataUrl,
      shareAmountsMinor: draft.shareAmountsMinor,
    };
    if (draft.sourceCurrency) {
      expense.sourceCurrency = draft.sourceCurrency;
      expense.sourceAmountMinor = draft.sourceAmountMinor;
      expense.exchangeRate = draft.exchangeRate;
    }
    const activity: Activity = {
      id: crypto.randomUUID(),
      text: editingId
        ? `${text.editExpense}: ${expense.title}`
        : `${text.addExpense}: ${expense.title} (${formatTwd(expense.amountMinor)})`,
      createdAt: now,
    };
    setGroupData((current) => {
      const data = current[activeGroup.id] ?? createGroupData(activeGroup);
      const nextExpenses = editingId
        ? data.expenses.map((item) => (item.id === editingId ? expense : item))
        : [expense, ...data.expenses];
      return { ...current, [activeGroup.id]: { ...data, expenses: nextExpenses, activities: [activity, ...data.activities].slice(0, 8) } };
    });
    setExpenseComposerOpen(false);
    setEditingExpense(null);
    showToast(editingId ? `${text.editExpense}: ${expense.title}` : `${text.addExpense}: ${expense.title}`);
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
    if (!activeGroup) return;

    if (cloudMode && cloudStore) {
      try {
        await cloudStore.deleteExpense(activeGroup.id, expense.id);
        recordCloudActivity(activeGroup.id, `${text.deleteExpense}: ${expense.title}`);
        setDialog(null);
        setSelectedExpenseId("");
        showToast(`${text.deleteExpense}: ${expense.title}`);
      } catch (error) {
        showToast(`${text.cloudSyncFailedPrefix}${(error as Error).message}`);
      }
      return;
    }

    const now = new Date().toISOString();
    const activity: Activity = {
      id: crypto.randomUUID(),
      text: `${text.deleteExpense}: ${expense.title}`,
      createdAt: now,
    };
    setGroupData((current) => {
      const data = current[activeGroup.id] ?? createGroupData(activeGroup);
      return {
        ...current,
        [activeGroup.id]: {
          ...data,
          expenses: data.expenses.filter((item) => item.id !== expense.id),
          activities: [activity, ...data.activities].slice(0, 8),
        },
      };
    });
    setDialog(null);
    setSelectedExpenseId("");
    showToast(`${text.deleteExpense}: ${expense.title}`);
  }

  async function submitInviteInput() {
    if (!inviteInputValue.trim()) return;

    if (cloudMode && cloudStore) {
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
      }
      return;
    }

    setInviteInputError(text.inviteNotFound);
  }

  async function settleTransfer(fromId: string, toId: string, amountMinor: number) {
    if (!activeGroup) return;
    const fromMember = members.find((member) => member.id === fromId);
    const toMember = members.find((member) => member.id === toId);
    if (!fromMember || !toMember) return;

    if (cloudMode && cloudStore) {
      try {
        await cloudStore.settleTransfer(activeGroup.id, fromId, toId, amountMinor, activeGroup.currency);
        recordCloudActivity(
          activeGroup.id,
          `${text.clearDebt}: ${fromMember.name} → ${toMember.name} ${formatTwd(amountMinor)}`,
        );
        showToast(`${text.clearDebt}: ${fromMember.name} → ${toMember.name}`);
      } catch (error) {
        showToast(`${text.cloudSyncFailedPrefix}${(error as Error).message}`);
      }
      return;
    }

    const now = new Date().toISOString();
    const settlement: Expense = {
      id: crypto.randomUUID(),
      title: text.settlementTransfer,
      amountMinor,
      currency: activeGroup.currency,
      createdAt: now,
      payerId: fromId,
      shareMemberIds: [toId],
      kind: "settlement",
    };
    const activity: Activity = {
      id: crypto.randomUUID(),
      text: `${text.clearDebt}: ${fromMember.name} → ${toMember.name} ${formatTwd(amountMinor)}`,
      createdAt: now,
    };
    setGroupData((current) => {
      const data = current[activeGroup.id] ?? createGroupData(activeGroup);
      return {
        ...current,
        [activeGroup.id]: { ...data, expenses: [settlement, ...data.expenses], activities: [activity, ...data.activities].slice(0, 8) },
      };
    });
    showToast(`${text.clearDebt}: ${fromMember.name} → ${toMember.name}`);
  }

  function settleDebt() {
    if (!debt) return;
    settleTransfer(debt.from.id, debt.to.id, debt.amountMinor);
  }

  async function archiveActiveGroup() {
    if (!activeGroup) return;
    setBusy(true);

    if (cloudMode && cloudStore) {
      try {
        await cloudStore.archiveGroup(activeGroup.id);
        setActiveGroupId("");
        setGroupRoute(null);
        setDialog(null);
        showToast(`${text.archiveGroup}: ${activeGroup.name}`);
      } catch (error) {
        showToast(`${text.cloudSyncFailedPrefix}${(error as Error).message}`);
      }
      setBusy(false);
      return;
    }

    const archived: ArchivedGroup = { ...activeGroup, archivedAt: new Date().toISOString() };
    setArchivedGroups((current) => [archived, ...current.filter((group) => group.id !== activeGroup.id)].slice(0, 8));
    setGroups((current) => current.filter((group) => group.id !== activeGroup.id));
    setActiveGroupId("");
    setGroupRoute(null);
    setDialog(null);
    showToast(`${text.archiveGroup}: ${activeGroup.name}`);
    setBusy(false);
  }

  async function deleteActiveGroup() {
    if (!activeGroup) return;

    if (cloudMode && cloudStore) {
      try {
        await cloudStore.deleteGroup(activeGroup.id);
        setActiveGroupId("");
        setGroupRoute(null);
        setDialog(null);
        showToast(`${text.deleteGroup}: ${activeGroup.name}`);
      } catch (error) {
        showToast(`${text.cloudSyncFailedPrefix}${(error as Error).message}`);
      }
      return;
    }

    setGroups((current) => current.filter((group) => group.id !== activeGroup.id));
    setGroupData((current) => {
      const next = { ...current };
      delete next[activeGroup.id];
      return next;
    });
    setActiveGroupId("");
    setGroupRoute(null);
    setDialog(null);
    showToast(`${text.deleteGroup}: ${activeGroup.name}`);
  }

  function openHome() {
    setActiveGroupId("");
    setGroupRoute(null);
  }

  const selectedTemplateLabel = templates.find((template) => template.id === selectedTemplate)?.label ?? text.createGroup;
  const localInviteCode = activeGroup ? `EQO-${activeGroup.id.replace(/^demo_group_/, "").replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase()}` : "";
  const inviteCode = cloudMode ? cloudInviteToken : localInviteCode;
  const inviteLink =
    activeGroup && inviteCode && typeof window !== "undefined"
      ? cloudMode
        ? `${window.location.origin}/?invite=${encodeURIComponent(inviteCode)}`
        : `${window.location.origin}/?invite=${encodeURIComponent(localInviteCode)}`
      : "";
  const localGroupsHintCount = cloudMode && !localGroupsHintDismissed ? localGroups.length : 0;
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
            {profile.avatarDataUrl ? <img src={profile.avatarDataUrl} alt="" /> : <UserRound aria-hidden="true" size={18} />}
          </button>
        </div>
        <div className="side-group-card">
          <div className="side-cover" />
          <div className="side-group-name">
            <div className="side-group-title-row">
              <h2>{activeGroup.name}</h2>
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
      </>
    );
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        {activeGroup ? (
          <button className="top-bar-icon-button mobile-only" type="button" aria-label={text.members} onClick={() => setGroupDrawerOpen(true)}>
            <Menu aria-hidden="true" size={22} />
          </button>
        ) : null}
        <button className="brand-mark" type="button" onClick={openHome}>
          Equo
        </button>
        <div className="top-actions">
          {activeGroup ? (
            <button className="top-bar-icon-button mobile-only" type="button" aria-label={text.groupManage} onClick={() => setSettingsDrawerOpen(true)}>
              <Settings aria-hidden="true" size={22} />
            </button>
          ) : (
            <button className="profile-dot" type="button" aria-label={text.profile} onClick={openProfileDialog}>
              {profile.avatarDataUrl ? <img src={profile.avatarDataUrl} alt="" /> : <UserRound aria-hidden="true" size={18} />}
            </button>
          )}
        </div>
      </header>

      {toast ? (
        <div className="toast-dock" role="status" aria-live="polite">
          <span className={busy ? "pulse-dot active" : "pulse-dot"} />
          <p>{toast.text}</p>
        </div>
      ) : null}

      {!activeGroup ? (
        <StartFlow
          groups={displayGroups}
          groupName={groupName}
          selectedTemplate={selectedTemplate}
          selectedTemplateLabel={selectedTemplateLabel}
          startMode={startMode}
          templates={templates}
          localGroupsHintCount={localGroupsHintCount}
          onCreateGroup={createGroup}
          onDismissLocalGroupsHint={() => setLocalGroupsHintDismissed(true)}
          onGroupNameChange={setGroupName}
          onSelectGroup={selectGroup}
          onSelectTemplate={(template) => {
            setSelectedTemplate(template.id);
            setGroupName(template.defaultName);
          }}
          onSetStartMode={setStartMode}
          onOpenInviteInput={() => setDialog("inviteInput")}
        />
      ) : (
        <section className="workspace-grid">
          <GroupRail
            activeGroup={activeGroup}
            groups={displayGroups}
            onCreateGroup={() => setDialog("createGroup")}
            onOpenArchivedGroups={() => setDialog("archivedList")}
            onRefresh={() => showToast("\u5df2\u91cd\u65b0\u6574\u7406\u76ee\u524d\u7fa4\u7d44\u3002")}
            onSelectGroup={selectGroup}
            onShowInviteCode={() => setDialog("inviteInput")}
          />

          {groupDrawerOpen ? (
            <div className="side-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setGroupDrawerOpen(false); }}>
              <div className="side-drawer side-drawer-left" role="dialog" aria-modal="true" aria-label={text.members}>
                <GroupRail
                  activeGroup={activeGroup}
                  groups={displayGroups}
                  onCreateGroup={() => { setGroupDrawerOpen(false); setDialog("createGroup"); }}
                  onOpenArchivedGroups={() => { setGroupDrawerOpen(false); setDialog("archivedList"); }}
                  onRefresh={() => showToast("\u5df2\u91cd\u65b0\u6574\u7406\u76ee\u524d\u7fa4\u7d44\u3002")}
                  onSelectGroup={selectGroup}
                  onShowInviteCode={() => { setGroupDrawerOpen(false); setDialog("inviteInput"); }}
                />
              </div>
            </div>
          ) : null}

          <section className="group-room pizo-home" aria-label={text.groupHome}>
            {cloudMode && cloudActiveLoading && !cloudActiveDetail ? (
              <div className="group-home-card glass-panel cloud-loading-skeleton" aria-busy="true">
                <span className="pulse-dot active" />
              </div>
            ) : null}
            <article className="group-home-card glass-panel" id="group-home">
              <div className="home-title-row">
                <div>
                  <h2>{activeGroup.name}</h2>
                  <p>
                    {text.members} <strong>{members.length}</strong> {text.total} <strong>{formatTwd(totalExpenseMinor)}</strong>
                  </p>
                </div>
              </div>

              <div className="hero-summary-grid" id="group-members" aria-label={text.members}>
                <div className="hero-member-summary">
                  <div className="hero-avatar-stack" aria-label={text.members}>
                    {members.map((member) => (
                      <span className="hero-avatar" key={member.id}>
                        {initial(member.name)}
                      </span>
                    ))}
                  </div>
                  <div className="hero-balance-list" aria-label={text.analysis}>
                    {members.slice(0, 2).map((member) => (
                      <div className="hero-balance-row" key={member.id}>
                        <div className="member-avatar">{initial(member.name)}</div>
                        <span>
                          {member.name}
                          {member.role === "owner" ? <small>{text.owner}</small> : null}
                        </span>
                        <strong>{formatSigned(balances.get(member.id) ?? 0)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="hero-donut" aria-label={text.debt}>
                  <div className="hero-donut-ring">
                    <div>
                      <span>{debt?.to.name ?? text.settled}</span>
                      <strong>{debt ? formatTwd(debt.amountMinor) : "$0"}</strong>
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
                  <strong>{formatTwd(spendDisplayAmountMinor)}</strong>
                </div>
                <div className="date-chip-row" aria-label="\u65e5\u671f">
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
                      <span className="member-avatar lime">{initial(debt.from.name)}</span>
                      <strong>{debt.from.name}</strong>
                    </div>
                    <div className="pizo-debt-center">
                      <span>{text.needPay}</span>
                      <b>{"\u2192"}</b>
                      <strong>{formatTwd(debt.amountMinor)}</strong>
                    </div>
                    <div className="pizo-debt-person right">
                      <span className="member-avatar photo">{initial(debt.to.name)}</span>
                      <strong>{debt.to.name}</strong>
                    </div>
                  </>
                ) : (
                  <div className="pizo-debt-empty">{text.settled}</div>
                )}
                {debt ? (
                  <button className="settlement-clear-action" type="button" onClick={settleDebt}>
                    {text.clearDebt}
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
                        ) : (
                          <span className="member-avatar photo">{initial(payer?.name)}</span>
                        )}
                        <span className="expense-record-main">
                          <strong>{expense.title}</strong>
                          <small>{formatTime(expense.createdAt)}</small>
                        </span>
                        <span className="expense-record-amount">
                          <small>{expense.currency}</small>
                          {formatTwd(expense.amountMinor)}
                          <i className="mini-avatar-stack" aria-hidden="true">
                            {shareMembers.map((member) => (
                              <em key={member.id}>{initial(member.name)}</em>
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

          <aside className="group-side-nav glass-panel" aria-label={text.groupHome}>
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
            onClick={() => {
              setEditingExpense(null);
              setExpenseComposerOpen(true);
            }}
          >
            <Plus aria-hidden="true" size={34} />
          </button>

          <nav className="mobile-tab-bar" aria-label={text.groupHome}>
            <button
              className="mobile-tab-item"
              type="button"
              onClick={() => {
                setDialog(null);
                setExpenseComposerOpen(false);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              <House aria-hidden="true" size={20} />
              <span>{text.navHome}</span>
            </button>
            <button className="mobile-tab-item" type="button" onClick={() => setDialog("recordsPanel")}>
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
            <button className="mobile-tab-item" type="button" onClick={() => setDialog("analysisPanel")}>
              <ChartNoAxesColumn aria-hidden="true" size={20} />
              <span>{text.navAnalysis}</span>
            </button>
            <button className="mobile-tab-item" type="button" onClick={openMemberList}>
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
          hidePhoto={cloudMode}
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
          session={session}
          onClose={() => setDialog(null)}
          onSave={saveProfile}
          onToast={showToast}
          onGoogleCredential={loginWithGoogleCredential}
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
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialog(null);
          }}
        >
          <section className={panelDialogOpen ? "flow-dialog panel-dialog glass-panel" : "flow-dialog glass-panel"} role="dialog" aria-modal="true" aria-label={text.groupHome}>
            <button className="dialog-close" type="button" aria-label={text.cancel} onClick={() => setDialog(null)}>
              <X aria-hidden="true" size={18} />
            </button>

            {dialog === "createGroup" ? (
              <>
                <div className="dialog-header">
                  <h3>{text.createGroup}</h3>
                  <p>{"\u65b0\u7fa4\u7d44\u6703\u7acb\u5373\u51fa\u73fe\u5728\u5de6\u5074\u5217\u8868\u3002"}</p>
                </div>
                <label>
                  <span>{text.name}</span>
                  <input value={groupName} onChange={(event) => setGroupName(event.target.value)} aria-label={text.groupName} />
                </label>
                <div className="dialog-action-row">
                  <button className="secondary-action" type="button" onClick={() => setDialog(null)}>
                    {text.cancel}
                  </button>
                  <button className="primary-action" type="button" onClick={createGroup}>
                    {text.createGroup}
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
                <div className="group-edit-cover">
                  <span>
                    <Pencil aria-hidden="true" size={22} />
                  </span>
                </div>
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
                  <button className="primary-action" type="button" disabled={!groupName.trim()} onClick={updateActiveGroup}>
                    {text.save}
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
                    <strong>{spendableExpenses.length}</strong>
                  </div>
                  <div>
                    <span>{"\u7e3d\u652f\u51fa"}</span>
                    <strong>{formatTwd(totalExpenseMinor)}</strong>
                  </div>
                  <div>
                    <span>{"\u5e73\u5747"}</span>
                    <strong>{formatTwd(averageExpenseMinor)}</strong>
                  </div>
                </div>
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
                        {expense.imageDataUrl ? (
                          <span className="record-dialog-thumb">
                            <img src={expense.imageDataUrl} alt="" />
                          </span>
                        ) : (
                          <span className="record-dialog-icon">
                            {expense.kind === "settlement" ? <History aria-hidden="true" size={18} /> : <ReceiptText aria-hidden="true" size={18} />}
                          </span>
                        )}
                        <span>
                          <strong>{expense.title}</strong>
                          <small>{expense.note ? expense.note : formatActivityTime(expense.createdAt)}</small>
                        </span>
                        <b>{formatTwd(expense.amountMinor)}</b>
                      </button>
                    ))
                  ) : (
                    <p className="dialog-empty">{text.noRecords}</p>
                  )}
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
                    <strong>{formatTwd(totalExpenseMinor)}</strong>
                  </div>
                  <div>
                    <span>{text.members}</span>
                    <strong>{members.length}</strong>
                  </div>
                  <div>
                    <span>{text.debt}</span>
                    <strong>{debt ? formatTwd(debt.amountMinor) : "$0"}</strong>
                  </div>
                </div>
                <div className="dialog-section-list">
                  <span className="dialog-list-title">{"\u6210\u54e1\u9918\u984d"}</span>
                  {members.map((member) => {
                    const balance = balances.get(member.id) ?? 0;
                    const width = `${Math.max(8, Math.round((Math.abs(balance) / maxBalanceMinor) * 100))}%`;
                    return (
                      <div className="analysis-balance-row" key={member.id}>
                        <span>{member.name}</span>
                        <div className="analysis-bar-track">
                          <i style={{ width }} />
                        </div>
                        <strong>{formatSigned(balance)}</strong>
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
                            <span className="member-avatar lime">{initial(from?.name)}</span>
                            <strong>{from?.name ?? ""}</strong>
                          </div>
                          <b>{"\u2192"}</b>
                          <div className="settlement-suggestion-person">
                            <span className="member-avatar photo">{initial(to?.name)}</span>
                            <strong>{to?.name ?? ""}</strong>
                          </div>
                          <span className="settlement-suggestion-amount">{formatTwd(transfer.amount.amount_minor)}</span>
                          <button
                            className="composer-mini-action"
                            type="button"
                            onClick={() => settleTransfer(transfer.fromMemberId, transfer.toMemberId, transfer.amount.amount_minor)}
                          >
                            {UI_TEXT.settlement.settleAction}
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <p className="dialog-empty">{UI_TEXT.settlement.settled}</p>
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
                      <small>{"\u9069\u5408\u5148\u505a Demo \u6216\u5e6b\u4ed6\u4eba\u4ee3\u8a18\u652f\u51fa\u3002"}</small>
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
                    <strong>{cloudMode && cloudInviteLoading ? "..." : inviteCode}</strong>
                  </div>
                  <div className="invite-link-box">
                    <span>{text.inviteLink}</span>
                    <strong>{cloudMode && cloudInviteLoading ? "..." : inviteLink}</strong>
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
                {!cloudMode ? (
                  <>
                    <p className="dialog-inline-error">{text.cloudInviteLoginRequired}</p>
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
                        onClick={() => {
                          setInviteInputValue("");
                          setInviteInputError("");
                          setDialog("profile");
                        }}
                      >
                        {text.profile}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
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
                      <button className="primary-action" type="button" disabled={!inviteInputValue.trim()} onClick={submitInviteInput}>
                        {text.joinGroupAction}
                      </button>
                    </div>
                  </>
                )}
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
                  {members.map((member) => (
                    <button className="member-dialog-row" type="button" key={member.id}>
                      <span className="member-avatar">{initial(member.name)}</span>
                      <span>
                        <strong>{member.name}</strong>
                        <small>{member.virtual ? text.virtualMember : member.role === "owner" ? text.owner : text.member}</small>
                      </span>
                      <b>{formatSigned(balances.get(member.id) ?? 0)}</b>
                    </button>
                  ))}
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
                    placeholder="\u8f38\u5165\u6210\u54e1\u540d\u7a31"
                    aria-label={text.virtualMemberName}
                  />
                </label>
                <div className="dialog-action-row">
                  <button className="secondary-action" type="button" onClick={() => setDialog(null)}>
                    {text.cancel}
                  </button>
                  <button className="primary-action" type="button" disabled={!virtualMemberName.trim()} onClick={addVirtualMember}>
                    {text.addMember}
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
                  {archivedGroups.length ? (
                    archivedGroups.map((group) => (
                      <div className="archived-dialog-row" key={group.id}>
                        <span className="record-dialog-icon">
                          <Archive aria-hidden="true" size={18} />
                        </span>
                        <span>
                          <strong>{group.name}</strong>
                          <small>{group.currency}</small>
                        </span>
                        <b>{text.archiveGroup}</b>
                      </div>
                    ))
                  ) : (
                    <p className="dialog-empty">{"\u76ee\u524d\u6c92\u6709\u5df2\u5c01\u5b58\u7684\u7fa4\u7d44"}</p>
                  )}
                </div>
              </>
            ) : null}

            {dialog === "archive" || dialog === "delete" ? (
              <>
                <div className="dialog-header centered">
                  <AlertTriangle aria-hidden="true" size={28} />
                  <h3>{dialog === "archive" ? text.archiveGroup : text.deleteGroup}</h3>
                  <p>{dialog === "archive" ? "\u5c01\u5b58\u5f8c\u53ef\u5f9e\u5de6\u5074\u4e0a\u65b9\u7684\u5c01\u5b58\u5165\u53e3\u67e5\u770b\u3002" : "\u522a\u9664\u5f8c\u9019\u500b Demo \u7fa4\u7d44\u5c07\u5f9e\u672c\u6a5f\u79fb\u9664\u3002"}</p>
                </div>
                <div className="dialog-action-row">
                  <button className="secondary-action" type="button" onClick={() => setDialog(null)}>
                    {text.cancel}
                  </button>
                  <button className={dialog === "delete" ? "danger-action" : "primary-action"} type="button" onClick={dialog === "archive" ? archiveActiveGroup : deleteActiveGroup}>
                    {text.confirm}
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
