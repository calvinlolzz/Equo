import type { ErrorCode } from "../../contracts/errors.js";
import type { HttpRuntimeResponse } from "./httpTypes.js";

export function jsonResponse(status: number, body: unknown): HttpRuntimeResponse {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body,
  };
}

export function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  request_id = "req_unknown",
): HttpRuntimeResponse {
  return jsonResponse(status, {
    error: {
      code,
      message,
      request_id,
    },
  });
}
