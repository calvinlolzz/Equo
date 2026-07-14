import { describe, expect, test } from "vitest";
import { createGoogleTokenVerifier } from "./googleTokenVerifier.js";
import { missingRuntimeEnv, readRuntimeEnv } from "./runtimeEnv.js";
import { createSupabaseStorageClient } from "./supabaseStorageClient.js";

describe("runtime adapters", () => {
  test("rejects Google tokens with the wrong audience", async () => {
    const verifier = createGoogleTokenVerifier("client-a", async () => ({
      ok: true,
      async json() {
        return {
          sub: "google-user",
          aud: "client-b",
          email: "alice@example.com",
          email_verified: "true",
        };
      },
    }));

    await expect(verifier("token")).resolves.toBeNull();
  });

  test("maps Google tokeninfo into GoogleIdentity", async () => {
    const verifier = createGoogleTokenVerifier("client-a", async () => ({
      ok: true,
      async json() {
        return {
          sub: "google-user",
          aud: "client-a",
          email: "alice@example.com",
          email_verified: "true",
          name: "Alice",
          picture: "https://example.com/avatar.png",
        };
      },
    }));

    await expect(verifier("token")).resolves.toEqual({
      auth_user_id: "google-user",
      google_sub: "google-user",
      email: "alice@example.com",
      display_name: "Alice",
      avatar_url: "https://example.com/avatar.png",
    });
  });

  test("reports missing Supabase runtime env", () => {
    const env = readRuntimeEnv({
      SUPABASE_URL: "https://example.supabase.co",
    });

    expect(missingRuntimeEnv(env)).toEqual([
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "GOOGLE_OAUTH_CLIENT_ID",
      "SESSION_SECRET",
    ]);
  });

});

describe("createSupabaseStorageClient", () => {
  test("uploads bytes to the equo-images bucket with service role auth", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const storage = createSupabaseStorageClient({
      url: "https://example.supabase.co",
      serviceRoleKey: "service-role-key",
      randomUUID: () => "fixed-uuid",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return { ok: true } as Response;
      },
    });

    const bytes = new Uint8Array([1, 2, 3]);
    await expect(
      storage.uploadImage({ pathPrefix: "group_1", ext: "jpg", bytes, contentType: "image/jpeg" }),
    ).resolves.toEqual({
      url: "https://example.supabase.co/storage/v1/object/public/equo-images/group_1/fixed-uuid.jpg",
    });

    expect(calls[0].url).toBe(
      "https://example.supabase.co/storage/v1/object/equo-images/group_1/fixed-uuid.jpg",
    );
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({
      Authorization: "Bearer service-role-key",
      "Content-Type": "image/jpeg",
      "x-upsert": "false",
    });
    expect(calls[0].init.body).toBeInstanceOf(Blob);
    expect(await (calls[0].init.body as Blob).arrayBuffer()).toEqual(bytes.buffer);
  });

  test("throws when the upload response is not ok", async () => {
    const storage = createSupabaseStorageClient({
      url: "https://example.supabase.co",
      serviceRoleKey: "service-role-key",
      fetcher: async () => ({ ok: false, status: 413 }) as Response,
    });

    await expect(
      storage.uploadImage({ pathPrefix: "group_1", ext: "jpg", bytes: new Uint8Array(), contentType: "image/jpeg" }),
    ).rejects.toThrow("Supabase storage upload failed: 413");
  });
});
