import assert from "node:assert/strict";
import test from "node:test";
import * as sentry from "@sentry/node";
import { sentryOptions } from "../lib/sentry-event.mjs";
import { googleAnalytics, publicMeasurementId } from "../src/analytics.mjs";

test("GA4 only enables a valid tag on the homepage without query parameters", () => {
  assert.equal(publicMeasurementId("G-TEST123", new URL("https://example.com/#library")), "G-TEST123");
  assert.equal(publicMeasurementId("G-TEST123", new URL("https://example.com/compatibility?feedback=private")), null);
  assert.equal(publicMeasurementId("G-TEST123", new URL("https://example.com/?search=private")), null);
  assert.equal(publicMeasurementId("G-TEST123&other=value", new URL("https://example.com/")), null);
});

test("GA4 loads once after opt-in and honors withdrawal on the same page", () => {
  const scripts = [];
  const browser = {
    location: new URL("https://example.com/#library"),
    document: {
      createElement: () => ({}),
      head: { append: script => scripts.push(script) },
    },
  };
  const consent = googleAnalytics("G-TEST123", browser);
  consent(false);
  assert.equal(browser.dataLayer, undefined);
  assert.equal(scripts.length, 0);
  consent(true);
  assert.equal(browser["ga-disable-G-TEST123"], false);
  assert.equal(scripts[0].referrerPolicy, "no-referrer");
  assert.equal(scripts[0].src, "https://www.googletagmanager.com/gtag/js?id=G-TEST123");
  const calls = browser.dataLayer.map(args => [...args]);
  assert.equal(calls[0][2].analytics_storage, "denied");
  assert.equal(calls[1][2].analytics_storage, "granted");
  assert.equal(calls[1][2].ad_storage, "denied");
  assert.equal(calls[3][2].page_location, "https://example.com/");
  assert.equal(calls[3][2].allow_google_signals, false);

  consent(false);
  assert.equal(browser["ga-disable-G-TEST123"], true);
  assert.equal(browser.dataLayer.at(-1)[2].analytics_storage, "denied");
  consent(true);
  assert.equal(browser["ga-disable-G-TEST123"], false);
  assert.equal(scripts.length, 1);
});

test("the Sentry SDK envelope keeps stack frames and omits sensitive context", async () => {
  const envelopes = [];
  sentry.initWithoutDefaultIntegrations({
    ...sentryOptions,
    dsn: "https://synthetic@example.com/1",
    transport: () => ({
      send: async envelope => { envelopes.push(envelope); return { statusCode: 200 }; },
      flush: async () => true,
    }),
  });
  sentry.withScope(scope => {
    scope.setUser({ email: "private@example.com" });
    scope.addBreadcrumb({ message: "private breadcrumb" });
    sentry.captureEvent({
      request: { url: "https://example.com/?feedback=private" },
      tags: { endpoint: "browse" },
      exception: { values: [{
        type: "Error",
        value: "private error",
        stacktrace: { frames: [{
          filename: "https://example.com/assets/index.js?private",
          function: "browse",
          lineno: 4,
          vars: { search: "private" },
        }] },
      }] },
    });
  });
  await sentry.close(1000);
  const [[, [[, event]]]] = envelopes;
  assert.ok(!JSON.stringify(envelopes).includes("private"));
  assert.equal(event.tags.endpoint, "browse");
  assert.equal(event.exception.values[0].stacktrace.frames[0].filename, "https://example.com/assets/index.js");
  assert.equal(event.exception.values[0].stacktrace.frames[0].lineno, 4);
});
