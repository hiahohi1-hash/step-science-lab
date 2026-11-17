// ─────────────────────────────────────────────
// 관리자 기능 (명세 8번)
// ─────────────────────────────────────────────
// 관리자 화면에서만 부르는 함수들입니다. 여기서는 학번·이름을 가리지 않고 전체를 보여 줍니다.

const { now } = require('../clock');
const { getSetting, setSetting } = require('../settings');
const { formatDateTime, formatDuration, kstParts, maskStudentId } = require('../timeFormat');
const { notifyAdmin } = require('../notify');
const { RuleError, checkId } = require('./common');
const { isValidCas } = require('./casNumber');
const { photoUrl } = require('./photo');
const { requireLab } = require('./labs');
const R = require('./reagentRules');
const E = require('./equipmentRules');

const MIN = 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * MIN;
const dt = (iso) => (iso ? formatDateTime(new Date(iso)) : '');

// ═════════════════ 요약 ═════════════════
function summary(db) {
  const iso = now().toISOString();
  const one = (sql, ...p) => db.prepare(sql).get(...p).n;
  return {
    onLoan: one("SELECT COUNT(*) n FROM reagent_loans WHERE status = '반출 중' AND due_at > ?", iso),
    pending: one("SELECT COUNT(*) n FROM reagent_loans WHERE status = '승인 대기'"),
    overdue: one("SELECT COUNT(*) n FROM reagent_loans WHERE status = '연체' OR (status = '반출 중' AND due_at <= ?)", iso),
    reorder: one('SELECT COUNT(*) n FROM reorder_list WHERE done_at IS NULL'),
    equipmentInUse: one("SELECT COUNT(*) n FROM equipment WHERE status = '사용 중' AND archived = 0"),
  };
}

// ═════════════════ 승인 대기 / 반출 중 목록 ═════════════════
const LOAN_SELECT = `SELECT l.*, r.name AS reagent_name, r.hazard FROM reagent_loans l JOIN reagents r ON r.id = l.reagent_id`;

function loanRow(l) {
  const t = now();
  const overdue = l.status === '연체' || (l.status === '반출 중' && new Date(l.due_at) <= t);
  return {
    id: l.id, reagentName: l.reagent_name, hazard: l.hazard, studentId: l.student_id, studentName: l.student_name,
    purpose: l.purpose, status: overdue ? '연체' : l.status, overdue, extended: !!l.extended,
    created: dt(l.created_at), due: dt(l.due_at), returned: dt(l.returned_at),
    remaining: l.remaining_amount, rejectReason: l.reject_reason,
    overdueText: overdue ? formatDuration((t - new Date(l.due_at)) / MIN) + ' 지남' : '',
  };
}

function pendingLoans(db) {
  return db.prepare(`${LOAN_SELECT} WHERE l.status = '승인 대기' ORDER BY l.created_at`).all().map(loanRow);
}

// 기한이 가까운 순서 (연체가 맨 위)
function activeLoans(db) {
  return db.prepare(`${LOAN_SELECT} WHERE l.status IN ('반출 중','연체') ORDER BY l.due_at`).all().map(loanRow);
}

// ═════════════════ 기구 현황 (강제 종료, 점검 중, 대기열 정리) ═════════════════
function equipmentStatus(db, labId = null) {
  const rows = db.prepare("SELECT * FROM equipment WHERE archived = 0 AND kind != '안내' AND (? IS NULL OR lab_id = ?) ORDER BY name, unit_label, id").all(labId, labId);
  return rows.map((e) => {
    const view = E.equipmentView(db, e);
    const use = E.currentUse(db, e.id);
    const queue = E.activeQueue(db, e.id);
    return {
      ...view,
      user: use ? { studentId: use.student_id, studentName: use.student_name, started: dt(use.started_at), ends: dt(use.ends_at) } : null,
      queue: queue.map((q, i) => ({ id: q.id, order: i + 1, studentId: q.student_id, studentName: q.student_name, status: q.status, joined: dt(q.joined_at) })),
    };
  });
}

function getEquipmentAny(db, id) {
  const e = db.prepare('SELECT * FROM equipment WHERE id = ? AND archived = 0').get(checkId(id, '기구'));
  if (!e) throw new RuleError('그 기구를 찾을 수 없어요.', '목록을 새로 고쳐 주세요.', 404);
  return e;
}

