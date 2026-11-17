// 기구 규칙 테스트 (명세 7번, 11단계)
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { freshDb, at, after, resetClock, student, EQUIP, ALL_CHECKED } = require('./helpers');
const E = require('../src/rules/equipmentRules');

afterEach(resetClock);

const status = (db, id) => E.getEquipmentRow(db, id).status;
const start = (db, id, sid, minutes) => E.startUse(db, { equipmentId: id, ...student(sid), minutes, checked: ALL_CHECKED[id] });

// ── 명세 11단계 필수 테스트 ──

test('시간이 지나면 "사용 가능"으로 바뀐다 (대기자 없음)', () => {
  const db = freshDb();
  at('2026-11-14 13:00');
  start(db, EQUIP.멸균기, '20301', 60);
  assert.equal(status(db, EQUIP.멸균기), '사용 중');
  at('2026-11-14 13:59');
  E.runEquipmentCheck(db);
  assert.equal(status(db, EQUIP.멸균기), '사용 중', '끝나기 전에는 그대로');
  at('2026-11-14 14:00');
  E.runEquipmentCheck(db);
  assert.equal(status(db, EQUIP.멸균기), '사용 가능');
});

test('대기자가 있으면 시간이 지났을 때 "예약 대기"로 바뀐다', () => {
  const db = freshDb();
  at('2026-11-14 13:00');
  start(db, EQUIP.멸균기, '20301', 60);
  E.joinQueue(db, { equipmentId: EQUIP.멸균기, ...student('20302') });
  at('2026-11-14 14:00');
  E.runEquipmentCheck(db);
  assert.equal(status(db, EQUIP.멸균기), '예약 대기');
  const view = E.equipmentView(db, E.getEquipmentRow(db, EQUIP.멸균기));
  assert.equal(view.turn.student, '203**', '대기 1번 학번은 뒤 두 자리를 가림');
});

test('예약 대기 10분 안에 시작하지 않으면 다음 대기자로 넘어간다', () => {
  const db = freshDb();
  at('2026-11-14 13:00');
  start(db, EQUIP.멸균기, '20301', 60);
  E.joinQueue(db, { equipmentId: EQUIP.멸균기, ...student('20302') });
  E.joinQueue(db, { equipmentId: EQUIP.멸균기, ...student('20303') });
  at('2026-11-14 14:00');
  E.runEquipmentCheck(db); // 20302 차례
  after(9);
  E.runEquipmentCheck(db);
  assert.throws(() => start(db, EQUIP.멸균기, '20303', 30), /차례/, '9분째: 아직 20302 차례');
  after(1);
  E.runEquipmentCheck(db); // 10분 지남 → 20303 차례
  assert.equal(status(db, EQUIP.멸균기), '예약 대기');
  assert.throws(() => start(db, EQUIP.멸균기, '20302', 30), /차례/, '넘어간 사람은 시작 못 함');
  start(db, EQUIP.멸균기, '20303', 30);
  assert.equal(status(db, EQUIP.멸균기), '사용 중');
});

test('대기자가 더 없으면 10분 뒤 "사용 가능"이 된다', () => {
  const db = freshDb();
  at('2026-11-14 13:00');
  start(db, EQUIP.멸균기, '20301', 60);
  E.joinQueue(db, { equipmentId: EQUIP.멸균기, ...student('20302') });
  at('2026-11-14 14:00');
  E.runEquipmentCheck(db);
  after(10);
  E.runEquipmentCheck(db);
  assert.equal(status(db, EQUIP.멸균기), '사용 가능');
});

test('대기자가 있으면 연장이 막힌다', () => {
  const db = freshDb();
  at('2026-11-14 13:00');
  start(db, EQUIP.멸균기, '20301', 60);
  E.joinQueue(db, { equipmentId: EQUIP.멸균기, ...student('20302') });
  assert.throws(() => E.extendUse(db, { equipmentId: EQUIP.멸균기, studentId: '20301', minutes: 10 }), /기다리는 사람/);
});

