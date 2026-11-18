import { AwsClient } from "aws4fetch";
import { r2Origin } from "./storage-config.mjs";
import { readStorageResponse } from "./publication-io.mjs";

const immutable = "public, max-age=31536000, immutable";
export function createR2Store(environment = process.env, { fetcher = fetch } = {}) {
  const origin = r2Origin(environment);
  const { R2_ENDPOINT: endpoint, R2_BUCKET_NAME: bucket,
    R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey } = environment;
  if (!/^https:\/\/[a-f0-9]{32}(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com$/.test(endpoint)
    || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 storage configuration is missing");
  }
  const signer = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
  async function request(path, method, init) {
    if (!/^(?:library\/(?:snapshots\/)?|feedback-tracks\/v[1-9][0-9]*\/)[a-f0-9]{64}\.(?:ass|json|vocabulary\.json|registry\.json(?:\.gz)?)$/.test(path)) {
      throw new Error("Invalid R2 object path");
    }
    const signed = await signer.sign(`${endpoint}/${bucket}/${path}`, {
      ...init, method, redirect: "error", signal: AbortSignal.timeout(10000),
    });
    return fetcher(signed);
  }
  return {
    async read(path, limit) {
      return readStorageResponse(await request(path, "GET"), limit);
    },
    async head(path) {
      const response = await request(path, "HEAD");
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Could not read R2 metadata");
      const size = Number(response.headers.get("Content-Length"));
      if (!Number.isSafeInteger(size) || size < 1) throw new Error("Invalid R2 object size");
      return { size, url: `${origin}/${path}` };
    },
    async put(path, bytes, { contentType }) {
      const response = await request(path, "PUT", { body: bytes, headers: {
        "Content-Type": contentType, "Cache-Control": immutable, "If-None-Match": "*",
      } });
      if (response.status === 412) return false;
      if (!response.ok) throw new Error("Could not write R2 object");
      return true;
    },
  };
}
