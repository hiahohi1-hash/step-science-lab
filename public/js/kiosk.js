// ─────────────────────────────────────────────
// 태블릿 처음 화면과 각 흐름 (3단계: 시약 반출·반납·연장)
// ─────────────────────────────────────────────

const app = document.getElementById('app');
let meta = null;          // 서버에서 받은 사용 목적, 시간 범위 등
let homeTimer = null;     // 결과 화면 5초 뒤 처음 화면으로 돌아가는 타이머
let idleTimer = null;     // 아무것도 안 누르고 오래 두면 처음 화면으로 (다른 학생이 학번을 보지 못하게)
const IDLE_SECONDS = 90;
// 지금 보고 있는 화면 (실시간 소식이 오면 이 화면만 다시 그림)
// { type: 'home' } 또는 { type: 'equipment', id } 또는 null(입력 중인 화면 → 건드리지 않음)
let currentView = null;
// 16단계: 주제로 찾은 뒤 기구를 고르면, 그 주제를 기구 화면의 "어떤 실험에 쓰시나요?" 칸에 미리 넣어 줌
let pendingTopic = '';

// ── 13단계: 이 태블릿이 놓인 실험실 ──
// 태블릿 브라우저에 기억해 둠 (다른 기기와 공유되지 않음). 개인정보 보호 모드 등에서 막혀도 화면은 동작하게 try 로 감쌈
const LAB_KEY = 'lab-kiosk-lab';
let labs = [];
let kioskLab = (() => { try { return JSON.parse(localStorage.getItem(LAB_KEY) || 'null'); } catch (e) { return null; } })();
function saveKioskLab(lab) {
  kioskLab = lab;
  try { localStorage.setItem(LAB_KEY, JSON.stringify({ id: lab.id, name: lab.name })); } catch (e) { /* 기억 못 해도 지금은 동작 */ }
}
// 서버 주소에 붙일 "lab=번호" (실험실이 안 정해졌으면 모든 실험실)
const labParam = () => (kioskLab ? 'lab=' + kioskLab.id : '');

// "이 태블릿은 어느 실험실에 있나요?"
function chooseLab(first) {
  show(
    first ? null : topNav('실험실 바꾸기'),
    h('h1', {}, '🏫 이 태블릿은 어느 실험실에 있나요?'),
    h('p', { class: 'muted center' }, '고른 실험실의 기구만 찾기·카메라 인식·상태 줄에 보여요. 나중에 처음 화면 맨 아래에서 바꿀 수 있어요.'),
    h('div', { class: 'grid lab-grid' }, ...labs.map((l) => h('button', {
      class: 'big' + (kioskLab && kioskLab.id === l.id ? ' selected' : ''),
      onclick: () => { saveKioskLab(l); home(); },
    }, l.name))),
  );
}

// 화면을 떠날 때 할 일 (예: 카메라 끄기). 카메라 화면이 onLeave(끄는 함수)로 등록함
let leaveHook = null;
function onLeave(fn) { leaveHook = fn; }

// 화면 바꾸기: 지금 내용을 지우고 새 내용을 그림
function show(...nodes) {
  clearTimeout(homeTimer);
  currentView = null;
  if (leaveHook) { const fn = leaveHook; leaveHook = null; fn(); }
  app.replaceChildren(...nodes.filter(Boolean)); // 비어 있는(null) 칸은 빼고 그림
  window.scrollTo(0, 0);
  const first = app.querySelector('input:not([type=checkbox]):not([data-noautofocus])');
  if (first) first.focus();
}

// 화면 위쪽 "처음으로" 줄
function topNav(title) {
  return h('div', { class: 'top-nav' },
    h('button', { onclick: home }, '← 처음으로'),
    h('span', { class: 'muted' }, title || ''));
}

// 아무것도 안 누르면 처음 화면으로
function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(home, IDLE_SECONDS * 1000);
}
['click', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, resetIdle, { passive: true }));

