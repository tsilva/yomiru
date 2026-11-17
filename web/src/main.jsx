import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { Compatibility } from "./Compatibility.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {location.pathname === "/compatibility" ? <Compatibility /> : <App />}
  </React.StrictMode>,
);
