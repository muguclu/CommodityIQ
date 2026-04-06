/* CommodityIQ — Signal Notification Service Worker */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  if (event.data?.type === "SIGNAL_NOTIFICATION") {
    const { title, body, tag } = event.data;
    self.registration.showNotification(title, {
      body,
      tag,
      icon:   "/favicon.ico",
      badge:  "/favicon.ico",
      silent: false,
    });
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      const existing = clients.find((c) => c.url.includes("/signals"));
      if (existing) return existing.focus();
      return self.clients.openWindow("/signals");
    })
  );
});
