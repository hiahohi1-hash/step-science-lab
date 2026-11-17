// ─────────────────────────────────────────────
// 관리자 화면 (명세 8번)
// ─────────────────────────────────────────────
// 탭: 요약·승인 / 기구 현황 / 전체 기록 / 시약 관리 / 기구 관리 / 재구매 / 통계 / 설정

const root = document.getElementById('admin');
const TABS = [
  ['home', '요약·승인'], ['notices', '알림'], ['equip', '기구 현황'], ['records', '전체 기록'], ['reagents', '시약 관리'],
  ['equipEdit', '기구 관리'], ['classMap', '모델 연결'], ['accuracy', '인식 정확도'], ['reorder', '재구매'], ['stats', '통계'], ['topics', '주제 기록'], ['catalog', '기자재 자료집'], ['labs', '실험실'], ['settings', '설정'],
];
let currentTab = 'home';
let editing = false; // 입력 중이면 실시간 소식이 와도 다시 그리지 않음
const content = h('section');
// 탭 내용 바꾸기 (비어 있는 null 칸은 빼고 그림)
const setContent = (...nodes) => content.replaceChildren(...(LAB_TABS.includes(currentTab) && !editing ? [labFilterBar()] : []), ...nodes.flat().filter(Boolean));
const msgArea = h('div');

// 관리자 요청 (로그인이 풀리면 로그인 화면으로)
async function adminApi(path, body) {
  try {
    return await api('/api/admin' + path, body);
  } catch (err) {
    if (/로그인이 필요/.test(err.message)) showLogin('로그인 시간이 끝났어요. 다시 로그인해 주세요.');
    throw err;
  }
}

// 성공·실패 안내를 위쪽에 잠깐 보여 줌
function flash(text, isError) {
  msgArea.replaceChildren(isError ? errorBox(text) : h('div', { class: 'ok-box' }, '✔ ' + text));
  setTimeout(() => msgArea.replaceChildren(), 4000);
}
// 버튼 하나 누르면 요청 → 결과 안내 → 다시 그리기
function action(label, fn, opts = {}) {
  return h('button', {
    class: opts.class || '',
    onclick: async () => {
      if (opts.confirm && !confirm(opts.confirm)) return;
      try { await fn(); flash(opts.done || '처리했어요.'); renderTab(); } catch (err) { flash(err, true); }
    },
  }, label);
}
const table = (headers, rows) => h('div', { class: 'table-wrap' }, h('table', {},
  h('thead', {}, h('tr', {}, ...headers.map((x) => h('th', {}, x)))),
  h('tbody', {}, ...(rows.length ? rows : [h('tr', {}, h('td', { colspan: headers.length, class: 'muted' }, '없어요'))]))));
const td = (...c) => h('td', {}, ...c);

// 비밀번호 칸 오른쪽에 👁 버튼: 누르면 입력한 글자가 보이고, 다시 누르면 ●●● 로 숨김
// - 처음에는 항상 숨김 상태 (옆 사람이 보지 않게)
// - 로그인 버튼을 누르거나 화면을 떠나면 다시 숨김으로 돌아감
function withEye(input) {
  const btn = h('button', { type: 'button', class: 'eye-btn', 'aria-label': '비밀번호 보이기', title: '비밀번호 보이기' }, '👁');
  const hide = () => { input.type = 'password'; btn.textContent = '👁'; btn.setAttribute('aria-label', '비밀번호 보이기'); btn.title = '비밀번호 보이기'; btn.classList.remove('on'); };
  btn.addEventListener('click', () => {
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = '🙈';
      btn.setAttribute('aria-label', '비밀번호 숨기기'); btn.title = '비밀번호 숨기기';
      btn.classList.add('on');
    } else hide();
    input.focus();
  });
  // 보낼 때(로그인·바꾸기)는 숨김으로 되돌려서 브라우저가 글자를 기억하지 않게
  setTimeout(() => { if (input.form) input.form.addEventListener('submit', hide); }, 0);
  return h('div', { class: 'pw-wrap' }, input, btn);
}

// ═════════════════ 로그인 ═════════════════
function showLogin(notice) {
  const pw = h('input', { type: 'password', autocomplete: 'current-password', maxlength: 200, placeholder: '관리자 비밀번호' });
  const msg = h('div', {}, notice ? errorBox({ message: notice }) : null);
  root.replaceChildren(
    h('h1', {}, '🔐 관리자 로그인'),
    h('form', {
      class: 'card', style: 'max-width:480px;margin:auto',
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const r = await api('/api/admin/login', { password: pw.value });
          pw.value = '';
          if (r.mustChange) return showForceChange();
          await initNotices(); showMain();
        } catch (err) { msg.replaceChildren(errorBox(err)); }
      },
    }, h('label', {}, '비밀번호'), withEye(pw), msg,
      h('button', { class: 'primary', type: 'submit', style: 'width:100%;margin-top:16px' }, '로그인')),
    h('p', { class: 'center' }, h('a', { href: '/' }, '← 처음 화면')),
  );
  pw.focus();
}

// 예시 비밀번호로 로그인했으면 먼저 바꾸게 함
function showForceChange() {
  root.replaceChildren(
    h('h1', {}, '🔐 비밀번호를 바꿔 주세요'),
    h('div', { class: 'card', style: 'max-width:520px;margin:auto' },
      errorBox({ message: '지금 비밀번호는 .env.example 에 적힌 예시 비밀번호예요.', hint: '누구나 알 수 있으니 새 비밀번호로 바꿔야 관리자 화면을 쓸 수 있어요.' }),
      passwordForm(async () => { await initNotices(); showMain(); })),
  );
}

function passwordForm(onDone) {
  const cur = h('input', { type: 'password', autocomplete: 'current-password', maxlength: 200 });
  const n1 = h('input', { type: 'password', autocomplete: 'new-password', maxlength: 100 });
  const n2 = h('input', { type: 'password', autocomplete: 'new-password', maxlength: 100 });
  const msg = h('div');
  return h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        await adminApi('/password', { current: cur.value, next: n1.value, next2: n2.value });
        cur.value = n1.value = n2.value = '';
        msg.replaceChildren(h('div', { class: 'ok-box' }, '✔ 비밀번호를 바꿨어요. 다른 기기의 로그인은 모두 끊겼어요.'));
        if (onDone) setTimeout(onDone, 1200);
      } catch (err) { msg.replaceChildren(errorBox(err)); }
    },
  }, h('label', {}, '지금 비밀번호'), withEye(cur), h('label', {}, '새 비밀번호 (8글자 이상)'), withEye(n1), h('label', {}, '새 비밀번호 한 번 더'), withEye(n2), msg,
    h('button', { class: 'primary', type: 'submit', style: 'margin-top:16px' }, '비밀번호 바꾸기'));
}

// ═════════════════ 8단계: 관리자 화면 알림 ═════════════════
// 서버가 "새 알림" 신호(번호만)를 보내면 → 로그인한 이 화면이 내용을 가져와서
// 컴퓨터 알림 창 + 삐 소리 + 탭 제목 숫자로 알려 줌
let lastNoticeId = 0;   // 마지막으로 받은 알림 번호
let unread = 0;         // 안 읽은 알림 수
let loggedIn = false;
const BASE_TITLE = '과학실 관리자';

function updateUnread(n) {
  unread = n;
  document.title = n ? `(${n}) 새 알림 — ${BASE_TITLE}` : BASE_TITLE;
  const tab = document.querySelector('.tabs button[data-tab="notices"]');
  if (tab) tab.textContent = n ? `알림 (${n})` : '알림';
}

