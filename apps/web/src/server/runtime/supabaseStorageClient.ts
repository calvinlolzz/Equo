const STORAGE_BUCKET = "equo-images";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export type SupabaseStorageClient = {
  uploadImage(options: {
    /**
     * The storage-object path prefix (everything before "<uuid>.<ext>"),
     * e.g. a groupId for group images or "avatars/<userId>" for a user's
     * avatar. Kept as a free-form prefix (rather than a groupId-only field)
     * so every caller - group images and the self-scoped avatar upload
     * alike - can share this one client.
     */
    pathPrefix: string;
    ext: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<{ url: string }>;
  /**
   * Deletes a bucket-relative object path (as produced by
   * urlToStoragePath). Used to clean up orphaned images once nothing
   * references them anymore (a deleted expense's photo, a group's previous
   * cover, a user's previous avatar) - see softDeleteExpense/updateGroup/
   * updateUserAvatar's fire-and-forget hooks. A 404 (already gone) is
   * treated as success since the end state - the object not existing - is
   * what the caller wants either way; any other non-ok response throws so
   * callers can log/ignore it themselves.
   */
  deleteImage(path: string): Promise<void>;
};

type SupabaseStorageOptions = {
  url: string;
  serviceRoleKey: string;
  fetcher?: typeof fetch;
  randomUUID?: () => string;
};

export function createSupabaseStorageClient(options: SupabaseStorageOptions): SupabaseStorageClient {
  const fetcher = options.fetcher ?? fetch;
  const randomUUID = options.randomUUID ?? (() => crypto.randomUUID());
  const baseUrl = options.url.replace(/\/$/, "");

  return {
    async uploadImage({ pathPrefix, ext, bytes, contentType }) {
      const objectPath = `${pathPrefix}/${randomUUID()}.${ext}`;
      const response = await fetcher(`${baseUrl}/storage/v1/object/${STORAGE_BUCKET}/${objectPath}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.serviceRoleKey}`,
          "Content-Type": contentType,
          "x-upsert": "false",
        },
        body: new Blob([toArrayBuffer(bytes)], { type: contentType }),
      });

      if (!response.ok) {
        throw new Error(`Supabase storage upload failed: ${response.status}`);
      }

      return { url: `${baseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${objectPath}` };
    },

    async deleteImage(path: string) {
      const response = await fetcher(`${baseUrl}/storage/v1/object/${STORAGE_BUCKET}/${path}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${options.serviceRoleKey}`,
          apikey: options.serviceRoleKey,
        },
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(`Supabase storage delete failed: ${response.status}`);
      }
    },
  };
}

export function createUnavailableSupabaseStorageClient(): SupabaseStorageClient {
  return {
    async uploadImage() {
      throw new Error("Supabase storage client is not configured");
    },
    async deleteImage() {
      throw new Error("Supabase storage client is not configured");
    },
  };
}

/**
 * Extracts the bucket-relative object path from one of OUR public storage
 * URLs (uploadImage's return shape: "<base>/storage/v1/object/public/
 * equo-images/<path>"), or null for anything that isn't - a foreign URL
 * (e.g. a Google profile picture at googleusercontent.com), a data: URI, or
 * a malformed/unexpected shape. Used by the orphan-cleanup hooks
 * (softDeleteExpense/updateGroup/updateUserAvatar) to decide whether an
 * old image_url/cover_image_url/avatar_url is ours to delete - deleting
 * only ever targets our own bucket, never a URL we don't control.
 */
export function urlToStoragePath(publicUrl: string | null | undefined): string | null {
  if (!publicUrl) return null;

  const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
  const index = publicUrl.indexOf(marker);
  if (index === -1) return null;

  const path = publicUrl.slice(index + marker.length);
  if (!path) return null;

  return path;
}
