// ─────────────────────────────────────────────
// 기구 규칙 (명세 7번): 사용 시작, 대기 등록, 일찍 종료, 연장, 사용 끝 처리, 예약 대기 넘기기
// ─────────────────────────────────────────────
// 기구 상태 4가지: 사용 가능 / 사용 중 / 예약 대기 / 점검 중
// 모든 시각은 clock.now() 로 가져옵니다.

const { now } = require('../clock');
const { getNumber, getSetting } = require('../settings');
const { formatTime, formatTimeSmart, formatDateTime, formatDuration, maskStudentId } = require('../timeFormat');
const { assertNotOverdue } = require('./reagentRules');
const { RuleError, checkStudentId, checkName, checkId } = require('./common');
const { photoUrl } = require('./photo');

const MIN = 60 * 1000;

// ── 기구 한 대 읽기 ──
function getEquipmentRow(db, id) {
  const e = db.prepare('SELECT * FROM equipment WHERE id = ? AND archived = 0').get(checkId(id, '기구'));
  if (!e) throw new RuleError('그 기구를 찾을 수 없어요.', '기구를 다시 찾아 주세요.', 404);
  return e;
}

// 지금 사용 중인 기록 (없으면 undefined)
function currentUse(db, equipmentId) {
  return db.prepare('SELECT * FROM equipment_uses WHERE equipment_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1').get(equipmentId);
}

// 대기열 (대기 중 + 차례인 사람), 등록 순서대로
function activeQueue(db, equipmentId) {
  return db.prepare(`SELECT * FROM equipment_queue WHERE equipment_id = ? AND status IN ('차례','대기')
                     ORDER BY CASE status WHEN '차례' THEN 0 ELSE 1 END, joined_at, id`).all(equipmentId);
}

// 기구 이름 + 구분 (예: "배양기 1번(창가)")
const displayName = (e) => (e.unit_label ? `${e.name} ${e.unit_label}` : e.name);

// ── 화면에 보여 줄 기구 정보 (학번은 뒤 두 자리 가림, 이름은 보내지 않음) ──
function equipmentView(db, e) {
  const t = now();
  const use = currentUse(db, e.id);
  const queue = activeQueue(db, e.id);
  const turn = queue.find((q) => q.status === '차례');
  const waiting = queue.filter((q) => q.status === '대기');
  const priorityMin = getNumber(db, 'reservation_priority_minutes');
  const soonMin = getNumber(db, 'ending_soon_minutes');
  const justMin = getNumber(db, 'just_finished_notice_minutes');

  let current = null;
  if (use) {
    const ends = new Date(use.ends_at);
    const remaining = Math.max(0, Math.ceil((ends - t) / MIN));
    current = {
      student: maskStudentId(use.student_id),
      startedAt: use.started_at,
      endsAt: use.ends_at,
      endsText: formatTimeSmart(ends, t),
      endsDateText: formatDateTime(ends),
      remainingMinutes: remaining,
      remainingText: formatDuration(remaining),
      extended: !!use.extended,
      endingSoon: remaining <= soonMin, // 7-4: 끝나기 10분 전 "곧 사용 가능"
    };
  }
  let turnInfo = null;
  if (turn) {
    const deadline = new Date(new Date(turn.turn_started_at).getTime() + priorityMin * MIN);
    turnInfo = {
      student: maskStudentId(turn.student_id),
      deadlineAt: deadline.toISOString(),
      deadlineText: formatTimeSmart(deadline, t),
      remainingMinutes: Math.max(0, Math.ceil((deadline - t) / MIN)),
    };
  }
  const justFinished = e.just_finished_at && t - new Date(e.just_finished_at) < justMin * MIN;
  const justFinishedUntil = justFinished ? new Date(new Date(e.just_finished_at).getTime() + justMin * MIN).toISOString() : null;

  return {
    id: e.id,
    name: e.name,
    unitLabel: e.unit_label,
    displayName: displayName(e),
    location: e.location,
    labId: e.lab_id,
    kind: e.kind || '예약',           // 14단계: '예약' 또는 '안내'(사용법만)
    isGuide: e.kind === '안내',
    labName: (db.prepare('SELECT name FROM labs WHERE id = ?').get(e.lab_id) || {}).name || '',
    photoUrl: photoUrl(e.photo), // 기구 사진 (없으면 null)
    status: e.status,
    isDangerous: !!e.is_dangerous,
    maxMinutes: e.max_minutes,
    maxText: formatDuration(e.max_minutes),
    timeOptions: JSON.parse(e.time_options),
    howto: JSON.parse(e.howto),
    checklist: JSON.parse(e.checklist),
    cautions: JSON.parse(e.cautions),
    current,
    turn: turnInfo,
    waitingCount: waiting.length,
    justFinished: !!justFinished,
    justFinishedUntil,
    priorityMinutes: priorityMin,
    queueEnabled: queueEnabled(db),
    endingSoonMinutes: soonMin,
  };
}

