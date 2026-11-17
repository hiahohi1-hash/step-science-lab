// ─────────────────────────────────────────────
// 서비스 워커 (알림 전용)
// ─────────────────────────────────────────────
// 안드로이드 크롬은 웹 페이지가 직접 알림을 띄우지 못하게 하고, 서비스 워커를 통해서만 띄우게 합니다.
// 이 파일은 알림을 눌렀을 때 현황판을 열어 주는 일만 합니다. (파일 저장·캐시 같은 일은 하지 않음)

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// 알림을 누르면 열려 있는 현황판으로 이동 (없으면 새로 열기)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = all.find((c) => new URL(c.url).pathname === '/status');
    if (open) return open.focus();
    return self.clients.openWindow('/status');
  })());
});
