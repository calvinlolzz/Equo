import { describe, expect, test } from "vitest";
import { createSupabaseStorageClient, urlToStoragePath } from "./supabaseStorageClient.js";

describe("urlToStoragePath", () => {
  test("extracts the bucket-relative path from one of our public storage URLs", () => {
    expect(
      urlToStoragePath("https://example.supabase.co/storage/v1/object/public/equo-images/group_1/photo.jpg"),
    ).toBe("group_1/photo.jpg");
  });

  test("extracts an avatar path (nested prefix)", () => {
    expect(
      urlToStoragePath("https://example.supabase.co/storage/v1/object/public/equo-images/avatars/user_1/pic.png"),
    ).toBe("avatars/user_1/pic.png");
  });

  test("returns null for a foreign URL (e.g. a Google profile picture)", () => {
    expect(urlToStoragePath("https://lh3.googleusercontent.com/a/some-photo")).toBeNull();
  });

  test("returns null for a data: URI", () => {
    expect(urlToStoragePath("data:image/jpeg;base64,abc123")).toBeNull();
  });

  test("returns null for null/undefined", () => {
    expect(urlToStoragePath(null)).toBeNull();
    expect(urlToStoragePath(undefined)).toBeNull();
  });

  test("returns null for an empty string", () => {
    expect(urlToStoragePath("")).toBeNull();
  });

  test("returns null for a URL pointing at a different bucket", () => {
    expect(
      urlToStoragePath("https://example.supabase.co/storage/v1/object/public/some-other-bucket/group_1/photo.jpg"),
    ).toBeNull();
  });

  test("returns null when the path after the marker is empty", () => {
    expect(urlToStoragePath("https://example.supabase.co/storage/v1/object/public/equo-images/")).toBeNull();
  });
});

describe("createSupabaseStorageClient.deleteImage", () => {
  test("sends a DELETE with service-role headers to the object path", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createSupabaseStorageClient({
      url: "https://example.supabase.co",
      serviceRoleKey: "service-role-key",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return { ok: true, status: 200 } as Response;
      },
    });

    await client.deleteImage("group_1/photo.jpg");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://example.supabase.co/storage/v1/object/equo-images/group_1/photo.jpg");
    expect(calls[0].init.method).toBe("DELETE");
    expect(calls[0].init.headers).toMatchObject({
      Authorization: "Bearer service-role-key",
      apikey: "service-role-key",
    });
  });

  test("treats a 404 as success (the object is already gone)", async () => {
    const client = createSupabaseStorageClient({
      url: "https://example.supabase.co",
      serviceRoleKey: "service-role-key",
      fetcher: async () => ({ ok: false, status: 404 }) as Response,
    });

    await expect(client.deleteImage("group_1/missing.jpg")).resolves.toBeUndefined();
  });

  test("throws for a non-404 failure", async () => {
    const client = createSupabaseStorageClient({
      url: "https://example.supabase.co",
      serviceRoleKey: "service-role-key",
      fetcher: async () => ({ ok: false, status: 500 }) as Response,
    });

    await expect(client.deleteImage("group_1/photo.jpg")).rejects.toThrow("Supabase storage delete failed: 500");
  });
});

describe("createUnavailableSupabaseStorageClient", () => {
  test("deleteImage rejects when storage is not configured", async () => {
    const { createUnavailableSupabaseStorageClient } = await import("./supabaseStorageClient.js");
    const client = createUnavailableSupabaseStorageClient();

    await expect(client.deleteImage("group_1/photo.jpg")).rejects.toThrow("not configured");
  });
});
