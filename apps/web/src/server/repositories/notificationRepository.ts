/**
 * The in-app inbox, from the reader's side.
 *
 * Everything here is scoped to one user by the RPC itself rather than by a
 * check in the handler - an id from someone else's inbox has to be a no-op, and
 * enforcing that in the UPDATE is the only version of the rule that cannot be
 * forgotten at a call site.
 */

export type NotificationRecord = {
  id: string;
  /** 'announcement' (from the console) or 'feedback_reply'. */
  kind: string;
  title: string;
  body: string;
  /** An in-app path, or null. Never an absolute URL. */
  link: string | null;
  created_at: string;
  read_at: string | null;
};

export type NotificationListRecord = {
  /** Unread across the whole inbox, not just the returned page. */
  unread: number;
  items: NotificationRecord[];
};

export type NotificationReadResult = {
  marked: number;
  unread: number;
};

export type NotificationRepository = {
  list(userId: string, limit: number): Promise<NotificationListRecord>;
  /** An empty id list means "everything unread". */
  markRead(userId: string, ids: string[]): Promise<NotificationReadResult>;
};
