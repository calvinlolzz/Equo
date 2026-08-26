import { useCallback, useEffect, useState } from "react";
import type { ExpenseCommentSummary } from "./apiClient";
import { describeCloudActionError } from "./describeCloudActionError";
import { MAX_COMMENT_LENGTH } from "../contracts/validation";

export type ExpenseCommentsApi = {
  listExpenseComments(groupId: string, expenseId: string): Promise<ExpenseCommentSummary[]>;
  addExpenseComment(groupId: string, expenseId: string, body: string): Promise<ExpenseCommentSummary>;
  removeExpenseComment(groupId: string, expenseId: string, commentId: string): Promise<void>;
};

export type ExpenseCommentsState = {
  items: ExpenseCommentSummary[];
  loading: boolean;
  error: string | null;
  submitting: boolean;
  submit(body: string): Promise<void>;
  remove(commentId: string): Promise<void>;
};

/**
 * The comment thread for whichever expense the detail dialog is showing.
 *
 * Fetched on open rather than carried in the group payload — see cloudStore's
 * listExpenseComments for why.
 *
 * Two things it deliberately does NOT do:
 *
 * - **No optimistic insert.** Everywhere else in this app an optimistic row is
 *   worth it because the write is one the user already committed to and can see
 *   the shape of. A comment is different: the id and the timestamp both come
 *   from the server, and a line that appears instantly and then jumps as the
 *   real one lands reads as the app having sent it twice. The round trip here
 *   is one small request against a thread that is already open.
 * - **No polling.** A thread refreshes when the dialog opens and when this
 *   client writes to it. Somebody else's comment arriving while the dialog sits
 *   open is what the push notification is for.
 */
export function useExpenseComments(
  api: ExpenseCommentsApi | null,
  groupId: string | null,
  expenseId: string | null,
): ExpenseCommentsState {
  const [items, setItems] = useState<ExpenseCommentSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!api || !groupId || !expenseId) {
      setItems([]);
      return;
    }

    // Swiping to a neighbouring expense changes expenseId without remounting,
    // so an in-flight fetch for the entry we just left must not be allowed to
    // write its comments onto the one now on screen.
    let cancelled = false;

    setLoading(true);
    setError(null);
    // Cleared up front rather than left in place: showing the previous entry's
    // thread under this entry's title, even for a moment, is a lie about who
    // said what and about which expense.
    setItems([]);

    api
      .listExpenseComments(groupId, expenseId)
      .then((comments) => {
        if (!cancelled) setItems(comments);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeCloudActionError(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [api, groupId, expenseId]);

  const submit = useCallback(
    async (body: string) => {
      const trimmed = body.trim();
      if (!api || !groupId || !expenseId || !trimmed || trimmed.length > MAX_COMMENT_LENGTH) return;

      setSubmitting(true);
      setError(null);
      try {
        const comment = await api.addExpenseComment(groupId, expenseId, trimmed);
        // Appended rather than refetched: the server orders by created_at and
        // this one is the newest, so a whole round trip would only confirm
        // where we already know it goes.
        setItems((current) => [...current, comment]);
      } catch (cause) {
        setError(describeCloudActionError(cause));
      } finally {
        setSubmitting(false);
      }
    },
    [api, groupId, expenseId],
  );

  const remove = useCallback(
    async (commentId: string) => {
      if (!api || !groupId || !expenseId) return;

      const previous = items;
      // Removed first here, unlike the insert: the line is already on screen
      // and the user asked for it to go, so leaving it sitting there while the
      // request flies reads as the tap not having registered. Restored on
      // failure, which is the case the error message then explains.
      setItems((current) => current.filter((comment) => comment.id !== commentId));
      setError(null);
      try {
        await api.removeExpenseComment(groupId, expenseId, commentId);
      } catch (cause) {
        setItems(previous);
        setError(describeCloudActionError(cause));
      }
    },
    [api, groupId, expenseId, items],
  );

  return { items, loading, error, submitting, submit, remove };
}