function forceEnd(db, id) {
  const e = getEquipmentAny(db, id);
  if (!E.currentUse(db, e.id)) throw new RuleError('지금 사용 중이 아니에요.', '목록을 새로 고쳐 주세요.');
  return E.finishUse(db, e.id, '강제 종료');
}

// 점검 중으로 바꾸기 / 점검 끝내기
function setMaintenance(db, id, on) {
  const e = getEquipmentAny(db, id);
  if (on) {
    if (E.currentUse(db, e.id)) throw new RuleError('사용 중인 기구는 바로 점검 중으로 바꿀 수 없어요.', '먼저 "강제 종료"를 눌러 주세요.');
    // 예약 대기 중이던 차례는 다시 "대기"로 돌려서 점검이 끝나면 다시 차례를 받게 함
    db.prepare("UPDATE equipment_queue SET status = '대기', turn_started_at = NULL WHERE equipment_id = ? AND status = '차례'").run(e.id);
    db.prepare("UPDATE equipment SET status = '점검 중' WHERE id = ?").run(e.id);
    return { status: '점검 중' };
  }
  if (e.status !== '점검 중') throw new RuleError('점검 중인 기구가 아니에요.');
  db.prepare("UPDATE equipment SET status = '사용 가능' WHERE id = ?").run(e.id);
  const next = E.giveTurnToNext(db, e.id); // 대기자가 있으면 바로 예약 대기
  return { status: next ? '예약 대기' : '사용 가능' };
}

// ── 모든 기구의 대기열 한눈에 보기 (잘못된 대기 찾기용) ──
function allQueues(db, labId = null) {
  const rows = db.prepare(`SELECT q.*, e.name, e.unit_label, e.status AS equipment_status FROM equipment_queue q
                           JOIN equipment e ON e.id = q.equipment_id
                           WHERE q.status IN ('대기','차례') AND e.archived = 0 AND (? IS NULL OR e.lab_id = ?)
                           ORDER BY e.name, e.unit_label, CASE q.status WHEN '차례' THEN 0 ELSE 1 END, q.joined_at, q.id`).all(labId, labId);
  const orderOf = new Map();
  return rows.map((q) => {
    const n = (orderOf.get(q.equipment_id) || 0) + 1;
    orderOf.set(q.equipment_id, n);
    return {
      id: q.id, equipmentId: q.equipment_id, equipmentName: E.displayName(q), equipmentStatus: q.equipment_status,
      order: n, studentId: q.student_id, studentName: q.student_name, status: q.status, joined: dt(q.joined_at),
    };
  });
}

// 대기열에서 한 명 삭제 (잘못 등록된 대기 등)
// reason: 삭제 이유 (선택) — 알림 기록에 남겨서 나중에 누가 왜 빠졌는지 알 수 있게
function cancelQueueEntry(db, queueId, reason) {
  const q = db.prepare(`SELECT q.*, e.name, e.unit_label FROM equipment_queue q JOIN equipment e ON e.id = q.equipment_id
                        WHERE q.id = ? AND q.status IN ('대기','차례')`).get(checkId(queueId, '대기'));
  if (!q) throw new RuleError('그 대기 기록을 찾을 수 없어요.', '이미 삭제됐거나 사용을 시작했을 수 있어요. 목록을 새로 고쳐 주세요.');
  const why = String(reason ?? '').trim().slice(0, 100);
  let next = null;
  db.transaction(() => {
    db.prepare("UPDATE equipment_queue SET status = '취소' WHERE id = ?").run(q.id);
    // 차례였던 사람을 뺐으면 다음 사람에게 차례 (없으면 사용 가능)
    if (q.status === '차례') next = E.giveTurnToNext(db, q.equipment_id);
  })();
  notifyAdmin(db, '대기열 삭제', `[대기열 삭제] ${E.displayName(q)} — ${q.student_id} ${q.student_name}${why ? ` (이유: ${why})` : ''}`);
  return { displayName: E.displayName(q), wasTurn: q.status === '차례', nextStudent: next ? maskStudentId(next.student_id) : null };
}