// ═════════════════ 처음 화면 (4번) ═════════════════
function home() {
  clearTimeout(idleTimer);
  pendingRecognition = null; // 기구 인식 도중 처음으로 돌아오면 기록하지 않음
  pendingTopic = '';
  const reagentSearch = h('input', { type: 'search', placeholder: '시약 이름이나 카스 번호 (예: 염산, 7647-01-0)', 'aria-label': '시약 직접 찾기' });
  const equipSearch = h('input', { type: 'search', placeholder: '기구 이름 (예: 배양기, 멸균기)', 'aria-label': '기구 직접 찾기' });
  const topicSearch = h('input', { type: 'search', maxlength: 100, placeholder: '주제를 입력해주세요', 'aria-label': '추천하는 도구' });

  // 6-4 "알림 소리 켜기" (브라우저 규칙상 한 번 눌러야 소리를 낼 수 있음)
  const soundBtn = soundEnabled()
    ? h('span', { class: 'muted' }, '🔔 알림 소리 켜짐')
    : h('button', { class: 'sound-btn', onclick: () => { enableSound(); home(); } }, '🔇 알림 소리 켜기');

  show(
    h('div', { class: 'top-nav' }, h('span'), soundBtn),
    h('h1', {}, '🧪 과학실 관리', kioskLab ? h('span', { class: 'lab-name' }, kioskLab.name) : null),
    h('button', { class: 'big primary', onclick: openScanner }, '📷 카메라로 찍기'),
    h('div', { class: 'row', style: 'margin-top:16px' },
      h('button', { onclick: () => askStudentId('반납', null) }, '시약 반납하기'),
      h('button', { onclick: () => askStudentId('연장', null) }, '시약 연장하기'),
      h('button', { onclick: () => { location.href = '/status' + (kioskLab ? '?lab=' + kioskLab.id : ''); } }, '기구 현황 보기'),
    ),
    h('div', { class: 'card' },
      h('label', {}, '🔎 추천하는 도구'),
      h('form', { onsubmit: (e) => { e.preventDefault(); showRecommend(topicSearch.value); } },
        h('div', { class: 'row' }, topicSearch, h('button', { class: 'primary', type: 'submit', style: 'flex:0 0 120px' }, '찾기'))),
      h('label', {}, '🔍 시약 직접 찾기'),
      h('form', { onsubmit: (e) => { e.preventDefault(); searchReagent(reagentSearch.value); } },
        h('div', { class: 'row' }, reagentSearch, h('button', { class: 'primary', type: 'submit', style: 'flex:0 0 120px' }, '찾기'))),
      h('label', {}, '🔍 기구 직접 찾기'),
      h('form', { onsubmit: (e) => { e.preventDefault(); searchEquipment(equipSearch.value); } },
        h('div', { class: 'row' }, equipSearch, h('button', { class: 'primary', type: 'submit', style: 'flex:0 0 120px' }, '찾기'))),
    ),
    h('h2', {}, `기구 지금 상태${kioskLab ? ` (${kioskLab.name})` : ''}`),
    h('div', { id: 'equip-strip', class: 'equip-strip' }, h('span', { class: 'muted' }, '불러오는 중…')),
    h('p', { class: 'center', style: 'margin-top:40px' },
      h('button', { class: 'link-btn', onclick: () => chooseLab(false) }, `🏫 실험실 바꾸기 (지금: ${kioskLab ? kioskLab.name : '모든 실험실'})`)),
  );
  currentView = { type: 'home' };
  loadEquipStrip();
  // 처음 화면에서는 검색 칸에 자동으로 키보드가 올라오지 않게 함
  document.activeElement && document.activeElement.blur();
}

// 처음 화면 아래쪽 기구 상태 줄 (7-4 "곧 사용 가능 (10분 남음)" 포함)
async function loadEquipStrip() {
  const strip = document.getElementById('equip-strip');
  if (!strip) return;
  try {
    const { groups } = await api('/api/equipment?' + labParam());
    const units = groups.flatMap((g) => g.units).filter((u) => !u.isGuide); // 안내 전용은 상태가 없으니 뺌
    if (!units.length) {
      strip.replaceChildren(h('p', { class: 'muted' }, '이 실험실에 등록된 기구가 아직 없어요. 선생님이 관리자 화면 "기구 관리"에서 추가할 수 있어요.'));
      return;
    }
    strip.replaceChildren(...units.map((u) => h('div', {
      class: 'mini-card', role: 'button', onclick: () => openEquipment(u.id),
    },
      h('div', { class: 'mini-name' }, u.displayName),
      statusBadge(u.status),
      u.current ? h('div', { class: 'muted' }, `${u.current.remainingText} 남음`) : null,
      u.current && u.current.endingSoon ? h('div', { class: 'badge warn' }, `곧 사용 가능 (${u.current.remainingMinutes}분 남음)`) : null,
      u.turn ? h('div', { class: 'muted' }, `대기 1번 ${u.turn.student} 우선 (${u.turn.remainingMinutes}분)`) : null,
      u.waitingCount ? h('div', { class: 'muted' }, `대기 ${u.waitingCount}명`) : null)));
  } catch (err) {
    strip.replaceChildren(errorBox(err));
  }
}

