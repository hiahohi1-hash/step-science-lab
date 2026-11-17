// 시약 규칙 테스트 (명세 6번, 11단계)
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { freshDb, at, after, resetClock, student, REAGENT, EQUIP, ALL_CHECKED } = require('./helpers');
const R = require('../src/rules/reagentRules');
const E = require('../src/rules/equipmentRules');

afterEach(resetClock);

const base = { ...student('20315', '홍길동'), purpose: '수업 실험' };

// ── 명세 11단계 필수 테스트 ──

test('고위험 시약은 오후 6시 이후 반출이 막힌다', () => {
  const db = freshDb();
  at('2026-11-14 18:00');
  assert.throws(() => R.checkout(db, { ...base, reagentId: REAGENT.염산 }), /오후 6:00 이후 반출할 수 없습니다/);
  at('2026-11-14 21:30');
  assert.throws(() => R.checkout(db, { ...base, reagentId: REAGENT.황산 }), /이후 반출할 수 없습니다/);
});

test('고위험 시약은 오후 6시 전에는 "승인 대기"가 되고 기한은 그날 오후 6시', () => {
  const db = freshDb();
  at('2026-11-14 17:59');
  const r = R.checkout(db, { ...base, reagentId: REAGENT.염산 });
  assert.equal(r.status, '승인 대기');
  assert.equal(r.dueAt, new Date('2026-11-14T18:00:00+09:00').toISOString());
});

test('시약 연장은 두 번째 시도가 막힌다', () => {
  const db = freshDb();
  at('2026-11-14 10:00');
  const { loanId } = R.checkout(db, { ...base, reagentId: REAGENT.에탄올, hours: 3 });
  R.extend(db, { loanId, studentId: '20315', hours: 2 });
  assert.throws(() => R.extend(db, { loanId, studentId: '20315', hours: 1 }), /한 번만/);
});

test('72시간이 넘는 반납 기한은 막힌다', () => {
  const db = freshDb();
  at('2026-11-14 10:00');
  assert.throws(() => R.checkout(db, { ...base, reagentId: REAGENT.에탄올, hours: 73 }), /72시간 이하/);
  // 딱 72시간은 됨
  assert.equal(R.checkout(db, { ...base, reagentId: REAGENT.에탄올, hours: 72 }).status, '반출 중');
});

test('연체 중인 학번은 시약 반출과 기구 사용이 모두 막힌다', () => {
  const db = freshDb();
  at('2026-11-14 10:00');
  R.checkout(db, { ...base, reagentId: REAGENT.에탄올, hours: 1 });
  at('2026-11-14 11:01'); // 기한(11:00)이 지남
  assert.throws(() => R.checkout(db, { ...base, reagentId: REAGENT.아세톤, hours: 1 }), /연체 중인 시약/);
  assert.throws(() => E.startUse(db, { equipmentId: EQUIP.원심분리기, ...student('20315'), minutes: 10, checked: ALL_CHECKED[EQUIP.원심분리기] }), /연체 중인 시약/);
  assert.throws(() => E.joinQueue(db, { equipmentId: EQUIP.원심분리기, ...student('20315') }), /연체|사용할 수 있어요/);
});

test('연체된 시약을 반납하면 다시 반출할 수 있다', () => {
  const db = freshDb();
  at('2026-11-14 10:00');
  const { loanId } = R.checkout(db, { ...base, reagentId: REAGENT.에탄올, hours: 1 });
  after(90);
  R.returnLoan(db, { loanId, studentId: '20315', amount: null });
  assert.equal(R.checkout(db, { ...base, reagentId: REAGENT.아세톤, hours: 1 }).status, '반출 중');
});

// ── 그 밖의 6번 규칙 ──

test('반출 기한은 최소 1시간', () => {
  const db = freshDb();
  at('2026-11-14 10:00');
  assert.throws(() => R.checkout(db, { ...base, reagentId: REAGENT.에탄올, hours: 0 }), /1시간 이상/);
});

test('남은 병이 0이면 반출이 막힌다', () => {
  const db = freshDb();
  at('2026-11-14 10:00');
  R.checkout(db, { ...base, reagentId: REAGENT.에탄올, hours: 2 }); // 예시 데이터는 1병
  assert.throws(() => R.checkout(db, { ...student('20316'), purpose: '동아리', reagentId: REAGENT.에탄올, hours: 2 }), /남은 병이 없어요/);
});

test('고위험 시약과 기한이 지난 기록은 연장할 수 없다', () => {
  const db = freshDb();
  at('2026-11-14 10:00');
  const hi = R.checkout(db, { ...base, reagentId: REAGENT.염산 });
  R.approve(db, hi.loanId);
  assert.throws(() => R.extend(db, { loanId: hi.loanId, studentId: '20315', hours: 1 }), /고위험/);

  const n = R.checkout(db, { ...student('20316'), purpose: '동아리', reagentId: REAGENT.에탄올, hours: 1 });
  after(61);
  assert.throws(() => R.extend(db, { loanId: n.loanId, studentId: '20316', hours: 1 }), /기한이 지난/);
});

test('연장은 최대 24시간', () => {
  const db = freshDb();
  at('2026-11-14 10:00');
  const { loanId } = R.checkout(db, { ...base, reagentId: REAGENT.에탄올, hours: 3 });
  assert.throws(() => R.extend(db, { loanId, studentId: '20315', hours: 25 }), /24시간 이하/);
});

test('다른 학번으로는 반납·연장할 수 없다', () => {
  const db = freshDb();
  at('2026-11-14 10:00');
  const { loanId } = R.checkout(db, { ...base, reagentId: REAGENT.에탄올, hours: 3 });
  assert.throws(() => R.returnLoan(db, { loanId, studentId: '20399', amount: null }), /이 학번으로 된 기록이 아니에요/);
  assert.throws(() => R.extend(db, { loanId, studentId: '20399', hours: 1 }), /이 학번으로 된 기록이 아니에요/);
});

test('남은 양을 체크하지 않으면 "기록 안 함", "다 씀"이면 재구매 목록에 올라감', () => {
  const db = freshDb();
  at('2026-11-14 10:00');
  const a = R.checkout(db, { ...base, reagentId: REAGENT.에탄올, hours: 3 });
  assert.equal(R.returnLoan(db, { loanId: a.loanId, studentId: '20315', amount: null }).remaining, '기록 안 함');
  const b = R.checkout(db, { ...base, reagentId: REAGENT.에탄올, hours: 3 });
  const r = R.returnLoan(db, { loanId: b.loanId, studentId: '20315', amount: '다 씀' });
  assert.equal(r.reorder, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reorder_list WHERE done_at IS NULL').get().n, 1);
});

test('기타 목적은 직접 적어야 한다', () => {
  const db = freshDb();
  at('2026-11-14 10:00');
  assert.throws(() => R.checkout(db, { ...base, purpose: '기타', purposeOther: '', reagentId: REAGENT.에탄올, hours: 1 }), /기타 사용 목적/);
});
