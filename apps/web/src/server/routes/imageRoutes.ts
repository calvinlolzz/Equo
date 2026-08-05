import type { PostgrestClient } from "../db/postgrestClient.js";
import type { ApiError } from "../../contracts/errors.js";
import type { UpdateMyAvatarRequest, UploadGroupImageRequest } from "../../contracts/schemas.js";
import {
  imageExtensionFromDataUrl,
  validateUpdateMyAvatarRequest,
  validateUploadGroupImageRequest,
} from "../../contracts/validation.js";
import type { GoogleTokenVerifier } from "../auth/google.js";
import { buildAuthContext } from "../auth/routeContext.js";
import {
  createSupabaseGroupRepository,
  updateUserAvatar,
} from "../repositories/supabaseGroupRepository.js";
import { urlToStoragePath, type SupabaseStorageClient } from "../runtime/supabaseStorageClient.js";

type RouteOptions = {
  client: PostgrestClient;
  storage: SupabaseStorageClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
};

/**
 * Declared rather than inferred so `ok` stays a literal type in each branch.
 * Inferred, it widens to boolean, and `if (result.ok)` then narrows nothing -
 * callers and tests end up looking at the union of both bodies.
 */
type RouteResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; body: ApiError };

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function decodeBase64(base64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}


export async function uploadGroupImageRoute(
  options: RouteOptions,
  groupId: string,
  request: UploadGroupImageRequest,
) {
  const validation = validateUploadGroupImageRequest(request);

  if (!validation.ok) {
    return {
      ok: false,
      status: 400,
      body: {
        error: {
          code: validation.issues[0]?.code ?? "INVALID_IMAGE",
          message: validation.issues[0]?.message ?? "Invalid image upload request.",
          request_id: request.client_request_id,
        },
      },
    };
  }

  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  const repository = createSupabaseGroupRepository(options.client);
  const member = await repository.findActiveMember(groupId, auth.context.user.id);

  if (!member) {
    return {
      ok: false,
      status: 403,
      body: {
        error: {
          code: "FORBIDDEN",
          message: "You are not a member of this group.",
          request_id: request.client_request_id,
        },
      },
    };
  }

  const ext = imageExtensionFromDataUrl(request.data_url) ?? "jpg";
  const base64 = request.data_url.slice(request.data_url.indexOf(",") + 1);
  const bytes = decodeBase64(base64);

  const image = await options.storage.uploadImage({
    pathPrefix: groupId,
    ext,
    bytes,
    contentType: CONTENT_TYPE_BY_EXT[ext] ?? "image/jpeg",
  });

  return { ok: true, status: 201, body: { image } };
}

/**
 * PATCH /api/v1/me/avatar - self-scoped, no group involved. Validates like a
 * group image upload (same data:image type/1.5MB rules via
 * validateUpdateMyAvatarRequest, which mirrors validateUploadGroupImageRequest's
 * helpers), uploads to avatars/<userId>/<uuid>.<ext>, and persists the URL on
 * users.avatar_url (mirrored to profiles.avatar_url) so it becomes the new
 * default avatar everywhere the user appears.
 */
export async function updateMyAvatarRoute(
  options: RouteOptions,
  request: UpdateMyAvatarRequest,
): Promise<RouteResult<{ avatar_url: string }>> {
  const validation = validateUpdateMyAvatarRequest(request);

  if (!validation.ok) {
    return {
      ok: false,
      status: 400,
      body: {
        error: {
          code: validation.issues[0]?.code ?? "INVALID_IMAGE",
          message: validation.issues[0]?.message ?? "Invalid image upload request.",
          request_id: request.client_request_id,
        },
      },
    };
  }

  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  const ext = imageExtensionFromDataUrl(request.data_url) ?? "jpg";
  const base64 = request.data_url.slice(request.data_url.indexOf(",") + 1);
  const bytes = decodeBase64(base64);

  const image = await options.storage.uploadImage({
    pathPrefix: `avatars/${auth.context.user.id}`,
    ext,
    bytes,
    contentType: CONTENT_TYPE_BY_EXT[ext] ?? "image/jpeg",
  });

  const updated = await updateUserAvatar(options.client, auth.context.user.id, image.url);

  // Clean up the previous avatar once it's actually been replaced by a
  // different one - fire-and-forget, never blocks the response. Only
  // deletes URLs that resolve to a path in our bucket (a Google profile
  // picture or another foreign URL is left alone).
  if (updated.previousAvatarUrl && updated.previousAvatarUrl !== image.url) {
    const path = urlToStoragePath(updated.previousAvatarUrl);
    if (path) {
      options.storage.deleteImage(path).catch((error) => {
        console.warn(`Failed to delete orphaned storage object ${path}:`, error);
      });
    }
  }

  return { ok: true, status: 200, body: { avatar_url: updated.avatar_url } };
}