// ═════════════════ 13단계: 실험실 고르기 ═════════════════
let adminLabs = [];       // 실험실 목록
let adminLab = '';        // 보고 있는 실험실 번호 ('' = 전체)
const LAB_TABS = ['equip', 'reagents', 'equipEdit', 'stats', 'accuracy', 'classMap', 'topics', 'catalog']; // 실험실 고르기가 보이는 탭
const ONE_LAB_TABS = ['classMap']; // "전체" 없이 실험실 하나만 고르는 탭 (모델은 실험실마다 따로라서)
const labQ = () => (adminLab ? 'lab=' + adminLab : '');
// "전체"를 고를 수 없는 탭에서 쓸 실험실 (전체였으면 첫 번째 실험실)
const oneLab = () => adminLab || (adminLabs[0] && adminLabs[0].id) || '';
const labNameOf = (id) => (adminLabs.find((l) => l.id === id) || {}).name || '';
async function loadLabs() { adminLabs = (await adminApi('/labs')).labs; }
// 실험실 고르기 줄 (전체 / 생물실 / …)
function labFilterBar() {
  const oneOnly = ONE_LAB_TABS.includes(currentTab);
  const current = oneOnly ? oneLab() : adminLab;
  return h('div', { class: 'lab-tabs' }, h('strong', { style: 'align-self:center;margin-right:6px' }, '실험실:'),
    ...[...(oneOnly ? [] : [{ id: '', name: '전체' }]), ...adminLabs].map((l) => h('button', {
      class: String(current) === String(l.id) ? 'selected' : '',
      onclick: () => { adminLab = l.id; editing = false; renderTab(); },
    }, l.name)));
}
// 시약·기구 입력 칸의 실험실 고르기
function labSelect(value) {
  const sel = h('select', {}, ...adminLabs.map((l) => h('option', { value: l.id }, l.name)));
  sel.value = String(value || adminLab || (adminLabs[0] && adminLabs[0].id) || '');
  return sel;
}

async function initNotices() {
  await loadLabs();
  const r = await adminApi('/notifications');
  lastNoticeId = r.lastId;
  updateUnread(r.unread);
}

async function fetchNewNotices() {
  if (!loggedIn) return;
  try {
    const r = await adminApi('/notifications?after=' + lastNoticeId);
    if (!r.items.length) return;
    lastNoticeId = r.items[r.items.length - 1].id;
    updateUnread(r.unread);
    // 여러 개가 한꺼번에 오면 창은 3개까지만 (화면이 알림 창으로 덮이지 않게)
    for (const n of r.items.slice(-3)) showDesktopNotice(n);
    // 승인 요청·연체는 삐 3번, 나머지는 1번
    beep(r.items.some((n) => ['승인 요청', '연체'].includes(n.type)) ? 3 : 1, 880);
    if (['notices', 'home'].includes(currentTab) && !editing) renderTab();
  } catch (e) { /* 로그인 풀림 등은 adminApi 가 처리 */ }
}

// 컴퓨터 알림 창 (학번·이름 없이 짧게: "[연체] 에탄올")
function showDesktopNotice(n) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const note = new Notification(`과학실 알림 ${n.short}`, { body: '관리자 화면에서 자세히 확인하세요.', tag: 'lab-' + n.id });
    note.onclick = () => { window.focus(); currentTab = 'notices'; showMain(); note.close(); };
  } catch (e) { /* 알림 창을 못 띄우면 소리와 탭 숫자로만 */ }
}

// "알림 켜기" 버튼: 컴퓨터 알림 허용 + 소리 켜기 (브라우저 규칙상 버튼을 한 번 눌러야 함)
function noticeButton() {
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  if (perm === 'granted' && soundEnabled()) return h('span', { class: 'muted small' }, '🔔 알림 켜짐');
  return h('button', {
    class: 'sound-btn',
    onclick: async () => {
      enableSound();
      if (perm === 'default') { try { await Notification.requestPermission(); } catch (e) { /* 무시 */ } }
      if ('Notification' in window && Notification.permission === 'denied') {
        flash({ message: '브라우저에서 알림이 차단돼 있어요.', hint: '주소창 왼쪽 자물쇠(또는 ⓘ) → 알림 → 허용으로 바꾼 뒤 새로 고쳐 주세요. 소리와 탭 숫자로는 계속 알려 드려요.' }, true);
      }
      showMain();
    },
  }, '🔕 알림 켜기');
}

// ═════════════════ 큰 틀 (탭) ═════════════════
function showMain() {
  loggedIn = true;
  const nav = h('nav', { class: 'tabs' }, ...TABS.map(([key, label]) => h('button', {
    class: key === currentTab ? 'selected' : '',
    'data-tab': key,
    onclick: () => { currentTab = key; editing = false; showMain(); },
  }, label)));
  root.replaceChildren(
    h('div', { class: 'top-nav' }, h('h1', { style: 'margin:0' }, '🧪 과학실 관리자'),
      h('div', { class: 'row-actions' }, noticeButton(), h('a', { href: '/' }, '처음 화면'),
        h('button', { onclick: async () => { await api('/api/admin/logout', {}); loggedIn = false; showLogin(); } }, '로그아웃'))),
    nav, msgArea, content);
  updateUnread(unread);
  renderTab();
}

async function renderTab() {
  try {
    const fn = { home: tabHome, notices: tabNotices, classMap: tabClassMap, accuracy: tabAccuracy, equip: tabEquip, records: tabRecords, reagents: tabReagents, equipEdit: tabEquipEdit, reorder: tabReorder, stats: tabStats, topics: tabTopics, catalog: tabCatalog, labs: tabLabs, settings: tabSettings }[currentTab];
    await fn();
  } catch (err) {
    if (!/로그인이 필요/.test(err.message || '')) setContent(errorBox(err));
  }
}

// ═════════════════ 요약·승인 ═════════════════
async function tabHome() {
  const { summary: s, pending, active, classMapWarnings } = await adminApi('/dashboard');
  const tile = (label, n, cls) => h('div', { class: 'tile ' + (n && cls ? cls : '') }, h('div', { class: 'tile-n' }, String(n)), h('div', {}, label));
  setContent(
    classMapWarnings ? h('div', { class: 'error', role: 'button', style: 'cursor:pointer', onclick: () => { currentTab = 'classMap'; showMain(); } },
      `⚠ 기구 인식 모델 연결에 확인할 것이 ${classMapWarnings}개 있어요. (눌러서 "모델 연결" 탭 보기)`) : null,
    h('div', { class: 'tiles' },
      tile('시약 반출 중', s.onLoan), tile('승인 대기', s.pending, 'warn'), tile('연체', s.overdue, 'danger'),
      tile('재구매 필요', s.reorder, 'warn'), tile('기구 사용 중', s.equipmentInUse)),
    h('h2', {}, '승인 대기 (고위험 시약)'),
    table(['시약', '학번', '이름', '목적', '신청', '기한', ''], pending.map((l) => {
      const reason = h('input', { type: 'text', maxlength: 200, placeholder: '거절 사유', class: 'inline-input', onfocus: () => { editing = true; }, onblur: () => { editing = false; } });
      return h('tr', {}, td(l.reagentName), td(l.studentId), td(l.studentName), td(l.purpose), td(l.created), td(l.due),
        td(h('div', { class: 'row-actions' },
          action('승인', () => adminApi(`/loans/${l.id}/approve`, {}), { class: 'primary', done: '승인했어요.' }),
          reason,
          action('거절', () => adminApi(`/loans/${l.id}/reject`, { reason: reason.value }), { class: 'danger', done: '거절했어요.' }))));
    })),
    h('h2', {}, '시약 반출 중 (기한이 가까운 순서)'),
    table(['시약', '학번', '이름', '목적', '기한', '상태'], active.map((l) => h('tr', { class: l.overdue ? 'overdue-row' : '' },
      td(l.reagentName, ' ', l.hazard === '고위험' ? h('span', { class: 'badge high' }, '고위험') : null), td(l.studentId), td(l.studentName), td(l.purpose), td(l.due),
      td(l.overdue ? `연체 (${l.overdueText})` : l.extended ? '반출 중 (연장함)' : '반출 중')))),
  );
}

