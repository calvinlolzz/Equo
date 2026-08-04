export type PushSubscriptionRecord = {
  endpoint: string;
  p256dh: string;
  auth: string;
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
    subscription: PushSubscriptionRecord & { userAgent?: string },
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
};
