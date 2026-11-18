export const analyticsStorageKey = "yomiru-analytics-v1";

export function publicMeasurementId(value, location) {
  if (!/^G-[A-Z0-9]+$/.test(value ?? "")) return null;
  // Episode and feedback parameters are used on the compatibility page.
  if (location.pathname !== "/" || location.search) return null;
  return value;
}

const denied = {
  analytics_storage: "denied",
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
};

export function googleAnalytics(measurementId, browser = window) {
  let initialized = false;
  const granted = { ...denied, analytics_storage: "granted" };

  return function setConsent(allowed) {
    browser[`ga-disable-${measurementId}`] = !allowed;
    if (initialized) {
      browser.gtag("consent", "update", allowed ? granted : denied);
      return;
    }
    if (!allowed) return;

    initialized = true;
    browser.dataLayer ??= [];
    browser.gtag = function () { browser.dataLayer.push(arguments); };
    browser.gtag("consent", "default", denied);
    browser.gtag("consent", "update", granted);
    browser.gtag("js", new Date());
    browser.gtag("config", measurementId, {
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location: `${browser.location.origin}/`,
      page_referrer: "",
    });

    const script = browser.document.createElement("script");
    script.async = true;
    script.referrerPolicy = "no-referrer";
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    browser.document.head.append(script);
  };
}