test('최대 사용 시간을 넘는 사용·연장은 막힌다', () => {
  const db = freshDb();
  at('2026-11-14 13:00');
  assert.throws(() => start(db, EQUIP.멸균기, '20301', 121), /최대 2시간/); // 멸균기 최대 2시간
  start(db, EQUIP.멸균기, '20301', 100);
  assert.throws(() => E.extendUse(db, { equipmentId: EQUIP.멸균기, studentId: '20301', minutes: 21 }), /최대 사용 시간/);
  E.extendUse(db, { equipmentId: EQUIP.멸균기, studentId: '20301', minutes: 20 }); // 딱 120분은 됨
});

// ── 그 밖의 7번 규칙 ──

test('필수 확인 사항을 모두 체크해야 시작할 수 있다', () => {
  const db = freshDb();
  at('2026-11-14 13:00');
  assert.throws(() => E.startUse(db, { equipmentId: EQUIP.멸균기, ...student('20301'), minutes: 60, checked: [0, 1, 2, 3] }), /필수 확인 사항/);
});

test('연장은 한 번만', () => {
  const db = freshDb();
  at('2026-11-14 13:00');
  start(db, EQUIP.멸균기, '20301', 30);
  E.extendUse(db, { equipmentId: EQUIP.멸균기, studentId: '20301', minutes: 10 });
  assert.throws(() => E.extendUse(db, { equipmentId: EQUIP.멸균기, studentId: '20301', minutes: 10 }), /한 번만/);
});

test('한 기구에 같은 학번은 한 번만 대기할 수 있다', () => {
  const db = freshDb();
  at('2026-11-14 13:00');
  start(db, EQUIP.멸균기, '20301', 60);
  E.joinQueue(db, { equipmentId: EQUIP.멸균기, ...student('20302') });
  assert.throws(() => E.joinQueue(db, { equipmentId: EQUIP.멸균기, ...student('20302') }), /이미 이 기구에 대기/);
});

test('일찍 끝내면 대기 1번에게 바로 차례가 간다', () => {
  const db = freshDb();
  at('2026-11-14 13:00');
  start(db, EQUIP.멸균기, '20301', 60);
  E.joinQueue(db, { equipmentId: EQUIP.멸균기, ...student('20302') });
  const r = E.endEarly(db, { equipmentId: EQUIP.멸균기, studentId: '20301' });
  assert.equal(r.newStatus, '예약 대기');
  assert.throws(() => E.endEarly(db, { equipmentId: EQUIP.멸균기, studentId: '20399' }), /사용 중인 기록이 없어요/);
});

test('끝나기 10분 전에는 "곧 사용 가능", 끝난 뒤 30분 동안 "방금 끝남" 안내', () => {
  const db = freshDb();
  at('2026-11-14 13:00');
  start(db, EQUIP.원심분리기, '20301', 30);
  at('2026-11-14 13:19');
  assert.equal(E.equipmentView(db, E.getEquipmentRow(db, EQUIP.원심분리기)).current.endingSoon, false);
  at('2026-11-14 13:20');
  assert.equal(E.equipmentView(db, E.getEquipmentRow(db, EQUIP.원심분리기)).current.endingSoon, true);
  at('2026-11-14 13:30');
  E.runEquipmentCheck(db);
  at('2026-11-14 13:59');
  assert.equal(E.equipmentView(db, E.getEquipmentRow(db, EQUIP.원심분리기)).justFinished, true);
  at('2026-11-14 14:00');
  assert.equal(E.equipmentView(db, E.getEquipmentRow(db, EQUIP.원심분리기)).justFinished, false);
});

