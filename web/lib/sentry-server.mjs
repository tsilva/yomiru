import { waitUntil } from "@vercel/functions";
import { sentryOptions } from "./sentry-event.mjs";

const dsn = process.env.VERCEL_ENV === "production" && process.env.SENTRY_DSN;
let monitoring;

export function reportServerError(error, endpoint) {
  if (!dsn) return;

  monitoring ??= import("@sentry/node").then(sentry => {
    sentry.initWithoutDefaultIntegrations({
      ...sentryOptions,
      dsn,
      release: process.env.VERCEL_GIT_COMMIT_SHA,
    });
    return sentry;
  });

  waitUntil(monitoring.then(sentry => {
    sentry.captureException(error, { tags: { endpoint } });
    return sentry.flush(2000);
  }).catch(() => {
    // A monitoring failure must not change the API response.
  }));
}
