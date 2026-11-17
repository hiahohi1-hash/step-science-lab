// ─────────────────────────────────────────────
// 기구 흐름 (7-3): 기구 찾기 → (여러 대면 고르기) → 상황 A / B / C
// kiosk.js 의 show(), topNav(), showResult() 를 같이 씁니다.
// ─────────────────────────────────────────────

// 사용 중·예약 대기 상태를 한 줄로 설명
function statusLine(eq) {
  if (eq.status === '사용 중' && eq.current) {
    // 대기 기능이 꺼져 있으면 "지금 누가 쓰고 있고 언제 끝나는지"만
    return `사용 중입니다 (사용자 ${eq.current.student}). ${eq.current.remainingText} 남음 (${eq.current.endsText} 종료 예정)` + (eq.queueEnabled ? `, 대기 ${eq.waitingCount}명` : '');
  }
  if (eq.status === '예약 대기' && eq.turn) {
    return `대기 1번 학번 ${eq.turn.student} 우선 사용 (${eq.turn.deadlineText}까지, ${eq.turn.remainingMinutes}분 남음), 그 뒤 대기 ${eq.waitingCount}명`;
  }
  if (eq.status === '점검 중') return '점검 중이라 지금은 사용할 수 없어요.';
  return '지금 바로 사용할 수 있어요.';
}

// ═════════════════ 기구 찾기 ═════════════════
async function searchEquipment(q) {
  const box = h('div', {}, h('p', { class: 'muted' }, '찾는 중…'));
  const input = h('input', { type: 'search', value: q || '', placeholder: '기구 이름 (예: 배양기)' });
  show(
    topNav('기구 찾기'),
    h('h2', {}, '기구 고르기'),
    h('form', { onsubmit: (e) => { e.preventDefault(); searchEquipment(input.value); } },
      h('div', { class: 'row' }, input, h('button', { class: 'primary', type: 'submit', style: 'flex:0 0 120px' }, '찾기'))),
    box,
  );
  try {
    const { groups } = await api('/api/equipment?q=' + encodeURIComponent(q || '') + '&' + labParam());
    if (groups.length === 0) {
      box.replaceChildren(h('p', {}, '찾는 기구가 없어요. 이름을 줄여서 다시 찾아 보세요.'));
      return;
    }
    box.replaceChildren(...groups.map((g) => h('div', {
      class: 'card clickable', role: 'button',
      onclick: () => (g.units.length > 1 ? chooseUnit(g.units) : openEquipment(g.units[0].id)),
    },
      h('strong', {}, g.name), g.units.length > 1 ? h('span', { class: 'muted' }, ` (${g.units.length}대)`) : null,
      ...g.units.map((u) => h('div', {}, g.units.length > 1 ? u.unitLabel + ' ' : '', kindOrStatusBadge(u))))));
  } catch (err) {
    box.replaceChildren(errorBox(err));
  }
}

// ═════════════════ 11-2-6 같은 종류가 여러 대일 때 고르기 ═════════════════
function chooseUnit(units) {
  show(
    topNav('기구 고르기'),
    h('h2', {}, `어느 ${units[0].name}인가요?`),
    h('div', { class: 'row' }, ...units.map((u) => h('button', { class: 'unit-btn', onclick: () => openEquipment(u.id) },
      u.photoUrl ? h('img', { src: u.photoUrl, alt: '', class: 'unit-photo' }) : null,
      h('div', { class: 'big-label' }, u.unitLabel || u.displayName), h('div', {}, kindOrStatusBadge(u))))),
  );
}

