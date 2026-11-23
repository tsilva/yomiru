import { createPublicKey, verify } from "node:crypto";

const issuer = "https://token.actions.githubusercontent.com";
export const cleanupAudience = "https://yomiru.tsilva.eu/api/subtitle-cleanup";
const branch = "refs/heads/main";
const repository = "tsilva/yomiru";
const claimsRequired = {
  iss: issuer, aud: cleanupAudience, repository, repository_id: "1462854175",
  repository_owner_id: "26742", actor_id: "26742", ref: branch,
  workflow_ref: `${repository}/.github/workflows/subtitle-cleanup.yml@${branch}`,
  event_name: "workflow_dispatch", environment: "Production", runner_environment: "github-hosted",
};

const decode = part => JSON.parse(Buffer.from(part, "base64url"));

export async function authorizedCleanupIdentity(authorization, { fetcher = fetch, now = Date.now } = {}) {
  if (typeof authorization !== "string" || authorization.length > 12288) return false;
  const parts = /^Bearer ([\w-]+)\.([\w-]+)\.([\w-]+)$/.exec(authorization);
  if (!parts) return false;
  const [, encodedHeader, encodedPayload, signature] = parts;
  let header, claims;
  try {
    header = decode(encodedHeader);
    claims = decode(encodedPayload);
  } catch { return false; }
  if (header?.alg !== "RS256" || header.crit !== undefined || typeof header.kid !== "string"
    || !Object.entries(claimsRequired).every(([name, value]) => claims?.[name] === value)
    || !/^[a-f0-9]{40}$/.test(claims.sha) || claims.workflow_sha !== claims.sha) return false;

  const seconds = now() / 1000;
  const { exp, nbf, iat } = claims;
  if (![exp, nbf, iat].every(Number.isInteger) || nbf > seconds + 30 || iat > seconds + 30
    || exp <= seconds || exp <= iat || exp - iat > 600) return false;

  const response = await fetcher(`${issuer}/.well-known/jwks`, {
    redirect: "error", signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("GitHub signing keys are unavailable");
  const { keys } = await response.json();
  const jwk = keys.find(key => key.kid === header.kid && key.kty === "RSA" && key.alg === "RS256"
    && key.use === "sig");
  return Boolean(jwk && verify("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedPayload}`),
    createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(signature, "base64url")));
}
