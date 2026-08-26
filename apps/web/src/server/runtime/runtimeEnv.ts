export type RuntimeEnv = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  GOOGLE_OAUTH_CLIENT_ID: string;
  SESSION_SECRET: string;
  /**
   * Web push (VAPID). OPTIONAL, and deliberately absent from
   * missingRuntimeEnv: a deployment without these keys should have
   * notifications switched off, not the whole API returning 503.
   */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  /** RFC 8292 "sub" - a mailto: or https: URL. Defaults per readVapidKeys. */
  VAPID_SUBJECT?: string;
  /**
   * Receipt recognition (Claude vision). OPTIONAL, and deliberately absent from
   * missingRuntimeEnv for the same reason as VAPID: a deployment without a key
   * should offer the camera and skip the auto-fill, not 503 the whole API.
   */
  ANTHROPIC_API_KEY?: string;
  /**
   * Receipt recognition via Gemini's free tier. Also optional, and independent
   * of the Anthropic key - a deployment may configure either, both, or neither.
   */
  GEMINI_API_KEY?: string;
  /** Overrides the recognition model. Absent = the scanner's own default. */
  RECEIPT_SCAN_MODEL?: string;
  /**
   * Shared secret the scheduler presents on POST /internal/run-nudges.
   * OPTIONAL, and absent from missingRuntimeEnv like the others - but note the
   * failure direction is the opposite: no key means the endpoint is CLOSED, not
   * that the feature runs unauthenticated.
   */
  CRON_SECRET?: string;
};

type EnvSource = Record<string, string | undefined>;

function cleanEnvValue(value: string | undefined): string | undefined {
  // Strip BOM and surrounding whitespace: values piped into `vercel env add`
  // can arrive polluted, which breaks URL building and token comparisons.
  const cleaned = value?.replace(/^[\s﻿]+|[\s﻿]+$/g, "");
  return cleaned || undefined;
}

export function readRuntimeEnv(source: EnvSource): Partial<RuntimeEnv> {
  return {
    SUPABASE_URL: cleanEnvValue(source.SUPABASE_URL),
    SUPABASE_ANON_KEY: cleanEnvValue(source.SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: cleanEnvValue(source.SUPABASE_SERVICE_ROLE_KEY),
    GOOGLE_OAUTH_CLIENT_ID: cleanEnvValue(source.GOOGLE_OAUTH_CLIENT_ID),
    SESSION_SECRET: cleanEnvValue(source.SESSION_SECRET),
    VAPID_PUBLIC_KEY: cleanEnvValue(source.VAPID_PUBLIC_KEY),
    VAPID_PRIVATE_KEY: cleanEnvValue(source.VAPID_PRIVATE_KEY),
    VAPID_SUBJECT: cleanEnvValue(source.VAPID_SUBJECT),
    ANTHROPIC_API_KEY: cleanEnvValue(source.ANTHROPIC_API_KEY),
    GEMINI_API_KEY: cleanEnvValue(source.GEMINI_API_KEY),
    RECEIPT_SCAN_MODEL: cleanEnvValue(source.RECEIPT_SCAN_MODEL),
    // Through cleanEnvValue like everything else, and it matters more here: a
    // value piped into `vercel env add` can arrive with a BOM, and a secret
    // that differs by one invisible character fails comparison with no clue.
    CRON_SECRET: cleanEnvValue(source.CRON_SECRET),
  };
}

/**
 * The VAPID keypair, or undefined when push is not configured.
 *
 * Both halves or nothing: a public key without its private key would let the
 * UI offer to turn notifications on and then silently never deliver one, which
 * is worse than the switch not being there.
 */
export function readVapidKeys(
  env: Partial<RuntimeEnv>,
): { publicKey: string; privateKey: string; subject: string } | undefined {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return undefined;
  }

  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    // Push services require a contact; they reject a request whose JWT has no
    // usable "sub". The site itself is a valid one and needs no extra config.
    subject: env.VAPID_SUBJECT ?? "https://equo-mu.vercel.app",
  };
}

export function missingRuntimeEnv(env: Partial<RuntimeEnv>): Array<keyof RuntimeEnv> {
  const missing: Array<keyof RuntimeEnv> = [];

  if (!env.SUPABASE_URL) {
    missing.push("SUPABASE_URL");
  }

  if (!env.SUPABASE_ANON_KEY) {
    missing.push("SUPABASE_ANON_KEY");
  }

  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }

  if (!env.GOOGLE_OAUTH_CLIENT_ID) {
    missing.push("GOOGLE_OAUTH_CLIENT_ID");
  }

  if (!env.SESSION_SECRET) {
    missing.push("SESSION_SECRET");
  }

  return missing;
}
