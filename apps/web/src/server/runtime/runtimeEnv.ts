export type RuntimeEnv = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  GOOGLE_OAUTH_CLIENT_ID: string;
  SESSION_SECRET: string;
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
