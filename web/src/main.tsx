import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initThemeEagerly } from "./ui";

// Apply the persisted theme before React mounts so the first paint matches
// the user's preference (no light-mode flash on dark preference).
initThemeEagerly();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
