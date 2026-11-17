// ─────────────────────────────────────────────
// 기구 현황판 (/status, 7-5) — 학생이 휴대폰으로 보는 화면
// ─────────────────────────────────────────────
// - 모든 기구를 카드로: 이름, 상태 색깔, 남은 시간(1분마다 줄어듦), 대기 인원
// - 학번은 뒤 두 자리를 가림 (서버가 가려서 보내 줌)
// - 예약 대기 중인 학생이 학번을 넣고 알림을 허용하면, 내 차례가 됐을 때 알림

const cardsEl = document.getElementById('cards');
const myBox = document.getElementById('my-box');
let units = [];            // 서버에서 받은 기구 목록
let clockOffset = 0;       // 서버 시각 − 휴대폰 시각 (휴대폰 시계가 틀려도 남은 시간이 맞게)
// 13단계: 보고 있는 실험실 (주소 ?lab=번호 로 시작 가능, 없으면 전체)
let statusLab = (() => { const v = new URLSearchParams(location.search).get('lab'); return /^\d+$/.test(v || '') ? Number(v) : null; })();
const STORE_KEY = 'lab-status-student-id';
const notifiedTurns = new Set(); // 이미 알림을 보낸 차례 (같은 알림 반복 방지)

// localStorage 는 개인정보 보호 모드 등에서 막힐 수 있어서 항상 try 로 감쌈
const store = {
  get() { try { return localStorage.getItem(STORE_KEY) || ''; } catch (e) { return ''; } },
  set(v) { try { v ? localStorage.setItem(STORE_KEY, v) : localStorage.removeItem(STORE_KEY); } catch (e) { /* 무시 */ } },
};
let myId = store.get();

// 상자 내용 바꾸기 (비어 있는 null 칸은 빼고)
const fill = (el, ...nodes) => el.replaceChildren(...nodes.flat().filter(Boolean));
const serverNow = () => Date.now() + clockOffset;
const minutesUntil = (iso) => Math.max(0, Math.ceil((new Date(iso).getTime() - serverNow()) / 60000));

// ═════════════════ 기구 카드 ═════════════════
async function loadCards() {
  try {
    const data = await api('/api/equipment' + (statusLab ? '?lab=' + statusLab : ''));
    clockOffset = new Date(data.serverTime).getTime() - Date.now();
    units = data.groups.flatMap((g) => g.units).filter((u) => !u.isGuide); // 안내 전용 기구는 현황판에 안 나옴
    // 대기 기능이 꺼져 있으면 "내 차례 알림 받기" 상자를 숨김
    const anyUnit = data.groups.flatMap((g) => g.units)[0];
    myBox.style.display = anyUnit && anyUnit.queueEnabled === false ? 'none' : '';
    renderCards();
    document.getElementById('updated').textContent = '마지막 갱신: ' + new Date(serverNow()).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' });
  } catch (err) {
    cardsEl.replaceChildren(errorBox(err));
  }
}

// 카드 그리기 (서버에 다시 묻지 않고 남은 시간만 새로 계산할 때도 부름)
function renderCards() {
  if (!units.length) {
    cardsEl.replaceChildren(h('p', { class: 'muted' }, '이 실험실에 등록된 기구가 아직 없어요.'));
    return;
  }
  cardsEl.replaceChildren(...units.map((u) => {
    const lines = [];
    if (u.current) {
      const left = minutesUntil(u.current.endsAt);
      lines.push(h('div', { class: 'remain' }, `${durationText(left)} 남음`));
      lines.push(h('div', { class: 'muted' }, `${u.current.endsText} 종료 예정 · 사용자 ${u.current.student}`));
      if (left <= u.endingSoonMinutes) lines.push(h('div', { class: 'badge warn' }, `곧 사용 가능 (${left}분 남음)`));
    }
    if (u.turn) {
      lines.push(h('div', {}, `대기 1번 학번 ${u.turn.student} 우선 사용 (${minutesUntil(u.turn.deadlineAt)}분 남음)`));
    }
    if (u.waitingCount) lines.push(h('div', {}, `대기 ${u.waitingCount}명`));
    if (u.status === '사용 가능' && !u.waitingCount) lines.push(h('div', { class: 'muted' }, '바로 사용할 수 있어요'));
    if (u.justFinishedUntil && new Date(u.justFinishedUntil).getTime() > serverNow()) {
      lines.push(h('div', { class: 'notice' }, '방금 사용이 끝났습니다. 안에 이전 사용자의 물건이 남아 있을 수 있으니 확인하세요'));
    }
    return h('article', { class: 'status-card s-' + (STATUS_CLASS[u.status] || '') },
      u.photoUrl ? h('img', { src: u.photoUrl, alt: '', class: 'status-photo', loading: 'lazy' }) : null,
      h('div', { class: 'status-card-head' }, h('strong', {}, u.displayName), statusBadge(u.status)),
      h('div', { class: 'muted small' }, [statusLab ? '' : u.labName, u.location].filter(Boolean).join(' · ')),
      ...lines);
  }));
}

