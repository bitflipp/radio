// Offline support. The app shell and /api/media are served network-first, so the cached copies only matter when
// the network is gone. Audio files are only ever cached explicitly by the page (into AUDIO_CACHE); here they are
// served from there, including the Range requests <audio> uses for seeking, which the Cache API can't answer itself.
const SHELL_CACHE = "radio-shell";
const AUDIO_CACHE = "radio-audio";
const SHELL_FILES = ["/", "/index.css", "/index.js", "/vue.js", "/favicon.svg", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/api/media"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== AUDIO_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }
  if (url.pathname.startsWith("/media/")) {
    event.respondWith(serveAudio(request, url));
  } else {
    event.respondWith(networkFirst(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) {
      return cached;
    }
    throw err;
  }
}

async function serveAudio(request, url) {
  // The page adds ?revalidate to ask the server about a saved track, bypassing the cache.
  if (url.searchParams.has("revalidate")) {
    return fetch(request);
  }
  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(url.pathname);
  if (!cached) {
    return fetch(request);
  }
  const range = request.headers.get("Range");
  if (!range) {
    return cached;
  }
  const blob = await cached.blob();
  const size = blob.size;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  let start, end;
  if (match && match[1] !== "") {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  } else if (match && match[2] !== "") {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  }
  if (start === undefined || start > end) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": cached.headers.get("Content-Type") || "audio/mpeg",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}
