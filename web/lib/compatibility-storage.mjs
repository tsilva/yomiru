import { get, put, BlobError, BlobPreconditionFailedError } from "@vercel/blob";
import { createCompatibilityStore, maxStateBytes } from "./compatibility.mjs";
import { createDatabaseCompatibility } from "./database-feedback.mjs";
import { database } from "./database.mjs";
import { databaseEnabled } from "./storage-config.mjs";

function options(signal) {
  const storeId = process.env.COMPATIBILITY_STORE_ID;
  if (!storeId || process.env.VERCEL_ENV !== "production") throw new Error("Compatibility storage unavailable");
  const timeout = AbortSignal.timeout(8000);
  return { access: "private", storeId, abortSignal: signal ? AbortSignal.any([signal, timeout]) : timeout };
}

export const privateBlobIO = {
  async read(pathname, signal) {
    const result = await get(pathname, { ...options(signal), useCache: false });
    if (!result) return null;
    const parts = [];
    let size = 0;
    for await (const chunk of result.stream) {
      size += chunk.length;
      if (size > maxStateBytes) throw new Error("Compatibility state exceeds limit");
      parts.push(chunk);
    }
    return { state: JSON.parse(Buffer.concat(parts)), etag: result.blob.etag };
  },
  async write(pathname, state, etag, signal) {
    try {
      await put(pathname, JSON.stringify(state), { ...options(signal), addRandomSuffix: false,
        contentType: "application/json", cacheControlMaxAge: 60, allowOverwrite: Boolean(etag),
        ...(etag ? { ifMatch: etag } : {}),
      });
      return true;
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError
        || (error instanceof BlobError && /already exists/i.test(error.message))) return false;
      throw error;
    }
  },
};

const legacyStore = createCompatibilityStore(privateBlobIO);
const activeStore = () => databaseEnabled() ? createDatabaseCompatibility(database()) : legacyStore;
export const compatibilityStore = {
  get: (...args) => activeStore().get(...args),
  observe: (group, ...args) => process.env.YOMIRU_PAUSE_FEEDBACK === "1"
    ? activeStore().get(group) : activeStore().observe(group, ...args),
  vote: (...args) => {
    if (process.env.YOMIRU_PAUSE_FEEDBACK === "1") throw new Error("Feedback temporarily read-only");
    return activeStore().vote(...args);
  },
};
