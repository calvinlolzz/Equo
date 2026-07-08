import React from "react";
import { createRoot } from "react-dom/client";
import "./app/App.css";
import { App } from "./app/App";
import { GlassBackground } from "./app/GlassBackground";

const root = document.getElementById("root");

if (!root) {
  throw new Error("MVP App Shell root element is missing");
}

createRoot(root).render(
  <React.StrictMode>
    <GlassBackground />
    <App />
  </React.StrictMode>,
);

// Register the PWA service worker in production builds only, after the page
// has finished loading so it never competes with the initial render/fetch.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.debug("[sw] registration failed", error);
    });
  });
}
