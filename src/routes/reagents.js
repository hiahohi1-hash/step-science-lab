// ─────────────────────────────────────────────
// 시약 관련 서버 주소 (학생용 처음 화면에서 사용)
// ─────────────────────────────────────────────
// 실제 규칙은 rules/reagentRules.js 에 있고, 여기서는 화면 ↔ 규칙을 이어 주기만 합니다.

const express = require('express');
const { getDb } = require('../db');
const { getNumber, getSetting } = require('../settings');
const { formatDateTime, formatTime, kstTimeOnSameDay } = require('../timeFormat');
const { now } = require('../clock');
const R = require('../rules/reagentRules');
const { findCasNumbers } = require('../rules/casNumber');
const { labFilter } = require('../rules/labs');

const router = express.Router();

// 화면에 보여 줄 때 시각을 한국식 글자로 바꿔 함께 보냄
const withText = (iso) => (iso ? { iso, text: formatDateTime(new Date(iso)) } : null);

// 반출 화면에 필요한 정보 (사용 목적, 시간 범위 등)
router.get('/meta', (req, res) => {
  const db = getDb();
  res.json({
    ok: true,
    purposes: R.PURPOSES,
    amounts: R.AMOUNTS,
    minHours: getNumber(db, 'normal_min_loan_hours'),
    maxHours: getNumber(db, 'normal_max_loan_hours'),
    extendMaxHours: getNumber(db, 'extend_max_hours'),
    // "18:00" → "오후 6:00" 처럼 한국식으로
    highRiskReturnTime: formatTime(kstTimeOnSameDay(now(), getSetting(db, 'high_risk_return_time'))),
  });
});

// 시약 검색: /api/reagents?q=염산
router.get('/', (req, res) => {
  res.json({ ok: true, reagents: R.searchReagents(getDb(), req.query.q, labFilter(getDb(), req.query.lab)) });
});

// 5-2 ① 바코드로 시약 찾기: /api/reagents/by-barcode/8801234567890
router.get('/by-barcode/:code', (req, res) => {
  const code = String(req.params.code || '').trim().slice(0, 40);
  const db = getDb();
  const row = /^[0-9A-Za-z-]+$/.test(code) ? db.prepare('SELECT id FROM reagents WHERE barcode = ? AND archived = 0').get(code) : null;
  if (!row) {
    return res.status(404).json({ ok: false, message: `바코드 ${code} 로 등록된 시약이 없어요.`, hint: '"라벨 글자 읽기"를 해 보거나 이름으로 찾아 주세요. 선생님은 관리자 화면에서 바코드를 등록할 수 있어요.' });
  }
  res.json({ ok: true, reagentId: row.id });
});

// 5-2 ② 라벨에서 읽은 글자로 시약 찾기: 글자 속 올바른 카스 번호만 골라서 찾음 (검증 실패한 번호는 무시)
router.post('/find-by-text', (req, res) => {
  const text = String((req.body || {}).text || '').slice(0, 5000);
  const casNumbers = findCasNumbers(text);
  const db = getDb();
  const reagents = casNumbers.length
    ? db.prepare(`SELECT id, name, cas_number FROM reagents WHERE archived = 0 AND cas_number IN (${casNumbers.map(() => '?').join(',')})`).all(...casNumbers)
    : [];
  res.json({ ok: true, casNumbers, reagents });
});

// 시약 하나: /api/reagents/1
router.get('/:id', (req, res) => {
  const r = R.getReagent(getDb(), Number(req.params.id));
  res.json({
    ok: true,
    reagent: { id: r.id, name: r.name, cas_number: r.cas_number, hazard: r.hazard, location: r.location, quantity: r.quantity, available: r.available },
  });
});

// 반출 신청
router.post('/loans', (req, res) => {
  const result = R.checkout(getDb(), req.body || {});
  res.json({ ok: true, ...result, due: withText(result.dueAt) });
});

// 학번으로 아직 반납하지 않은 기록 보기 (반납·연장 화면)
router.post('/loans/mine', (req, res) => {
  const { studentId, reagentId } = req.body || {};
  const loans = R.listActiveLoans(getDb(), studentId, reagentId || null).map((l) => ({
    id: l.id, reagentName: l.reagent_name, hazard: l.hazard, status: l.status,
    overdue: l.overdue, extended: !!l.extended, canExtend: l.canExtend, extendBlockedReason: l.extendBlockedReason,
    due: withText(l.due_at), created: withText(l.created_at),
  }));
  res.json({ ok: true, loans });
});

// 연장
router.post('/loans/:id/extend', (req, res) => {
  const result = R.extend(getDb(), { loanId: req.params.id, ...(req.body || {}) });
  res.json({ ok: true, ...result, due: withText(result.dueAt) });
});

// 반납
router.post('/loans/:id/return', (req, res) => {
  const result = R.returnLoan(getDb(), { loanId: req.params.id, ...(req.body || {}) });
  res.json({ ok: true, ...result });
});

module.exports = router;
