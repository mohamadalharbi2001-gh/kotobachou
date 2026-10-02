import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function () { /* the app works fine without it */ });
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