// ═════════════════ 알림 기록 (8단계) ═════════════════
async function tabNotices() {
  const r = await adminApi('/notifications');
  lastNoticeId = Math.max(lastNoticeId, r.lastId);
  updateUnread(r.unread);
  setContent(
    h('div', { class: 'row-actions' },
      r.unread ? action('모두 읽음으로 표시', () => adminApi('/notifications/read-all', {}), { done: '모두 읽음으로 표시했어요.' }) : h('span', { class: 'muted' }, '안 읽은 알림이 없어요.'),
      h('span', { class: 'muted small' }, '최근 200개까지 보여요.')),
    table(['시각', '종류', '내용'], r.items.map((n) => h('tr', { class: n.read ? '' : 'unread-row' },
      td(n.time), td(n.type), td(n.message)))),
  );
}

// ═════════════════ 기구 현황 ═════════════════
// 대기열에서 한 명 삭제: 누구를 지우는지 확인 + 이유(선택) 입력
async function deleteQueueEntry(q, equipmentName) {
  const reason = prompt(
    `${equipmentName} 대기 ${q.order}번 — ${q.studentId} ${q.studentName}${q.status === '차례' ? ' (지금 차례)' : ''}\n\n` +
    '이 대기를 삭제할까요? 삭제 이유를 적어 주세요. (선택, 예: 잘못 등록함 / 다른 기구 사용함)\n취소를 누르면 삭제하지 않아요.', '');
  if (reason === null) return; // 취소
  try {
    const r = await adminApi(`/queue/${q.id}/cancel`, { reason });
    flash(r.wasTurn
      ? (r.nextStudent ? `삭제했어요. 다음 대기자(${r.nextStudent})에게 차례가 넘어갔어요.` : '삭제했어요. 기다리는 사람이 없어서 "사용 가능"이 됐어요.')
      : '대기열에서 삭제했어요.');
    renderTab();
  } catch (err) { flash(err, true); }
}

async function tabEquip() {
  const { equipment, queues, queueEnabled } = await adminApi('/equipment-status?' + labQ());
  // 모든 기구의 대기열을 한 표로 (잘못된 대기를 찾아 삭제하기 쉽게)
  const queueCard = h('div', { class: 'card' },
    h('h2', { style: 'margin-top:0' }, `📋 전체 대기열 (${queues.length}명)`),
    queues.length
      ? table(['기구', '순서', '학번', '이름', '상태', '등록', ''], queues.map((q) => h('tr', { class: q.status === '차례' ? 'unread-row' : '' },
        td(q.equipmentName), td(String(q.order)), td(q.studentId), td(q.studentName),
        td(q.status === '차례' ? '지금 차례' : '대기'), td(q.joined),
        td(h('button', { class: 'danger', onclick: () => deleteQueueEntry(q, q.equipmentName) }, '삭제')))))
      : h('p', { class: 'muted' }, '기다리는 사람이 없어요.'),
    h('p', { class: 'muted small' }, '잘못 등록된 대기는 "삭제"를 누르세요. 지금 차례인 사람을 삭제하면 다음 사람에게 차례가 넘어가요. 삭제한 내용은 "알림" 탭에 기록돼요.'));

  // 대기 기능이 꺼져 있고 남은 대기도 없으면 대기열 상자 대신 짧은 안내만
  const queueOff = queueEnabled === false;
  setContent(queueOff && !queues.length ? h('p', { class: 'muted small' }, '대기 기능이 꺼져 있어요 (학생은 지금 누가 쓰는지만 봐요). 설정 탭에서 켤 수 있어요.') : queueCard,
    h('h2', {}, '기구별 상태'), ...equipment.map((e) => h('div', { class: 'card' },
    h('div', { class: 'top-nav' }, h('strong', {}, e.displayName), statusBadge(e.status)),
    e.user ? h('p', {}, `사용자: ${e.user.studentId} ${e.user.studentName} · ${e.user.started} ~ ${e.user.ends}`) : null,
    e.turn ? h('p', {}, `예약 대기: ${e.turn.student} (${e.turn.deadlineText}까지)`) : null,
    h('div', { class: 'row-actions' },
      e.user ? action('강제 종료', () => adminApi(`/equipment/${e.id}/force-end`, {}), { class: 'danger', confirm: `${e.displayName} 사용을 강제로 끝낼까요?`, done: '강제 종료했어요.' }) : null,
      e.status === '점검 중'
        ? action('점검 끝내기', () => adminApi(`/equipment/${e.id}/maintenance`, { on: false }), { done: '점검을 끝냈어요.' })
        : action('점검 중으로 바꾸기', () => adminApi(`/equipment/${e.id}/maintenance`, { on: true }), { done: '점검 중으로 바꿨어요.' }),
      e.queue.length ? action('대기열 모두 비우기', () => adminApi(`/equipment/${e.id}/clear-queue`, {}), { confirm: `${e.displayName} 대기열 ${e.queue.length}명을 모두 삭제할까요?`, done: '대기열을 비웠어요.' }) : null),
    e.queue.length ? table(['순서', '학번', '이름', '상태', '등록', ''], e.queue.map((q) => h('tr', {},
      td(String(q.order)), td(q.studentId), td(q.studentName), td(q.status === '차례' ? '지금 차례' : '대기'), td(q.joined),
      td(h('button', { class: 'danger', onclick: () => deleteQueueEntry(q, e.displayName) }, '삭제'))))) : null)));
}

// ═════════════════ 전체 기록 + CSV ═════════════════
const recordFilter = { type: 'loans', from: '', to: '', q: '' };
async function tabRecords() {
  const type = h('select', {}, h('option', { value: 'loans' }, '시약 반출 기록'), h('option', { value: 'uses' }, '기구 사용 기록'));
  type.value = recordFilter.type;
  const from = h('input', { type: 'date', value: recordFilter.from });
  const to = h('input', { type: 'date', value: recordFilter.to });
  const q = h('input', { type: 'text', maxlength: 30, placeholder: '학번 또는 이름', value: recordFilter.q });
  const box = h('div', {}, h('p', { class: 'muted' }, '불러오는 중…'));
  const qs = () => new URLSearchParams(recordFilter).toString();

  const search = async () => {
    Object.assign(recordFilter, { type: type.value, from: from.value, to: to.value, q: q.value.trim() });
    try {
      const r = await adminApi('/records?' + qs());
      box.replaceChildren(h('p', { class: 'muted' }, `${r.rows.length}건 (최대 2000건)`), r.type === 'loans'
        ? table(['신청', '시약', '학번', '이름', '목적', '상태', '기한', '반납', '남은 양'], r.rows.map((l) => h('tr', { class: l.overdue ? 'overdue-row' : '' },
          td(l.created), td(l.reagentName), td(l.studentId || '(지워짐)'), td(l.studentName || ''), td(l.purpose), td(l.status), td(l.due), td(l.returned), td(l.remaining || ''))))
        : table(['시작', '기구', '학번', '이름', '종료 예정', '실제 종료', '방식', '분'], r.rows.map((u) => h('tr', {},
          td(u.started), td(u.equipmentName), td(u.studentId || '(지워짐)'), td(u.studentName || ''), td(u.ends), td(u.ended), td(u.endReason), td(String(u.minutes))))));
    } catch (err) { box.replaceChildren(errorBox(err)); }
  };

  setContent(
    h('form', { class: 'card filter', onsubmit: (e) => { e.preventDefault(); search(); } },
      h('div', { class: 'row' }, h('div', {}, h('label', {}, '종류'), type), h('div', {}, h('label', {}, '시작 날짜'), from),
        h('div', {}, h('label', {}, '끝 날짜'), to), h('div', {}, h('label', {}, '학번·이름'), q)),
      h('div', { class: 'row-actions', style: 'margin-top:12px' },
        h('button', { class: 'primary', type: 'submit' }, '검색'),
        h('button', { type: 'button', onclick: () => { Object.assign(recordFilter, { type: type.value, from: from.value, to: to.value, q: q.value.trim() }); location.href = '/api/admin/records.csv?' + qs(); } }, '📥 CSV 내려받기 (엑셀)'))),
    box);
  [from, to, q].forEach((el) => { el.addEventListener('focus', () => { editing = true; }); el.addEventListener('blur', () => { editing = false; }); });
  search();
}

