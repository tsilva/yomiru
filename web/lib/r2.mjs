import { AwsClient } from "aws4fetch";
import { r2Origin } from "./storage-config.mjs";
import { readStorageResponse } from "./publication-io.mjs";
import { sourceArchiveObject } from "./source-archive.mjs";
import { canonicalSubtitleKey } from "./subtitle-cleanup.mjs";

const immutable = "public, max-age=31536000, immutable";
const publicObject = path => /^library\/[a-f0-9]{64}\.webp$/.test(path)
  || /^(?:library\/(?:snapshots\/)?|feedback-tracks\/v[1-9][0-9]*\/)[a-f0-9]{64}\.(?:ass|json|vocabulary\.json|registry\.json(?:\.gz)?)$/.test(path);
const publicSubtitle = path => /^(?:library\/|feedback-tracks\/v[1-9][0-9]*\/)[a-f0-9]{64}\.ass$/.test(path);
const legacyPlaybackSubtitle = path => path.startsWith("feedback-tracks/") && publicSubtitle(path);
export const archiveReadinessPath = "health/archive-v1.txt";

function signedStore({ endpoint, bucket, accessKeyId, secretAccessKey, origin, allowed, cacheControl }, fetcher) {
  if (!/^https:\/\/[a-f0-9]{32}(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com$/.test(endpoint)
    || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 storage configuration is missing");
  }
  const signer = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
  async function listObjects(params) {
    const url = new URL(`${endpoint}/${bucket}`);
    url.search = new URLSearchParams({ "list-type": "2", "encoding-type": "url", ...params }).toString();
    const signed = await signer.sign(url.toString(), { redirect: "error", signal: AbortSignal.timeout(10000) });
    const response = await readStorageResponse(await fetcher(signed), 512 * 1024);
    return response?.bytes.toString("utf8") ?? "";
  }
  async function request(path, method, init) {
    if (!allowed(path)) throw new Error("Invalid R2 object path");
    const signed = await signer.sign(`${endpoint}/${bucket}/${path}`, {
      ...init, method, redirect: "error", signal: AbortSignal.timeout(10000),
    });
    return fetcher(signed);
  }
  return {
    async read(path, limit) {
      return readStorageResponse(await request(path, "GET"), limit);
    },
    async head(path, { modified: includeModified = false, encoding: includeEncoding = false } = {}) {
      const response = await request(path, "HEAD");
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Could not read R2 metadata");
      const size = Number(response.headers.get("Content-Length"));
      if (!response.headers.has("Content-Length") || !Number.isSafeInteger(size) || size < (includeModified ? 0 : 1)) {
        throw new Error("Invalid R2 object size");
      }
      const modified = includeModified ? Date.parse(response.headers.get("Last-Modified")) : undefined;
      if (includeModified && !Number.isFinite(modified)) throw new Error("Invalid R2 object modification time");
      return { size, ...(includeModified && { modified }),
        ...(includeEncoding && { encoding: response.headers.get("Content-Encoding"),
          decodedSha256: response.headers.get("x-amz-meta-ass-sha256") }),
        ...(origin && { url: `${origin}/${path}` }) };
    },
    async put(path, bytes, { contentType, contentEncoding, decodedSha256 }) {
      const response = await request(path, "PUT", { body: bytes, headers: {
        "Content-Type": contentType, "Cache-Control": cacheControl, "If-None-Match": "*",
        ...(contentEncoding && { "Content-Encoding": contentEncoding }),
        ...(decodedSha256 && { "x-amz-meta-ass-sha256": decodedSha256 }),
      } });
      if (response.status === 412) return false;
      if (!response.ok) throw new Error("Could not write R2 object");
      return true;
    },
    ...(origin && {
      async subtitlePage(after) {
        if (after !== undefined && (typeof after !== "string" || !after.startsWith("library/")
          || Buffer.byteLength(after) > 1024)) throw new Error("Invalid R2 library cursor");
        const max = 200;
        const xml = await listObjects({ prefix: "library/", "max-keys": String(max),
          ...(after && { "start-after": after }) });
        const contents = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, entry]) => entry);
        const keys = contents.map(entry => decodeURIComponent(entry.match(/<Key>([^<]+)<\/Key>/)?.[1] ?? ""));
        const count = Number(xml.match(/<KeyCount>(\d+)<\/KeyCount>/)?.[1]);
        const truncated = xml.match(/<IsTruncated>(true|false)<\/IsTruncated>/)?.[1];
        if (!xml.includes("<ListBucketResult") || !xml.includes("</ListBucketResult>") || count !== keys.length
          || count > max || !truncated || (!count && truncated === "true")
          || keys.some(key => !key.startsWith("library/") || key === after) || new Set(keys).size !== count) {
          throw new Error("Invalid R2 library listing");
        }
        const objects = contents.flatMap((entry, i) => {
          const key = keys[i];
          if (!canonicalSubtitleKey.test(key)) return [];
          const bytes = Number(entry.match(/<Size>(\d+)<\/Size>/)?.[1]);
          const modified = Date.parse(entry.match(/<LastModified>([^<]+)<\/LastModified>/)?.[1]);
          if (!Number.isSafeInteger(bytes) || !Number.isFinite(modified)) throw new Error("Invalid R2 subtitle metadata");
          return [{ key, bytes, modified }];
        });
        return { objects, next: truncated === "true" ? keys.at(-1) : null };
      },
      async legacyPlaybackKeys() {
        const xml = await listObjects({ prefix: "feedback-tracks/", "max-keys": "24" });
        const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(([, key]) => decodeURIComponent(key));
        const count = Number(xml.match(/<KeyCount>(\d+)<\/KeyCount>/)?.[1]);
        if (!xml.includes("<ListBucketResult") || !xml.includes("</ListBucketResult>") || count !== keys.length
          || count > 24 || keys.some(key => !legacyPlaybackSubtitle(key))
          || (!count && !xml.includes("<IsTruncated>false</IsTruncated>"))) {
          throw new Error("Invalid R2 legacy subtitle listing");
        }
        return keys;
      },
      async deleteSubtitle(path) {
        if (!publicSubtitle(path)) throw new Error("Only public subtitle files may be removed");
        const response = await request(path, "DELETE");
        if (!response.ok) throw new Error("Could not remove R2 subtitle");
        if (await this.head(path)) throw new Error("R2 subtitle still exists");
      },
    }),
  };
}

export function createR2Store(environment = process.env, { fetcher = fetch } = {}) {
  const origin = r2Origin(environment);
  const { R2_ENDPOINT: endpoint, R2_BUCKET_NAME: bucket,
    R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey } = environment;
  return signedStore({ endpoint, bucket, accessKeyId, secretAccessKey, origin,
    allowed: publicObject, cacheControl: immutable }, fetcher);
}

export function createPrivateSourceStore(environment = process.env, { fetcher = fetch } = {}) {
  const { SOURCE_ARCHIVE_R2_ENDPOINT: endpoint, SOURCE_ARCHIVE_R2_BUCKET_NAME: bucket,
    SOURCE_ARCHIVE_R2_ACCESS_KEY_ID: accessKeyId, SOURCE_ARCHIVE_R2_SECRET_ACCESS_KEY: secretAccessKey } = environment;
  if (!environment.R2_BUCKET_NAME || bucket === environment.R2_BUCKET_NAME) {
    throw new Error("Source archive requires a separate private R2 bucket");
  }
  return signedStore({ endpoint, bucket, accessKeyId, secretAccessKey,
    allowed: path => path === archiveReadinessPath || sourceArchiveObject(path), cacheControl: "private, no-store" }, fetcher);
}