// ═════════════════ 기구 화면 (상태에 따라 상황 A / B / 예약 대기 / 점검 중) ═════════════════
async function openEquipment(id) {
  let eq;
  try {
    ({ equipment: eq } = await api('/api/equipment/' + id));
  } catch (err) {
    return show(topNav(), errorBox(err));
  }
  // 카메라 인식으로 들어왔으면, 사용자가 최종 확인한 이 기구와 함께 인식 기록을 남김 (11-4)
  logRecognitionIfAny(eq.id);
  // 14단계: 안내 전용 기구(마이크로피펫 등)는 예약 없이 사용법 화면으로 바로
  if (eq.isGuide) return showGuide(eq);
  const header = h('div', { class: 'card center' },
    eq.photoUrl ? h('img', { src: eq.photoUrl, alt: `${eq.displayName} 사진`, class: 'equip-photo' }) : null,
    h('div', { class: 'big-name' }, eq.displayName),
    h('p', {}, statusBadge(eq.status)),
    h('p', {}, statusLine(eq)),
    eq.justFinished ? h('p', { class: 'badge warn' }, '방금 사용이 끝났습니다. 안에 이전 사용자의 물건이 남아 있을 수 있으니 확인하세요') : null,
    eq.current && eq.current.endingSoon ? h('p', { class: 'badge warn' }, `곧 사용 가능 (${eq.current.remainingMinutes}분 남음)`) : null,
  );
  const howtoBtn = h('button', { onclick: () => showHowto(eq) }, '사용법 보기');

  if (eq.status === '사용 가능') {
    // 상황 A
    show(topNav(eq.displayName), header,
      h('h2', { class: 'center' }, `${josa(eq.displayName, '을', '를')} 사용하실 건가요?`),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => startStep1(eq) }, '예'),
        h('button', { onclick: () => showHowto(eq) }, '아니오 (사용법 보기)')));
  } else if (eq.status === '사용 중') {
    // 상황 B (다른 사람) + 상황 C (본인) 들어가는 버튼
    show(topNav(eq.displayName), header,
      h('div', { class: 'row' },
        eq.queueEnabled ? h('button', { class: 'primary', onclick: () => queueForm(eq) }, '대기 등록하기') : null,
        howtoBtn),
      h('div', { class: 'row', style: 'margin-top:12px' },
        h('button', { onclick: () => askMine(eq) }, '제가 사용 중이에요 (일찍 끝남·연장)')));
  } else if (eq.status === '예약 대기') {
    show(topNav(eq.displayName), header,
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => startStep1(eq, true) }, '제 차례예요 (사용 시작)'),
        h('button', { onclick: () => queueForm(eq) }, '대기 등록하기'),
        howtoBtn));
  } else {
    show(topNav(eq.displayName), header, h('div', { class: 'row' }, howtoBtn));
  }
  // 이 화면은 "보기만 하는 화면"이라 상태가 바뀌면 자동으로 다시 그림 (5단계 실시간 갱신)
  currentView = { type: 'equipment', id: eq.id };
}

// ═════════════════ 사용법과 주의사항 ═════════════════
function showHowto(eq) {
  const list = (items) => h('ol', { class: 'howto' }, ...items.map((s) => (s.startsWith('⚠') ? h('p', { class: 'sample-notice' }, s) : h('li', {}, s.replace(/^\d+\.\s*/, '')))));
  show(
    topNav(eq.displayName),
    h('h2', {}, `${eq.displayName} 사용법`),
    eq.photoUrl ? h('img', { src: eq.photoUrl, alt: `${eq.displayName} 사진`, class: 'equip-photo' }) : null,
    h('div', { class: 'card' }, list(eq.howto)),
    h('h2', {}, '⚠ 주의사항'),
    h('div', { class: 'card' }, list(eq.cautions)),
    h('h2', {}, '사용 전 필수 확인 사항'),
    h('div', { class: 'card' }, h('ul', {}, ...eq.checklist.map((c) => h('li', {}, c)))),
    h('button', { onclick: () => openEquipment(eq.id), style: 'width:100%' }, '← 기구 화면으로'),
  );
}

// 학번·이름 입력 칸
function studentInputs() {
  return {
    sid: h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: 10, placeholder: '예: 20315' }),
    name: h('input', { type: 'text', autocomplete: 'off', maxlength: 20, placeholder: '예: 홍길동' }),
  };
}

// 시간 직접 입력 칸 (시간 + 분) → 총 분
function durationInput(maxMinutes) {
  const hh = h('input', { type: 'number', min: 0, max: Math.floor(maxMinutes / 60), step: 1, inputmode: 'numeric', placeholder: '시간' });
  const mm = h('input', { type: 'number', min: 0, max: 59, step: 1, inputmode: 'numeric', placeholder: '분' });
  return {
    el: h('div', { class: 'row' }, h('div', {}, hh, ' 시간'), h('div', {}, mm, ' 분')),
    value: () => (hh.value === '' && mm.value === '' ? null : Number(hh.value || 0) * 60 + Number(mm.value || 0)),
    clear: () => { hh.value = ''; mm.value = ''; },
    onInput: (fn) => { hh.addEventListener('input', fn); mm.addEventListener('input', fn); },
  };
}

