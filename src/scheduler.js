// ─────────────────────────────────────────────
// 1분마다 자동 검사 (6-4, 7-4)
// ─────────────────────────────────────────────
// runChecks(db) 한 번 = 검사 한 번. 테스트에서는 시각을 바꿔 가며 직접 부릅니다.
// startScheduler() 는 node-cron 으로 매분 0초에 runChecks 를 부릅니다.

const cron = require('node-cron');
const { now } = require('./clock');
const { getNumber, getSetting } = require('./settings');
const { notifyAdmin } = require('./notify');
const { formatDateTime, formatDuration, maskStudentId } = require('./timeFormat');
const { runEquipmentCheck } = require('./rules/equipmentRules');

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

// ── 시약 검사 ──
function checkReagents(db) {
  const t = now();
  const iso = t.toISOString();
  const events = [];

  // ① 고위험 승인 대기 30분 지나면 자동 취소 (또는 반납 기한 오후 6시가 지나도 취소)
  const waitMin = getNumber(db, 'high_risk_approval_minutes');
  const cutoff = new Date(t.getTime() - waitMin * MIN).toISOString();
  const stale = db.prepare(`SELECT l.*, r.name AS reagent_name FROM reagent_loans l JOIN reagents r ON r.id = l.reagent_id
                            WHERE l.status = '승인 대기' AND (l.created_at <= ? OR l.due_at <= ?)`).all(cutoff, iso);
  for (const l of stale) {
    db.prepare("UPDATE reagent_loans SET status = '자동 취소' WHERE id = ? AND status = '승인 대기'").run(l.id);
    notifyAdmin(db, '자동 취소', `[자동 취소] ${l.reagent_name} — ${l.student_id} ${l.student_name}: ${waitMin}분 동안 승인되지 않아 취소됐습니다.`);
    events.push({ type: '자동 취소', loanId: l.id });
  }

  // ② 기한 1시간 전: "곧 반납 기한" 알림 (한 번만)
  const soon = new Date(t.getTime() + 60 * MIN).toISOString();
  const dueSoon = db.prepare(`SELECT l.*, r.name AS reagent_name FROM reagent_loans l JOIN reagents r ON r.id = l.reagent_id
                              WHERE l.status = '반출 중' AND l.due_soon_notified_at IS NULL AND l.due_at > ? AND l.due_at <= ?`).all(iso, soon);
  for (const l of dueSoon) {
    db.prepare('UPDATE reagent_loans SET due_soon_notified_at = ? WHERE id = ?').run(iso, l.id);
    notifyAdmin(db, '곧 반납 기한', `[곧 반납 기한] ${l.reagent_name} — ${l.student_id} ${l.student_name}, 기한 ${formatDateTime(new Date(l.due_at))}`);
    events.push({ type: '곧 반납 기한', loanId: l.id });
  }

  // ③ 기한 지남 → "연체" + 알림 (처음 1번)
  const newlyOverdue = db.prepare(`SELECT l.*, r.name AS reagent_name FROM reagent_loans l JOIN reagents r ON r.id = l.reagent_id
                                   WHERE l.status = '반출 중' AND l.due_at <= ?`).all(iso);
  for (const l of newlyOverdue) {
    db.prepare("UPDATE reagent_loans SET status = '연체', overdue_since = due_at, overdue_notified_at = ? WHERE id = ?").run(iso, l.id);
    notifyAdmin(db, '연체', `[연체] ${l.reagent_name} — ${l.student_id} ${l.student_name}, 기한 ${formatDateTime(new Date(l.due_at))} 지남`);
    events.push({ type: '연체', loanId: l.id, reagentName: l.reagent_name, student: maskStudentId(l.student_id) });
  }

  // ④ 이미 연체인 기록: 하루에 1번만 다시 알림
  const reminders = db.prepare(`SELECT l.*, r.name AS reagent_name FROM reagent_loans l JOIN reagents r ON r.id = l.reagent_id
                                WHERE l.status = '연체' AND l.overdue_notified_at <= ?`).all(new Date(t.getTime() - DAY).toISOString());
  for (const l of reminders) {
    db.prepare('UPDATE reagent_loans SET overdue_notified_at = ? WHERE id = ?').run(iso, l.id);
    const late = formatDuration((t - new Date(l.due_at)) / MIN);
    notifyAdmin(db, '연체', `[연체 계속] ${l.reagent_name} — ${l.student_id} ${l.student_name}, ${late} 지남`);
    events.push({ type: '연체 다시 알림', loanId: l.id });
  }
  return events;
}

