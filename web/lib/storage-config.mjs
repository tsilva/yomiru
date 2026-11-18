export function databaseEnabled(environment = process.env) {
  return Boolean(environment.DATABASE_URL || environment.PUBLIC_R2_ORIGIN);
}

export function r2Origin(environment = process.env) {
  const url = new URL(environment.PUBLIC_R2_ORIGIN);
  if (url.protocol !== "https:" || url.origin !== environment.PUBLIC_R2_ORIGIN
    || !environment.DATABASE_URL) throw new Error("Incomplete R2 and database configuration");
  return url.origin;
}
