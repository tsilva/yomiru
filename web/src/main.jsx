import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { Compatibility } from "./Compatibility.jsx";
import { PortraitGuard } from "./PortraitGuard.jsx";
import { AnalyticsSettings } from "./AnalyticsSettings.jsx";
import { publicMeasurementId } from "./analytics.mjs";
import { browserErrorHandlers } from "./sentry-browser.mjs";
import "./styles.css";

const production = import.meta.env.PROD && location.hostname === "yomiru.tsilva.eu";
const measurementId = production && publicMeasurementId(import.meta.env.VITE_GA_MEASUREMENT_ID, location);
const errorHandlers = production
  ? browserErrorHandlers(import.meta.env.VITE_SENTRY_DSN, import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA)
  : undefined;

createRoot(document.getElementById("root"), errorHandlers).render(
  <React.StrictMode>
    {location.pathname === "/compatibility" ? <Compatibility /> : <App />}
    {measurementId && <AnalyticsSettings measurementId={measurementId} />}
    <PortraitGuard />
  </React.StrictMode>,
);
