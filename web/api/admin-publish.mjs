import { head, put, BlobNotFoundError } from "@vercel/blob";
import { protectedAdminHost, writePublicationObject } from "../lib/admin-publication.mjs";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (!protectedAdminHost(request)) return response.status(404).end();
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).end();
  }
  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    const result = await writePublicationObject(body, {
      head: async pathname => {
        try { return await head(pathname); }
        catch (error) { if (error instanceof BlobNotFoundError) return null; throw error; }
      },
      put,
    });
    return response.status(200).json(result);
  } catch {
    // Neither credentials nor provider diagnostics are returned to callers.
    return response.status(409).json({ error: "Publication rejected; check object integrity and current revision" });
  }
}
