import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// index.html starts with the branded launch background so Android never
// flashes a white canvas between the native splash and the first React paint.
window.requestAnimationFrame(() => {
  document.body.style.removeProperty("background-color")
})

// Keep the installed PWA on the same production release as the browser app.
// A new service worker takes control immediately (skipWaiting + clients.claim
// in /sw.js); when that happens to an already-installed app, reload once so
// the running JS bundle cannot remain on an older release.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  let reloadingForUpdate = false;
  const hadControllerAtBoot = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadControllerAtBoot || reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((registration) => {
      void registration.update();

      // Installed PWAs can stay open for days. Re-check after returning to
      // the app and periodically while it remains open.
      const checkForUpdate = () => {
        if (document.visibilityState === "visible") void registration.update();
      };
      document.addEventListener("visibilitychange", checkForUpdate);
      window.addEventListener("online", checkForUpdate);
      window.setInterval(checkForUpdate, 60 * 60 * 1000);
    }).catch((error) => {
      console.warn("StabiFlow service worker registration failed", error);
    });
  });
}