// ═════════════════ 상황 A ① 학번, 이름 ═════════════════
// 16단계: "어떤 실험(주제)에 쓰시나요? (선택)" 입력 칸 — 학번·이름 없이 주제만 모아서 추천에 씀
function topicInput() {
  return h('input', {
    type: 'text', maxlength: 100, autocomplete: 'off', value: pendingTopic || '', 'data-noautofocus': true,
    placeholder: '예: 효모 발효, 효소 반응 (선택, 이름·학번은 쓰지 마세요)',
  });
}

function startStep1(eq, isTurn) {
  const { sid, name } = studentInputs();
  const topic = topicInput();
  const msg = h('div');
  show(
    topNav(eq.displayName),
    h('h2', {}, isTurn ? `${eq.displayName} — 내 차례 사용 시작` : `${eq.displayName} 사용 시작 (1/3)`),
    h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        if (!/^\d{4,10}$/.test(sid.value.trim())) return msg.replaceChildren(errorBox({ message: '학번은 숫자 4~10자리로 입력해 주세요.' }));
        if (!name.value.trim()) return msg.replaceChildren(errorBox({ message: '이름을 입력해 주세요.' }));
        startStep2(eq, { studentId: sid.value.trim(), studentName: name.value.trim(), topic: topic.value.trim() });
      },
    },
      h('label', {}, '학번'), sid, h('label', {}, '이름'), name,
      h('label', {}, '어떤 실험(주제)에 쓰시나요? ', h('span', { class: 'muted small' }, '(선택)')), topic,
      msg,
      h('button', { class: 'primary', type: 'submit', style: 'width:100%;margin-top:24px' }, '다음')),
  );
}

// ═════════════════ 상황 A ② 몇 시간 사용? ═════════════════
function startStep2(eq, who) {
  let minutes = null;
  const custom = durationInput(eq.maxMinutes);
  const btns = eq.timeOptions.map((o) => h('button', {
    type: 'button',
    onclick: (e) => { minutes = o.minutes; custom.clear(); btns.forEach((b) => b.classList.toggle('selected', b === e.currentTarget)); },
  }, o.label));
  custom.onInput(() => { minutes = custom.value(); btns.forEach((b) => b.classList.remove('selected')); });
  const msg = h('div');

  show(
    topNav(eq.displayName),
    h('h2', {}, `몇 시간 사용하실 건가요? (2/3)`),
    h('div', { class: 'grid' }, ...btns),
    h('label', {}, `직접 입력 (최대 ${eq.maxText})`), custom.el,
    msg,
    h('button', {
      class: 'primary', style: 'width:100%;margin-top:24px',
      onclick: () => {
        if (!minutes || minutes < 1) return msg.replaceChildren(errorBox({ message: '사용 시간을 골라 주세요.' }));
        if (minutes > eq.maxMinutes) return msg.replaceChildren(errorBox({ message: `최대 사용 시간은 ${eq.maxText}이에요.`, hint: '더 짧게 정해 주세요.' }));
        startStep3(eq, who, minutes);
      },
    }, '다음'),
  );
}

// ═════════════════ 상황 A ③ 필수 확인 사항 → ④ 사용 시작 → ⑤ 완료 ═════════════════
function startStep3(eq, who, minutes) {
  const msg = h('div');
  const boxes = eq.checklist.map((c, i) => h('input', { type: 'checkbox', id: 'chk' + i }));
  const startBtn = h('button', { class: 'primary', style: 'width:100%;margin-top:24px', disabled: boxes.length > 0 }, '사용 시작');
  // 모두 체크해야 [사용 시작] 버튼이 눌림
  boxes.forEach((b) => b.addEventListener('change', () => { startBtn.disabled = !boxes.every((x) => x.checked); }));

  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    try {
      const res = await api(`/api/equipment/${eq.id}/start`, { ...who, minutes, checked: boxes.map((_, i) => i) });
      showResult(true, '사용 시작', [res.message, `(${res.endsDateText})`]);
    } catch (err) {
      startBtn.disabled = false;
      msg.replaceChildren(errorBox(err));
    }
  });

  show(
    topNav(eq.displayName),
    h('h2', {}, '사용 전 필수 확인 (3/3)'),
    h('p', { class: 'muted' }, '하나씩 직접 확인하고 체크하세요. 모두 체크해야 시작할 수 있어요.'),
    ...eq.checklist.map((c, i) => h('div', { class: 'card' }, h('label', { for: 'chk' + i, style: 'margin:0' }, boxes[i], c))),
    msg,
    startBtn,
  );
}

