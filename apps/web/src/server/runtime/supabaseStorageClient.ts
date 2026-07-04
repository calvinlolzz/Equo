const STORAGE_BUCKET = "equo-images";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export type SupabaseStorageClient = {
  uploadImage(options: {
    groupId: string;
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
    async uploadImage({ groupId, ext, bytes, contentType }) {
      const objectPath = `${groupId}/${randomUUID()}.${ext}`;
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
