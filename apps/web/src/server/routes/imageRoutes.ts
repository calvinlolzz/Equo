import type { UploadGroupImageRequest } from "../../contracts/schemas.js";
import { imageExtensionFromDataUrl, validateUploadGroupImageRequest } from "../../contracts/validation.js";
import { verifyGoogleIdToken, type GoogleTokenVerifier } from "../auth/google.js";
import { requireAuthenticatedUser } from "../auth/session.js";
import {
  createSupabaseGroupRepository,
  type SupabaseQueryClient,
  upsertUserByGoogleIdentity,
} from "../repositories/supabaseGroupRepository.js";
import type { SupabaseStorageClient } from "../runtime/supabaseStorageClient.js";

type RouteOptions = {
  client: SupabaseQueryClient;
  storage: SupabaseStorageClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
};

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function decodeBase64(base64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

async function buildImageRouteContext(options: RouteOptions) {
  const identity = await verifyGoogleIdToken(options.idToken, options.verifier);
  return requireAuthenticatedUser(identity, (googleIdentity) =>
    upsertUserByGoogleIdentity(options.client, googleIdentity),
  );
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

  const auth = await buildImageRouteContext(options);

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
    groupId,
    ext,
    bytes,
    contentType: CONTENT_TYPE_BY_EXT[ext] ?? "image/jpeg",
  });

  return { ok: true, status: 201, body: { image } };
}