// 7-4 위험 기구가 끝났을 때: 소리 + 크게 안내 (화면을 누르면 닫힘)
function showDangerNotice(data) {
  beep(5, 990);
  const overlay = h('div', { class: 'overlay', role: 'alertdialog', onclick: () => overlay.remove() },
    h('div', { class: 'overlay-box' },
      h('div', { class: 'overlay-title' }, `⚠ ${data.displayName} 사용 시간이 끝났습니다`),
      h('div', { class: 'overlay-main' }, '압력과 온도가 내려간 것을 확인한 뒤 여세요'),
      h('div', { class: 'muted' }, '화면을 누르면 닫혀요')));
  document.body.append(overlay);
}

// 아직 만들지 않은 기능 안내
function notReady(text) {
  showResult(false, '아직 준비 중이에요', [text]);
}

// ═════════════════ 결과 화면 + 5초 뒤 처음으로 (4번) ═════════════════
function showResult(success, title, lines) {
  let left = 5;
  const count = h('div', { class: 'countdown' }, `${left}초 뒤 처음 화면으로 돌아가요`);
  show(h('div', { class: 'result ' + (success ? 'success' : 'fail') },
    h('div', { class: 'icon' }, success ? '✔' : '!'),
    h('h2', {}, title),
    ...lines.filter(Boolean).map((l) => h('p', {}, l)),
    h('button', { class: 'primary', onclick: home }, '처음 화면으로'),
    count));
  const tick = () => {
    left -= 1;
    if (left <= 0) return home();
    count.textContent = `${left}초 뒤 처음 화면으로 돌아가요`;
    homeTimer = setTimeout(tick, 1000);
  };
  homeTimer = setTimeout(tick, 1000);
}

// ═════════════════ 시약 찾기 (5-2 ③ 직접 선택) ═════════════════
async function searchReagent(q, purpose) {
  const box = h('div', {}, h('p', { class: 'muted' }, '찾는 중…'));
  const input = h('input', { type: 'search', value: q || '', placeholder: '시약 이름이나 카스 번호' });
  show(
    topNav(purpose === '반납' ? '반납할 시약 고르기' : '시약 찾기'),
    h('h2', {}, '시약 고르기'),
    h('form', { onsubmit: (e) => { e.preventDefault(); searchReagent(input.value, purpose); } },
      h('div', { class: 'row' }, input, h('button', { class: 'primary', type: 'submit', style: 'flex:0 0 120px' }, '찾기'))),
    box,
  );
  try {
    // 이 실험실 시약을 먼저 찾고, 없으면 다른 실험실 시약도 찾아봄 (반납하러 온 경우 등)
    let { reagents } = await api('/api/reagents?q=' + encodeURIComponent(q || '') + '&' + labParam());
    let otherLabs = false;
    if (reagents.length === 0 && kioskLab && q) {
      reagents = (await api('/api/reagents?q=' + encodeURIComponent(q))).reagents;
      otherLabs = reagents.length > 0;
    }
    if (reagents.length === 0) {
      box.replaceChildren(h('p', {}, '찾는 시약이 없어요. 이름을 줄여서(예: "염") 다시 찾아 보세요.'));
      return;
    }
    box.replaceChildren(otherLabs ? h('p', { class: 'badge warn' }, `${kioskLab.name}에는 없어서 다른 실험실 시약을 보여 드려요.`) : '',
      ...reagents.map((r) => h('div', {
      class: 'card clickable',
      role: 'button',
      tabindex: 0,
      onclick: () => (purpose === '반납' ? askStudentId('반납', r) : confirmReagent(r.id)),
    },
      h('strong', {}, r.name), ' ', hazardBadge(r.hazard),
      h('div', { class: 'muted' }, `${otherLabs ? r.labName + ' · ' : ''}카스 번호 ${r.cas_number || '-'} · ${r.location} · 남은 병 ${r.available}/${r.quantity}`))));
  } catch (err) {
    box.replaceChildren(errorBox(err));
  }
}

function hazardBadge(hazard) {
  return h('span', { class: 'badge ' + (hazard === '고위험' ? 'high' : 'normal') }, hazard);
}

