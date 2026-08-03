import { describe, expect, test, vi } from "vitest";
import type { AdminRepository } from "../repositories/adminRepository.js";
import type { SettingsRepository } from "../repositories/supabaseSettingsRepository.js";
import { handleAdminGetReceiptScanSettings, handleAdminSetReceiptScanSettings } from "./admin.js";

const DEFAULT_MODEL = "claude-haiku-4-5";
/** A deployment with a Claude key and no Gemini one - the common shape. */
const ANTHROPIC_ONLY = { anthropic: "sk-ant-test" };
const NO_KEYS = {};

function context(id: string, email = "admin@example.com") {
  return { user: { id, google_sub: `google-${id}`, email, display_name: "Admin" } };
}

/** support < admin < owner, keyed by the caller's id so one fake covers every rank. */
function repository(): AdminRepository {
  return {
    async findAdminRole(userId: string) {
      if (userId === "user_owner") return "owner";
      if (userId === "user_admin") return "admin";
      if (userId === "user_support") return "support";
      return null;
    },
  } as unknown as AdminRepository;
}

function settings(saved = { enabled: true, model: DEFAULT_MODEL }) {
  const setReceiptScan = vi.fn<SettingsRepository["setReceiptScan"]>(async (_actor, enabled, model) => ({
    enabled,
    model,
    updated_at: "2026-08-03T12:00:00.000Z",
    updated_by_email: "admin@example.com",
  }));

  return {
    repo: {
      async getReceiptScan() {
        return { ...saved, updated_at: null, updated_by_email: null };
      },
      setReceiptScan,
    } satisfies SettingsRepository,
    setReceiptScan,
  };
}

describe("handleAdminGetReceiptScanSettings", () => {
  test("lets support read the live configuration", async () => {
    // Which model is running is the first thing to check on a "掃描沒反應"
    // report, so reading it must not need the rank that can change it.
    const result = await handleAdminGetReceiptScanSettings(
      repository(),
      settings().repo,
      context("user_support"),
      DEFAULT_MODEL,
      ANTHROPIC_ONLY,
    );

    expect(result.status).toBe(200);
    expect(result.ok && result.body).toMatchObject({ enabled: true, model: DEFAULT_MODEL, configured: true });
  });

  test("reports the choices the console may offer, so it cannot present one the server rejects", async () => {
    const result = await handleAdminGetReceiptScanSettings(
      repository(),
      settings().repo,
      context("user_admin"),
      DEFAULT_MODEL,
      ANTHROPIC_ONLY,
    );

    const models = result.ok ? result.body.models : [];
    expect(models.map((entry) => entry.id)).toContain(DEFAULT_MODEL);

    // Every model is listed, but only the ones whose provider has a key here
    // are marked runnable - "why is Gemini missing" is a worse question to be
    // left with than "Gemini needs a key".
    expect(models.find((entry) => entry.provider === "google")?.available).toBe(false);
    expect(models.find((entry) => entry.id === DEFAULT_MODEL)?.available).toBe(true);
  });

  test("distinguishes 'no API key' from 'switched off'", async () => {
    const result = await handleAdminGetReceiptScanSettings(
      repository(),
      settings({ enabled: true, model: DEFAULT_MODEL }).repo,
      context("user_admin"),
      DEFAULT_MODEL,
      NO_KEYS,
    );

    // Both stop the auto-fill, but one is fixed in Vercel and the other here.
    expect(result.ok && result.body).toMatchObject({ configured: false, enabled: true });
  });

  test("refuses a caller with no admin role at all", async () => {
    const result = await handleAdminGetReceiptScanSettings(
      repository(),
      settings().repo,
      context("user_nobody"),
      DEFAULT_MODEL,
      ANTHROPIC_ONLY,
    );

    expect(result.status).toBe(403);
  });
});

describe("handleAdminSetReceiptScanSettings", () => {
  test("saves a switch-off from an admin", async () => {
    const { repo, setReceiptScan } = settings();

    const result = await handleAdminSetReceiptScanSettings(
      repository(),
      repo,
      context("user_admin"),
      { enabled: false, model: DEFAULT_MODEL },
      DEFAULT_MODEL,
      ANTHROPIC_ONLY,
    );

    expect(result.status).toBe(200);
    expect(setReceiptScan).toHaveBeenCalledWith(
      { id: "user_admin", email: "admin@example.com" },
      false,
      DEFAULT_MODEL,
    );
  });

  test("support can read but not change — this switch stops a paid feature for everyone", async () => {
    const { repo, setReceiptScan } = settings();

    const result = await handleAdminSetReceiptScanSettings(
      repository(),
      repo,
      context("user_support"),
      { enabled: false, model: DEFAULT_MODEL },
      DEFAULT_MODEL,
      ANTHROPIC_ONLY,
    );

    expect(result.status).toBe(403);
    expect(setReceiptScan).not.toHaveBeenCalled();
  });

  test("rejects a model this build cannot call instead of storing it", async () => {
    const { repo, setReceiptScan } = settings();

    const result = await handleAdminSetReceiptScanSettings(
      repository(),
      repo,
      context("user_admin"),
      { enabled: true, model: "gpt-4o" },
      DEFAULT_MODEL,
      ANTHROPIC_ONLY,
    );

    // Stored, it would turn every later scan into a silent 503 while the
    // console kept showing the setting as if it had taken effect.
    expect(result.status).toBe(400);
    expect(setReceiptScan).not.toHaveBeenCalled();
  });

  test("rejects a missing or non-boolean enabled flag", async () => {
    const { repo, setReceiptScan } = settings();

    for (const body of [{ model: DEFAULT_MODEL }, { enabled: "false", model: DEFAULT_MODEL }]) {
      const result = await handleAdminSetReceiptScanSettings(
        repository(),
        repo,
        context("user_admin"),
        body,
        DEFAULT_MODEL,
        ANTHROPIC_ONLY,
      );
      expect(result.status).toBe(400);
    }

    expect(setReceiptScan).not.toHaveBeenCalled();
  });

  test("echoes back the saved state so the console never shows a stale value", async () => {
    const { repo } = settings();

    const result = await handleAdminSetReceiptScanSettings(
      repository(),
      repo,
      context("user_owner", "owner@example.com"),
      { enabled: true, model: "claude-sonnet-5" },
      DEFAULT_MODEL,
      ANTHROPIC_ONLY,
    );

    expect(result.ok && result.body).toMatchObject({ enabled: true, model: "claude-sonnet-5", configured: true });
  });
});