// ═════════════════ 시약 관리 ═════════════════
async function tabReagents() {
  const { reagents } = await adminApi('/reagents?' + labQ());
  setContent(
    h('button', { class: 'primary', onclick: () => reagentForm(null) }, '+ 시약 추가'),
    table(['실험실', '이름', '카스 번호', '바코드', '위험', '위치', '병 수 (남음/전체)', '메모', ''], reagents.map((r) => h('tr', {},
      td(labNameOf(r.lab_id)), td(r.name), td(r.cas_number || ''), td(r.barcode || ''), td(r.hazard), td(r.location), td(`${r.available} / ${r.quantity}`), td(r.memo),
      td(h('div', { class: 'row-actions' }, h('button', { onclick: () => reagentForm(r) }, '수정'),
        action('삭제', () => adminApi(`/reagents/${r.id}/delete`, {}), { class: 'danger', confirm: `${r.name}을(를) 목록에서 삭제할까요? (지난 기록은 남아요)`, done: '삭제했어요.' })))))));
}

function reagentForm(r) {
  editing = true;
  const f = {
    name: h('input', { type: 'text', maxlength: 50, value: r ? r.name : '' }),
    cas_number: h('input', { type: 'text', maxlength: 15, placeholder: '예: 7647-01-0', value: r ? r.cas_number || '' : '' }),
    barcode: h('input', { type: 'text', maxlength: 40, inputmode: 'numeric', placeholder: '직접 입력하거나 📷 바코드 찍기', value: r ? r.barcode || '' : '' }),
    hazard: h('select', {}, h('option', { value: '일반' }, '일반'), h('option', { value: '고위험' }, '고위험')),
    lab_id: labSelect(r && r.lab_id),
    location: h('input', { type: 'text', maxlength: 50, value: r ? r.location : '' }),
    quantity: h('input', { type: 'number', min: 0, max: 9999, step: 1, value: r ? r.quantity : 1 }),
    memo: h('textarea', { maxlength: 500, rows: 2 }, r ? r.memo : ''),
  };
  f.hazard.value = r ? r.hazard : '일반';
  const msg = h('div');
  setContent(h('form', {
    class: 'card',
    onsubmit: async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
      data.quantity = Number(data.quantity);
      data.lab_id = Number(data.lab_id);
      try { await adminApi(r ? `/reagents/${r.id}` : '/reagents', data); editing = false; flash('저장했어요.'); renderTab(); } catch (err) { msg.replaceChildren(errorBox(err)); }
    },
  }, h('h2', {}, r ? `${r.name} 수정` : '시약 추가'),
    h('label', {}, '시약 이름 *'), f.name, h('label', {}, '카스 번호'), f.cas_number, h('label', {}, '상품 바코드 번호'),
    h('div', { class: 'row' }, f.barcode, h('button', { type: 'button', style: 'flex:0 0 160px', onclick: () => scanBarcodeInto(f.barcode) }, '📷 바코드 찍기')),
    h('label', {}, '실험실'), f.lab_id, h('label', {}, '위험 등급'), f.hazard, h('label', {}, '보관 위치'), f.location, h('label', {}, '보유 병 수'), f.quantity, h('label', {}, '메모'), f.memo,
    msg, h('div', { class: 'row-actions', style: 'margin-top:16px' }, h('button', { class: 'primary', type: 'submit' }, '저장'),
      h('button', { type: 'button', onclick: () => { editing = false; renderTab(); } }, '취소'))));
}

// 8번 "시약 추가할 때 카메라로 바코드를 찍으면 바코드 번호가 자동으로 들어감"
async function scanBarcodeInto(input) {
  const video = h('video', { class: 'scan-video', playsinline: true, muted: true, autoplay: true });
  const status = h('p', { class: 'center' }, '카메라를 켜는 중…');
  let stream = null, timer = null, done = false;
  const close = () => { done = true; clearTimeout(timer); stopCamera(stream); overlay.remove(); };
  const overlay = h('div', { class: 'overlay', role: 'dialog' },
    h('div', { class: 'overlay-box', style: 'width:min(640px,100%)' },
      h('h2', { style: 'margin-top:0' }, '📷 시약 바코드를 비춰 주세요'),
      h('div', { class: 'scan-box' }, video, h('div', { class: 'scan-frame' })),
      status,
      h('button', { onclick: close }, '닫기')));
  document.body.append(overlay);
  try {
    const reader = await getBarcodeReader();
    stream = await startCamera(video);
    if (done) return stopCamera(stream);
    status.textContent = '바코드를 찾는 중…';
    const canvas = document.createElement('canvas');
    const tick = () => {
      if (done) return;
      if (video.readyState >= 2 && video.videoWidth) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        const code = decodeBarcode(reader, canvas);
        if (code) {
          input.value = code;
          close();
          flash(`바코드 ${code} 를 넣었어요. 저장을 눌러 주세요.`);
          return;
        }
      }
      timer = setTimeout(tick, 250);
    };
    tick();
  } catch (err) {
    status.replaceChildren(errorBox(err));
  }
}

// ═════════════════ 기구 관리 ═════════════════
async function tabEquipEdit() {
  const { equipment } = await adminApi('/equipment?' + labQ());
  setContent(
    h('button', { class: 'primary', onclick: () => equipmentForm(null) }, '+ 기구 추가'),
    h('p', { class: 'muted' }, '같은 종류가 여러 대면 이름은 같게, "구분 이름"을 다르게 (예: 1번(창가)). 모델 분류 이름 연결은 10단계 화면에서 해요.'),
    table(['사진', '실험실', '종류', '이름', '구분', '위치', '최대 시간', '시간 선택지', '위험', ''], equipment.map((e) => h('tr', {},
      td(e.photoUrl ? h('img', { src: e.photoUrl, alt: '', class: 'thumb' }) : h('span', { class: 'muted small' }, '없음')),
      td(labNameOf(e.lab_id)), td(e.kind === '안내' ? '📘 안내 전용' : '예약'), td(e.name), td(e.unit_label), td(e.location),
      td(e.kind === '안내' ? '-' : durationText(e.max_minutes)), td(e.kind === '안내' ? '-' : e.time_options.map((o) => o.label).join(', ')), td(e.is_dangerous ? '⚠ 위험' : ''),
      td(h('div', { class: 'row-actions' }, h('button', { onclick: () => equipmentForm(e) }, '수정'),
        action('삭제', () => adminApi(`/equipment/${e.id}/delete`, {}), { class: 'danger', confirm: `${e.name} ${e.unit_label}을(를) 삭제할까요? (지난 기록은 남아요)`, done: '삭제했어요.' })))))));
}

