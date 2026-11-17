// 실험 주제로 기구·기자재 추천 + 주제 모으기 테스트 (16단계)
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { freshDb, at, resetClock, student } = require('./helpers');
const Rec = require('../src/rules/recommend');
const A = require('../src/rules/adminRules');
const E = require('../src/rules/equipmentRules');

afterEach(resetClock);
const bio = 1;
const names = (list) => list.map((x) => x.name);

test('주제를 낱말로 나눌 때 흔한 말과 조사를 뺀다', () => {
  assert.deepEqual(Rec.tokenize('효모의 발효 실험'), ['효모', '발효']);
  // "추출하는" → 끝의 "는"을 떼어 "추출하" (키워드 "DNA 추출"의 "추출"과 겹쳐서 맞음)
  assert.deepEqual(Rec.tokenize('DNA를 추출하는 방법'), ['dna', '추출하']);
});

test('"효모 발효"는 배양기를 추천한다 (주로 사용하는 기구)', () => {
  const db = freshDb();
  const r = Rec.recommend(db, '효모 발효 실험', bio);
  assert.equal(r.equipment[0].name, '배양기');
  assert.equal(r.equipment[0].units, 2, '배양기 1번·2번은 한 번만, 2대로 표시');
  assert.ok(r.equipment[0].matchedKeywords.includes('효모'));
});

test('기구와 기자재(안내 전용)를 두 묶음으로 나눈다', () => {
  const db = freshDb();
  const r = Rec.recommend(db, 'DNA 추출', bio);
  assert.ok(names(r.equipment).includes('원심분리기'));
  assert.ok(names(r.tools).includes('마이크로피펫'));
  assert.ok(r.equipment.every((x) => !x.isGuide) && r.tools.every((x) => x.isGuide));
});

test('비슷한 말도 알아듣는다 (박테리아 → 세균·미생물)', () => {
  const db = freshDb();
  assert.equal(Rec.recommend(db, '박테리아 키우기', bio).equipment[0].name, '배양기');
});

test('맞는 것이 없으면 빈 결과, 주제가 비면 안내', () => {
  const db = freshDb();
  const r = Rec.recommend(db, '자유 낙하', bio);
  assert.equal(r.equipment.length + r.tools.length, 0);
  assert.throws(() => Rec.recommend(db, '  ', bio), /주제를 입력/);
  assert.throws(() => Rec.recommend(db, '실험 관찰', bio), /자세히/);
});

test('학생들이 실제로 적은 주제가 쌓이면 그 기구가 추천된다', () => {
  const db = freshDb();
  // 처음에는 "광합성"과 맞는 키워드가 없음
  assert.equal(Rec.recommend(db, '광합성 속도', bio).equipment.length, 0);
  for (let i = 0; i < 3; i++) Rec.saveTopic(db, 5, '광합성 색소 건조'); // 건조기 화면에서 적은 주제
  const r = Rec.recommend(db, '광합성', bio);
  assert.equal(r.equipment[0].name, '건조기');
  assert.equal(r.equipment[0].topicHits, 3);
});

test('점수가 같으면 실제로 많이 쓰인 기구가 먼저', () => {
  const db = freshDb();
  A.saveEquipment(db, { lab_id: bio, name: '항온 수조', max_minutes: 60, time_options: [], keywords: ['효소 반응'] });
  A.saveEquipment(db, { lab_id: bio, name: '온도 조절 블록', max_minutes: 60, time_options: [], keywords: ['효소 반응'] });
  at('2026-11-14 10:00');
  const blockId = db.prepare("SELECT id FROM equipment WHERE name = '온도 조절 블록'").get().id;
  E.startUse(db, { equipmentId: blockId, ...student('20301'), minutes: 10, checked: [] });
  const order = names(Rec.recommend(db, '효소 반응', bio).equipment);
  // 두 기구는 키워드 점수가 같고, 한 번 쓰인 "온도 조절 블록"이 먼저
  assert.ok(order.indexOf('온도 조절 블록') < order.indexOf('항온 수조'), order.join(', '));
  assert.equal(order[0], '온도 조절 블록');
});

