// ─────────────────────────────────────────────
// 시약 규칙 (명세 6번): 반출, 승인/거절, 연장, 반납
// ─────────────────────────────────────────────
// 모든 시각은 clock.now() 로 가져옵니다 (테스트에서 시간을 바꿀 수 있게).

const { now } = require('../clock');
const { getNumber, getSetting } = require('../settings');
const { notifyAdmin } = require('../notify');
const { kstTimeOnSameDay, formatDateTime, formatTime, maskStudentId } = require('../timeFormat');
const { RuleError, checkStudentId, checkName, checkId } = require('./common');

const PURPOSES = ['수업 실험', '동아리', '개인 탐구', '기타'];
const AMOUNTS = ['가득', '절반 이상', '절반 미만', '거의 없음', '다 씀'];
const ACTIVE = ['승인 대기', '반출 중', '연체']; // 아직 시약장에 돌아오지 않은 상태
const HOUR = 60 * 60 * 1000;

// ── 시약 정보 + 지금 꺼낼 수 있는 병 수 ──
// 남은 병 = 보유 병 수 − (승인 대기 + 반출 중 + 연체) 기록 수
function getReagent(db, reagentId) {
  const r = db.prepare(`
    SELECT r.*, r.quantity - (SELECT COUNT(*) FROM reagent_loans l
                              WHERE l.reagent_id = r.id AND l.status IN ('승인 대기','반출 중','연체')) AS available
    FROM reagents r WHERE r.id = ? AND r.archived = 0`).get(reagentId);
  if (!r) throw new RuleError('그 시약을 찾을 수 없어요.', '시약을 다시 검색해 주세요.', 404);
  return r;
}

// ── 이 학번이 연체 중인지 (6-1-6: 연체 학번은 시약 반출과 기구 사용 모두 막음) ──
// 1분마다 하는 검사(5단계)가 "연체"로 바꾸기 전이라도, 기한이 지났으면 연체로 봅니다.
function findOverdueLoan(db, studentId) {
  return db.prepare(`
    SELECT l.*, r.name AS reagent_name FROM reagent_loans l JOIN reagents r ON r.id = l.reagent_id
    WHERE l.student_id = ? AND (l.status = '연체' OR (l.status = '반출 중' AND l.due_at <= ?))
    ORDER BY l.due_at LIMIT 1`).get(studentId, now().toISOString());
}

function assertNotOverdue(db, studentId) {
  const o = findOverdueLoan(db, studentId);
  if (o) {
    throw new RuleError(
      `연체 중인 시약(${o.reagent_name})이 있어서 사용할 수 없어요.`,
      '연체된 시약을 먼저 반납하면 다시 사용할 수 있어요.',
    );
  }
}

