// 안내 전용 기구 테스트 (14단계) — 마이크로피펫, 피펫 에이드 …
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { freshDb, at, resetClock, student } = require('./helpers');
const E = require('../src/rules/equipmentRules');
const A = require('../src/rules/adminRules');
const { recognitionConfig } = require('../src/rules/recognition');

afterEach(resetClock);
const guideId = (db, name) => db.prepare('SELECT id FROM equipment WHERE name = ?').get(name).id;

test('예시로 마이크로피펫·피펫 에이드가 안내 전용으로 생물실에 들어 있다', () => {
  const db = freshDb();
  const rows = db.prepare("SELECT e.name, l.code FROM equipment e JOIN labs l ON l.id = e.lab_id WHERE e.kind = '안내' ORDER BY e.id").all();
  assert.deepEqual(rows, [{ name: '마이크로피펫', code: 'bio' }, { name: '피펫 에이드', code: 'bio' }]);
  const view = E.equipmentView(db, E.getEquipmentRow(db, guideId(db, '마이크로피펫')));
  assert.equal(view.isGuide, true);
  assert.ok(view.howto.length > 5 && view.cautions.length > 3 && view.checklist.length > 0);
});

test('안내 전용 예시는 한 번만 들어가고, 관리자가 지우면 다시 생기지 않는다', () => {
  const { openDb } = require('../src/db');
  const db = freshDb();
  A.archiveEquipment(db, guideId(db, '피펫 에이드'));
  require('../src/seed').seedGuideExamples(db); // 서버를 다시 켠 것처럼
  assert.equal(db.prepare("SELECT COUNT(*) n FROM equipment WHERE name = '피펫 에이드' AND archived = 0").get().n, 0);
  assert.ok(openDb);
});

test('안내 전용 기구는 사용 시작·대기 등록이 안 된다', () => {
  const db = freshDb();
  at('2026-11-14 10:00');
  const id = guideId(db, '마이크로피펫');
  assert.throws(() => E.startUse(db, { equipmentId: id, ...student('20301'), minutes: 10, checked: [0, 1, 2] }), /안내 전용/);
  assert.throws(() => E.joinQueue(db, { equipmentId: id, ...student('20301') }), /안내 전용/);
});

test('안내 전용 기구는 관리자 "기구 현황"에 나오지 않지만, 찾기와 카메라 인식에는 나온다', () => {
  const db = freshDb();
  assert.ok(!A.equipmentStatus(db).some((e) => e.isGuide));
  assert.ok(E.searchEquipment(db, '피펫').every((g) => g.units.every((u) => u.isGuide)));
  assert.equal(E.searchEquipment(db, '피펫').length, 2);
  assert.ok(recognitionConfig(db).classes.micropipette);
});

test('관리자가 안내 전용 기구를 만들면 시간 관련 칸은 쓰지 않는다', () => {
  const db = freshDb();
  const { id } = A.saveEquipment(db, { lab_id: 1, kind: '안내', name: '현미경', time_options: [{ label: '아무거나', minutes: 99999 }], max_minutes: -5, howto: ['1. 저배율부터'] });
  const e = db.prepare('SELECT kind, max_minutes, time_options FROM equipment WHERE id = ?').get(id);
  assert.deepEqual(e, { kind: '안내', max_minutes: 60, time_options: '[]' });
  assert.throws(() => A.saveEquipment(db, { lab_id: 1, kind: '이상한', name: 'x', max_minutes: 10 }), /종류/);
});

test('사용 중인 예약 기구는 안내 전용으로 바꿀 수 없다', () => {
  const db = freshDb();
  at('2026-11-14 10:00');
  E.startUse(db, { equipmentId: 4, ...student('20301'), minutes: 10, checked: [0, 1, 2] });
  assert.throws(() => A.saveEquipment(db, { lab_id: 1, kind: '안내', name: '원심분리기' }, 4), /사용 중이거나 대기자/);
});