// ── 7-5 현황판: 이 학번이 기다리는 기구와 "내 차례"인 기구 ──
// (현황판은 학번을 가려서 보여 주므로, 내 차례인지는 학번을 직접 넣어 물어봐야 알 수 있음)
function myQueueStatus(db, studentIdRaw) {
  const studentId = checkStudentId(studentIdRaw);
  const t = now();
  const priorityMin = getNumber(db, 'reservation_priority_minutes');
  const rows = db.prepare(`SELECT q.*, e.name, e.unit_label FROM equipment_queue q JOIN equipment e ON e.id = q.equipment_id
                           WHERE q.student_id = ? AND q.status IN ('차례','대기')`).all(studentId);
  return rows.map((q) => {
    if (q.status === '차례') {
      const deadline = new Date(new Date(q.turn_started_at).getTime() + priorityMin * MIN);
      return { equipmentId: q.equipment_id, displayName: displayName(q), myTurn: true, turnKey: `${q.id}`,
        deadlineText: formatTimeSmart(deadline, t), remainingMinutes: Math.max(0, Math.ceil((deadline - t) / MIN)) };
    }
    const ahead = activeQueue(db, q.equipment_id).findIndex((x) => x.id === q.id); // 내 앞에 있는 사람 수
    return { equipmentId: q.equipment_id, displayName: displayName(q), myTurn: false, position: ahead + 1 };
  });
}

// ── 기구 찾기 (이름으로). 같은 이름끼리 묶어서 돌려줌 → 여러 대면 "1번/2번" 고르기 ──
// labId 를 주면 그 실험실 기구만 (13단계), 없으면 모든 실험실
// 같은 실험실·같은 이름끼리 묶음 (다른 실험실의 같은 이름 기구는 따로)
function searchEquipment(db, q, labId = null) {
  const s = String(q ?? '').trim().slice(0, 50);
  const like = `%${s.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
  const rows = db.prepare(`SELECT e.* FROM equipment e LEFT JOIN labs lb ON lb.id = e.lab_id
                           WHERE e.archived = 0 AND (? IS NULL OR e.lab_id = ?)
                             AND (? = '' OR e.name LIKE ? ESCAPE '\\' OR e.unit_label LIKE ? ESCAPE '\\')
                           ORDER BY lb.sort, lb.id, e.name, e.unit_label, e.id`).all(labId, labId, s, like, like);
  const groups = new Map();
  for (const e of rows) {
    const key = `${e.lab_id}|${e.name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(equipmentView(db, e));
  }
  return [...groups.values()].map((units) => ({ name: units[0].name, labId: units[0].labId, labName: units[0].labName, units }));
}

// ── 14단계: 안내 전용 기구는 예약·대기 없이 사용법만 보여 줌 ──
function assertBookable(e) {
  if (e.kind === '안내') {
    throw new RuleError(`${displayName(e)}은(는) 안내 전용 기구라서 사용 등록이 필요 없어요.`, '사용법과 주의사항을 확인하고 바로 사용하세요.');
  }
}

// ── 사용할 시간 검사: 1분 이상, 최대 사용 시간 이하 ──
function checkMinutes(e, minutes) {
  const m = Number(minutes);
  if (!Number.isInteger(m) || m < 1 || m > e.max_minutes) {
    throw new RuleError(`사용 시간은 최대 ${formatDuration(e.max_minutes)}까지만 정할 수 있어요.`,
      `1분 ~ ${formatDuration(e.max_minutes)} 사이로 골라 주세요.`);
  }
  return m;
}

