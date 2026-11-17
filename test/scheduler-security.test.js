// 1분마다 자동 검사(6-4) + 보안 테스트
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { freshDb, at, after, resetClock, student, REAGENT } = require('./helpers');
const R = require('../src/rules/reagentRules');
const S = require('../src/scheduler');
const A = require('../src/rules/adminRules');
const auth = require('../src/auth');
const { maskStudentId, formatDateTime } = require('../src/timeFormat');
const { setSetting } = require('../src/settings');

afterEach(resetClock);
const base = { ...student('20315', '홍길동'), purpose: '동아리' };
const notes = (db, type) => db.prepare('SELECT COUNT(*) n FROM notifications WHERE type = ?').get(type).n;

// ── 자동 검사 ──

test('고위험 승인 대기는 30분 동안 처리되지 않으면 자동 취소', () => {
  const db = freshDb();
  at('2026-11-14 13:00');
  const { loanId } = R.checkout(db, { ...base, reagentId: REAGENT.염산 });
  after(29); S.runChecks(db);
  assert.equal(db.prepare('SELECT status FROM reagent_loans WHERE id = ?').get(loanId).status, '승인 대기');
  after(1); S.runChecks(db);
  assert.equal(db.prepare('SELECT status FROM reagent_loans WHERE id = ?').get(loanId).status, '자동 취소');
});

test('기한 1시간 전 알림은 한 번만, 연체 알림은 처음 1번 + 하루 1번', () => {
  const db = freshDb();
  at('2026-11-14 10:00');
  R.checkout(db, { ...base, reagentId: REAGENT.에탄올, hours: 3 }); // 기한 13:00
  at('2026-11-14 12:00'); S.runChecks(db); S.runChecks(db);
  assert.equal(notes(db, '곧 반납 기한'), 1);
  at('2026-11-14 13:00'); S.runChecks(db);
  at('2026-11-14 13:01'); S.runChecks(db);
  assert.equal(notes(db, '연체'), 1, '처음 1번');
  at('2026-11-15 12:59'); S.runChecks(db);
  assert.equal(notes(db, '연체'), 1, '24시간 전에는 다시 안 보냄');
  at('2026-11-15 13:00'); S.runChecks(db);
  assert.equal(notes(db, '연체'), 2, '하루 뒤 1번 더');
});

test('1년 지난 기록의 학번·이름 지우기는 설정을 켰을 때만, 끝난 기록만', () => {
  const db = freshDb();
  at('2025-11-01 10:00');
  const old = R.checkout(db, { ...base, reagentId: REAGENT.에탄올, hours: 1 });
  R.returnLoan(db, { loanId: old.loanId, studentId: '20315', amount: null });
  at('2026-11-14 10:00');
  assert.equal(S.anonymizeOldRecords(db), 0, '설정이 꺼져 있으면 지우지 않음');
  setSetting(db, 'anonymize_after_year', '1');
  assert.equal(S.anonymizeOldRecords(db), 1);
  assert.equal(db.prepare('SELECT student_id FROM reagent_loans WHERE id = ?').get(old.loanId).student_id, null);
});

// ── 보여 주기 ──

test('학번은 뒤 두 자리를 가리고, 날짜는 한국식으로 보여 준다', () => {
  assert.equal(maskStudentId('20315'), '203**');
  assert.equal(formatDateTime(new Date('2026-11-14T15:00:00+09:00')), '11월 14일 (토) 오후 3:00');
  assert.equal(formatDateTime(new Date('2026-11-15T00:05:00+09:00')), '11월 15일 (일) 오전 12:05');
});

// ── 보안 ──

test('비밀번호는 그대로 저장하지 않고, 맞는 비밀번호만 통과한다', () => {
  const stored = auth.hashPassword('my-secret-pw');
  assert.ok(!stored.includes('my-secret-pw'));
  assert.equal(auth.verifyPassword('my-secret-pw', stored), true);
  assert.equal(auth.verifyPassword('my-secret-pX', stored), false);
  assert.notEqual(auth.hashPassword('my-secret-pw'), stored, '같은 비밀번호도 매번 다르게 저장 (소금값)');
});

test('CSV: 엑셀 수식처럼 보이는 글자는 실행되지 않게 바꾼다', () => {
  for (const evil of ['=1+1', '+cmd', '-2+3', '@SUM(A1)']) {
    assert.ok(A.csvCell(evil).startsWith(`"'`), evil);
  }
  assert.equal(A.csvCell('홍길동'), '"홍길동"');
  assert.equal(A.csvCell('따옴표"하나'), '"따옴표""하나"');
});

test('설정 저장은 정해진 항목만 받는다 (비밀번호 해시 같은 것은 바꿀 수 없음)', () => {
  const db = freshDb();
  A.saveSettings(db, { admin_password_hash: 'hacked', reservation_priority_minutes: '15' });
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'").get(), undefined);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'reservation_priority_minutes'").get().value, '15');
});