function equipmentForm(e) {
  editing = true;
  const lines = (arr) => (arr || []).join('\n');
  const f = {
    name: h('input', { type: 'text', maxlength: 50, value: e ? e.name : '' }),
    unit_label: h('input', { type: 'text', maxlength: 30, placeholder: '한 대뿐이면 비워 두세요', value: e ? e.unit_label : '' }),
    location: h('input', { type: 'text', maxlength: 50, value: e ? e.location : '' }),
    max_minutes: h('input', { type: 'number', min: 1, step: 1, value: e ? e.max_minutes : 60 }),
    is_dangerous: h('input', { type: 'checkbox', id: 'danger' }),
    kind: h('select', {}, h('option', { value: '예약' }, '예약 기구 (사용 등록·사용 현황 관리)'), h('option', { value: '안내' }, '📘 안내 전용 (찍으면 사용법·주의사항만, 예약 없음)')),
    lab_id: labSelect(e && e.lab_id),
    howto: h('textarea', { rows: 10 }, lines(e && e.howto)),
    checklist: h('textarea', { rows: 5 }, lines(e && e.checklist)),
    cautions: h('textarea', { rows: 6 }, lines(e && e.cautions)),
    keywords: h('textarea', { rows: 3, placeholder: '예: 미생물 배양, 효모, 발효 (쉼표나 줄로 나눠 쓰기)' }, ((e && e.keywords) || []).join(', ')),
  };
  f.is_dangerous.checked = !!(e && e.is_dangerous);

  // 사용 시간 선택지: 이름 + 분 줄 여러 개
  const optBox = h('div');
  const addOpt = (o = { label: '', minutes: '' }) => {
    const row = h('div', { class: 'row opt-row' },
      h('input', { type: 'text', maxlength: 40, placeholder: '이름 (예: 멸균 20분 과정 - 총 1시간)', value: o.label }),
      h('input', { type: 'number', min: 1, step: 1, placeholder: '분', value: o.minutes, style: 'flex:0 0 120px' }),
      h('button', { type: 'button', style: 'flex:0 0 80px', onclick: () => row.remove() }, '빼기'));
    optBox.append(row);
  };
  (e ? e.time_options : []).forEach(addOpt);
  if (!e) addOpt();

  f.kind.value = (e && e.kind) || '예약';
  const bookingBox = h('div', {},
    h('label', {}, '최대 사용 시간 (분)'), f.max_minutes,
    h('label', { for: 'danger' }, f.is_dangerous, '위험 기구 (끝날 때 소리 + "압력과 온도 확인" 안내)'),
    h('label', {}, '사용 시간 선택지'), optBox, h('button', { type: 'button', onclick: () => addOpt() }, '+ 선택지 추가'));
  const syncKind = () => { bookingBox.style.display = f.kind.value === '안내' ? 'none' : ''; };
  f.kind.addEventListener('change', syncKind);
  syncKind();

  const msg = h('div');
  setContent(h('form', {
    class: 'card',
    onsubmit: async (ev) => {
      ev.preventDefault();
      const split = (ta) => ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
      const data = {
        kind: f.kind.value, lab_id: Number(f.lab_id.value), name: f.name.value, unit_label: f.unit_label.value, location: f.location.value, max_minutes: Number(f.max_minutes.value),
        is_dangerous: f.is_dangerous.checked, howto: split(f.howto),
        keywords: f.keywords.value.split(/[,\n]/).map((x) => x.trim()).filter(Boolean), checklist: split(f.checklist), cautions: split(f.cautions),
        time_options: [...optBox.querySelectorAll('.opt-row')].map((row) => {
          const [label, minutes] = row.querySelectorAll('input');
          return { label: label.value, minutes: Number(minutes.value) };
        }).filter((o) => o.label || o.minutes),
      };
      try { await adminApi(e ? `/equipment/${e.id}` : '/equipment', data); editing = false; flash('저장했어요.'); renderTab(); } catch (err) { msg.replaceChildren(errorBox(err)); }
    },
  }, h('h2', {}, e ? `${e.name} ${e.unit_label} 수정` : '기구 추가'),
    h('label', {}, '기구 이름 *'), f.name, h('label', {}, '구분 이름 (같은 종류가 여러 대일 때)'), f.unit_label,
    h('label', {}, '종류'), f.kind,
    h('label', {}, '실험실'), f.lab_id, h('label', {}, '보관 위치'), f.location,
    bookingBox,
    h('label', {}, '사진 (선택)'), photoSection(e),
    h('label', {}, '사용법 (한 줄에 한 단계)'), f.howto,
    h('label', {}, '필수 확인 사항 (한 줄에 하나, 학생이 모두 체크해야 시작)'), f.checklist,
    h('label', {}, '주의사항 (한 줄에 하나)'), f.cautions,
    h('label', {}, '🔎 쓰이는 실험·키워드 (주제로 찾기에 쓰여요)'), f.keywords,
    h('p', { class: 'muted small' }, '"⚠ 학교 기구 설명서를 보고…" 예시 표시 줄은 내용을 검토한 뒤 지우면 돼요.'),
    msg, h('div', { class: 'row-actions', style: 'margin-top:16px' }, h('button', { class: 'primary', type: 'submit' }, '저장'),
      h('button', { type: 'button', onclick: () => { editing = false; renderTab(); } }, '취소'))));
}

