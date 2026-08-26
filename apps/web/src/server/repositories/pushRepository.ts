export type PushSubscriptionRecord = {
  endpoint: string;
  p256dh: string;
  auth: string;
  /**
   * The language this DEVICE asked for, or null when it has never said.
   *
   * On the subscription rather than the user because a subscription is a
   * device: one person's work laptop can be in English and their phone in
   * Chinese, and each should get the notification it can read. Null covers
   * every device that subscribed before this existed - the server falls back
   * to 繁體中文 for those, which is what they have been receiving.
   */
  locale?: string | null;
};

export type PushTargetsRecord = {
  group_name: string | null;
  /** The actor's display name in this group; null if they are not a member. */
  actor_name: string | null;
  subscriptions: PushSubscriptionRecord[];
};

export type PushRepository = {
  /** Store (or refresh) one browser's subscription. Keyed on the endpoint. */
  saveSubscription(
    userId: string,
    subscription: PushSubscriptionRecord & { userAgent?: string; locale?: string | null },
  ): Promise<{ endpoint: string }>;
  /** Remove one of the caller's own subscriptions. */
  deleteSubscription(userId: string, endpoint: string): Promise<{ deleted: number }>;
  /** Drop a subscription the push service has told us is dead (404/410). */
  pruneSubscription(endpoint: string): Promise<{ deleted: number }>;
  /** Everyone in the group except the actor, plus the names the message needs. */
  targetsForGroup(groupId: string, actorUserId: string): Promise<PushTargetsRecord>;
  /**
   * The endpoints of ONE member - the recipient of a nudge. actor_name is
   * always null here: the sender's name comes from the write that authorised
   * the reminder, not from a second lookup.
   */
  targetsForMember(groupId: string, memberId: string): Promise<PushTargetsRecord>;
  /**
   * The console's owners and admins — the only notification aimed at operators
   * rather than users. group_name/actor_name are always null; neither applies.
   */
  targetsForAdmins(): Promise<PushTargetsRecord>;
  /**
   * Record what one fan-out achieved. Best-effort by contract: the caller is a
   * write path that has already succeeded, and bookkeeping about a notification
   * must never be able to undo it.
   */
  logDelivery(kind: string, outcome: { sent: number; pruned: number; failed: number }): Promise<void>;
};
