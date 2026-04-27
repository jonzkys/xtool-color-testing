import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { installUserHeader } from "./api/userHeader";
import { initThemeEagerly } from "./ui";
import { initSentry } from "./sentry";

// Apply the persisted theme before React mounts so the first paint matches
// the user's preference (no light-mode flash on dark preference).
initThemeEagerly();
// Install the X-User-Id interceptor for multi-user deployments. No-op
// when localStorage doesn't contain a user id (standalone workflow).
installUserHeader();
// Sentry — fire-and-forget. No-op when VITE_SENTRY_DSN is unset; when
// set the SDK loads dynamically and starts capturing uncaught errors
// + unhandled promise rejections. Dispatched before React renders so
// boot-time crashes still get reported.
void initSentry();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