test('그 실험실에 없으면 다른 실험실 기구를 보여 준다', () => {
  const db = freshDb();
  const phys = db.prepare("SELECT id FROM labs WHERE code = 'phys'").get().id;
  const r = Rec.recommend(db, '효모', phys);
  assert.equal(r.otherLabs, true);
  assert.equal(r.equipment[0].labName, '생물실');
});

test('주제 기록: 학번·이름 없이 주제만, 학번 같은 숫자는 막음, 비우면 저장 안 함', () => {
  const db = freshDb();
  assert.equal(Rec.saveTopic(db, 7, ''), null);
  assert.throws(() => Rec.saveTopic(db, 7, '20315 홍길동 실험'), /학번 같은 숫자/);
  assert.throws(() => Rec.saveTopic(db, 7, 'x'.repeat(101)), /2~100글자/);
  Rec.saveTopic(db, 7, '효소 반응 속도');
  const cols = db.prepare('PRAGMA table_info(topic_logs)').all().map((c) => c.name);
  assert.ok(!cols.some((c) => /student/.test(c)), '학생 정보 칸이 없음');
  assert.equal(db.prepare('SELECT topic FROM topic_logs').get().topic, '효소 반응 속도');
});

test('기구 사용을 시작할 때 적은 주제도 모이고, 잘못된 주제여도 사용은 시작된다', () => {
  const db = freshDb();
  at('2026-11-14 10:00');
  E.startUse(db, { equipmentId: 4, ...student('20301'), minutes: 10, checked: [0, 1, 2], topic: 'DNA 추출' });
  E.startUse(db, { equipmentId: 5, ...student('20302'), minutes: 60, checked: [0, 1, 2], topic: '20302 학번' }); // 막히는 주제
  assert.deepEqual(db.prepare('SELECT equipment_id, topic FROM topic_logs').all(), [{ equipment_id: 4, topic: 'DNA 추출' }]);
  assert.equal(E.getEquipmentRow(db, 5).status, '사용 중');
});

test('관리자: 자주 나온 주제를 키워드에 추가 (같은 종류 여러 대 모두), 주제 삭제', () => {
  const db = freshDb();
  Rec.saveTopic(db, 2, '김치 유산균');
  Rec.saveTopic(db, 2, '김치 유산균');
  const sum = Rec.topicSummary(db, bio);
  assert.equal(sum[0].topics[0].count, 2);
  Rec.addKeyword(db, 2, '김치 유산균');
  for (const id of [2, 3]) assert.ok(JSON.parse(E.getEquipmentRow(db, id).keywords).includes('김치 유산균'), '배양기 1번·2번 모두');
  assert.equal(Rec.deleteTopic(db, 2, '김치 유산균').removed, 2);
});

test('비슷한 말 설정을 바꾸면 추천에 바로 반영된다', () => {
  const db = freshDb();
  assert.equal(Rec.recommend(db, '요구르트', bio).equipment.length, 0);
  Rec.saveSynonyms(db, '발효, 요구르트, 김치');
  assert.equal(Rec.recommend(db, '요구르트', bio).equipment[0].name, '배양기');
});

// ── 추천 다듬기 (16단계 확인 뒤) ──
test('"기구" 같은 흔한 말은 점수에 안 들어간다 (유리 기구 건조 → 건조기만)', () => {
  const db = freshDb();
  assert.deepEqual(names(Rec.recommend(db, '유리 기구 건조', bio).equipment), ['건조기']);
});

test('주제가 키워드와 통째로 같으면 그 기구가 먼저 (식물 조직 배양 → 클린벤치)', () => {
  const db = freshDb();
  assert.equal(Rec.recommend(db, '식물 조직 배양', bio).equipment[0].name, '무균 작업대(클린벤치)');
});

test('비슷한 말로만 맞으면 점수가 낮다 (효소 반응에 원심분리기가 끼지 않음)', () => {
  const db = freshDb();
  const r = Rec.recommend(db, '효소 반응', bio);
  assert.ok(!names(r.equipment).includes('원심분리기'));
  assert.equal(r.tools[0].name, '마이크로피펫');
});

test('유산균도 세균으로 알아듣는다 (김치 유산균 → 배양기)', () => {
  const db = freshDb();
  assert.equal(Rec.recommend(db, '김치 유산균', bio).equipment[0].name, '배양기');
});