test('관리자가 잘못된 대기를 삭제하면 기록이 남고, 차례였던 사람이면 다음 사람에게 넘어간다', () => {
  const A = require('../src/rules/adminRules');
  const db = freshDb();
  at('2026-11-14 13:00');
  start(db, EQUIP.멸균기, '20301', 60);
  E.joinQueue(db, { equipmentId: EQUIP.멸균기, ...student('20302', '잘못등록') });
  E.joinQueue(db, { equipmentId: EQUIP.멸균기, ...student('20303') });
  E.joinQueue(db, { equipmentId: EQUIP.멸균기, ...student('20304') });
  assert.equal(A.allQueues(db).length, 3);

  // ① 대기 중인 사람 삭제 → 순서만 당겨짐
  const wrong = A.allQueues(db).find((q) => q.studentId === '20302');
  const r1 = A.cancelQueueEntry(db, wrong.id, '잘못 등록함');
  assert.equal(r1.wasTurn, false);
  assert.deepEqual(A.allQueues(db).map((q) => [q.studentId, q.order]), [['20303', 1], ['20304', 2]]);
  assert.match(db.prepare("SELECT message FROM notifications WHERE type = '대기열 삭제'").get().message, /20302 잘못등록 \(이유: 잘못 등록함\)/);

  // ② 차례인 사람 삭제 → 다음 사람에게 차례
  at('2026-11-14 14:00');
  E.runEquipmentCheck(db); // 20303 차례
  const turn = A.allQueues(db).find((q) => q.status === '차례');
  const r2 = A.cancelQueueEntry(db, turn.id, '');
  assert.equal(r2.wasTurn, true);
  assert.equal(r2.nextStudent, '203**');
  assert.equal(A.allQueues(db)[0].studentId, '20304');
  assert.equal(A.allQueues(db)[0].status, '차례');

  // ③ 이미 삭제된 대기는 다시 삭제할 수 없음
  assert.throws(() => A.cancelQueueEntry(db, wrong.id), /찾을 수 없어요/);
  // ④ 마지막 사람까지 삭제 → 사용 가능
  A.cancelQueueEntry(db, A.allQueues(db)[0].id);
  assert.equal(status(db, EQUIP.멸균기), '사용 가능');
});

test('위험 기구(멸균기)가 시간 종료되면 자동 검사 결과에 위험 표시가 있다 (태블릿 경고용)', () => {
  const db = freshDb();
  at('2026-11-14 13:00');
  start(db, EQUIP.멸균기, '20301', 60);
  at('2026-11-14 14:00');
  const changes = E.runEquipmentCheck(db);
  assert.equal(changes[0].type, '시간 종료');
  assert.equal(changes[0].isDangerous, true);
});

// ── 대기 기능 끄기 (학교 의견: 순서대로 쓰지 않으니 "지금 누가 쓰는지"만) ──
test('대기 기능은 처음에 꺼져 있다', () => {
  const db = freshDb({ queue: false });
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'queue_enabled'").get().value, '0');
  assert.equal(E.equipmentView(db, E.getEquipmentRow(db, EQUIP.멸균기)).queueEnabled, false);
});

test('대기 기능이 꺼져 있으면 대기 등록이 안 되고, 시간이 지나면 바로 "사용 가능"', () => {
  const db = freshDb({ queue: false });
  at('2026-11-14 13:00');
  start(db, EQUIP.멸균기, '20301', 60);
  assert.throws(() => E.joinQueue(db, { equipmentId: EQUIP.멸균기, ...student('20302') }), /대기 등록을 쓰지 않아요/);
  const view = E.equipmentView(db, E.getEquipmentRow(db, EQUIP.멸균기));
  assert.equal(view.current.student, '203**', '지금 누가 쓰는지는 보임');
  at('2026-11-14 14:00');
  E.runEquipmentCheck(db);
  assert.equal(status(db, EQUIP.멸균기), '사용 가능');
});

test('대기 기능이 꺼져 있으면 연장은 대기자와 상관없이 된다 (최대 시간까지)', () => {
  const db = freshDb({ queue: false });
  at('2026-11-14 13:00');
  start(db, EQUIP.멸균기, '20301', 60);
  E.extendUse(db, { equipmentId: EQUIP.멸균기, studentId: '20301', minutes: 30 });
});

test('관리자가 대기 기능을 끄면 남아 있던 대기와 "예약 대기"가 정리된다', () => {
  const A = require('../src/rules/adminRules');
  const db = freshDb(); // 켜진 상태에서 시작
  at('2026-11-14 13:00');
  start(db, EQUIP.멸균기, '20301', 60);
  E.joinQueue(db, { equipmentId: EQUIP.멸균기, ...student('20302') });
  at('2026-11-14 14:00');
  E.runEquipmentCheck(db);
  assert.equal(status(db, EQUIP.멸균기), '예약 대기');
  A.saveSettings(db, { queue_enabled: '0' });
  assert.equal(status(db, EQUIP.멸균기), '사용 가능');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM equipment_queue WHERE status IN ('대기','차례')").get().n, 0);
});