// ═════════════════ "이 시약이 맞나요?" 확인 (5-2 마지막) ═════════════════
async function confirmReagent(id) {
  try {
    const { reagent: r } = await api('/api/reagents/' + id);
    const none = r.available <= 0;
    show(
      topNav('시약 확인'),
      h('div', { class: 'card center' },
        h('div', { class: 'big-name' }, r.name),
        h('p', {}, hazardBadge(r.hazard)),
        h('p', {}, `보관 위치: ${r.location}`),
        h('p', {}, `남은 병: `, h('strong', {}, `${r.available}병`), ` (전체 ${r.quantity}병)`),
        r.hazard === '고위험' ? h('p', { class: 'muted' }, `고위험 시약은 선생님 승인 후 반출되고, 오늘 ${meta.highRiskReturnTime}까지 반납해야 해요.`) : null,
      ),
      h('h2', { class: 'center' }, '이 시약이 맞나요?'),
      none ? errorBox({ message: '남은 병이 없어서 지금은 반출할 수 없어요.', hint: '다른 사람이 반납한 뒤에 다시 시도해 주세요.' }) : null,
      h('div', { class: 'row' },
        h('button', { class: 'primary', disabled: none, onclick: () => checkoutForm(r) }, '예, 반출할게요'),
        h('button', { onclick: () => askStudentId('반납', r) }, '이 시약 반납하기'),
        h('button', { onclick: () => searchReagent('') }, '아니오, 다시 찾기'),
      ),
    );
  } catch (err) {
    show(topNav(), errorBox(err));
  }
}

// ═════════════════ 6-1 반출하기 ═════════════════
function checkoutForm(r) {
  const isHigh = r.hazard === '고위험';
  const sid = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: 10, placeholder: '예: 20315' });
  const name = h('input', { type: 'text', autocomplete: 'off', maxlength: 20, placeholder: '예: 홍길동' });
  const other = h('input', { type: 'text', maxlength: 100, placeholder: '사용 목적을 적어 주세요', style: 'display:none;margin-top:12px' });
  const msg = h('div');
  let purpose = null;
  let hours = null;

  // 사용 목적 버튼 (하나만 고를 수 있음)
  const purposeBtns = meta.purposes.map((p) => h('button', {
    type: 'button',
    onclick: (e) => {
      purpose = p;
      purposeBtns.forEach((b) => b.classList.toggle('selected', b === e.currentTarget));
      other.style.display = p === '기타' ? '' : 'none';
      if (p === '기타') other.focus();
    },
  }, p === '기타' ? '기타(직접 입력)' : p));

  // 반납 기한 고르기 (일반 시약만)
  let dueSection;
  if (isHigh) {
    dueSection = h('div', { class: 'card' }, `반납 기한: 오늘 ${meta.highRiskReturnTime}까지 (자동으로 정해져요)`);
  } else {
    const choices = [1, 2, 3, 6, 12, 24, 48, 72].filter((x) => x >= meta.minHours && x <= meta.maxHours);
    const custom = h('input', { type: 'number', min: meta.minHours, max: meta.maxHours, step: 1, inputmode: 'numeric', placeholder: `직접 입력 (${meta.minHours}~${meta.maxHours}시간)` });
    const hourBtns = choices.map((x) => h('button', {
      type: 'button',
      onclick: (e) => {
        hours = x; custom.value = '';
        hourBtns.forEach((b) => b.classList.toggle('selected', b === e.currentTarget));
      },
    }, x >= 24 && x % 24 === 0 ? `${x / 24}일` : `${x}시간`));
    custom.addEventListener('input', () => {
      hours = custom.value === '' ? null : Number(custom.value);
      hourBtns.forEach((b) => b.classList.remove('selected'));
    });
    dueSection = h('div', {}, h('div', { class: 'grid' }, ...hourBtns), h('div', { style: 'margin-top:12px' }, custom));
  }

  async function submit(e) {
    e.preventDefault();
    msg.replaceChildren();
    if (!purpose) return msg.replaceChildren(errorBox({ message: '사용 목적을 골라 주세요.' }));
    if (!isHigh && !hours) return msg.replaceChildren(errorBox({ message: '반납 기한을 골라 주세요.' }));
    submitBtn.disabled = true;
    try {
      const res = await api('/api/reagents/loans', {
        reagentId: r.id, studentId: sid.value, studentName: name.value,
        purpose, purposeOther: other.value, hours,
      });
      if (res.status === '승인 대기') {
        showResult(true, `${res.reagentName} 반출 신청 완료`, [
          '선생님 승인을 기다리는 중이에요. 승인되면 시약을 가져갈 수 있어요.',
          `반납 기한: ${res.due.text}`,
        ]);
      } else {
        showResult(true, `${res.reagentName} 반출 완료`, [`반납 기한: ${res.due.text}`, '기한 안에 꼭 반납해 주세요.']);
      }
    } catch (err) {
      submitBtn.disabled = false;
      msg.replaceChildren(errorBox(err));
      msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  const submitBtn = h('button', { class: 'primary', type: 'submit', style: 'width:100%;margin-top:24px' }, isHigh ? '반출 신청 (승인 요청)' : '반출하기');

  show(
    topNav(`${r.name} 반출`),
    h('h2', {}, `${r.name} 반출하기 `, hazardBadge(r.hazard)),
    h('form', { onsubmit: submit },
      h('label', {}, '학번'), sid,
      h('label', {}, '이름'), name,
      h('label', {}, '사용 목적'), h('div', { class: 'grid' }, ...purposeBtns), other,
      h('label', {}, '반납 기한'), dueSection,
      msg,
      submitBtn,
    ),
  );
}

// ═════════════════ 6-2, 6-3 학번 입력 → 내 기록 ═════════════════
// mode: '반납' 또는 '연장', reagent: 반납할 시약을 이미 골랐으면 그 시약
function askStudentId(mode, reagent) {
  const sid = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: 10, placeholder: '예: 20315' });
  const msg = h('div');
  show(
    topNav(mode === '반납' ? '시약 반납' : '시약 연장'),
    h('h2', {}, mode === '반납' ? `${reagent ? reagent.name + ' ' : ''}반납하기` : '시약 연장하기'),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        msg.replaceChildren();
        try {
          const { loans } = await api('/api/reagents/loans/mine', { studentId: sid.value, reagentId: reagent ? reagent.id : null });
          showMyLoans(mode, sid.value.trim(), loans, reagent);
        } catch (err) {
          msg.replaceChildren(errorBox(err));
        }
      },
    },
      h('label', {}, '학번을 입력하세요'), sid, msg,
      h('button', { class: 'primary', type: 'submit', style: 'width:100%;margin-top:16px' }, '내 기록 보기')),
  );
}

