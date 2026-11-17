// ─────────────────────────────────────────────
// 실시간 소식 받기 + 맨 위 연체 경고 띠
// ─────────────────────────────────────────────
// 서버의 /api/events 에 연결해 두고, 소식이 오면 handlers 에 등록된 함수를 부릅니다.

const liveHandlers = { change: [], 'overdue-new': [], 'equipment-finished': [], turn: [], 'admin-notice': [] };

// 소식 종류별로 할 일 등록: onLive('change', () => ...)
function onLive(type, fn) {
  liveHandlers[type].push(fn);
}

function connectLive() {
  const es = new EventSource('/api/events'); // 끊기면 브라우저가 알아서 다시 연결함
  for (const type of Object.keys(liveHandlers)) {
    es.addEventListener(type, (ev) => {
      let data = {};
      try { data = JSON.parse(ev.data); } catch (e) { /* 무시 */ }
      liveHandlers[type].forEach((fn) => fn(data));
    });
  }
  // 다시 연결되면 그동안 놓친 변화를 반영
  es.addEventListener('open', () => liveHandlers.change.forEach((fn) => fn({ reason: '다시 연결' })));
  return es;
}

// 맨 위 빨간 경고 띠 채우기 (6-4)
async function refreshAlertBar() {
  const bar = document.getElementById('alert-bar');
  if (!bar) return;
  try {
    const { overdue } = await api('/api/alerts');
    bar.replaceChildren(...overdue.map((o) => h('div', {}, '⚠ ' + o.text)));
  } catch (e) {
    bar.replaceChildren(h('div', {}, '⚠ 서버와 연결이 끊겼어요. 와이파이와 서버 컴퓨터를 확인해 주세요.'));
  }
}
