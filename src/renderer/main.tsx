import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "bootstrap/dist/css/bootstrap.min.css";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Suspense boundary required for use(settingsLoaderPromise) in App.tsx.
        The fallback is intentionally minimal — the app loads fast on Electron. */}
    <Suspense fallback={<div className="app" />}>
      <App />
    </Suspense>
  </React.StrictMode>,
);
