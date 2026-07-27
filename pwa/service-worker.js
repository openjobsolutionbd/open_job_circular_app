// ==========================================================
// service-worker.js
// ==========================================================
// এই ফাইলটা ব্রাউজারের ব্যাকগ্রাউন্ডে চলে (পেজ বন্ধ থাকলেও)।
// এর দুটো কাজ:
//   ১. পুশ নোটিফিকেশন এলে সেটা দেখানো
//   ২. PWA-টাকে "ইনস্টলযোগ্য" বানানো
// ==========================================================

const CACHE_NAME = "chakri-khobor-v1";
const CORE_FILES = ["/", "/index.html", "/style.css", "/app.js", "/chat.js", "/pdf-viewer.js", "/sites.js", "/manifest.json"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_FILES).catch(() => {}))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// নেটওয়ার্ক না থাকলেও অন্তত মূল পেজটা যেন খোলা যায়, তার জন্য ছোট্ট একটা
// ক্যাশ-ব্যবস্থা (এটা মূল ফিচার না, শুধু একটা বাড়তি সুবিধা)
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// আসল কাজ — পুশ নোটিফিকেশন এলে সেটা দেখানো
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "চাকরির খবর", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "চাকরির খবর — রিমাইন্ডার";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// নোটিফিকেশনে ক্লিক করলে অ্যাপটা খুলে যাবে
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});
