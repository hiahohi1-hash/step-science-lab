// 기자재 자료집 테스트
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { freshDb } = require('./helpers');
const Cat = require('../src/rules/catalog');
const Rec = require('../src/rules/recommend');
const { ITEMS, SOURCES } = require('../src/catalog/equipmentCatalog');

const labId = (db, code) => db.prepare('SELECT id FROM labs WHERE code = ?').get(code).id;

test('자료집은 생물·화학·물리 기자재를 담고, 번호가 겹치지 않고, 출처 번호가 모두 있다', () => {
  for (const code of ['bio', 'chem', 'phys']) assert.ok(ITEMS.filter((i) => i.lab === code).length >= 10, code);
  assert.equal(new Set(ITEMS.map((i) => i.id)).size, ITEMS.length);
  for (const it of ITEMS) {
    assert.ok(['예약', '안내'].includes(it.kind), it.id);
    assert.ok(it.keywords.length >= 3, it.id);
    for (const n of it.src) assert.ok(SOURCES.some((x) => x.id === n), `${it.id} 출처 ${n}`);
  }
});

test('자료집은 넣기 전에는 추천에 쓰이지 않는다', () => {
  const db = freshDb();
  const r = Rec.recommend(db, '중화 적정', labId(db, 'chem'));
  assert.equal(r.equipment.length + r.tools.length, 0);
});

test('골라 넣으면 그 실험실에 추가되고 "추천하는 도구"에 나온다', () => {
  const db = freshDb();
  const r = Cat.addFromCatalog(db, ['chem-burette', 'chem-ph', 'chem-hood', 'phys-cart']);
  assert.equal(r.added.length, 4);
  const chem = labId(db, 'chem');
  const rec = Rec.recommend(db, '중화 적정', chem);
  assert.ok(rec.tools.some((t) => t.name === '뷰렛'));
  const phys = Rec.recommend(db, '뉴턴 제2법칙', labId(db, 'phys'));
  assert.equal(phys.tools[0].name, '역학 수레·레일');
  // 예약 기구(흄 후드)는 기본 사용 시간 선택지가 들어감, 안내 전용은 사용법 안내 문구
  const hood = db.prepare("SELECT kind, time_options, howto FROM equipment WHERE name = '흄 후드'").get();
  assert.equal(hood.kind, '예약');
  assert.ok(JSON.parse(hood.time_options).length > 0);
  assert.match(JSON.parse(hood.howto)[0], /사용법을 아직 적지 않았어요/);
});

test('이미 있는 기구는 새로 만들지 않고 키워드만 합친다', () => {
  const db = freshDb();
  Cat.addFromCatalog(db, ['bio-microscope']);
  db.prepare("UPDATE equipment SET keywords = '[\"내가 적은 키워드\"]' WHERE name = '광학 현미경'").run();
  const r = Cat.addFromCatalog(db, ['bio-microscope']);
  assert.equal(r.merged.length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM equipment WHERE name = '광학 현미경'").get().n, 1);
  const kws = JSON.parse(db.prepare("SELECT keywords FROM equipment WHERE name = '광학 현미경'").get().keywords);
  assert.equal(kws[0], '내가 적은 키워드', '선생님이 적은 키워드는 그대로');
  assert.ok(kws.includes('체세포 분열'));
});

test('자료집에 없는 항목, 빈 선택은 막힌다', () => {
  const db = freshDb();
  assert.throws(() => Cat.addFromCatalog(db, []), /골라 주세요/);
  assert.throws(() => Cat.addFromCatalog(db, ['없는-항목']), /자료집에 없는/);
});

test('목록에서 이미 있는 것을 표시한다', () => {
  const db = freshDb();
  Cat.addFromCatalog(db, ['phys-multimeter']);
  const it = Cat.listCatalog(db).items.find((i) => i.id === 'phys-multimeter');
  assert.equal(it.exists, true);
  assert.equal(it.labName, '물리실');
});

test('자료집을 넣으면 과목별 대표 주제가 알맞은 기자재로 추천된다 (엉뚱한 꼬리 없이)', () => {
  const db = freshDb();
  Cat.addFromCatalog(db, ITEMS.map((i) => i.id));
  const tools = (q, code) => Rec.recommend(db, q, labId(db, code)).tools.map((t) => t.name);
  assert.deepEqual(tools('옴의 법칙', 'phys'), ['직류 전원 장치', '멀티미터']);
  assert.deepEqual(tools('불꽃 반응', 'chem').slice(0, 1), ['니크롬선(불꽃 반응용)']);
  assert.ok(!tools('불꽃 반응', 'chem').includes('전자저울'), '"반응"만 겹친 기구는 빠짐');
  assert.equal(tools('중화 적정', 'chem')[0], '뷰렛');
  assert.deepEqual(tools('전자기 유도', 'phys').sort(), ['검류계', '코일·막대자석 세트'].sort());
  assert.equal(tools('체세포 분열 관찰', 'bio')[0], '광학 현미경');
});
