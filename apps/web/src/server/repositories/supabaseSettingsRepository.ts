import type { PostgrestClient } from "../db/postgrestClient.js";

export type ReceiptScanSettings = {
  enabled: boolean;
  model: string;
  /** null until an admin has saved once — the row is created lazily. */
  updated_at: string | null;
  updated_by_email: string | null;
};

export type AutoNudgeSettings = {
  enabled: boolean;
  overdue_days: number;
  cooldown_days: number;
  updated_at: string | null;
  updated_by_email: string | null;
};

export type SiteNotice = {
  banner: { message: string; level: "info" | "warning"; ends_at: string | null; active: boolean };
  maintenance: { enabled: boolean; message: string };
};

export type SettingsRepository = {
  getReceiptScan(defaultModel: string): Promise<ReceiptScanSettings>;
  setReceiptScan(
    actor: { id: string; email: string },
    enabled: boolean,
    model: string,
  ): Promise<ReceiptScanSettings>;
  getAutoNudge(): Promise<AutoNudgeSettings>;
  setAutoNudge(
    actor: { id: string; email: string },
    settings: { enabled: boolean; overdueDays: number; cooldownDays: number },
  ): Promise<AutoNudgeSettings>;
  getSiteNotice(): Promise<SiteNotice>;
  setSiteNotice(
    actor: { id: string; email: string },
    settings: {
      bannerMessage: string;
      bannerLevel: "info" | "warning";
      bannerEndsAt: string | null;
      maintenanceEnabled: boolean;
      maintenanceMessage: string;
    },
  ): Promise<SiteNotice>;
};

/**
 * Runtime configuration an admin can change without a deploy.
 *
 * Read on the scan path rather than cached in the module: the whole reason
 * recognition is switchable from the console is so it can be turned off
 * *immediately* when its per-call cost misbehaves, and a cache measured in
 * minutes would quietly undo that. One indexed lookup against a multi-second
 * vision call is not a trade worth making.
 */
export function createSupabaseSettingsRepository(client: PostgrestClient): SettingsRepository {
  return {
    async getReceiptScan(defaultModel) {
      return client.rpc<ReceiptScanSettings>("receipt_scan_settings", { p_default_model: defaultModel });
    },

    async getAutoNudge() {
      return client.rpc<AutoNudgeSettings>("auto_nudge_settings", {});
    },

    async setAutoNudge(actor, settings) {
      return client.rpc<AutoNudgeSettings>("admin_console_set_auto_nudge", {
        p_actor: actor.id,
        p_actor_email: actor.email,
        p_enabled: settings.enabled,
        p_overdue_days: settings.overdueDays,
        p_cooldown_days: settings.cooldownDays,
      });
    },

    async getSiteNotice() {
      return client.rpc<SiteNotice>("site_notice_settings", {});
    },

    async setSiteNotice(actor, settings) {
      return client.rpc<SiteNotice>("admin_console_set_site_notice", {
        p_actor: actor.id,
        p_actor_email: actor.email,
        p_banner_message: settings.bannerMessage,
        p_banner_level: settings.bannerLevel,
        p_banner_ends_at: settings.bannerEndsAt,
        p_maintenance_enabled: settings.maintenanceEnabled,
        p_maintenance_message: settings.maintenanceMessage,
      });
    },

    async setReceiptScan(actor, enabled, model) {
      return client.rpc<ReceiptScanSettings>("admin_console_set_receipt_scan", {
        p_actor: actor.id,
        p_actor_email: actor.email,
        p_enabled: enabled,
        p_model: model,
      });
    },
  };
}