// ═════════════════ 모델과 기구 연결 (11-3) ═════════════════
async function tabClassMap() {
  const lab = oneLab(); // 15단계: 모델은 실험실마다 따로
  const v = await adminApi('/class-map?lab=' + lab);
  const m = v.model;
  const modelCard = h('div', { class: 'card' },
    h('h2', { style: 'margin-top:0' }, `${m.labName || ''} 모델`),
    h('p', {}, '모델 폴더: ', h('code', {}, m.folder || '-'), m.legacy ? ' (예전 위치 — 그대로 써도 되고, public/model/' + ((adminLabs.find((l) => l.id === lab) || {}).code || '') + '/ 로 옮겨도 돼요)' : ''),
    m.kind === 'real'
      ? h('p', {}, `✔ 진짜 모델: ${m.version || ''} · 분류 ${m.labels.length}개 (${m.labels.join(', ')})`)
      : h('p', {}, '🧪 연습용 가짜 모델을 쓰는 중이에요. ',
        m.missingFiles.length ? `위 폴더에 ${m.missingFiles.join(', ')} 파일이 없어요.` : '', m.error || ''),
    h('p', { class: 'muted small' }, '새 모델 파일로 바꾸면 이 화면을 새로 고쳐 경고가 없는지 확인하세요. 그 실험실 태블릿도 새로 고쳐야 새 모델을 써요.'));

  // 분류 이름 한 줄: 체크한 기구들이 그 분류에 연결됨 (같은 종류 여러 대 → 여러 개 체크)
  const row = (c) => {
    const boxes = v.equipment.map((e) => {
      const cb = h('input', { type: 'checkbox', id: `cm-${c.className}-${e.id}` });
      cb.checked = c.equipmentIds.includes(e.id);
      return { e, cb };
    });
    const save = action('저장', () => adminApi('/class-map', { labId: lab, className: c.className, equipmentIds: boxes.filter((b) => b.cb.checked).map((b) => b.e.id) }), { class: 'primary', done: `"${c.className}" 연결을 저장했어요.` });
    return h('tr', { class: c.inModel === false ? 'overdue-row' : '' },
      td(h('code', {}, c.className), c.inModel === false ? h('div', { class: 'small' }, '지금 모델에 없음') : null),
      td(h('div', { class: 'check-list' }, ...boxes.map(({ e, cb }) => h('label', { for: cb.id, class: 'check-item' }, cb, e.displayName)))),
      td(save));
  };

  // 새 분류 이름 추가 (모델을 만들기 전에 미리 연결해 둘 때)
  const newName = h('input', { type: 'text', maxlength: 60, placeholder: '분류 이름 (예: microscope)', onfocus: () => { editing = true; }, onblur: () => { editing = false; } });

  // 인식 설정
  const notEq = h('input', { type: 'text', maxlength: 60, value: v.notEquipmentClass });
  const th = h('input', { type: 'number', min: 50, max: 99, step: 1, value: Math.round(v.settings.recognition_threshold * 100) });
  const hold = h('input', { type: 'number', min: 1, max: 10, step: 1, value: v.settings.recognition_hold_seconds });
  const cand = h('input', { type: 'number', min: 2, max: 30, step: 1, value: v.settings.recognition_candidate_seconds });
  [notEq, th, hold, cand].forEach((el) => { el.addEventListener('focus', () => { editing = true; }); el.addEventListener('blur', () => { editing = false; }); });

  const mapTable = table(['분류 이름', '연결할 기구', ''], v.classes.map(row));
  const train = await trainingCard(lab).catch((err) => errorBox(err)); // 18단계: 학습 사진과 다시 학습
  setContent(
    ...v.warnings.map((w) => errorBox({ message: w.text, hint: w.hint })),
    modelCard,
    train,
    h('h2', {}, '분류 이름 ↔ 기구 연결'),
    h('p', { class: 'muted small' }, '티처블 머신에서 정한 분류 이름마다, 그 사진에 해당하는 기구를 체크하세요. 같은 종류가 여러 대면 모두 체크하면 인식 뒤 "1번 / 2번"을 고르게 돼요. 체크를 모두 풀고 저장하면 연결이 사라져요.'),
    mapTable,
    h('form', {
      class: 'row-actions', style: 'margin-top:10px',
      onsubmit: (e) => {
        e.preventDefault();
        const name = newName.value.trim();
        if (!name) return flash({ message: '분류 이름을 입력해 주세요.' }, true);
        if (v.classes.some((c) => c.className === name)) return flash({ message: '이미 있는 분류 이름이에요.' }, true);
        // 표에 새 줄만 추가 (기구를 체크하고 "저장"을 눌러야 실제로 저장됨)
        mapTable.querySelector('tbody').append(row({ className: name, equipmentIds: [], inModel: null }));
        v.classes.push({ className: name });
        newName.value = '';
      },
    }, newName, h('button', { type: 'submit' }, '+ 분류 이름 추가')),
    h('form', {
      class: 'card', style: 'margin-top:20px',
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await adminApi('/recognition-settings', { not_equipment_class: notEq.value, recognition_threshold: Number(th.value) / 100, recognition_hold_seconds: Number(hold.value), recognition_candidate_seconds: Number(cand.value) });
          editing = false; flash('인식 설정을 저장했어요. 태블릿 카메라 화면을 다시 열면 적용돼요.'); renderTab();
        } catch (err) { flash(err, true); }
      },
    }, h('h2', { style: 'margin-top:0' }, '인식 설정'),
      h('label', {}, '"기구 아님" 분류 이름 (이 결과가 나오면 아무 반응 없이 계속 인식)'), notEq,
      h('div', { class: 'row' },
        h('div', {}, h('label', {}, '자동 결정 확신도 기준 (%)'), th),
        h('div', {}, h('label', {}, '같은 결과가 이어져야 하는 시간 (초)'), hold),
        h('div', {}, h('label', {}, '결정이 안 되면 후보를 보여 줄 시간 (초)'), cand)),
      h('button', { class: 'primary', type: 'submit', style: 'margin-top:12px' }, '저장')),
  );
}

// ═════════════════ 인식 정확도 (11-4) ═════════════════
let accuracyVersion = '';
async function tabAccuracy() {
  const a = await adminApi('/accuracy?' + labQ() + (accuracyVersion ? '&version=' + encodeURIComponent(accuracyVersion) : ''));
  const pct = (x) => (x === null || x === undefined ? '-' : Math.round(x * 100) + '%');
  const sel = h('select', { onchange: (e) => { accuracyVersion = e.target.value; renderTab(); } },
    h('option', { value: '' }, '모든 모델'), ...a.versions.map((x) => h('option', { value: x.version }, `${x.version} (${x.count}건)`)));
  sel.value = a.selectedVersion || '';
  const o = a.overall;
  const lows = a.perClass.filter((p) => p.low);

  setContent(
    h('div', { class: 'row-actions' }, h('label', { style: 'margin:0' }, '모델'), h('div', { style: 'min-width:260px' }, sel),
      h('button', { onclick: () => { location.href = '/api/admin/accuracy.csv'; } }, '📥 인식 기록 CSV (탐구 보고서용)')),
    o.total === 0 ? h('div', { class: 'card' }, '아직 인식 기록이 없어요. 태블릿에서 "카메라로 찍기"로 기구를 인식하고 기구 화면까지 들어가면 기록이 쌓여요.') : null,
    h('div', { class: 'tiles', style: 'margin-top:12px' },
      h('div', { class: 'tile' }, h('div', { class: 'tile-n' }, String(o.total)), h('div', {}, '인식 기록')),
      h('div', { class: 'tile ' + (o.accuracy !== null && o.accuracy < a.thresholds.lowAccuracy ? 'danger' : '') }, h('div', { class: 'tile-n' }, pct(o.accuracy)), h('div', {}, '전체 정확도')),
      h('div', { class: 'tile' }, h('div', { class: 'tile-n' }, pct(o.avgConfidence)), h('div', {}, '평균 확신도')),
      ...Object.entries(o.byMethod).map(([k, n]) => h('div', { class: 'tile' }, h('div', { class: 'tile-n' }, String(n)), h('div', {}, k)))),
    lows.length ? errorBox({ message: `정확도가 낮은 기구: ${lows.map((p) => `${p.name} ${pct(p.accuracy)}`).join(', ')}`, hint: '사진을 더 찍어 다시 학습시키세요. (README 의 "사진 찍는 요령" 참고)' }) : null,
    h('h2', {}, '기구별 정확도'),
    h('p', { class: 'muted small' }, `정확도 = 모델이 처음 예측한 기구가 학생이 최종 확인한 기구와 같은 비율. ${a.thresholds.minSamples}건 이상, ${pct(a.thresholds.lowAccuracy)} 미만이면 다시 학습을 권해요.`),
    table(['기구', '기록 수', '맞음', '정확도', '평균 확신도', '안내'], a.perClass.map((p) => h('tr', { class: p.low ? 'overdue-row' : '' },
      td(p.name, h('div', { class: 'muted small' }, p.className)), td(String(p.total)), td(String(p.correct)), td(pct(p.accuracy)), td(pct(p.avgConfidence)), td(p.advice)))),
    h('h2', {}, '자주 헷갈린 기구 짝'),
    table(['짝', '횟수', '자세히'], a.confusedPairs.map((p) => h('tr', {}, td(p.pair), td(String(p.count)), td(p.detail)))),
  );
}

// ═════════════════ 기구 사진 (7-1 "사진(선택)") ═════════════════
// 고른 사진을 가로·세로 1024 이하 JPEG 로 다시 그려서 보냄
// → 휴대폰 사진 속 촬영 위치(GPS)·기기 정보가 지워지고, 파일도 작아짐
async function imageFileToJpeg(file) {
  if (!file || !/^image\//.test(file.type)) throw { message: '사진 파일이 아니에요.', hint: 'JPG 또는 PNG 사진을 골라 주세요.' };
  if (file.size > 25 * 1024 * 1024) throw { message: '사진이 너무 커요.', hint: '25MB 이하 사진을 골라 주세요.' };
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); // 휴대폰 사진의 회전 방향을 반영
  } catch (e) {
    throw { message: '이 사진을 열지 못했어요.', hint: 'JPG·PNG 사진으로 다시 골라 주세요. (아이폰 HEIC 사진은 "가장 호환성 높은 형식"으로 찍거나 JPG 로 바꿔 주세요.)' };
  }
  const MAX = 1024;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height); // 투명 PNG 는 흰 배경으로
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close && bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