// ── 1년 지난 기록의 학번·이름 지우기 (설정에서 켰을 때만, 9번) ──
// 끝난 기록만 지웁니다 (반출 중·사용 중인 기록은 건드리지 않음).
function anonymizeOldRecords(db) {
  if (getSetting(db, 'anonymize_after_year') !== '1') return 0;
  const yearAgo = new Date(now().getTime() - 365 * DAY).toISOString();
  let n = 0;
  n += db.prepare(`UPDATE reagent_loans SET student_id = NULL, student_name = NULL
                   WHERE created_at <= ? AND student_id IS NOT NULL AND status IN ('반납 완료','거절됨','자동 취소')`).run(yearAgo).changes;
  n += db.prepare(`UPDATE equipment_uses SET student_id = NULL, student_name = NULL
                   WHERE started_at <= ? AND student_id IS NOT NULL AND ended_at IS NOT NULL`).run(yearAgo).changes;
  n += db.prepare(`UPDATE equipment_queue SET student_id = NULL, student_name = NULL
                   WHERE joined_at <= ? AND student_id IS NOT NULL AND status IN ('사용 시작','넘어감','취소')`).run(yearAgo).changes;
  return n;
}

// ── 검사 한 번 ──
// broadcast: 화면에 소식 보내는 함수 (테스트에서는 생략 가능)
function runChecks(db, broadcast = () => {}) {
  const reagentEvents = checkReagents(db);
  const equipmentEvents = runEquipmentCheck(db);
  const anonymized = anonymizeOldRecords(db);

  // 화면에 소식 보내기 (이름 없이, 학번은 가려서)
  for (const e of reagentEvents) {
    if (e.type === '연체') broadcast('overdue-new', { reagentName: e.reagentName, student: e.student });
  }
  for (const e of equipmentEvents) {
    if (e.type === '시간 종료') {
      broadcast('equipment-finished', { equipmentId: e.equipmentId, displayName: e.displayName, isDangerous: e.isDangerous });
    }
    if (e.newStatus === '예약 대기' || e.nextStudent) {
      broadcast('turn', { equipmentId: e.equipmentId, student: e.nextStudent });
    }
  }
  // 상태가 바뀌었거나, 남은 시간 표시를 1분마다 줄이기 위해 매번 "change" 를 보냄
  broadcast('change', { reason: '자동 검사' });

  return { reagentEvents, equipmentEvents, anonymized };
}

// ── 매분 실행 시작 ──
function startScheduler(db, broadcast) {
  const safeRun = () => {
    try {
      const r = runChecks(db, broadcast);
      const count = r.reagentEvents.length + r.equipmentEvents.length;
      if (count) console.log(`[자동 검사] 바뀐 것 ${count}개`, [...r.reagentEvents, ...r.equipmentEvents].map((e) => e.type).join(', '));
    } catch (e) {
      console.error('[자동 검사] 오류:', e); // 오류가 나도 다음 1분 뒤에 다시 검사
    }
  };
  safeRun(); // 서버가 켜지자마자 한 번
  return cron.schedule('* * * * *', safeRun, { timezone: 'Asia/Seoul', noOverlap: true, name: '1분 검사' });
}

module.exports = { runChecks, checkReagents, anonymizeOldRecords, startScheduler };