// ═════════════════ 상황 B 대기 등록 ═════════════════
function queueForm(eq) {
  const { sid, name } = studentInputs();
  const msg = h('div');
  show(
    topNav(eq.displayName),
    h('h2', {}, `${eq.displayName} 대기 등록`),
    h('p', {}, statusLine(eq)),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        msg.replaceChildren();
        try {
          const res = await api(`/api/equipment/${eq.id}/queue`, { studentId: sid.value, studentName: name.value });
          showResult(true, '대기 등록 완료', [`${res.displayName} 대기 ${res.position}번이에요.`,
            `차례가 오면 ${eq.priorityMinutes}분 안에 기구 화면에서 "제 차례예요"를 눌러 사용을 시작하세요.`]);
        } catch (err) {
          msg.replaceChildren(errorBox(err));
        }
      },
    },
      h('label', {}, '학번'), sid, h('label', {}, '이름'), name, msg,
      h('button', { class: 'primary', type: 'submit', style: 'width:100%;margin-top:24px' }, '대기 등록하기')),
  );
}

// ═════════════════ 상황 C: 지금 사용 중인 본인 (학번으로 확인) ═════════════════
function askMine(eq) {
  const sid = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: 10, placeholder: '예: 20315' });
  const msg = h('div');
  show(
    topNav(eq.displayName),
    h('h2', {}, '본인 확인'),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        msg.replaceChildren();
        try {
          const me = await api(`/api/equipment/${eq.id}/me`, { studentId: sid.value });
          myMenu(eq, sid.value.trim(), me);
        } catch (err) {
          msg.replaceChildren(errorBox(err));
        }
      },
    }, h('label', {}, '사용을 시작할 때 입력한 학번'), sid, msg,
      h('button', { class: 'primary', type: 'submit', style: 'width:100%;margin-top:24px' }, '확인')),
  );
}

function myMenu(eq, studentId, me) {
  const msg = h('div');
  show(
    topNav(eq.displayName),
    h('h2', {}, `${eq.displayName} — 내 사용`),
    h('p', {}, statusLine(eq)),
    h('div', { class: 'row' },
      h('button', {
        class: 'primary',
        onclick: async () => {
          if (!confirm('지금 사용을 끝낼까요?')) return;
          try {
            const res = await api(`/api/equipment/${eq.id}/end`, { studentId });
            showResult(true, '사용 종료', [`${res.displayName} 사용을 끝냈어요.`,
              res.newStatus === '예약 대기' ? `대기 1번(${res.nextStudent}) 학생에게 차례가 넘어갔어요.` : '이제 다른 사람이 사용할 수 있어요.',
              eq.isDangerous ? '⚠ 압력과 온도가 내려간 것을 확인한 뒤 여세요.' : '']);
          } catch (err) { msg.replaceChildren(errorBox(err)); }
        },
      }, '일찍 끝났어요'),
      h('button', { disabled: !me.canExtend, onclick: () => extendUseForm(eq, studentId) }, '시간 연장하기'),
      h('button', { onclick: () => showHowto(eq) }, '사용법 보기')),
    me.canExtend ? null : h('p', { class: 'muted' }, '연장 불가: ' + me.extendBlockedReason),
    msg,
  );
}

