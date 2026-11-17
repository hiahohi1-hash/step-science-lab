// 18단계: 학습 사진 모으기·모델 다시 저장 테스트 (보안·형식 검사 위주)
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { freshDb, EQUIP } = require('./helpers');
const T = require('../src/rules/training');
const Rec = require('../src/rules/recognition');

let trainDir, modelDir;
beforeEach(() => {
  trainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-train-'));
  modelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-model-'));
  T.setDirsForTest(trainDir, modelDir);
});

const fakeJpeg = (size = 300) => {
  const b = Buffer.alloc(size, 0x22);
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[size - 2] = 0xff; b[size - 1] = 0xd9;
  return b;
};
const jpg = (size) => `data:image/jpeg;base64,${fakeJpeg(size).toString('base64')}`;
const bio = (db) => db.prepare("SELECT id FROM labs WHERE code = 'bio'").get().id;
const files = (...p) => { try { return fs.readdirSync(path.join(trainDir, ...p)); } catch (e) { return []; } };

test('확인된 사진은 그 기구의 분류 이름 폴더에 저장된다 (학번·이름 없이)', () => {
  const db = freshDb();
  const r = T.saveSample(db, { equipmentId: EQUIP.멸균기, dataUrl: jpg() });
  assert.deepEqual(r, { saved: true, className: 'autoclave' });
  const f = files('bio', 'autoclave');
  assert.equal(f.length, 1);
  assert.match(f[0], /^s-\d{13}-[0-9a-f]{8}\.jpg$/);
  // 배양기 2번을 골라도 같은 분류(incubator)로
  assert.equal(T.saveSample(db, { equipmentId: EQUIP.배양기2, dataUrl: jpg() }).className, 'incubator');
});

test('모델에 없는 새 기구를 고르면 eq_번호 분류가 생기고 인식 연결 표에도 들어간다', () => {
  const db = freshDb();
  const id = db.prepare("INSERT INTO equipment (name, max_minutes, lab_id) VALUES ('히트 블록', 60, ?)").run(bio(db)).lastInsertRowid;
  const r = T.saveSample(db, { equipmentId: id, dataUrl: jpg() });
  assert.equal(r.className, `eq_${id}`);
  assert.ok(Rec.recognitionConfig(db, bio(db)).classes[`eq_${id}`]);
  assert.equal(files('bio', `eq_${id}`).length, 1);
});

test('설정에서 끄면 저장하지 않는다', () => {
  const db = freshDb();
  db.prepare("UPDATE settings SET value = '0' WHERE key = 'training_collect'").run();
  assert.equal(T.saveSample(db, { equipmentId: EQUIP.멸균기, dataUrl: jpg() }).saved, false);
  assert.equal(files('bio').length, 0);
  assert.equal(Rec.recognitionConfig(db, bio(db)).collectSamples, false);
});

test('JPEG 이 아니거나 너무 크거나, 없는 기구면 거절된다', () => {
  const db = freshDb();
  assert.throws(() => T.saveSample(db, { equipmentId: EQUIP.멸균기, dataUrl: 'data:image/png;base64,AAAA' }), /형식/);
  assert.throws(() => T.saveSample(db, { equipmentId: EQUIP.멸균기, dataUrl: jpg(200 * 1024) }), /너무 커요/);
  assert.throws(() => T.saveSample(db, { equipmentId: 9999, dataUrl: jpg() }), /찾을 수 없어요/);
  db.prepare('UPDATE equipment SET archived = 1 WHERE id = ?').run(EQUIP.건조기);
  assert.throws(() => T.saveSample(db, { equipmentId: EQUIP.건조기, dataUrl: jpg() }), /찾을 수 없어요/);
  assert.equal(files('bio').length, 0);
});

