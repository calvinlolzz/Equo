import { handleV1Request } from "../../../../vercel-api/v1Handler.js";

export default async function handler(request: Parameters<typeof handleV1Request>[0], response: Parameters<typeof handleV1Request>[1]) {
  return handleV1Request(request, response);
}
