import { sentryOptions } from "../lib/sentry-event.mjs";

export function browserErrorHandlers(dsn, release) {
  if (!dsn) return undefined;

  const monitoring = import("@sentry/react").then(({
    init, globalHandlersIntegration, dedupeIntegration, reactErrorHandler,
  }) => {
    init({
      ...sentryOptions,
      dsn,
      release,
      defaultIntegrations: false,
      integrations: [globalHandlersIntegration(), dedupeIntegration()],
    });
    return reactErrorHandler();
  }).catch(() => undefined);

  function report(error, errorInfo) {
    console.error(error);
    void monitoring.then(capture => capture?.(error, errorInfo));
  }

  return { onUncaughtError: report, onCaughtError: report };
}
