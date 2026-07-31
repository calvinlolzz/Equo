import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import {
  ADMIN_COMMAND_GROUP_LABELS,
  ADMIN_COMMAND_RESULT_LIMIT,
  buildAdminCommands,
  moveSelection,
  shouldSearch,
  type AdminCommand,
} from "./adminCommands";
import type { AdminRoute } from "./adminRoute";
import type { AdminGroupRow, AdminUserRow, EquoApiClient } from "./apiClient";

/** Typing pause before the two search requests go out. */
const SEARCH_DEBOUNCE_MS = 220;

/**
 * ⌘K / Ctrl+K: one box for "take me to that person / group / page".
 *
 * Searches users and groups in parallel and offers tab jumps alongside them.
 * Everything it can do is decided in adminCommands.ts; this file is the input,
 * the keyboard handling and the list.
 */
export function AdminCommandPalette({
  client,
  canManageAdmins,
  onNavigate,
  onClose,
}: {
  client: EquoApiClient;
  canManageAdmins: boolean;
  onNavigate: (patch: Partial<AdminRoute>) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [groups, setGroups] = useState<AdminGroupRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!shouldSearch(query)) {
      setUsers([]);
      setGroups([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      Promise.all([
        client.adminListUsers({ search: query.trim(), limit: ADMIN_COMMAND_RESULT_LIMIT, offset: 0 }),
        client.adminListGroups({ search: query.trim(), limit: ADMIN_COMMAND_RESULT_LIMIT, offset: 0 }),
      ])
        .then(([userPage, groupPage]) => {
          if (cancelled) return;
          setUsers(userPage.users);
          setGroups(groupPage.groups);
        })
        .catch(() => {
          if (cancelled) return;
          // A failed lookup leaves the tab jumps, which still work. No error
          // banner: the palette is a shortcut, and one that quietly finds
          // nothing is better than one that shouts about it mid-keystroke.
          setUsers([]);
          setGroups([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [client, query]);

  const commands = useMemo(
    () => buildAdminCommands({ query, users, groups, canManageAdmins }),
    [query, users, groups, canManageAdmins],
  );

  // The list reorders under the cursor as results arrive; keeping the index in
  // range beats letting Enter fire on whatever happens to be there.
  useEffect(() => {
    setSelected(0);
  }, [query]);

  function run(command: AdminCommand) {
    onNavigate(command.patch);
    onClose();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((current) => moveSelection(current, 1, commands.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((current) => moveSelection(current, -1, commands.length));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const command = commands[selected];
      if (command) run(command);
    }
  }

  let lastGroup: AdminCommand["group"] | null = null;

  return (
    <div
      className="admin-modal"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="admin-modal__panel admin-palette"
        role="dialog"
        aria-modal="true"
        aria-label="快速搜尋"
        onKeyDown={onKeyDown}
      >
        <div className="admin-palette__search">
          <Search aria-hidden="true" size={16} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="搜尋使用者、群組，或貼上一個 ID"
            aria-label="快速搜尋"
            onChange={(event) => setQuery(event.target.value)}
          />
          {searching && <span className="admin-palette__status">搜尋中…</span>}
        </div>

        <ul className="admin-palette__list" role="listbox" aria-label="搜尋結果">
          {commands.map((command, index) => {
            const heading = command.group === lastGroup ? null : ADMIN_COMMAND_GROUP_LABELS[command.group];
            lastGroup = command.group;
            return (
              <li key={command.id}>
                {heading && <p className="admin-palette__heading">{heading}</p>}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === selected}
                  className={index === selected ? "admin-palette__item admin-palette__item--active" : "admin-palette__item"}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => run(command)}
                >
                  <span className="admin-palette__label">{command.label}</span>
                  {command.hint && <span className="admin-palette__hint">{command.hint}</span>}
                </button>
              </li>
            );
          })}
          {commands.length === 0 && (
            <li className="admin-palette__empty">
              {/* One character matches no tab (they are all Chinese) and is
                  below the search threshold, so "沒有符合的結果" would be a
                  lie about a lookup that never ran. */}
              {!shouldSearch(query) ? "再多輸入一個字開始搜尋" : searching ? "搜尋中…" : "沒有符合的結果"}
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
