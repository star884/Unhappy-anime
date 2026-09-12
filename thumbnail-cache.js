"use strict";

(() => {
  const CONFIG = Object.freeze({
    cacheName: "unhappy-thumbnails-v1",
    serviceWorkerUrl: "./sw.js"
  });

  async function register() {
    if (!("serviceWorker" in navigator)) {
      return null;
    }

    /*
     * Service Workers require a secure context.
     * localhost is allowed during development.
     */
    if (
      !window.isSecureContext &&
      location.hostname !== "localhost" &&
      location.hostname !== "127.0.0.1"
    ) {
      return null;
    }

    try {
      const registration =
        await navigator.serviceWorker.register(
          CONFIG.serviceWorkerUrl,
          {
            scope: "./"
          }
        );

      /*
       * Check for a newer worker whenever the site loads.
       */
      if (typeof registration.update === "function") {
        registration.update().catch(() => {});
      }

      return registration;
    } catch (error) {
      console.warn(
        "UNHAPPY thumbnail cache unavailable:",
        error
      );

      return null;
    }
  }

  async function clear() {
    if (!("caches" in window)) {
      return false;
    }

    return caches.delete(
      CONFIG.cacheName
    );
  }

  async function size() {
    if (!("caches" in window)) {
      return 0;
    }

    const cache =
      await caches.open(
        CONFIG.cacheName
      );

    const requests =
      await cache.keys();

    return requests.length;
  }

  window.UnhappyThumbnailCache =
    Object.freeze({
      register,
      clear,
      size
    });

  register();
})();
