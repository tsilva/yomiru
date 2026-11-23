export async function workflowRequest(audience, body) {
  const issuerURL = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  const token = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (issuerURL.protocol !== "https:" || !issuerURL.hostname.endsWith(".actions.githubusercontent.com")
    || issuerURL.username || issuerURL.password || !token) throw new Error("GitHub OIDC is unavailable");
  issuerURL.searchParams.set("audience", audience);
  const identity = await fetch(issuerURL, { headers: { Authorization: `Bearer ${token}` },
    redirect: "error", signal: AbortSignal.timeout(10000) });
  if (!identity.ok) throw new Error("GitHub rejected the OIDC request");
  const { value } = await identity.json();
  if (typeof value !== "string" || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) {
    throw new Error("GitHub did not issue a workflow identity");
  }
  const result = await fetch(audience, { method: "POST", body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${value}`, "Content-Type": "application/json" },
    redirect: "error", signal: AbortSignal.timeout(65000) });
  if (!result.ok) throw new Error(`Production rejected ${body.action} (${result.status})`);
  return result.json();
}
