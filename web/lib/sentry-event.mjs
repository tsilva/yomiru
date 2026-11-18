export function errorEvent(event) {
  const exceptions = event.exception?.values;
  if (!exceptions?.length) return null;

  // Keep error types and frames for grouping. Messages can contain provider
  // URLs, vote identifiers, or database values.
  return {
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: event.platform,
    environment: event.environment,
    release: event.release,
    sdk: event.sdk,
    tags: { endpoint: event.tags?.endpoint },
    exception: {
      values: exceptions.map(({ type, mechanism, stacktrace }) => ({
        type,
        ...(mechanism && { mechanism: { type: mechanism.type, handled: mechanism.handled } }),
        ...(stacktrace?.frames && {
          stacktrace: {
            frames: stacktrace.frames.map(frame => ({
              filename: frame.filename?.split(/[?#]/, 1)[0],
              function: frame.function,
              lineno: frame.lineno,
              colno: frame.colno,
              in_app: frame.in_app,
            })),
          },
        }),
      })),
    },
  };
}

export const sentryOptions = {
  environment: "production",
  sendDefaultPii: false,
  sendClientReports: false,
  debug: false,
  tracesSampleRate: 0,
  beforeSend: errorEvent,
};
