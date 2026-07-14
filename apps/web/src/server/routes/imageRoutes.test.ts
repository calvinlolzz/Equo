import { describe, expect, test } from "vitest";
import { updateMyAvatarRoute, uploadGroupImageRoute } from "./imageRoutes.js";
import { createFakePostgrest } from "../db/fakePostgrest.js";
import type { SupabaseStorageClient } from "../runtime/supabaseStorageClient.js";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const validRequest = {
  client_request_id: "req_image",
  kind: "expense" as const,
  data_url: `data:image/png;base64,${tinyPngBase64}`,
};

function makeClient(member: { id: string } | null, deletedAt: string | null = null) {
  return createFakePostgrest({
    select: (table) => {
      // Session-token requests are gated on the account still being enabled
      // (buildAuthContext -> findUserAuthState), so every route fake has to
      // answer this probe, not just the route's own membership check.
      if (table === "users") return [{ id: "user_alice", deleted_at: deletedAt }];
      if (table === "group_members") return member ? [member] : [];
      return [];
    },
  });
}

function makeStorage(): SupabaseStorageClient {
  return {
    async uploadImage() {
      return { url: "https://example.supabase.co/storage/v1/object/public/equo-images/group_1/photo.jpg" };
    },
    async deleteImage() {},
  };
}

const verifier = async (idToken: string) => ({
  auth_user_id: idToken,
  google_sub: idToken,
  email: "alice@example.com",
  display_name: "Alice",
  // Marks the identity as already-resolved so requireAuthenticatedUser skips
  // the upsertUserByGoogleIdentity DB round-trip (see sessionToken.ts's doc
  // on resolved_user_id) - this fake client only needs to answer the
  // group_members membership check the route itself performs.
  resolved_user_id: idToken,
});

describe("uploadGroupImageRoute", () => {
  test("uploads the image for an active group member", async () => {
    const result = await uploadGroupImageRoute(
      {
        client: makeClient({ id: "member_alice" }),
        storage: makeStorage(),
        verifier,
        idToken: "user_alice",
      },
      "group_1",
      validRequest,
    );

    expect(result.status).toBe(201);
    expect(result.ok && result.body).toMatchObject({
      image: { url: expect.stringContaining("photo.jpg") },
    });
  });

  test("rejects the upload with 403 FORBIDDEN when the caller is not an active member of the group", async () => {
    const result = await uploadGroupImageRoute(
      {
        client: makeClient(null),
        storage: makeStorage(),
        verifier,
        idToken: "user_mallory",
      },
      "group_1",
      validRequest,
    );

    expect(result.status).toBe(403);
    if (result.ok) {
      throw new Error("expected uploadGroupImageRoute to reject a non-member with 403");
    }
    expect(result.body.error?.code).toBe("FORBIDDEN");
  });
});

function makeAvatarClient() {
  return createFakePostgrest({
    // Serves both the account-state probe and updateUserAvatar's read of the
    // previous avatar (the one that has to be cleaned up from storage).
    select: () => [
      {
        id: "user_alice",
        deleted_at: null,
        avatar_url:
          "https://example.supabase.co/storage/v1/object/public/equo-images/avatars/user_alice/old.jpg",
      },
    ],
    update: (table, _query, body) =>
      table === "users" ? [{ avatar_url: (body as { avatar_url: string }).avatar_url }] : [],
  });
}

function makeAvatarStorage(): SupabaseStorageClient {
  return {
    async uploadImage({ pathPrefix, ext }) {
      return {
        url: `https://example.supabase.co/storage/v1/object/public/equo-images/${pathPrefix}/avatar.${ext}`,
      };
    },
    async deleteImage() {},
  };
}

describe("updateMyAvatarRoute", () => {
  test("uploads the avatar and persists it on users.avatar_url for the authenticated caller", async () => {
    const result = await updateMyAvatarRoute(
      {
        client: makeAvatarClient(),
        storage: makeAvatarStorage(),
        verifier,
        idToken: "user_alice",
      },
      { client_request_id: "req_avatar", data_url: validRequest.data_url },
    );

    expect(result.status).toBe(200);
    expect(result.ok && result.body).toMatchObject({
      avatar_url: expect.stringContaining("avatars/user_alice/"),
    });
  });

  test("rejects an invalid image with 400 INVALID_IMAGE", async () => {
    const result = await updateMyAvatarRoute(
      {
        client: makeAvatarClient(),
        storage: makeAvatarStorage(),
        verifier,
        idToken: "user_alice",
      },
      { client_request_id: "req_avatar", data_url: "not-a-data-url" },
    );

    expect(result.status).toBe(400);
    if (result.ok) {
      throw new Error("expected updateMyAvatarRoute to reject an invalid image with 400");
    }
    expect(result.body.error?.code).toBe("INVALID_IMAGE");
  });

  test("rejects an unauthenticated caller with 401", async () => {
    const result = await updateMyAvatarRoute(
      {
        client: makeAvatarClient(),
        storage: makeAvatarStorage(),
        verifier: async () => null,
        idToken: "",
      },
      { client_request_id: "req_avatar", data_url: validRequest.data_url },
    );

    expect(result.status).toBe(401);
    if (result.ok) {
      throw new Error("expected updateMyAvatarRoute to reject an unauthenticated caller with 401");
    }
    expect(result.body.error?.code).toBe("UNAUTHENTICATED");
  });

  describe("orphaned-avatar cleanup", () => {
    function makeFakeAvatarStorage() {
      const deletedPaths: string[] = [];
      return {
        deletedPaths,
        client: {
          async uploadImage({ pathPrefix, ext }: { pathPrefix: string; ext: string }) {
            return {
              url: `https://example.supabase.co/storage/v1/object/public/equo-images/${pathPrefix}/avatar.${ext}`,
            };
          },
          async deleteImage(path: string) {
            deletedPaths.push(path);
          },
        },
      };
    }

    test("deletes the previous avatar once it's replaced by a different one", async () => {
      const storage = makeFakeAvatarStorage();

      await updateMyAvatarRoute(
        {
          client: makeAvatarClient(),
          storage: storage.client,
          verifier,
          idToken: "user_alice",
        },
        { client_request_id: "req_avatar", data_url: validRequest.data_url },
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      // makeAvatarClient always reports avatars/user_alice/old.jpg as the previous
      // value - the new upload lands on a different path, so the old object is
      // now unreferenced and should be cleaned up.
      expect(storage.deletedPaths).toEqual(["avatars/user_alice/old.jpg"]);
    });

    test("does not delete a foreign previous avatar URL (e.g. a Google profile picture)", async () => {
      const client = createFakePostgrest({
        select: () => [
          { id: "user_alice", deleted_at: null, avatar_url: "https://lh3.googleusercontent.com/a/some-photo" },
        ],
        update: (table, _query, body) =>
          table === "users" ? [{ avatar_url: (body as { avatar_url: string }).avatar_url }] : [],
      });
      const storage = makeFakeAvatarStorage();

      await updateMyAvatarRoute(
        { client, storage: storage.client, verifier, idToken: "user_alice" },
        { client_request_id: "req_avatar", data_url: validRequest.data_url },
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(storage.deletedPaths).toEqual([]);
    });
  });
});