test('관리자 사진 올리기: 기구 아님·연결된 분류만, 이상한 폴더 이름은 막힌다', () => {
  const db = freshDb();
  const lab = bio(db);
  assert.equal(T.uploadSamples(db, lab, 'not_equipment', [jpg(), jpg()]).saved, 2);
  assert.equal(files('bio', 'not_equipment').length, 2);
  assert.throws(() => T.uploadSamples(db, lab, 'nobody', [jpg()]), /연결된 분류 이름이 아니에요/);
  for (const bad of ['../x', '..', 'a/b', '한글']) assert.throws(() => T.uploadSamples(db, lab, bad, [jpg()]), /올바르지 않아요/);
  assert.throws(() => T.uploadSamples(db, lab, 'not_equipment', Array(31).fill(jpg())), /1~30장/);
  // 하나라도 이상하면 하나도 저장하지 않음
  assert.throws(() => T.uploadSamples(db, lab, 'not_equipment', [jpg(), 'data:image/jpeg;base64,AAAA']));
  assert.equal(files('bio', 'not_equipment').length, 2);
});

test('사진 파일 주소는 서버가 만든 이름 모양만 통과한다', () => {
  const db = freshDb();
  T.saveSample(db, { equipmentId: EQUIP.멸균기, dataUrl: jpg() });
  const [f] = files('bio', 'autoclave');
  assert.ok(T.samplePath(db, bio(db), 'autoclave', f));
  assert.equal(T.samplePath(db, bio(db), '..', f), null);
  assert.equal(T.samplePath(db, bio(db), 'autoclave', '../../data/lab.db'), null);
  assert.equal(T.deleteSamples(db, bio(db), 'autoclave', ['../x.jpg', f]).deleted, 1);
});

test('분류마다 5장 이상, 2개 분류 이상이어야 학습 목록이 나온다', () => {
  const db = freshDb();
  const lab = bio(db);
  for (let i = 0; i < 5; i++) T.saveSample(db, { equipmentId: EQUIP.멸균기, dataUrl: jpg() });
  assert.throws(() => T.trainingSet(db, lab), /2개 이상/);
  T.uploadSamples(db, lab, 'not_equipment', Array(5).fill(jpg()));
  T.saveSample(db, { equipmentId: EQUIP.건조기, dataUrl: jpg() }); // 1장뿐 → 빠짐
  const set = T.trainingSet(db, lab);
  assert.deepEqual(set.labels, ['autoclave', 'not_equipment']);
  assert.equal(set.files.length, 10);
  assert.deepEqual(set.skipped, [{ className: 'dryer', count: 1 }]);
  const ov = T.overview(db, lab);
  assert.equal(ov.total, 11);
});

// 작은 가짜 모델: Dense(units = 분류 수) 하나, 가중치 2개
const model = (units, w1 = [4, units]) => ({
  modelTopology: { class_name: 'Sequential', config: { layers: [{ class_name: 'Dense', config: { units } }] } },
  weightsManifest: [{ paths: ['weights.bin'], weights: [{ name: 'k', shape: w1, dtype: 'float32' }] }],
});
const weights = (n) => Buffer.alloc(n * 4, 1).toString('base64');

test('학습한 모델 저장: 형식·크기·분류 수가 맞아야 하고, 이전 모델은 백업 후 되돌릴 수 있다', () => {
  const db = freshDb();
  const lab = bio(db);
  const ok = { labels: ['a', 'b'], modelJson: model(2), weightsBase64: weights(8) };
  assert.throws(() => T.saveModel(db, lab, { ...ok, labels: ['a', '../b'] }), /분류 이름/);
  assert.throws(() => T.saveModel(db, lab, { ...ok, labels: ['a', 'a'] }), /분류 이름/);
  assert.throws(() => T.saveModel(db, lab, { ...ok, weightsBase64: weights(7) }), /크기가 맞지 않아요/);
  assert.throws(() => T.saveModel(db, lab, { ...ok, labels: ['a', 'b', 'c'] }), /출력 개수/);
  assert.throws(() => T.rollbackModel(db, lab), /없어요/);

  T.saveModel(db, lab, ok);
  const dir = path.join(modelDir, 'bio');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['metadata.json', 'model.json', 'weights.bin']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'))).labels, ['a', 'b']);

  // 두 번째 저장 → 첫 모델이 백업되고, 되돌리면 첫 모델 분류 이름으로 돌아옴
  T.saveModel(db, lab, { labels: ['a', 'b', 'c'], modelJson: model(3, [4, 3]), weightsBase64: weights(12) });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'))).labels.length, 3);
  T.rollbackModel(db, lab);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'))).labels, ['a', 'b']);
});