// ── 7-3 상황 A ④ 사용 시작 ──
// input: { equipmentId, studentId, studentName, minutes, checked: [0,1,2…] (체크한 확인 사항 번호) }
function startUse(db, input) {
  const t = now();
  const e = getEquipmentRow(db, input.equipmentId);
  assertBookable(e);
  const studentId = checkStudentId(input.studentId);
  const studentName = checkName(input.studentName);
  const minutes = checkMinutes(e, input.minutes);

  // ③ 필수 확인 사항을 모두 체크했는지 (화면에서 막아도, 서버에서 한 번 더 확인)
  const checklist = JSON.parse(e.checklist);
  const checked = new Set(Array.isArray(input.checked) ? input.checked.map(Number) : []);
  if (checklist.some((_, i) => !checked.has(i))) {
    throw new RuleError('필수 확인 사항을 모두 체크해야 사용할 수 있어요.', '안전을 위해 하나씩 확인하고 체크해 주세요.');
  }

  // 6-1-6: 연체 학번은 기구 사용도 막음
  assertNotOverdue(db, studentId);

  let turnEntry = null;
  if (e.status === '점검 중') {
    throw new RuleError(`${displayName(e)}은(는) 지금 점검 중이에요.`, '점검이 끝날 때까지 기다리거나 선생님께 문의하세요.');
  } else if (e.status === '사용 중') {
    throw new RuleError(`${displayName(e)}은(는) 다른 사람이 사용 중이에요.`, '대기 등록을 하면 차례가 왔을 때 알려 드려요.');
  } else if (e.status === '예약 대기') {
    // 7-4: 예약 대기 중에는 차례인 사람만 시작할 수 있음
    turnEntry = activeQueue(db, e.id).find((q) => q.status === '차례');
    if (!turnEntry || turnEntry.student_id !== studentId) {
      throw new RuleError(`지금은 대기 1번(${maskStudentId(turnEntry && turnEntry.student_id)}) 학생의 차례예요.`,
        '대기 등록을 하거나, 차례 시간이 지날 때까지 기다려 주세요.');
    }
  }

  const endsAt = new Date(t.getTime() + minutes * MIN);
  db.transaction(() => {
    // 동시에 두 사람이 눌러도 한 명만 시작되도록 "상태가 그대로일 때만" 바꿈
    const changed = db.prepare("UPDATE equipment SET status = '사용 중', just_finished_at = NULL WHERE id = ? AND status = ?")
      .run(e.id, e.status).changes;
    if (!changed) throw new RuleError('방금 다른 사람이 먼저 시작했어요.', '화면을 다시 확인해 주세요.');
    db.prepare(`INSERT INTO equipment_uses (equipment_id, student_id, student_name, started_at, ends_at)
                VALUES (?, ?, ?, ?, ?)`).run(e.id, studentId, studentName, t.toISOString(), endsAt.toISOString());
    if (turnEntry) db.prepare("UPDATE equipment_queue SET status = '사용 시작' WHERE id = ?").run(turnEntry.id);
  })();
  // 16단계: "어떤 실험에 쓰시나요?"(선택) — 학번·이름 없이 주제만 따로 기록. 잘못 써도 사용 시작은 막지 않음
  if (input.topic) { try { require('./recommend').saveTopic(db, e.id, input.topic); } catch (err) { /* 주제 기록 실패는 무시 */ } }

  // ⑤ 완료 화면 문구
  return {
    equipmentId: e.id,
    displayName: displayName(e),
    endsAt: endsAt.toISOString(),
    message: `${displayName(e)} 사용 시작. ${formatTimeSmart(endsAt, t)}에 사용 가능으로 바뀝니다.`,
    endsDateText: formatDateTime(endsAt),
  };
}

// ── 7-3 상황 B: 대기 등록 ──
// 대기 기능을 쓰는지 (관리자 설정 "대기 기능 쓰기")
const queueEnabled = (db) => getSetting(db, 'queue_enabled') === '1';

