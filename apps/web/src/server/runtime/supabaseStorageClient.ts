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
  };
}

export function createUnavailableSupabaseStorageClient(): SupabaseStorageClient {
  return {
    async uploadImage() {
      throw new Error("Supabase storage client is not configured");
    },
  };
}