function showMyLoans(mode, studentId, loans, reagent) {
  const list = loans.filter((l) => l.status !== '승인 대기' || mode === '반납');
  const cards = list.map((l) => {
    const blocked = mode === '연장' && !l.canExtend;
    const pending = l.status === '승인 대기';
    return h('div', {
      class: 'card ' + (l.overdue ? 'overdue ' : '') + (blocked || pending ? '' : 'clickable'),
      role: blocked || pending ? null : 'button',
      onclick: blocked || pending ? null : () => (mode === '반납' ? returnForm(studentId, l) : extendForm(studentId, l)),
    },
      h('strong', {}, l.reagentName), ' ', hazardBadge(l.hazard), ' ',
      l.overdue ? h('span', { class: 'badge high' }, '연체') : null,
      pending ? h('span', { class: 'badge warn' }, '승인 대기') : null,
      h('div', {}, `반납 기한: ${l.due.text}`),
      blocked ? h('div', { class: 'muted' }, '연장 불가: ' + l.extendBlockedReason) : null,
      pending ? h('div', { class: 'muted' }, '선생님 승인 전이라 아직 반납할 수 없어요.') : null);
  });

  show(
    topNav(mode === '반납' ? '시약 반납' : '시약 연장'),
    h('h2', {}, `학번 ${maskId(studentId)}의 ${mode === '반납' ? '반납할' : '연장할'} 기록`),
    cards.length ? h('p', { class: 'muted' }, mode === '반납' ? '반납할 기록을 누르세요.' : '연장할 기록을 누르세요.') : null,
    ...(cards.length ? cards : [h('div', { class: 'card' },
      reagent ? `이 학번으로 반출 중인 ${reagent.name} 기록이 없어요.` : '이 학번으로 반출 중인 시약이 없어요.',
      h('div', { class: 'muted' }, '학번을 다시 확인해 주세요.'))]),
  );
}