function joinQueue(db, input) {
  if (!queueEnabled(db)) {
    throw new RuleError('이 학교는 대기 등록을 쓰지 않아요.', '지금 사용 중인 사람과 끝나는 시각을 확인하고, 끝난 뒤에 사용하세요.');
  }
  const t = now();
  const e = getEquipmentRow(db, input.equipmentId);
  assertBookable(e);
  const studentId = checkStudentId(input.studentId);
  const studentName = checkName(input.studentName);

  if (!['사용 중', '예약 대기'].includes(e.status)) {
    throw new RuleError(e.status === '점검 중' ? '점검 중인 기구는 대기 등록을 할 수 없어요.' : '지금 바로 사용할 수 있어요. 대기 등록이 필요 없어요.',
      '처음 화면에서 기구를 다시 골라 주세요.');
  }
  assertNotOverdue(db, studentId);
  const use = currentUse(db, e.id);
  if (use && use.student_id === studentId) throw new RuleError('지금 이 기구를 사용 중인 학번이에요.', '본인 사용은 대기 등록 없이 연장할 수 있어요.');
  // 한 기구에 같은 학번은 한 번만
  if (activeQueue(db, e.id).some((q) => q.student_id === studentId)) {
    throw new RuleError('이미 이 기구에 대기 등록되어 있어요.', '한 기구에는 한 번만 대기할 수 있어요.');
  }

  db.prepare('INSERT INTO equipment_queue (equipment_id, student_id, student_name, joined_at) VALUES (?, ?, ?, ?)')
    .run(e.id, studentId, studentName, t.toISOString());
  const position = activeQueue(db, e.id).filter((q) => q.status === '대기').length;
  return { displayName: displayName(e), position };
}

// ── 7-3 상황 C: 학번으로 "지금 사용 중인 본인"인지 확인 ──
function checkCurrentUser(db, equipmentId, studentIdRaw) {
  const studentId = checkStudentId(studentIdRaw);
  const e = getEquipmentRow(db, equipmentId);
  const use = currentUse(db, e.id);
  if (!use || use.student_id !== studentId) {
    throw new RuleError('이 학번으로 사용 중인 기록이 없어요.', '학번을 다시 확인해 주세요.', 404);
  }
  return { e, use, extendBlockedReason: extendBlockedReason(db, e, use) };
}

// 연장할 수 없는 이유 (가능하면 null)
function extendBlockedReason(db, e, use) {
  if (use.extended) return '연장은 한 번만 할 수 있어요.';
  if (activeQueue(db, e.id).length > 0) return '기다리는 사람이 있어서 연장할 수 없어요.';
  const usedSoFar = Math.round((new Date(use.ends_at) - new Date(use.started_at)) / MIN);
  if (usedSoFar >= e.max_minutes) return `이미 최대 사용 시간(${formatDuration(e.max_minutes)})만큼 정했어요.`;
  return null;
}

// ── 7-3 상황 C: 일찍 끝났어요 ──
function endEarly(db, { equipmentId, studentId }) {
  const { e } = checkCurrentUser(db, equipmentId, studentId);
  const result = finishUse(db, e.id, '일찍 종료');
  return { displayName: displayName(e), ...result };
}

// ── 7-3 상황 C: 시간 연장하기 (1번만, 대기자 없을 때만, 최대 사용 시간 이하) ──
function extendUse(db, { equipmentId, studentId, minutes }) {
  const { e, use, extendBlockedReason: reason } = checkCurrentUser(db, equipmentId, studentId);
  if (reason) throw new RuleError(reason, '지금 사용이 끝난 뒤 다시 사용 시작을 해 주세요.');
  const m = Number(minutes);
  const total = Math.round((new Date(use.ends_at) - new Date(use.started_at)) / MIN) + m;
  if (!Number.isInteger(m) || m < 1 || total > e.max_minutes) {
    const left = e.max_minutes - Math.round((new Date(use.ends_at) - new Date(use.started_at)) / MIN);
    throw new RuleError(`최대 사용 시간(${formatDuration(e.max_minutes)})을 넘을 수 없어요.`,
      `최대 ${formatDuration(left)}까지 연장할 수 있어요.`);
  }
  const newEnd = new Date(new Date(use.ends_at).getTime() + m * MIN);
  const changed = db.prepare('UPDATE equipment_uses SET ends_at = ?, extended = 1, ending_soon_notified = 0 WHERE id = ? AND extended = 0 AND ended_at IS NULL')
    .run(newEnd.toISOString(), use.id).changes;
  if (!changed) throw new RuleError('연장은 한 번만 할 수 있어요.');
  return { displayName: displayName(e), endsAt: newEnd.toISOString(), message: `${displayName(e)} ${formatDuration(m)} 연장. ${formatTimeSmart(newEnd, now())}에 사용 가능으로 바뀝니다.` };
}

