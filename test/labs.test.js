// 여러 실험실 테스트 (13단계)
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { freshDb, at, resetClock, student } = require('./helpers');
const Labs = require('../src/rules/labs');
const A = require('../src/rules/adminRules');
const R = require('../src/rules/reagentRules');
const E = require('../src/rules/equipmentRules');
const { recognitionConfig } = require('../src/rules/recognition');

afterEach(resetClock);

const labId = (db, code) => db.prepare('SELECT id FROM labs WHERE code = ?').get(code).id;

test('처음에는 생물실·물리실·화학실이 있고, 예시 시약·기구는 모두 생물실', () => {
  const db = freshDb();
  assert.deepEqual(Labs.listLabs(db).map((l) => l.name), ['생물실', '물리실', '화학실']);
  const bio = labId(db, 'bio');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM equipment WHERE lab_id IS NOT ?').get(bio).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reagents WHERE lab_id IS NOT ?').get(bio).n, 0);
});

test('기구·시약 찾기는 실험실별로 나뉘고, 실험실을 안 고르면 전체', () => {
  const db = freshDb();
  const phys = labId(db, 'phys');
  A.saveEquipment(db, { lab_id: phys, name: '역학 수레 세트', max_minutes: 120, time_options: [] });
  A.saveReagent(db, { lab_id: phys, name: '철가루', hazard: '일반', quantity: 3 });
  assert.deepEqual(E.searchEquipment(db, '', phys).map((g) => g.name), ['역학 수레 세트']);
  assert.ok(!E.searchEquipment(db, '', labId(db, 'bio')).some((g) => g.name === '역학 수레 세트'));
  assert.ok(E.searchEquipment(db, '').some((g) => g.name === '역학 수레 세트'), '전체에서는 보임');
  assert.deepEqual(R.searchReagents(db, '', phys).map((r) => r.name), ['철가루']);
  assert.equal(R.searchReagents(db, '철가루')[0].labName, '물리실');
});

test('다른 실험실의 같은 이름 기구는 따로 묶인다', () => {
  const db = freshDb();
  A.saveEquipment(db, { lab_id: labId(db, 'chem'), name: '건조기', max_minutes: 60, time_options: [] });
  const groups = E.searchEquipment(db, '건조기');
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.labName).sort(), ['생물실', '화학실']);
});

test('시약 반납은 실험실과 상관없이 내 기록이 모두 나온다', () => {
  const db = freshDb();
  at('2026-11-14 10:00');
  const chem = labId(db, 'chem');
  const { id } = A.saveReagent(db, { lab_id: chem, name: '황산구리', hazard: '일반', quantity: 2 });
  R.checkout(db, { reagentId: id, ...student('20315'), purpose: '동아리', hours: 2 });
  R.checkout(db, { reagentId: 6, ...student('20315'), purpose: '동아리', hours: 2 }); // 생물실 에탄올
  assert.equal(R.listActiveLoans(db, '20315').length, 2);
});

test('카메라 인식은 그 실험실 기구만 연결 표에 들어간다', () => {
  const db = freshDb();
  const chem = labId(db, 'chem');
  const { id } = A.saveEquipment(db, { lab_id: chem, name: '건조기', unit_label: '화학', max_minutes: 60, time_options: [] });
  db.prepare("INSERT INTO model_class_map (class_name, equipment_id) VALUES ('dryer', ?)").run(id);
  assert.deepEqual(recognitionConfig(db, chem).classes.dryer.map((u) => u.id), [id]);
  assert.ok(!recognitionConfig(db, labId(db, 'bio')).classes.dryer.some((u) => u.id === id));
});

test('실험실 추가·이름 바꾸기, 시약·기구가 있으면 지울 수 없음', () => {
  const db = freshDb();
  const { id } = Labs.saveLab(db, { name: '지구과학실', code: 'earth' });
  assert.throws(() => Labs.saveLab(db, { name: '생물실', code: 'bio2' }), /이미 있어요/);
  assert.throws(() => Labs.saveLab(db, { name: '잘못', code: 'Bad Code!' }), /영어 코드/);
  Labs.saveLab(db, { name: '지구과학실2', code: 'earth' }, id);
  assert.throws(() => Labs.deleteLab(db, labId(db, 'bio')), /지울 수 없어요/);
  Labs.deleteLab(db, id);
  assert.equal(Labs.listLabs(db).length, 3);
});

test('시약·기구를 저장할 때 실험실이 꼭 있어야 한다', () => {
  const db = freshDb();
  assert.throws(() => A.saveReagent(db, { name: 'x', hazard: '일반', quantity: 1 }), /실험실을 골라/);
  assert.throws(() => A.saveEquipment(db, { name: 'x', max_minutes: 10, time_options: [], lab_id: 999 }), /찾을 수 없어요/);
});
