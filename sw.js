"use strict";

const CACHE_NAME = "unhappy-thumbnails-v1";

self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(
              key =>
                key.startsWith("unhappy-thumbnails-") &&
                key !== CACHE_NAME
            )
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isImageRequest(request) {
  if (request.method !== "GET") {
    return false;
  }

  if (request.destination === "image") {
    return true;
  }

  const accept = request.headers.get("accept") || "";

  return accept.includes("image/");
}

function isCacheableImageUrl(url) {
  if (!/^https?:$/.test(url.protocol)) {
    return false;
  }

  const path = url.pathname.toLowerCase();

  return (
    /\.(?:avif|gif|jpe?g|png|svg|webp)(?:$|\?)/i.test(path) ||
    /(?:image|thumbnail|poster|backdrop)/i.test(path)
  );
}

async function getCachedImage(cache, request) {
  return cache.match(request);
}

async function fetchAndCache(cache, request) {
  const response = await fetch(request);

  /*
   * Opaque responses are important here.
   * Many remote image hosts do not expose CORS headers.
   *
   * Do NOT call response.blob() on an opaque response.
   * Store the original response directly instead.
   */
  if (
    !response ||
    (!response.ok && response.type !== "opaque")
  ) {
    return response;
  }

  await cache.put(
    request,
    response.clone()
  );

  return response;
}

self.addEventListener("fetch", event => {
  const request = event.request;

  if (!isImageRequest(request)) {
    return;
  }

  let url;

  try {
    url = new URL(request.url);
  } catch (_) {
    return;
  }

  if (!isCacheableImageUrl(url)) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache =
        await caches.open(CACHE_NAME);

      /*
       * CACHE FIRST:
       *
       * cached image -> instant response
       * no cached image -> download + store
       */
      const cached =
        await getCachedImage(
          cache,
          request
        );

      if (cached) {
        return cached;
      }

      try {
        return await fetchAndCache(
          cache,
          request
        );
      } catch (error) {
        /*
         * Network failed. Try an older cached copy
         * before allowing the request to fail.
         */
        const stale =
          await cache.match(request);

        if (stale) {
          return stale;
        }

        throw error;
      }
    })()
  );
});