function extendUseForm(eq, studentId) {
  const used = Math.round((new Date(eq.current.endsAt) - new Date(eq.current.startedAt)) / 60000);
  const left = eq.maxMinutes - used; // 더 쓸 수 있는 최대 시간
  let minutes = null;
  const custom = durationInput(left);
  const btns = eq.timeOptions.filter((o) => o.minutes <= left).map((o) => h('button', {
    type: 'button',
    onclick: (e) => { minutes = o.minutes; custom.clear(); btns.forEach((b) => b.classList.toggle('selected', b === e.currentTarget)); },
  }, '+ ' + o.label));
  custom.onInput(() => { minutes = custom.value(); btns.forEach((b) => b.classList.remove('selected')); });
  const msg = h('div');

  show(
    topNav(eq.displayName),
    h('h2', {}, `${eq.displayName} 시간 연장 (한 번만 가능)`),
    h('p', {}, `지금 종료 예정: ${eq.current.endsText} · 최대 ${Math.floor(left / 60)}시간 ${left % 60}분 더 쓸 수 있어요.`),
    btns.length ? h('div', { class: 'grid' }, ...btns) : null,
    h('label', {}, '직접 입력'), custom.el,
    msg,
    h('button', {
      class: 'primary', style: 'width:100%;margin-top:24px',
      onclick: async () => {
        if (!minutes || minutes < 1) return msg.replaceChildren(errorBox({ message: '연장할 시간을 골라 주세요.' }));
        try {
          const res = await api(`/api/equipment/${eq.id}/extend`, { studentId, minutes });
          showResult(true, '연장 완료', [res.message]);
        } catch (err) { msg.replaceChildren(errorBox(err)); }
      },
    }, '연장하기'),
  );
}

// ═════════════════ 14단계: 안내 전용 기구 (마이크로피펫, 피펫 에이드 …) ═════════════════
// 예약·대기·학번 입력 없이 사진·사용 전 확인·사용법·주의사항만 보여 줌
function kindOrStatusBadge(u) {
  return u.isGuide ? h('span', { class: 'status guide' }, '📘 사용법 안내') : statusBadge(u.status);
}

function showGuide(eq) {
  const list = (items) => h('ol', { class: 'howto' }, ...items.map((s) => (s.startsWith('⚠') ? h('p', { class: 'sample-notice' }, s) : h('li', {}, s.replace(/^\d+\.\s*/, '')))));
  show(
    topNav(eq.displayName),
    h('div', { class: 'card center' },
      eq.photoUrl ? h('img', { src: eq.photoUrl, alt: `${eq.displayName} 사진`, class: 'equip-photo' }) : null,
      h('div', { class: 'big-name' }, eq.displayName),
      h('p', {}, h('span', { class: 'status guide' }, '📘 안내 전용'), ' 예약 없이 사용법을 확인하고 바로 쓰면 돼요.'),
      eq.location ? h('p', { class: 'muted' }, `보관 위치: ${eq.location}`) : null),
    eq.checklist.length ? h('h2', {}, '✅ 쓰기 전에 확인하세요') : null,
    eq.checklist.length ? h('div', { class: 'card' }, h('ul', { class: 'check-before' }, ...eq.checklist.map((c) => h('li', {}, c)))) : null,
    h('h2', {}, '📖 사용법'),
    h('div', { class: 'card' }, list(eq.howto)),
    eq.cautions.length ? h('h2', {}, '⚠ 주의사항') : null,
    eq.cautions.length ? h('div', { class: 'card caution-card' }, list(eq.cautions)) : null,
    guideTopicBox(eq),
  );
}

// 16단계: 안내 전용 화면 아래 "어떤 실험에 쓰시나요? (선택)" — 적으면 보내고 처음으로
function guideTopicBox(eq) {
  const topic = topicInput();
  const msg = h('div');
  return h('div', { class: 'card' },
    h('label', { style: 'margin-top:0' }, `어떤 실험(주제)에 ${josa(eq.displayName, '을', '를')} 쓰시나요? `, h('span', { class: 'muted small' }, '(선택 — 비워도 돼요)')),
    topic, msg,
    h('button', {
      class: 'primary', style: 'width:100%;margin-top:16px',
      onclick: async () => {
        const t = topic.value.trim();
        if (t) {
          try { await api('/api/topics', { equipmentId: eq.id, topic: t }); } catch (err) { return msg.replaceChildren(errorBox(err)); }
        }
        home();
      },
    }, '다 읽었어요 (처음으로)'));
}
