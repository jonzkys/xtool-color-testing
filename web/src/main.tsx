import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { installUserHeader } from "./api/userHeader";
import { initThemeEagerly } from "./ui";

// Apply the persisted theme before React mounts so the first paint matches
// the user's preference (no light-mode flash on dark preference).
initThemeEagerly();
// Install the X-User-Id interceptor for multi-user deployments. No-op
// when localStorage doesn't contain a user id (standalone workflow).
installUserHeader();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