// ── 사용 끝 처리 (일찍 종료, 시간 종료, 강제 종료 공통) ──
// 7-4: 대기자가 없으면 "사용 가능", 있으면 "예약 대기" + 대기 1번에게 차례
function finishUse(db, equipmentId, reason) {
  const t = now();
  return db.transaction(() => {
    const use = currentUse(db, equipmentId);
    if (use) {
      db.prepare('UPDATE equipment_uses SET ended_at = ?, end_reason = ? WHERE id = ?').run(t.toISOString(), reason, use.id);
    }
    db.prepare('UPDATE equipment SET just_finished_at = ? WHERE id = ?').run(t.toISOString(), equipmentId);
    const next = giveTurnToNext(db, equipmentId);
    return { newStatus: next ? '예약 대기' : '사용 가능', nextStudent: next ? maskStudentId(next.student_id) : null };
  })();
}

// 다음 대기자에게 차례를 줌. 대기자가 없으면 "사용 가능" (점검 중이면 그대로 둠)
function giveTurnToNext(db, equipmentId) {
  const t = now();
  const next = queueEnabled(db)
    ? db.prepare("SELECT * FROM equipment_queue WHERE equipment_id = ? AND status = '대기' ORDER BY joined_at, id LIMIT 1").get(equipmentId)
    : null; // 대기 기능 끔 → 다음 차례 없음
  const e = db.prepare('SELECT status FROM equipment WHERE id = ?').get(equipmentId);
  if (e.status === '점검 중') return null;
  if (next) {
    db.prepare("UPDATE equipment_queue SET status = '차례', turn_started_at = ? WHERE id = ?").run(t.toISOString(), next.id);
    db.prepare("UPDATE equipment SET status = '예약 대기' WHERE id = ?").run(equipmentId);
    return next;
  }
  db.prepare("UPDATE equipment SET status = '사용 가능' WHERE id = ?").run(equipmentId);
  return null;
}

// ── 7-4 자동 검사용 (5단계에서 1분마다 부름) ──
// ① 끝나는 시각이 지난 사용 → 시간 종료
// ② 차례가 왔는데 10분 안에 시작하지 않은 대기자 → 넘어감, 다음 사람에게
// 바뀐 내용을 목록으로 돌려줌 (위험 기구 알림, 화면 갱신에 사용)
function runEquipmentCheck(db) {
  const t = now();
  const changes = [];

  const expired = db.prepare(`SELECT u.*, e.is_dangerous, e.name, e.unit_label FROM equipment_uses u JOIN equipment e ON e.id = u.equipment_id
                              WHERE u.ended_at IS NULL AND u.ends_at <= ?`).all(t.toISOString());
  for (const u of expired) {
    const r = finishUse(db, u.equipment_id, '시간 종료');
    changes.push({ type: '시간 종료', equipmentId: u.equipment_id, displayName: displayName(u), isDangerous: !!u.is_dangerous, ...r });
  }

  const priorityMin = getNumber(db, 'reservation_priority_minutes');
  const cutoff = new Date(t.getTime() - priorityMin * MIN).toISOString();
  const lateTurns = db.prepare("SELECT * FROM equipment_queue WHERE status = '차례' AND turn_started_at <= ?").all(cutoff);
  for (const q of lateTurns) {
    db.transaction(() => {
      db.prepare("UPDATE equipment_queue SET status = '넘어감' WHERE id = ?").run(q.id);
      const next = giveTurnToNext(db, q.equipment_id);
      changes.push({ type: '차례 넘어감', equipmentId: q.equipment_id, skipped: maskStudentId(q.student_id), nextStudent: next ? maskStudentId(next.student_id) : null });
    })();
  }
  return changes;
}

module.exports = {
  displayName, equipmentView, searchEquipment, getEquipmentRow,
  startUse, joinQueue, checkCurrentUser, extendBlockedReason, endEarly, extendUse,
  finishUse, runEquipmentCheck, queueEnabled, myQueueStatus, giveTurnToNext, currentUse, activeQueue,
};
