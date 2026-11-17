// 기구 사진 인식 판정 테스트 (명세 11-2, 11-5)
// 판정기(recognition-core.js)는 태블릿 화면이 쓰는 파일과 똑같은 파일입니다.
// 판정 결과가 'candidates' 이면 화면은 후보 선택 화면을, 'none' 이면 아무 반응 없이 계속 인식합니다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createJudge } = require('../src/rules/recognition');
const { freshDb } = require('./helpers');
const { saveLog } = require('../src/rules/recognition');
const RA = require('../src/rules/recognitionAdmin');

const CLASSES = ['autoclave', 'incubator', 'centrifuge', 'dryer', 'clean_bench'];
const judge = () => createJudge({ threshold: 0.8, holdSeconds: 2, candidateSeconds: 5, notEquipmentClass: 'not_equipment', knownClasses: CLASSES });

// 1초에 4번(250ms마다) 같은 결과를 seconds 초 동안 넣어 보고 마지막 판정을 돌려줌
function feed(j, predictions, seconds, startMs = 0) {
  let r;
  for (let t = startMs; t <= startMs + seconds * 1000; t += 250) {
    r = j.update(typeof predictions === 'function' ? predictions(t) : predictions, t);
    if (r.type === 'decided' || r.type === 'candidates') return { ...r, atMs: t };
  }
  return { ...r, atMs: startMs + seconds * 1000 };
}
const P = (pairs) => Object.entries(pairs).map(([className, probability]) => ({ className, probability }));

// ── 명세 11-5 필수 테스트 ──

test('확신도 80% 미만이면 결정하지 않고 후보 선택 화면(상위 3개)이 뜬다', () => {
  const r = feed(judge(), P({ dryer: 0.62, incubator: 0.30, autoclave: 0.05, not_equipment: 0.03 }), 10);
  assert.equal(r.type, 'candidates');
  assert.deepEqual(r.top3.map((c) => c.className), ['dryer', 'incubator', 'autoclave']);
  assert.equal(Math.round(r.top3[0].probability * 100), 62);
  assert.equal(r.atMs, 5000, '기구가 보인 지 5초 뒤');
});

test('79%가 계속되어도 자동 결정되지 않고 후보 화면이 뜬다', () => {
  const r = feed(judge(), P({ autoclave: 0.79, dryer: 0.21 }), 10);
  assert.equal(r.type, 'candidates');
});

test('"기구 아님"이면 아무 반응도 하지 않고 계속 인식한다', () => {
  const j = judge();
  const r = feed(j, P({ not_equipment: 0.99, autoclave: 0.01 }), 30);
  assert.equal(r.type, 'none', '30초 동안 결정도 후보도 없음');
  // 그 뒤에 기구가 보이면 정상적으로 인식
  const r2 = feed(j, P({ autoclave: 0.95, not_equipment: 0.05 }), 5, 30250);
  assert.equal(r2.type, 'decided');
  assert.equal(r2.className, 'autoclave');
});

// ── 그 밖의 11-2 규칙 ──

test('같은 기구가 2초 동안 연속으로 80% 이상이면 그 기구로 결정한다', () => {
  const r = feed(judge(), P({ autoclave: 0.93, dryer: 0.07 }), 10);
  assert.equal(r.type, 'decided');
  assert.equal(r.className, 'autoclave');
  assert.equal(r.atMs, 2000);
  assert.ok(r.confidence >= 0.8);
});

test('결과가 계속 바뀌면 결정하지 않고 후보 화면이 뜬다', () => {
  const r = feed(judge(), (t) => ((t / 250) % 2 ? P({ autoclave: 0.9, dryer: 0.1 }) : P({ dryer: 0.9, autoclave: 0.1 })), 10);
  assert.equal(r.type, 'candidates');
  assert.deepEqual(r.top3.slice(0, 2).map((c) => c.className).sort(), ['autoclave', 'dryer']);
});

test('2초가 되기 전에 80% 밑으로 떨어지면 처음부터 다시 센다', () => {
  const j = judge();
  feed(j, P({ autoclave: 0.95 }), 1.5);
  j.update(P({ autoclave: 0.6 }), 1750);
  const r = feed(j, P({ autoclave: 0.95 }), 3, 2000);
  assert.equal(r.type, 'decided');
  assert.equal(r.atMs, 4000, '다시 2초를 채워야 함');
});

test('기구와 연결되지 않은 분류 이름은 "기구 아님"처럼 무시한다', () => {
  const r = feed(judge(), P({ pipette: 0.97, autoclave: 0.03 }), 20);
  assert.equal(r.type, 'none');
});

test('후보에는 "기구 아님"이 들어가지 않는다', () => {
  const r = feed(judge(), P({ dryer: 0.5, not_equipment: 0.45, incubator: 0.05 }), 10);
  assert.equal(r.type, 'candidates');
  assert.ok(r.top3.every((c) => c.className !== 'not_equipment'));
});

// ── 11-4 인식 기록과 정확도 ──

test('인식 기록: 최종 확인한 기구의 분류 이름은 서버의 연결 표에서 찾아 저장한다', () => {
  const db = freshDb();
  saveLog(db, { predictedClass: 'dryer', confidence: 0.61, top3: [], decidedBy: '후보에서 선택', confirmedEquipmentId: 3, modelVersion: '시험' });
  const row = db.prepare('SELECT * FROM recognition_logs').get();
  assert.equal(row.confirmed_class, 'incubator'); // 3번 = 배양기 2번(문 쪽)
  assert.throws(() => saveLog(db, { decidedBy: '아무거나', confirmedEquipmentId: 1 }), /형식/);
});

test('정확도: 기구별 정확도, 헷갈린 짝, 낮으면 다시 학습 안내', () => {
  const db = freshDb();
  const log = (pred, eq) => saveLog(db, { predictedClass: pred, confidence: 0.8, top3: [], decidedBy: '자동 결정', confirmedEquipmentId: eq, modelVersion: '시험' });
  for (let i = 0; i < 5; i++) log('autoclave', 1);
  for (let i = 0; i < 2; i++) log('incubator', 2);
  for (let i = 0; i < 3; i++) log('dryer', 2); // 배양기를 건조기로 3번
  const a = RA.accuracy(db);
  const inc = a.perClass.find((p) => p.className === 'incubator');
  assert.equal(inc.accuracy, 0.4);
  assert.equal(inc.advice, '사진을 더 찍어 다시 학습시키세요.');
  assert.equal(a.perClass.find((p) => p.className === 'autoclave').accuracy, 1);
  assert.equal(a.confusedPairs[0].count, 3);
  assert.match(a.confusedPairs[0].pair, /건조기 ↔ 배양기/);
  assert.equal(a.overall.accuracy, 0.7);
});