function photoSection(e) {
  if (!e) return h('p', { class: 'muted small' }, '기구를 먼저 저장한 뒤 "수정"에서 사진을 넣을 수 있어요.');
  const preview = h('div', { class: 'photo-preview' },
    e.photoUrl ? h('img', { src: e.photoUrl, alt: `${e.name} 사진` }) : h('span', { class: 'muted' }, '사진 없음'));
  const msg = h('div');
  const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', capture: 'environment', style: 'display:none' });
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    msg.replaceChildren(h('p', { class: 'muted' }, '사진을 줄이고 올리는 중…'));
    try {
      const dataUrl = await imageFileToJpeg(file);
      const r = await adminApi(`/equipment/${e.id}/photo`, { dataUrl });
      e.photoUrl = r.url;
      preview.replaceChildren(h('img', { src: r.url, alt: `${e.name} 사진` }));
      msg.replaceChildren(h('div', { class: 'ok-box' }, '✔ 사진을 저장했어요. (촬영 위치 같은 숨은 정보는 지웠어요)'));
    } catch (err) { msg.replaceChildren(errorBox(err)); }
  });
  return h('div', { class: 'photo-box' },
    preview,
    h('div', { class: 'row-actions' },
      h('button', { type: 'button', onclick: () => input.click() }, e.photoUrl ? '📷 사진 바꾸기' : '📷 사진 넣기'),
      h('button', {
        type: 'button',
        onclick: async () => {
          if (!e.photoUrl || !confirm('사진을 지울까요?')) return;
          try { await adminApi(`/equipment/${e.id}/photo/delete`, {}); e.photoUrl = null; preview.replaceChildren(h('span', { class: 'muted' }, '사진 없음')); msg.replaceChildren(); } catch (err) { msg.replaceChildren(errorBox(err)); }
        },
      }, '사진 지우기')),
    h('p', { class: 'muted small' }, '기구 전체가 잘 보이게 찍어 주세요. 학생 얼굴이 나오지 않게 해 주세요. 사진은 바로 저장돼요.'),
    input, msg);
}

// ═════════════════ 기자재 자료집 (인터넷 자료로 만든 예시 목록에서 골라 넣기) ═════════════════
async function tabCatalog() {
  const { items, sources } = await adminApi('/catalog');
  const shown = items.filter((it) => !adminLab || String(it.labId) === String(adminLab));
  const boxes = new Map();
  const srcText = (it) => (it.src.length ? '출처 ' + it.src.map((n) => '[' + n + ']').join('') : '⚠ 일반 지식 — 확인 필요');
  const row = (it) => {
    const cb = h('input', { type: 'checkbox', id: 'cat-' + it.id });
    boxes.set(it.id, cb);
    return h('tr', { class: it.exists ? 'muted' : '' },
      td(cb),
      td(h('label', { for: 'cat-' + it.id, class: 'check-item' }, h('strong', {}, it.name)),
        it.exists ? h('div', { class: 'small' }, '이미 있음 → 넣으면 키워드만 합쳐요') : null),
      td(it.labName), td(it.kind === '안내' ? '📘 안내 전용' : '예약 기구'),
      td(h('span', { class: 'small' }, it.keywords.join(', '))),
      td(h('span', { class: 'small' }, srcText(it))));
  };
  const msg = h('div');
  setContent(
    h('p', { class: 'muted' }, '고등학교 생명과학·화학·물리 실험에서 자주 쓰는 기자재와 쓰이는 실험(키워드) 목록이에요. 우리 학교에 있는 것만 체크해서 넣으세요. 넣은 기자재는 "추천하는 도구"에 바로 쓰여요. 사용법은 비어 있으니 "기구 관리"에서 적어 주세요.'),
    h('div', { class: 'row-actions' },
      h('button', { type: 'button', onclick: () => boxes.forEach((cb) => { cb.checked = true; }) }, '보이는 것 모두 체크'),
      h('button', { type: 'button', onclick: () => boxes.forEach((cb) => { cb.checked = false; }) }, '체크 모두 풀기'),
      h('button', {
        class: 'primary', type: 'button',
        onclick: async () => {
          const ids = [...boxes].filter(([, cb]) => cb.checked).map(([id]) => id);
          if (!ids.length) return msg.replaceChildren(errorBox({ message: '넣을 기자재를 체크해 주세요.' }));
          if (!confirm(ids.length + '개를 실험실에 넣을까요?')) return;
          try {
            const r = await adminApi('/catalog/add', { ids });
            flash(`새로 ${r.added.length}개 추가, ${r.merged.length}개는 키워드만 합쳤어요.`);
            renderTab();
          } catch (err) { msg.replaceChildren(errorBox(err)); }
        },
      }, '✔ 체크한 것 실험실에 넣기')),
    msg,
    table(['', '기자재', '실험실', '종류', '쓰이는 실험(키워드)', '근거'], shown.map(row)),
    h('h2', {}, '참고한 자료'),
    h('ol', { class: 'small' }, ...sources.map((x) => h('li', {}, h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer' }, x.title)))),
    h('p', { class: 'muted small' }, '⚠ 예시 자료예요. 학교 교육과정·교과서에 맞는지 선생님이 검토해 주세요. "일반 지식 — 확인 필요"는 검색 자료로 직접 확인하지 못한 항목이에요.'),
  );
}

// ═════════════════ 16단계: 학생들이 적은 실험 주제 ═════════════════
async function tabTopics() {
  const { items } = await adminApi('/topics?' + labQ());
  setContent(
    h('p', { class: 'muted' }, '학생들이 기구·기자재 화면에서 적은 "어떤 실험에 쓰시나요?" 답이에요 (학번·이름은 저장하지 않아요). 자주 나온 주제를 "키워드에 추가"하면 주제로 찾기가 더 잘 맞아요. 이상한 글은 "삭제"하세요.'),
    ...(items.length ? items.map((it) => h('div', { class: 'card' },
      h('h2', { style: 'margin-top:0' }, it.name),
      h('p', { class: 'small' }, '지금 키워드: ', it.keywords.length ? it.keywords.join(', ') : h('span', { class: 'muted' }, '없음')),
      table(['주제', '횟수', '마지막', ''], it.topics.map((t) => h('tr', {},
        td(t.topic), td(String(t.count)), td(new Date(t.last).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })),
        td(h('div', { class: 'row-actions' },
          it.keywords.includes(t.topic) ? h('span', { class: 'muted small' }, '키워드에 있음')
            : action('키워드에 추가', () => adminApi(`/equipment/${it.equipmentId}/keywords/add`, { keyword: t.topic }), { class: 'primary', done: '키워드에 추가했어요.' }),
          action('삭제', () => adminApi('/topics/delete', { equipmentId: it.equipmentId, topic: t.topic }), { class: 'danger', confirm: `"${t.topic}" 기록 ${t.count}개를 지울까요?`, done: '지웠어요.' }))))))))
      : [h('div', { class: 'card muted' }, '아직 모인 주제가 없어요.')]),
  );
}

// ═════════════════ 실험실 관리 (13단계) ═════════════════
async function tabLabs() {
  await loadLabs();
  const row = (l) => {
    const name = h('input', { type: 'text', maxlength: 20, value: l.name, onfocus: () => { editing = true; }, onblur: () => { editing = false; } });
    const code = h('input', { type: 'text', maxlength: 20, value: l.code, onfocus: () => { editing = true; }, onblur: () => { editing = false; } });
    const sort = h('input', { type: 'number', step: 1, value: l.sort, style: 'width:80px' });
    return h('tr', {}, td(name), td(code), td(sort), td(`기구 ${l.equipmentCount} · 시약 ${l.reagentCount}`),
      td(h('div', { class: 'row-actions' },
        action('저장', () => adminApi(`/labs/${l.id}`, { name: name.value, code: code.value, sort: Number(sort.value) }), { class: 'primary', done: '저장했어요.' }),
        action('삭제', () => adminApi(`/labs/${l.id}/delete`, {}), { class: 'danger', confirm: `${l.name}을(를) 지울까요?`, done: '지웠어요.' }))));
  };
  const nName = h('input', { type: 'text', maxlength: 20, placeholder: '예: 지구과학실' });
  const nCode = h('input', { type: 'text', maxlength: 20, placeholder: '예: earth (영어 소문자)' });
  setContent(
    table(['이름', '영어 코드', '순서', '들어 있는 것', ''], adminLabs.map(row)),
    h('p', { class: 'muted small' }, '영어 코드는 그 실험실 인식 모델 폴더 이름으로 쓰여요 (예: public/model/bio). 시약·기구가 있는 실험실은 지울 수 없어요.'),
    h('form', {
      class: 'card',
      onsubmit: async (ev) => {
        ev.preventDefault();
        try { await adminApi('/labs', { name: nName.value, code: nCode.value, sort: adminLabs.length + 1 }); flash('실험실을 추가했어요.'); renderTab(); } catch (err) { flash(err, true); }
      },
    }, h('h2', { style: 'margin-top:0' }, '+ 실험실 추가'),
      h('div', { class: 'row' }, h('div', {}, h('label', {}, '이름'), nName), h('div', {}, h('label', {}, '영어 코드'), nCode)),
      h('button', { class: 'primary', type: 'submit', style: 'margin-top:12px' }, '추가')),
  );
}

// ═════════════════ 재구매 목록 ═════════════════
async function tabReorder() {
  const { items } = await adminApi('/reorder');
  setContent(table(['시약', '이유', '올라온 시각', ''], items.map((o) => h('tr', {},
    td(o.reagentName), td(o.reason), td(o.created), td(action('구매 완료', () => adminApi(`/reorder/${o.id}/done`, {}), { class: 'primary', done: '목록에서 뺐어요.' }))))));
}

// ═════════════════ 사용 통계 ═════════════════
let statsMonth = '';
async function tabStats() {
  const s = await adminApi('/stats?month=' + encodeURIComponent(statsMonth) + '&' + labQ());
  const month = h('input', { type: 'month', value: s.month, onchange: (e) => { statsMonth = e.target.value; renderTab(); } });
  setContent(
    h('div', { class: 'row-actions' }, h('label', { style: 'margin:0' }, '달 고르기'), month),
    h('h2', {}, `기구별 사용 (${s.month})`),
    table(['기구', '사용 횟수', '총 사용 시간'], s.equipment.map((x) => h('tr', {}, td(x.equipment), td(String(x.count)), td(x.minutesText)))),
    h('h2', {}, `시약별 반출 횟수 (${s.month})`),
    table(['시약', '반출 횟수'], s.reagents.map((x) => h('tr', {}, td(x.reagent), td(String(x.count))))),
    h('p', { class: 'muted small' }, '탐구 보고서에 쓰려면 "전체 기록" 탭에서 CSV 로 내려받아 엑셀로 그래프를 그려도 돼요.'));
}

// ═════════════════ 설정 ═════════════════
async function tabSettings() {
  const { settings: s } = await adminApi('/settings');
  const num = (k, min, max) => h('input', { type: 'number', min, max, step: 1, value: s[k] });
  const f = {
    normal_max_loan_hours: num('normal_max_loan_hours', 1, 720),
    extend_max_hours: num('extend_max_hours', 1, 168),
    high_risk_return_time: h('input', { type: 'time', value: s.high_risk_return_time }),
    reservation_priority_minutes: num('reservation_priority_minutes', 1, 120),
    anonymize_after_year: h('input', { type: 'checkbox', id: 'anon' }),
    queue_enabled: h('input', { type: 'checkbox', id: 'queue' }),
    training_collect: h('input', { type: 'checkbox', id: 'collect' }),
  };
  f.anonymize_after_year.checked = s.anonymize_after_year === '1';
  f.queue_enabled.checked = s.queue_enabled === '1';
  f.training_collect.checked = s.training_collect === '1';
  Object.values(f).forEach((el) => { el.addEventListener('focus', () => { editing = true; }); el.addEventListener('blur', () => { editing = false; }); });
  const msg = h('div');

  setContent(
    h('form', {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value]));
        try { await adminApi('/settings', data); msg.replaceChildren(h('div', { class: 'ok-box' }, '✔ 설정을 저장했어요.')); } catch (err) { msg.replaceChildren(errorBox(err)); }
      },
    }, h('h2', {}, '규칙 설정'),
      h('label', {}, '일반 시약 최장 반출 시간 (시간, 기본 72)'), f.normal_max_loan_hours,
      h('label', {}, '시약 연장 최대 시간 (시간, 기본 24)'), f.extend_max_hours,
      h('label', {}, '고위험 시약 반납 시각 (기본 오후 6시)'), f.high_risk_return_time,
      h('label', {}, '예약 대기 우선 시간 (분, 기본 10)'), f.reservation_priority_minutes,
      h('label', { for: 'queue' }, f.queue_enabled, '기구 대기 기능 쓰기 (끄면 학생은 지금 누가 쓰는지만 봐요. 끄는 순간 남아 있던 대기는 취소돼요)'),
      h('label', { for: 'collect' }, f.training_collect, '태블릿에서 확인한 기구 사진(가운데 부분만)을 학습용으로 모으기 (모델 연결 탭에서 다시 학습할 때 씀)'),
      h('label', { for: 'anon' }, f.anonymize_after_year, '1년 지난 기록의 학번·이름 자동으로 지우기'),
      msg, h('button', { class: 'primary', type: 'submit', style: 'margin-top:16px' }, '저장')),
    synonymCard(),
    h('div', { class: 'card' }, h('h2', {}, '관리자 비밀번호 바꾸기'), passwordForm()),
  );
}

