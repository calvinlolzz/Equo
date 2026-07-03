import React from "react";
import { createRoot } from "react-dom/client";
import "./app/App.css";
import { App } from "./app/App";

const root = document.getElementById("root");

if (!root) {
  throw new Error("MVP App Shell root element is missing");
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