// ═════════════════ 내 차례 알림 (7-5) ═════════════════
function renderMyBox(items, message) {
  if (!myId) {
    const sid = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: 10, placeholder: '대기 등록한 학번 (예: 20315)' });
    const msg = h('div');
    myBox.replaceChildren(
      h('strong', {}, '🔔 내 차례 알림 받기'),
      h('p', { class: 'muted small' }, '기구에 대기 등록을 했다면 학번을 넣어 두세요. 차례가 되면 알려 드려요. 학번은 이 휴대폰에만 저장돼요.'),
      h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          const v = sid.value.trim();
          if (!/^\d{4,10}$/.test(v)) return msg.replaceChildren(errorBox({ message: '학번은 숫자 4~10자리로 입력해 주세요.' }));
          myId = v;
          store.set(v);
          enableSound(); // 버튼을 누른 순간이라 소리를 켤 수 있음
          await askNotificationPermission();
          checkMyQueue();
        },
      }, h('div', { class: 'row' }, sid, h('button', { class: 'primary', type: 'submit', style: 'flex:0 0 160px' }, '알림 켜기')), msg),
    );
    return;
  }

  const permText = !('Notification' in window) ? '이 브라우저는 알림을 지원하지 않아요. 이 화면을 켜 두면 소리와 진동으로 알려 드려요.'
    : Notification.permission === 'granted' ? '알림 허용됨'
      : Notification.permission === 'denied' ? '알림이 차단돼 있어요. 이 화면을 켜 두면 소리와 진동으로 알려 드려요.'
        : '알림을 허용하지 않았어요.';
  fill(myBox,
    h('div', { class: 'top-nav' },
      h('strong', {}, `🔔 학번 ${maskId(myId)}의 대기`),
      h('button', { onclick: () => { myId = ''; store.set(''); renderMyBox(); } }, '학번 지우기')),
    message ? errorBox(message) : null,
    ...(items && items.length ? items.map((it) => (it.myTurn
      ? h('div', { class: 'my-turn' }, `🎉 지금 내 차례! ${it.displayName} — ${it.deadlineText}까지 (${it.remainingMinutes}분 남음) 기구에서 사용을 시작하세요`)
      : h('div', {}, `${it.displayName}: 대기 ${it.position}번째`)))
      : [h('div', { class: 'muted' }, '지금 대기 중인 기구가 없어요.')]),
    h('p', { class: 'muted small' }, permText),
    // 화면을 새로 열면 브라우저 규칙상 소리가 다시 꺼짐 → 한 번 눌러 켜기
    soundEnabled() ? null : h('button', { onclick: () => { enableSound(); checkMyQueue(); } }, '🔇 알림 소리 켜기'),
    'Notification' in window && Notification.permission === 'default'
      ? h('button', { onclick: async () => { await askNotificationPermission(); checkMyQueue(); } }, '알림 허용하기') : null,
  );
}

async function askNotificationPermission() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  try { await Notification.requestPermission(); } catch (e) { /* 무시 */ }
}

// 내 학번의 대기·차례 확인 → 새로 내 차례가 되면 알림
async function checkMyQueue() {
  if (!myId) return renderMyBox();
  try {
    const { items } = await api('/api/equipment/my-queue', { studentId: myId });
    renderMyBox(items);
    for (const it of items.filter((x) => x.myTurn)) {
      if (notifiedTurns.has(it.turnKey)) continue;
      notifiedTurns.add(it.turnKey);
      alertMyTurn(it);
    }
  } catch (err) {
    renderMyBox([], err);
  }
}

// 내 차례 알림: 브라우저 알림 + 소리 + 진동 (휴대폰에서 알림이 안 되는 경우를 대비해 셋 다)
async function alertMyTurn(it) {
  const title = `내 차례예요: ${it.displayName}`;
  const body = `${it.deadlineText}까지(${it.remainingMinutes}분 안에) 기구 화면에서 "제 차례예요"를 눌러 사용을 시작하세요.`;
  let shown = false;
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, tag: 'turn-' + it.turnKey });
      shown = true;
    } catch (e) {
      // 안드로이드 크롬은 이 방식을 막음 → 서비스 워커 방식으로 다시 시도
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) { await reg.showNotification(title, { body, tag: 'turn-' + it.turnKey }); shown = true; }
      } catch (e2) { /* 무시 */ }
    }
  }
  beep(4, 990);
  try { navigator.vibrate && navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) { /* 무시 */ }
  document.title = '🔔 내 차례! — 기구 현황판';
  if (!shown) console.info('브라우저 알림을 띄우지 못해서 화면·소리·진동으로만 알렸어요.');
}

// ═════════════════ 시작 ═════════════════
// 실험실 탭: 전체 / 생물실 / 물리실 / …
async function renderLabTabs() {
  const nav = document.getElementById('lab-tabs');
  try {
    const { labs } = await api('/api/labs');
    if (statusLab && !labs.some((l) => l.id === statusLab)) statusLab = null;
    const tab = (id, name) => h('button', {
      class: statusLab === id ? 'selected' : '',
      onclick: () => {
        statusLab = id;
        history.replaceState(null, '', id ? '?lab=' + id : location.pathname); // 주소에도 남겨서 즐겨찾기 가능
        renderLabTabs(); loadCards();
      },
    }, name);
    nav.replaceChildren(tab(null, '전체'), ...labs.map((l) => tab(l.id, l.name)));
  } catch (e) { nav.replaceChildren(); }
}

(function start() {
  renderLabTabs();
  renderMyBox();
  loadCards();
  checkMyQueue();

  // 실시간 소식
  onLive('change', () => { loadCards(); checkMyQueue(); });
  onLive('turn', () => checkMyQueue());
  const es = connectLive();
  const conn = document.getElementById('conn');
  es.addEventListener('open', () => { conn.textContent = '● 실시간'; conn.style.color = 'var(--green)'; });
  es.addEventListener('error', () => { conn.textContent = '○ 다시 연결 중…'; conn.style.color = 'var(--red)'; });

  // 남은 시간은 서버 소식이 없어도 30초마다 다시 계산 (1분마다 줄어들게)
  setInterval(renderCards, 30000);

  // 서비스 워커: 안드로이드 크롬에서 알림을 띄우는 데 필요 (자체 인증서 https 에서는 등록이 안 될 수 있음)
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