// ═════════════════ 6-3 반납하기 ═════════════════
function returnForm(studentId, loan) {
  const record = h('input', { type: 'checkbox', id: 'record-amount' }); // 기본값: 체크 안 됨
  let amount = null;
  const amountBtns = meta.amounts.map((a) => h('button', {
    type: 'button',
    onclick: (e) => { amount = a; amountBtns.forEach((b) => b.classList.toggle('selected', b === e.currentTarget)); },
  }, a));
  const amountBox = h('div', { class: 'grid', style: 'display:none;margin-top:12px' }, ...amountBtns);
  record.addEventListener('change', () => {
    amountBox.style.display = record.checked ? '' : 'none';
    if (!record.checked) { amount = null; amountBtns.forEach((b) => b.classList.remove('selected')); }
  });
  const msg = h('div');

  async function submit() {
    msg.replaceChildren();
    if (record.checked && !amount) return msg.replaceChildren(errorBox({ message: '남은 양을 골라 주세요.', hint: '기록하지 않으려면 체크를 풀어 주세요.' }));
    try {
      const res = await api(`/api/reagents/loans/${loan.id}/return`, { studentId, amount: record.checked ? amount : null });
      showResult(true, `${res.reagentName} 반납 완료`, [
        `남은 양: ${res.remaining}`,
        res.reorder ? '남은 양이 적어서 선생님께 재구매 알림을 보냈어요.' : '시약장 제자리에 넣어 주세요.',
      ]);
    } catch (err) {
      msg.replaceChildren(errorBox(err));
    }
  }

  show(
    topNav('시약 반납'),
    h('h2', {}, `${loan.reagentName} 반납`),
    h('div', { class: 'card' + (loan.overdue ? ' overdue' : '') }, `반납 기한: ${loan.due.text}`, loan.overdue ? ' (기한 지남)' : ''),
    h('label', { for: 'record-amount' }, record, '남은 양 기록하기 (선택)'),
    amountBox,
    msg,
    h('button', { class: 'primary', style: 'width:100%;margin-top:24px', onclick: submit }, '반납하기'),
  );
}

// ═════════════════ 6-2 연장하기 ═════════════════
function extendForm(studentId, loan) {
  let hours = null;
  const choices = [1, 2, 3, 6, 12, 24].filter((x) => x <= meta.extendMaxHours);
  const btns = choices.map((x) => h('button', {
    type: 'button',
    onclick: (e) => { hours = x; btns.forEach((b) => b.classList.toggle('selected', b === e.currentTarget)); },
  }, `${x}시간`));
  const msg = h('div');

  async function submit() {
    msg.replaceChildren();
    if (!hours) return msg.replaceChildren(errorBox({ message: '연장할 시간을 골라 주세요.' }));
    try {
      const res = await api(`/api/reagents/loans/${loan.id}/extend`, { studentId, hours });
      showResult(true, `${res.reagentName} 연장 완료`, [`새 반납 기한: ${res.due.text}`, '연장은 한 번만 할 수 있어요.']);
    } catch (err) {
      msg.replaceChildren(errorBox(err));
    }
  }

  show(
    topNav('시약 연장'),
    h('h2', {}, `${loan.reagentName} 연장`),
    h('div', { class: 'card' }, `지금 반납 기한: ${loan.due.text}`),
    h('label', {}, `얼마나 연장할까요? (최대 ${meta.extendMaxHours}시간, 한 번만 가능)`),
    h('div', { class: 'grid' }, ...btns),
    msg,
    h('button', { class: 'primary', style: 'width:100%;margin-top:24px', onclick: submit }, '연장하기'),
  );
}

// ═════════════════ 시작 ═════════════════
(async function start() {
  try {
    meta = await api('/api/reagents/meta');
    // 13단계: 이 태블릿의 실험실이 정해져 있지 않거나 없어진 실험실이면 먼저 고르게 함
    labs = (await api('/api/labs')).labs;
    if (!kioskLab || !labs.some((l) => l.id === kioskLab.id)) chooseLab(true);
    else { kioskLab = labs.find((l) => l.id === kioskLab.id); home(); }
    refreshAlertBar();

    // ── 실시간 소식 연결 (5단계) ──
    onLive('change', () => {
      refreshAlertBar();
      // 학생이 입력 중인 화면은 건드리지 않고, 보기만 하는 화면만 다시 그림
      if (currentView && currentView.type === 'home') loadEquipStrip();
      if (currentView && currentView.type === 'equipment') openEquipment(currentView.id);
    });
    onLive('overdue-new', () => beep(3, 880));          // 새 연체 → 삐 3번
    onLive('equipment-finished', (d) => { if (d.isDangerous) showDangerNotice(d); });
    connectLive();
  } catch (err) {
    show(h('h1', {}, '🧪 과학실 관리'), errorBox(err), h('button', { onclick: () => location.reload() }, '다시 시도'));
  }
})();