// 대기열 모두 비우기
function clearQueue(db, id) {
  const e = getEquipmentAny(db, id);
  const n = db.transaction(() => {
    const changes = db.prepare("UPDATE equipment_queue SET status = '취소' WHERE equipment_id = ? AND status IN ('대기','차례')").run(e.id).changes;
    if (e.status === '예약 대기') db.prepare("UPDATE equipment SET status = '사용 가능' WHERE id = ?").run(e.id);
    return changes;
  })();
  if (n) notifyAdmin(db, '대기열 삭제', `[대기열 모두 비움] ${E.displayName(e)} — ${n}명`);
  return { removed: n };
}

// ═════════════════ 전체 기록 검색 + CSV ═════════════════
// filters: { type: 'loans' | 'uses', from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', q: 학번 또는 이름 }
function kstDayStart(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - KST_OFFSET_MS);
}

function records(db, filters) {
  const type = filters.type === 'uses' ? 'uses' : 'loans';
  const from = kstDayStart(filters.from);
  const toStart = kstDayStart(filters.to);
  const to = toStart ? new Date(toStart.getTime() + 24 * 60 * MIN) : null; // 끝 날짜 하루 전체 포함
  const q = String(filters.q || '').trim().slice(0, 30);
  const like = `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;

  if (type === 'loans') {
    const rows = db.prepare(`${LOAN_SELECT}
      WHERE (? IS NULL OR l.created_at >= ?) AND (? IS NULL OR l.created_at < ?)
        AND (? = '' OR l.student_id LIKE ? ESCAPE '\\' OR l.student_name LIKE ? ESCAPE '\\')
      ORDER BY l.created_at DESC LIMIT 2000`).all(
      from && from.toISOString(), from && from.toISOString(), to && to.toISOString(), to && to.toISOString(), q, like, like);
    return { type, rows: rows.map(loanRow) };
  }
  const rows = db.prepare(`
    SELECT u.*, e.name, e.unit_label FROM equipment_uses u JOIN equipment e ON e.id = u.equipment_id
    WHERE (? IS NULL OR u.started_at >= ?) AND (? IS NULL OR u.started_at < ?)
      AND (? = '' OR u.student_id LIKE ? ESCAPE '\\' OR u.student_name LIKE ? ESCAPE '\\')
    ORDER BY u.started_at DESC LIMIT 2000`).all(
    from && from.toISOString(), from && from.toISOString(), to && to.toISOString(), to && to.toISOString(), q, like, like);
  return {
    type,
    rows: rows.map((u) => ({
      id: u.id, equipmentName: E.displayName(u), studentId: u.student_id, studentName: u.student_name,
      started: dt(u.started_at), ends: dt(u.ends_at), ended: dt(u.ended_at), endReason: u.end_reason || '사용 중',
      minutes: Math.round(((u.ended_at ? new Date(u.ended_at) : now()) - new Date(u.started_at)) / MIN),
      extended: !!u.extended,
    })),
  };
}

// CSV 칸 하나 만들기
// ⚠ 엑셀은 =, +, -, @ 로 시작하는 칸을 "수식"으로 실행합니다. 학생이 이름 칸에 수식을 넣어
//   관리자 컴퓨터에서 실행되게 하는 공격을 막기 위해 앞에 ' 를 붙여 글자로만 보이게 합니다.
function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

function recordsCsv(db, filters) {
  const { type, rows } = records(db, filters);
  const cols = type === 'loans'
    ? [['번호', 'id'], ['시약', 'reagentName'], ['위험 등급', 'hazard'], ['학번', 'studentId'], ['이름', 'studentName'], ['사용 목적', 'purpose'],
      ['상태', 'status'], ['신청', 'created'], ['반납 기한', 'due'], ['반납', 'returned'], ['연장', 'extended'], ['남은 양', 'remaining'], ['거절 사유', 'rejectReason']]
    : [['번호', 'id'], ['기구', 'equipmentName'], ['학번', 'studentId'], ['이름', 'studentName'], ['시작', 'started'], ['종료 예정', 'ends'],
      ['실제 종료', 'ended'], ['종료 방식', 'endReason'], ['사용 시간(분)', 'minutes'], ['연장', 'extended']];
  const lines = [cols.map(([label]) => csvCell(label)).join(',')];
  for (const r of rows) {
    lines.push(cols.map(([, key]) => csvCell(typeof r[key] === 'boolean' ? (r[key] ? '예' : '아니오') : r[key])).join(','));
  }
  // 맨 앞의 ﻿(BOM): 엑셀이 한글을 깨뜨리지 않고 읽게 하는 표시
  return { filename: `${type === 'loans' ? '시약반출기록' : '기구사용기록'}.csv`, body: '﻿' + lines.join('\r\n') };
}

// ═════════════════ 시약 관리 ═════════════════
function listReagents(db, labId = null) {
  return db.prepare(`SELECT r.*, r.quantity - (SELECT COUNT(*) FROM reagent_loans l
                       WHERE l.reagent_id = r.id AND l.status IN ('승인 대기','반출 중','연체')) AS available
                     FROM reagents r WHERE r.archived = 0 AND (? IS NULL OR r.lab_id = ?) ORDER BY r.name`).all(labId, labId);
}

function text(v, label, max, required = false) {
  const s = String(v ?? '').trim();
  if (required && !s) throw new RuleError(`${label}을(를) 입력해 주세요.`);
  if (s.length > max) throw new RuleError(`${label}이(가) 너무 길어요.`, `${max}글자 이하로 줄여 주세요.`);
  return s;
}

function saveReagent(db, data, id) {
  const name = text(data.name, '시약 이름', 50, true);
  const cas = text(data.cas_number, '카스 번호', 15);
  if (cas && !isValidCas(cas)) throw new RuleError('카스 번호가 올바르지 않아요.', '예: 7647-01-0 처럼 쓰고, 마지막 검증 숫자를 확인해 주세요.');
  const barcode = text(data.barcode, '바코드 번호', 40);
  if (barcode && !/^[0-9A-Za-z-]+$/.test(barcode)) throw new RuleError('바코드 번호에는 숫자·영어·- 만 쓸 수 있어요.');
  if (!['일반', '고위험'].includes(data.hazard)) throw new RuleError('위험 등급을 골라 주세요.', '일반 또는 고위험');
  const location = text(data.location, '보관 위치', 50);
  const quantity = Number(data.quantity);
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 9999) throw new RuleError('병 수는 0 이상의 정수로 입력해 주세요.');
  const memo = text(data.memo, '메모', 500);
  const labId = requireLab(db, data.lab_id);

  if (barcode) {
    const dup = db.prepare('SELECT id, name FROM reagents WHERE barcode = ? AND archived = 0 AND id != ?').get(barcode, id || 0);
    if (dup) throw new RuleError(`이 바코드는 이미 "${dup.name}"에 등록되어 있어요.`, '바코드 번호를 확인해 주세요.');
  }
  if (id) {
    const changed = db.prepare(`UPDATE reagents SET name=?, cas_number=?, barcode=?, hazard=?, location=?, quantity=?, memo=?, lab_id=?
                                WHERE id = ? AND archived = 0`).run(name, cas || null, barcode || null, data.hazard, location, quantity, memo, labId, checkId(id, '시약')).changes;
    if (!changed) throw new RuleError('그 시약을 찾을 수 없어요.', '목록을 새로 고쳐 주세요.', 404);
    return { id: Number(id) };
  }
  const info = db.prepare(`INSERT INTO reagents (name, cas_number, barcode, hazard, location, quantity, memo, lab_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(name, cas || null, barcode || null, data.hazard, location, quantity, memo, labId);
  return { id: Number(info.lastInsertRowid) };
}

function archiveReagent(db, id) {
  const active = db.prepare("SELECT COUNT(*) n FROM reagent_loans WHERE reagent_id = ? AND status IN ('승인 대기','반출 중','연체')").get(checkId(id, '시약')).n;
  if (active) throw new RuleError('아직 반납되지 않은 기록이 있어서 삭제할 수 없어요.', '모두 반납된 뒤에 삭제해 주세요.');
  db.prepare('UPDATE reagents SET archived = 1 WHERE id = ?').run(id);
}

// ═════════════════ 기구 관리 ═════════════════
function listEquipmentAdmin(db, labId = null) {
  return db.prepare('SELECT * FROM equipment WHERE archived = 0 AND (? IS NULL OR lab_id = ?) ORDER BY name, unit_label, id').all(labId, labId).map((e) => ({
    lab_id: e.lab_id,
    kind: e.kind || '예약',
    keywords: JSON.parse(e.keywords || '[]'),
    id: e.id, name: e.name, unit_label: e.unit_label, location: e.location, max_minutes: e.max_minutes,
    is_dangerous: !!e.is_dangerous, status: e.status, photoUrl: photoUrl(e.photo),
    howto: JSON.parse(e.howto), checklist: JSON.parse(e.checklist), cautions: JSON.parse(e.cautions), time_options: JSON.parse(e.time_options),
    classes: db.prepare('SELECT class_name FROM model_class_map WHERE equipment_id = ?').all(e.id).map((m) => m.class_name),
  }));
}

// 글 목록 (사용법, 확인 사항, 주의사항) 검사: 빈 줄 빼고 최대 40줄, 줄마다 300글자
function textList(v, label) {
  const list = (Array.isArray(v) ? v : []).map((s) => String(s ?? '').trim()).filter(Boolean);
  if (list.length > 40) throw new RuleError(`${label}은(는) 40줄까지만 쓸 수 있어요.`);
  if (list.some((s) => s.length > 300)) throw new RuleError(`${label}의 한 줄이 너무 길어요.`, '한 줄에 300글자 이하로 나눠 주세요.');
  return list;
}

function saveEquipment(db, data, id) {
  const kind = data.kind === undefined ? '예약' : data.kind;
  if (!['예약', '안내'].includes(kind)) throw new RuleError('기구 종류를 골라 주세요.', '예약 기구 또는 안내 전용');
  if (kind === '안내') {
    // 안내 전용: 사용 시간·위험 기구 표시는 쓰지 않으므로 기본값으로 채움
    data = { ...data, max_minutes: 60, time_options: [], is_dangerous: false };
    if (id) {
      const busy = db.prepare('SELECT 1 FROM equipment_uses WHERE equipment_id = ? AND ended_at IS NULL').get(checkId(id, '기구'))
        || db.prepare("SELECT 1 FROM equipment_queue WHERE equipment_id = ? AND status IN ('대기','차례')").get(id);
      if (busy) throw new RuleError('지금 사용 중이거나 대기자가 있어서 안내 전용으로 바꿀 수 없어요.', '사용이 끝나고 대기열을 비운 뒤 바꿔 주세요.');
    }
  }
  const name = text(data.name, '기구 이름', 50, true);
  const unit = text(data.unit_label, '구분 이름', 30);
  const location = text(data.location, '보관 위치', 50);
  const max = Number(data.max_minutes);
  if (!Number.isInteger(max) || max < 1 || max > 14 * 24 * 60) throw new RuleError('최대 사용 시간을 확인해 주세요.', '1분 ~ 14일 사이로 정해 주세요.');
  const options = (Array.isArray(data.time_options) ? data.time_options : []).map((o) => ({
    label: text(o && o.label, '시간 선택지 이름', 40, true), minutes: Number(o && o.minutes),
  }));
  if (options.length > 10) throw new RuleError('사용 시간 선택지는 10개까지만 만들 수 있어요.');
  for (const o of options) {
    if (!Number.isInteger(o.minutes) || o.minutes < 1 || o.minutes > max) {
      throw new RuleError(`"${o.label}"의 시간이 올바르지 않아요.`, `1분 이상, 최대 사용 시간(${formatDuration(max)}) 이하로 정해 주세요.`);
    }
  }
  const howto = textList(data.howto, '사용법');
  const checklist = textList(data.checklist, '필수 확인 사항');
  const cautions = textList(data.cautions, '주의사항');
  // 16단계: 쓰이는 실험·키워드 (30개까지, 하나에 30글자까지)
  const keywords = [...new Set((Array.isArray(data.keywords) ? data.keywords : []).map((k) => String(k ?? '').trim()).filter(Boolean))];
  if (keywords.length > 30) throw new RuleError('키워드는 30개까지만 쓸 수 있어요.');
  if (keywords.some((k) => k.length > 30)) throw new RuleError('키워드 하나가 너무 길어요.', '30글자 이하로 줄여 주세요.');
  const dangerous = data.is_dangerous ? 1 : 0;
  const labId = requireLab(db, data.lab_id);
  const args = [name, unit, location, max, JSON.stringify(options), JSON.stringify(howto), JSON.stringify(checklist), JSON.stringify(cautions), dangerous, labId, kind, JSON.stringify(keywords)];

  if (id) {
    const changed = db.prepare(`UPDATE equipment SET name=?, unit_label=?, location=?, max_minutes=?, time_options=?, howto=?, checklist=?, cautions=?, is_dangerous=?, lab_id=?, kind=?, keywords=?
                                WHERE id = ? AND archived = 0`).run(...args, checkId(id, '기구')).changes;
    if (!changed) throw new RuleError('그 기구를 찾을 수 없어요.', '목록을 새로 고쳐 주세요.', 404);
    return { id: Number(id) };
  }
  const info = db.prepare(`INSERT INTO equipment (name, unit_label, location, max_minutes, time_options, howto, checklist, cautions, is_dangerous, lab_id, kind, keywords)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...args);
  return { id: Number(info.lastInsertRowid) };
}

function archiveEquipment(db, id) {
  const e = getEquipmentAny(db, id);
  if (E.currentUse(db, e.id)) throw new RuleError('사용 중인 기구는 삭제할 수 없어요.', '먼저 강제 종료해 주세요.');
  db.transaction(() => {
    db.prepare("UPDATE equipment_queue SET status = '취소' WHERE equipment_id = ? AND status IN ('대기','차례')").run(e.id);
    db.prepare('DELETE FROM model_class_map WHERE equipment_id = ?').run(e.id);
    db.prepare('UPDATE equipment SET archived = 1 WHERE id = ?').run(e.id);
  })();
}

// ═════════════════ 재구매 목록 ═════════════════
function reorderList(db) {
  return db.prepare(`SELECT o.*, r.name AS reagent_name FROM reorder_list o JOIN reagents r ON r.id = o.reagent_id
                     WHERE o.done_at IS NULL ORDER BY o.created_at`).all().map((o) => ({ id: o.id, reagentName: o.reagent_name, reason: o.reason, created: dt(o.created_at) }));
}

function markPurchased(db, id) {
  const changed = db.prepare('UPDATE reorder_list SET done_at = ? WHERE id = ? AND done_at IS NULL').run(now().toISOString(), checkId(id, '재구매')).changes;
  if (!changed) throw new RuleError('이미 처리된 항목이에요.', '목록을 새로 고쳐 주세요.');
}

// ═════════════════ 사용 통계 (탐구 보고서용) ═════════════════
// month: 'YYYY-MM' (없으면 이번 달, 한국 시간 기준)
function stats(db, month, labId = null) {
  let y, m;
  const mm = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (mm) { y = +mm[1]; m = +mm[2]; } else { const p = kstParts(now()); y = p.year; m = p.month; }
  const start = new Date(Date.UTC(y, m - 1, 1) - KST_OFFSET_MS);
  const end = new Date(Date.UTC(y, m, 1) - KST_OFFSET_MS);
  const t = now();

  const uses = db.prepare(`SELECT u.*, e.name, e.unit_label FROM equipment_uses u JOIN equipment e ON e.id = u.equipment_id
                           WHERE u.started_at >= ? AND u.started_at < ? AND (? IS NULL OR e.lab_id = ?)`).all(start.toISOString(), end.toISOString(), labId, labId);
  const byEquip = new Map();
  for (const u of uses) {
    const key = E.displayName(u);
    const s = byEquip.get(key) || { equipment: key, count: 0, minutes: 0 };
    s.count += 1;
    s.minutes += Math.max(0, Math.round(((u.ended_at ? new Date(u.ended_at) : t) - new Date(u.started_at)) / MIN));
    byEquip.set(key, s);
  }

  const reagents = db.prepare(`SELECT r.name AS reagent, COUNT(*) AS count FROM reagent_loans l JOIN reagents r ON r.id = l.reagent_id
                               WHERE l.created_at >= ? AND l.created_at < ? AND l.status IN ('반출 중','연체','반납 완료') AND (? IS NULL OR r.lab_id = ?)
                               GROUP BY r.id ORDER BY count DESC, r.name`).all(start.toISOString(), end.toISOString(), labId, labId);
  return {
    month: `${y}-${String(m).padStart(2, '0')}`,
    equipment: [...byEquip.values()].sort((a, b) => b.count - a.count).map((s) => ({ ...s, minutesText: formatDuration(s.minutes) })),
    reagents,
  };
}

// ═════════════════ 알림 기록 (8단계: 관리자 화면 알림) ═════════════════
// afterId 를 주면 그 번호보다 새 알림만 (관리자 화면이 새 알림을 가져갈 때)
function notifications(db, afterId) {
  const after = Number.isInteger(Number(afterId)) && Number(afterId) > 0 ? Number(afterId) : 0;
  const rows = after
    ? db.prepare('SELECT * FROM notifications WHERE id > ? ORDER BY id LIMIT 50').all(after)
    : db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 200').all();
  return {
    unread: db.prepare('SELECT COUNT(*) n FROM notifications WHERE read_at IS NULL').get().n,
    lastId: db.prepare('SELECT COALESCE(MAX(id), 0) n FROM notifications').get().n,
    items: rows.map((n) => ({
      id: n.id, type: n.type, message: n.message, time: dt(n.sent_at), read: !!n.read_at,
      // 컴퓨터 알림 창에 띄울 짧은 글: 학번·이름 없이 "[연체] 에탄올" 까지만 (주변 학생이 볼 수 있으므로)
      short: String(n.message).split(' — ')[0],
    })),
  };
}

function markAllRead(db) {
  db.prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL').run(now().toISOString());
}

// ═════════════════ 설정 ═════════════════
// 관리자 화면에서 바꿀 수 있는 설정과 검사 방법 (여기 없는 이름은 저장하지 않음)
const EDITABLE = {
  normal_max_loan_hours: { label: '일반 시약 최장 반출 시간(시간)', check: (v) => Number.isInteger(+v) && +v >= 1 && +v <= 720 },
  extend_max_hours: { label: '시약 연장 최대 시간(시간)', check: (v) => Number.isInteger(+v) && +v >= 1 && +v <= 168 },
  high_risk_return_time: { label: '고위험 시약 반납 시각', check: (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v) },
  reservation_priority_minutes: { label: '예약 대기 우선 시간(분)', check: (v) => Number.isInteger(+v) && +v >= 1 && +v <= 120 },
  queue_enabled: { label: '기구 대기 기능 쓰기', check: (v) => v === '0' || v === '1' },
  training_collect: { label: '확인한 기구 사진을 학습용으로 모으기', check: (v) => v === '0' || v === '1' },
  anonymize_after_year: { label: '1년 지난 기록의 학번·이름 자동 지우기', check: (v) => v === '0' || v === '1' },
};

function getEditableSettings(db) {
  return Object.fromEntries(Object.keys(EDITABLE).map((k) => [k, getSetting(db, k)]));
}

function saveSettings(db, data) {
  const changes = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (!EDITABLE[k]) continue; // 모르는 이름은 무시 (비밀번호 해시 같은 것을 바꾸지 못하게)
    const s = String(v).trim();
    if (!EDITABLE[k].check(s)) throw new RuleError(`"${EDITABLE[k].label}" 값이 올바르지 않아요.`, '다시 확인해 주세요.');
    changes[k] = s;
  }
  db.transaction(() => {
    for (const [k, v] of Object.entries(changes)) setSetting(db, k, v);
    // 대기 기능을 끄면: 남아 있던 대기는 취소하고, "예약 대기" 기구는 "사용 가능"으로
    if (changes.queue_enabled === '0') {
      db.prepare("UPDATE equipment_queue SET status = '취소' WHERE status IN ('대기','차례')").run();
      db.prepare("UPDATE equipment SET status = '사용 가능' WHERE status = '예약 대기'").run();
    }
  })();
  return getEditableSettings(db);
}

module.exports = {
  summary, pendingLoans, activeLoans,
  equipmentStatus, forceEnd, setMaintenance, cancelQueueEntry, clearQueue, allQueues,
  records, recordsCsv, csvCell,
  listReagents, saveReagent, archiveReagent,
  listEquipmentAdmin, saveEquipment, archiveEquipment,
  reorderList, markPurchased, stats, notifications, markAllRead,
  getEditableSettings, saveSettings,
  approve: R.approve, reject: R.reject,
};
