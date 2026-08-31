import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StatusApp } from "./status-app";
import "./styles.css";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Root element is missing");
}

createRoot(rootElement).render(
  <StrictMode>
    <StatusApp />
  </StrictMode>,
);