// ── 6-1 반출하기 ──
// input: { reagentId, studentId, studentName, purpose, purposeOther, hours }
function checkout(db, input) {
  const t = now();
  const reagentId = checkId(input.reagentId, '시약');
  const studentId = checkStudentId(input.studentId);
  const studentName = checkName(input.studentName);

  // 사용 목적
  if (!PURPOSES.includes(input.purpose)) {
    throw new RuleError('사용 목적을 골라 주세요.', `${PURPOSES.join(' / ')} 중에서 골라 주세요.`);
  }
  let purpose = input.purpose;
  if (purpose === '기타') {
    const other = String(input.purposeOther ?? '').trim();
    if (other.length < 2 || other.length > 100) {
      throw new RuleError('기타 사용 목적을 적어 주세요.', '2~100글자로 적어 주세요.');
    }
    purpose = `기타: ${other}`;
  }

  const reagent = getReagent(db, reagentId);

  // 6-1-5: 남은 병이 0이면 막기
  if (reagent.available <= 0) {
    throw new RuleError(`${reagent.name}은(는) 지금 남은 병이 없어요.`, '다른 사람이 반납한 뒤에 다시 시도하거나 선생님께 문의하세요.');
  }
  // 6-1-6: 연체 학번 막기
  assertNotOverdue(db, studentId);

  let status;
  let dueAt;
  if (reagent.hazard === '고위험') {
    // 6-1-3: 고위험 → 반출한 날 오후 6시까지 자동, 6시 이후 반출 금지
    const returnTime = getSetting(db, 'high_risk_return_time'); // 기본 '18:00'
    dueAt = kstTimeOnSameDay(t, returnTime);
    if (t >= dueAt) {
      throw new RuleError(
        `고위험 시약은 ${formatTime(dueAt)} 이후 반출할 수 없습니다.`,
        '내일 다시 신청하거나 담당 선생님께 문의하세요.',
      );
    }
    status = '승인 대기';
  } else {
    // 6-1-3: 일반 → 사용자가 정함 (최소 1시간, 최장 72시간)
    const minH = getNumber(db, 'normal_min_loan_hours');
    const maxH = getNumber(db, 'normal_max_loan_hours');
    const hours = Number(input.hours);
    if (!Number.isInteger(hours) || hours < minH || hours > maxH) {
      throw new RuleError(
        `반납 기한은 ${minH}시간 이상 ${maxH}시간 이하로만 정할 수 있어요.`,
        `1~${maxH} 사이의 시간을 골라 주세요.`,
      );
    }
    dueAt = new Date(t.getTime() + hours * HOUR);
    status = '반출 중';
  }

  const info = db.prepare(`
    INSERT INTO reagent_loans (reagent_id, student_id, student_name, purpose, status, created_at, approved_at, due_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    reagentId, studentId, studentName, purpose, status,
    t.toISOString(), status === '반출 중' ? t.toISOString() : null, dueAt.toISOString(),
  );

  // 6-1-4: 관리자 알림
  if (status === '승인 대기') {
    const wait = getNumber(db, 'high_risk_approval_minutes');
    notifyAdmin(db, '승인 요청',
      `[승인 요청] ${reagent.name}(고위험) — ${studentId} ${studentName}, 목적: ${purpose}. ${wait}분 안에 승인하지 않으면 자동 취소됩니다.`);
  } else {
    notifyAdmin(db, '반출',
      `[반출] ${reagent.name} — ${studentId} ${studentName}, 목적: ${purpose}, 기한: ${formatDateTime(dueAt)}`);
  }

  return { loanId: Number(info.lastInsertRowid), status, dueAt: dueAt.toISOString(), reagentName: reagent.name };
}

// ── 6-1-4 관리자 승인 / 거절 (관리자 화면은 7단계에서 연결) ──
function approve(db, loanId) {
  const loan = db.prepare('SELECT * FROM reagent_loans WHERE id = ?').get(checkId(loanId, '기록'));
  if (!loan || loan.status !== '승인 대기') throw new RuleError('승인 대기 중인 기록이 아니에요.', '목록을 새로 고쳐 주세요.');
  if (new Date(loan.due_at) <= now()) {
    throw new RuleError('이미 반납 기한(오후 6시)이 지나서 승인할 수 없어요.', '거절하고 학생에게 내일 다시 신청하도록 안내해 주세요.');
  }
  db.prepare("UPDATE reagent_loans SET status = '반출 중', approved_at = ? WHERE id = ?").run(now().toISOString(), loan.id);
}

function reject(db, loanId, reason) {
  const loan = db.prepare('SELECT * FROM reagent_loans WHERE id = ?').get(checkId(loanId, '기록'));
  if (!loan || loan.status !== '승인 대기') throw new RuleError('승인 대기 중인 기록이 아니에요.', '목록을 새로 고쳐 주세요.');
  const r = String(reason ?? '').trim();
  if (r.length < 1 || r.length > 200) throw new RuleError('거절 사유를 적어 주세요.', '1~200글자로 적어 주세요.');
  db.prepare("UPDATE reagent_loans SET status = '거절됨', reject_reason = ? WHERE id = ?").run(r, loan.id);
}

// ── 학번으로 아직 반납하지 않은 기록 찾기 (반납·연장 화면에서 사용) ──
// reagentId 를 주면 그 시약만
function listActiveLoans(db, studentIdRaw, reagentId) {
  const studentId = checkStudentId(studentIdRaw);
  const rows = db.prepare(`
    SELECT l.id, l.reagent_id, r.name AS reagent_name, r.hazard, l.status, l.due_at, l.extended, l.created_at
    FROM reagent_loans l JOIN reagents r ON r.id = l.reagent_id
    WHERE l.student_id = ? AND l.status IN ('승인 대기','반출 중','연체') ${reagentId ? 'AND l.reagent_id = ?' : ''}
    ORDER BY l.due_at`).all(...(reagentId ? [studentId, checkId(reagentId, '시약')] : [studentId]));
  const t = now();
  return rows.map((l) => ({
    ...l,
    overdue: l.status === '연체' || (l.status === '반출 중' && new Date(l.due_at) <= t),
    canExtend: canExtendReason(l, t) === null,
    extendBlockedReason: canExtendReason(l, t),
  }));
}

// 연장할 수 없는 이유 (할 수 있으면 null)
function canExtendReason(loan, t) {
  if (loan.status !== '반출 중') return loan.status === '연체' ? '이미 기한이 지난 기록은 연장할 수 없어요.' : '반출 중인 기록만 연장할 수 있어요.';
  if (loan.hazard === '고위험') return '고위험 시약은 연장할 수 없어요.';
  if (loan.extended) return '이미 한 번 연장했어요. 연장은 한 번만 할 수 있어요.';
  if (new Date(loan.due_at) <= t) return '이미 기한이 지난 기록은 연장할 수 없어요.';
  return null;
}

// 기록을 찾고, 그 학번의 기록인지 확인 (본인 확인)
function getOwnLoan(db, loanId, studentIdRaw) {
  const studentId = checkStudentId(studentIdRaw);
  const loan = db.prepare(`
    SELECT l.*, r.name AS reagent_name, r.hazard FROM reagent_loans l JOIN reagents r ON r.id = l.reagent_id
    WHERE l.id = ?`).get(checkId(loanId, '기록'));
  if (!loan || loan.student_id !== studentId) {
    throw new RuleError('이 학번으로 된 기록이 아니에요.', '학번을 다시 확인해 주세요.', 404);
  }
  return loan;
}

// ── 6-2 연장하기 ──
function extend(db, { loanId, studentId, hours }) {
  const t = now();
  const loan = getOwnLoan(db, loanId, studentId);
  const reason = canExtendReason(loan, t);
  if (reason) throw new RuleError(reason, '반납 후 다시 반출 신청을 해 주세요.');

  const maxH = getNumber(db, 'extend_max_hours');
  const h = Number(hours);
  if (!Number.isInteger(h) || h < 1 || h > maxH) {
    throw new RuleError(`연장은 1시간 이상 ${maxH}시간 이하로만 할 수 있어요.`, `1~${maxH} 사이의 시간을 골라 주세요.`);
  }
  const newDue = new Date(new Date(loan.due_at).getTime() + h * HOUR);

  // 동시에 두 번 눌러도 한 번만 연장되도록 "extended = 0 인 경우에만" 바꿈
  const changed = db.prepare(`UPDATE reagent_loans SET due_at = ?, extended = 1, due_soon_notified_at = NULL
                              WHERE id = ? AND extended = 0 AND status = '반출 중'`).run(newDue.toISOString(), loan.id).changes;
  if (!changed) throw new RuleError('이미 한 번 연장했어요. 연장은 한 번만 할 수 있어요.');

  notifyAdmin(db, '연장', `[연장] ${loan.reagent_name} — ${loan.student_id} ${loan.student_name}, ${h}시간 연장 → 새 기한 ${formatDateTime(newDue)}`);
  return { loanId: loan.id, dueAt: newDue.toISOString(), reagentName: loan.reagent_name };
}

// ── 6-3 반납하기 ──
// amount: null/'' 이면 "기록 안 함", 아니면 AMOUNTS 중 하나
function returnLoan(db, { loanId, studentId, amount }) {
  const t = now();
  const loan = getOwnLoan(db, loanId, studentId);
  if (!['반출 중', '연체'].includes(loan.status)) {
    throw new RuleError(loan.status === '승인 대기' ? '아직 승인 대기 중인 기록이에요.' : '이미 처리된 기록이에요.',
      '반출 중인 기록만 반납할 수 있어요.');
  }
  let remaining = '기록 안 함';
  if (amount !== null && amount !== undefined && amount !== '') {
    if (!AMOUNTS.includes(amount)) throw new RuleError('남은 양을 다시 골라 주세요.', `${AMOUNTS.join(' / ')} 중 하나를 골라 주세요.`);
    remaining = amount;
  }

  const changed = db.prepare(`UPDATE reagent_loans SET status = '반납 완료', returned_at = ?, remaining_amount = ?
                              WHERE id = ? AND status IN ('반출 중','연체')`).run(t.toISOString(), remaining, loan.id).changes;
  if (!changed) throw new RuleError('이미 처리된 기록이에요.');

  const late = new Date(loan.due_at) < t ? ' (기한 지나서 반납)' : '';
  notifyAdmin(db, '반납', `[반납] ${loan.reagent_name} — ${loan.student_id} ${loan.student_name}${late}, 남은 양: ${remaining}`);

  // "거의 없음" / "다 씀" → 재구매 목록 + 알림
  let reorder = false;
  if (remaining === '거의 없음' || remaining === '다 씀') {
    db.prepare('INSERT INTO reorder_list (reagent_id, loan_id, reason, created_at) VALUES (?, ?, ?, ?)')
      .run(loan.reagent_id, loan.id, `반납 시 남은 양: ${remaining}`, t.toISOString());
    notifyAdmin(db, '재구매 필요', `[재구매 필요] ${loan.reagent_name} — 반납 시 남은 양 "${remaining}"`);
    reorder = true;
  }
  return { loanId: loan.id, reagentName: loan.reagent_name, remaining, reorder, late: !!late };
}

// ── 시약 검색 (이름, 카스 번호, 바코드) ──
// labId 를 주면 그 실험실 시약만 (13단계), 없으면 모든 실험실
function searchReagents(db, q, labId = null) {
  const s = String(q ?? '').trim().slice(0, 50);
  const like = `%${s.replace(/[%_\\]/g, (c) => '\\' + c)}%`; // %, _ 같은 특수 글자는 그대로 검색되게
  return db.prepare(`
    SELECT r.id, r.name, r.cas_number, r.hazard, r.location, r.quantity, r.lab_id AS labId, lb.name AS labName,
           r.quantity - (SELECT COUNT(*) FROM reagent_loans l
                         WHERE l.reagent_id = r.id AND l.status IN ('승인 대기','반출 중','연체')) AS available
    FROM reagents r LEFT JOIN labs lb ON lb.id = r.lab_id
    WHERE r.archived = 0 AND (? IS NULL OR r.lab_id = ?)
      AND (? = '' OR r.name LIKE ? ESCAPE '\\' OR r.cas_number LIKE ? ESCAPE '\\' OR r.barcode = ?)
    ORDER BY r.name LIMIT 50`).all(labId, labId, s, like, like, s);
}

module.exports = {
  PURPOSES, AMOUNTS, ACTIVE,
  getReagent, searchReagents, findOverdueLoan, assertNotOverdue,
  checkout, approve, reject, listActiveLoans, extend, returnLoan,
  maskStudentId,
};
