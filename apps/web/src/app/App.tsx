import { useEffect, useMemo, useState } from "react";
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
  Pencil,
  Plus,
  ReceiptText,
  Trash2,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { GroupRail } from "./GroupRail";
import { StartFlow } from "./StartFlowPanel";
import type { Activity, ArchivedGroup, Expense, Group, GroupData, Member, StartMode } from "./appTypes";
import { UI_TEXT } from "./uiText";
type DialogMode =
  | "createGroup"
  | "editGroup"
  | "inviteMembers"
  | "currencyPanel"
  | "recordsPanel"
  | "analysisPanel"
  | "memberActions"
  | "memberList"
  | "virtualMember"
  | "archivedList"
  | "archive"
  | "delete"
  | null;

const GROUPS_KEY = "equo.clean.groups";
const GROUP_DATA_KEY = "equo.clean.group_data";
const ARCHIVED_GROUPS_KEY = "equo.clean.archived_groups";

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
    members: [{ id: `${group.id}_owner`, name: "Demo", role: "owner" }],
    expenses: [],
    activities: [{ id: crypto.randomUUID(), text: `Demo ${text.createGroup}: ${group.name}`, createdAt: now }],
  };
}

export function App() {
  const [demoMode, setDemoMode] = useState(true);
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
  const [status, setStatus] = useState("Demo \u6a21\u5f0f\u5df2\u555f\u7528\uff0c\u53ef\u4ee5\u76f4\u63a5\u64cd\u4f5c\u4e3b\u8981\u6d41\u7a0b\u3002");
  const [busy, setBusy] = useState(false);

  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? null;
  const activeData = activeGroup ? groupData[activeGroup.id] ?? createGroupData(activeGroup) : null;
  const members = activeData?.members ?? [];
  const expenses = activeData?.expenses ?? [];
  const activities = activeData?.activities ?? [];
  const totalExpenseMinor = expenses.reduce((sum, expense) => sum + expense.amountMinor, 0);
  const averageExpenseMinor = expenses.length ? Math.round(totalExpenseMinor / expenses.length) : 0;
  const payerMember = members[0];

  const balances = useMemo(() => {
    const map = new Map<string, number>();
    members.forEach((member) => map.set(member.id, 0));
    expenses.forEach((expense) => {
      map.set(expense.payerId, (map.get(expense.payerId) ?? 0) + expense.amountMinor);
      const share = Math.round(expense.amountMinor / Math.max(1, expense.shareMemberIds.length));
      expense.shareMemberIds.forEach((id) => map.set(id, (map.get(id) ?? 0) - share));
    });
    return map;
  }, [expenses, members]);

  const debt = useMemo(() => {
    const debtor = members.find((member) => (balances.get(member.id) ?? 0) < 0);
    const creditor = members.find((member) => (balances.get(member.id) ?? 0) > 0);
    if (!debtor || !creditor) return null;
    return {
      from: debtor,
      to: creditor,
      amountMinor: Math.min(Math.abs(balances.get(debtor.id) ?? 0), balances.get(creditor.id) ?? 0),
    };
  }, [balances, members]);
  const maxBalanceMinor = Math.max(1, ...members.map((member) => Math.abs(balances.get(member.id) ?? 0)));

  useEffect(() => writeJson(GROUPS_KEY, groups), [groups]);
  useEffect(() => writeJson(GROUP_DATA_KEY, groupData), [groupData]);
  useEffect(() => writeJson(ARCHIVED_GROUPS_KEY, archivedGroups), [archivedGroups]);

  useEffect(() => {
    const routeId = getRouteGroupId();
    if (routeId && routeId !== activeGroupId && groups.some((group) => group.id === routeId)) {
      setActiveGroupId(routeId);
    }
  }, [activeGroupId, groups]);

  function selectGroup(group: Group) {
    setActiveGroupId(group.id);
    setGroupRoute(group.id);
    setStatus(`${text.groupHome}: ${group.name}`);
  }

  function createGroup() {
    const template = templates.find((item) => item.id === selectedTemplate) ?? templates[0];
    const name = groupName.trim() || template.defaultName;
    const group: Group = { id: `demo_group_${crypto.randomUUID()}`, name, currency: "TWD" };
    setGroups((current) => [group, ...current.filter((item) => item.id !== group.id)].slice(0, 8));
    setGroupData((current) => ({ ...current, [group.id]: createGroupData(group) }));
    setActiveGroupId(group.id);
    setGroupRoute(group.id, "replace");
    setDialog(null);
    setStatus(`${text.createGroup}: ${name}`);
  }

  function openEditGroup() {
    if (!activeGroup) return;
    setGroupName(activeGroup.name);
    setDialog("editGroup");
  }

  function updateActiveGroup() {
    if (!activeGroup) return;
    const name = groupName.trim();
    if (!name) return;
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
    setStatus(`${text.editGroup}: ${name}`);
  }

  function updateActiveCurrency(currency: string) {
    if (!activeGroup || activeGroup.currency === currency) {
      setDialog(null);
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
    setStatus(`${text.currency}: ${currency}`);
  }

  function openInviteMembers() {
    if (!activeGroup) return;
    setDialog("inviteMembers");
  }

  function openMemberList() {
    if (!activeGroup) return;
    setDialog("memberList");
  }

  async function copyInviteText(value: string) {
    if (!value) return;
    try {
      await navigator.clipboard?.writeText(value);
      setStatus("\u5df2\u8907\u88fd\u5230\u526a\u8cbc\u7c3f\u3002");
    } catch {
      setStatus("\u526a\u8cbc\u7c3f\u7121\u6cd5\u4f7f\u7528\uff0c\u8acb\u624b\u52d5\u8907\u88fd\u3002");
    }
  }

  function handleSideNavClick(id: string) {
    if (id === "members") {
      openMemberList();
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
    setStatus(text.groupHome);
  }

  function addVirtualMember() {
    if (!activeGroup || !virtualMemberName.trim()) return;
    const member: Member = { id: `${activeGroup.id}_member_${crypto.randomUUID()}`, name: virtualMemberName.trim(), virtual: true };
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
    setStatus(`${text.addVirtualMember}: ${member.name}`);
  }

  function addExpense() {
    if (!activeGroup || members.length === 0) return;
    const now = new Date().toISOString();
    const expense: Expense = {
      id: crypto.randomUUID(),
      title: text.dinner,
      amountMinor: 120000,
      currency: activeGroup.currency,
      createdAt: now,
      payerId: members[0].id,
      shareMemberIds: members.map((member) => member.id),
    };
    const activity: Activity = {
      id: crypto.randomUUID(),
      text: `${text.addExpense}: ${expense.title} (${formatTwd(expense.amountMinor)})`,
      createdAt: now,
    };
    setGroupData((current) => {
      const data = current[activeGroup.id] ?? createGroupData(activeGroup);
      return { ...current, [activeGroup.id]: { ...data, expenses: [expense, ...data.expenses], activities: [activity, ...data.activities].slice(0, 8) } };
    });
    setExpenseComposerOpen(false);
    setStatus(`${text.addExpense}: ${expense.title}`);
  }

  function archiveActiveGroup() {
    if (!activeGroup) return;
    setBusy(true);
    const archived: ArchivedGroup = { ...activeGroup, archivedAt: new Date().toISOString() };
    setArchivedGroups((current) => [archived, ...current.filter((group) => group.id !== activeGroup.id)].slice(0, 8));
    setGroups((current) => current.filter((group) => group.id !== activeGroup.id));
    setActiveGroupId("");
    setGroupRoute(null);
    setDialog(null);
    setStatus(`${text.archiveGroup}: ${activeGroup.name}`);
    setBusy(false);
  }

  function deleteActiveGroup() {
    if (!activeGroup) return;
    setGroups((current) => current.filter((group) => group.id !== activeGroup.id));
    setGroupData((current) => {
      const next = { ...current };
      delete next[activeGroup.id];
      return next;
    });
    setActiveGroupId("");
    setGroupRoute(null);
    setDialog(null);
    setStatus(`${text.deleteGroup}: ${activeGroup.name}`);
  }

  function openHome() {
    setActiveGroupId("");
    setGroupRoute(null);
  }

  const selectedTemplateLabel = templates.find((template) => template.id === selectedTemplate)?.label ?? text.createGroup;
  const inviteCode = activeGroup ? `EQO-${activeGroup.id.replace(/^demo_group_/, "").replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase()}` : "";
  const inviteLink = activeGroup && typeof window !== "undefined" ? `${window.location.origin}/?invite=${encodeURIComponent(inviteCode)}` : "";
  const panelDialogOpen =
    dialog === "archivedList" ||
    dialog === "inviteMembers" ||
    dialog === "memberList" ||
    dialog === "currencyPanel" ||
    dialog === "recordsPanel" ||
    dialog === "analysisPanel";

  return (
    <main className="app-shell">
      <header className="top-bar">
        <button className="brand-mark" type="button" onClick={openHome}>
          Equo
        </button>
        <div className="top-actions">
          <label className="demo-switch">
            <input type="checkbox" checked={demoMode} onChange={(event) => setDemoMode(event.target.checked)} />
            <span>Demo</span>
          </label>
        </div>
      </header>

      <section className="status-dock" aria-live="polite">
        <span className={busy ? "pulse-dot active" : "pulse-dot"} />
        <p>{status}</p>
      </section>

      {!activeGroup ? (
        <StartFlow
          groups={groups}
          groupName={groupName}
          selectedTemplate={selectedTemplate}
          selectedTemplateLabel={selectedTemplateLabel}
          startMode={startMode}
          templates={templates}
          onCreateGroup={createGroup}
          onGroupNameChange={setGroupName}
          onSelectGroup={selectGroup}
          onSelectTemplate={(template) => {
            setSelectedTemplate(template.id);
            setGroupName(template.defaultName);
          }}
          onSetStartMode={setStartMode}
          onStatus={setStatus}
        />
      ) : (
        <section className="workspace-grid">
          <GroupRail
            activeGroup={activeGroup}
            groups={groups}
            onCreateGroup={() => setDialog("createGroup")}
            onOpenArchivedGroups={() => setDialog("archivedList")}
            onRefresh={() => setStatus("\u5df2\u91cd\u65b0\u6574\u7406\u76ee\u524d\u7fa4\u7d44\u3002")}
            onSelectGroup={selectGroup}
            onShowInviteCode={() => setStatus(text.inputInviteCode)}
          />

          <section className="group-room pizo-home" aria-label={text.groupHome}>
            <article className="group-home-card glass-panel" id="group-home">
              <div className="home-title-row">
                <div>
                  <h2>{activeGroup.name}</h2>
                  <p>
                    {text.members} <strong>{members.length}</strong> {text.total} <strong>{formatTwd(totalExpenseMinor)}</strong>
                  </p>
                </div>
                <span className="status-pill">{demoMode ? "Demo" : "API"}</span>
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
                  <button className="soft-tab active" type="button">
                    {text.personalSpend}
                  </button>
                  <button className="soft-tab" type="button">
                    {text.groupSpend}
                  </button>
                </div>
                <button className="text-action" type="button" onClick={() => setDialog("analysisPanel")}>
                  {text.viewAll} <ChevronRight aria-hidden="true" size={14} />
                </button>
              </div>
              <div className="spending-date-row">
                <div>
                  <span>{`${new Date().getMonth() + 1}/${new Date().getDate()}`}</span>
                  <strong>{formatTwd(totalExpenseMinor)}</strong>
                </div>
                <div className="date-chip-row" aria-label="\u65e5\u671f">
                  {[26, 27, 28, 29, 30, 1, 2, 3].map((day) => (
                    <button className={day === new Date().getDate() ? "date-chip active" : "date-chip"} type="button" key={day}>
                      {day}
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
                <button className="settlement-clear-action" type="button" onClick={() => setStatus(text.clearDebt)}>
                  {text.clearDebt}
                </button>
              </div>
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
                  {expenses.slice(0, 5).map((expense) => (
                    <button className="expense-record-row pizo-expense-row" type="button" key={expense.id}>
                      <span className="member-avatar photo">{initial(payerMember?.name)}</span>
                      <span className="expense-record-main">
                        <strong>{expense.title}</strong>
                        <small>{formatTime(expense.createdAt)}</small>
                      </span>
                      <span className="expense-record-amount">
                        <small>{expense.currency}</small>
                        {formatTwd(expense.amountMinor)}
                        <i className="mini-avatar-stack" aria-hidden="true">
                          {members.slice(0, 3).map((member) => (
                            <em key={member.id}>{initial(member.name)}</em>
                          ))}
                        </i>
                      </span>
                    </button>
                  ))}
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
            <button className="profile-dot" type="button" aria-label={text.profile}>
              <UserRound aria-hidden="true" size={16} />
            </button>
            <div className="side-group-card">
              <div className="side-cover" />
              <div className="side-group-name">
                <div className="side-group-title-row">
                  <h2>{activeGroup.name}</h2>
                  <button className="side-edit-group" type="button" aria-label={text.editGroup} onClick={openEditGroup}>
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
                  <button className={item.id === "home" ? "side-nav-item active" : "side-nav-item"} type="button" key={item.id} onClick={() => handleSideNavClick(item.id)}>
                    <Icon aria-hidden="true" size={19} />
                    {item.id === "currency" ? `${item.label} ${activeGroup.currency}` : item.label}
                  </button>
                );
              })}
            </nav>
            <div className="side-danger-actions">
              <button className="side-archive-action" type="button" onClick={() => setDialog("archive")}>
                <Archive aria-hidden="true" size={16} />
                {text.archiveGroup}
              </button>
              <button className="side-delete-action" type="button" onClick={() => setDialog("delete")}>
                <Trash2 aria-hidden="true" size={16} />
                {text.deleteGroup}
              </button>
            </div>
          </aside>

          <button className="floating-action" type="button" aria-label={text.addExpense} onClick={() => setExpenseComposerOpen(true)}>
            <Plus aria-hidden="true" size={34} />
          </button>
        </section>
      )}

      {expenseComposerOpen ? (
        <div className="composer-backdrop" role="presentation">
          <section className="expense-composer glass-panel" role="dialog" aria-modal="true" aria-label={text.addExpense}>
            <button className="composer-close" type="button" aria-label={text.cancel} onClick={() => setExpenseComposerOpen(false)}>
              <X aria-hidden="true" size={18} />
            </button>
            <div className="composer-header">
              <p className="eyebrow">Expense</p>
              <h2>{text.addExpense}</h2>
            </div>
            <div className="amount-display">
              <span>{activeGroup?.currency ?? "TWD"}</span>
              <strong>$1,200</strong>
            </div>
            <label>
              <span>{text.title}</span>
              <input value={text.dinner} aria-label={text.title} readOnly />
            </label>
            <div className="dialog-action-row">
              <button className="secondary-action" type="button" onClick={() => setExpenseComposerOpen(false)}>
                {text.cancel}
              </button>
              <button className="primary-action" type="button" onClick={addExpense}>
                {text.addExpense}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {dialog ? (
        <div className="modal-backdrop" role="presentation">
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
                    <strong>{expenses.length}</strong>
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
                      <button className="record-dialog-row" type="button" key={expense.id}>
                        <span className="record-dialog-icon">
                          <ReceiptText aria-hidden="true" size={18} />
                        </span>
                        <span>
                          <strong>{expense.title}</strong>
                          <small>{formatActivityTime(expense.createdAt)}</small>
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
                    <strong>{inviteCode}</strong>
                  </div>
                  <div className="invite-link-box">
                    <span>{text.inviteLink}</span>
                    <strong>{inviteLink}</strong>
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