// 16단계: 주제 추천에서 "같은 뜻"으로 볼 말 묶음
function synonymCard() {
  const ta = h('textarea', { rows: 8, onfocus: () => { editing = true; }, onblur: () => { editing = false; } });
  const msg = h('div');
  adminApi('/synonyms').then((r) => { ta.value = r.text || ''; }).catch(() => {});
  return h('form', {
    class: 'card',
    onsubmit: async (e) => {
      e.preventDefault();
      try { const r = await adminApi('/synonyms', { text: ta.value }); msg.replaceChildren(h('div', { class: 'ok-box' }, `✔ 비슷한 말 묶음 ${r.lines}줄을 저장했어요.`)); } catch (err) { msg.replaceChildren(errorBox(err)); }
    },
  }, h('h2', { style: 'margin-top:0' }, '🔎 주제로 찾기 — 비슷한 말'),
    h('p', { class: 'muted small' }, '한 줄에 한 묶음, 쉼표로 나눠 써요. 예: "세균, 박테리아, 미생물" → 학생이 "박테리아"라고 써도 "세균" 키워드 기구를 찾아요.'),
    ta, msg, h('button', { class: 'primary', type: 'submit', style: 'margin-top:12px' }, '저장'));
}

// ═════════════════ 시작 ═════════════════
(async function start() {
  try {
    const me = await api('/api/admin/me');
    if (!me.loggedIn) showLogin();
    else if (me.mustChange) showForceChange();
    else { await initNotices(); showMain(); }
  } catch (err) {
    root.replaceChildren(errorBox(err));
  }
  refreshAlertBar();
  onLive('admin-notice', () => fetchNewNotices());
  // 실시간 소식: 입력 중이 아닐 때만 지금 탭을 다시 그림 (요약·기구 현황·재구매만)
  onLive('change', () => {
    refreshAlertBar();
    if (!editing && content.isConnected && ['home', 'equip', 'reorder'].includes(currentTab)) renderTab();
  });
  connectLive();
})();
