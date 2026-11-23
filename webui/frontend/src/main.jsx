import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import "./index.css";
import "./i18n.js"; // Import i18n configuration

if (
  typeof document !== "undefined" &&
  ((typeof navigator !== "undefined" && /Firefox\//i.test(navigator.userAgent)) ||
    (typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("-moz-appearance", "none")))
) {
  document.documentElement.classList.add("is-firefox");
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
