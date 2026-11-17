// 실험실마다 인식 모델 테스트 (15단계)
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { freshDb } = require('./helpers');
const RA = require('../src/rules/recognitionAdmin');
const { recognitionConfig, saveLog } = require('../src/rules/recognition');
const A = require('../src/rules/adminRules');

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-model-')); // 진짜 public/model 대신 임시 폴더
  RA.setModelDirForTest(dir);
});
const labId = (db, code) => db.prepare('SELECT id FROM labs WHERE code = ?').get(code).id;
// 티처블 머신이 내보낸 것처럼 파일 3개 만들기
function putModel(sub, labels, name = 'tm-model') {
  const d = path.join(dir, sub);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'model.json'), '{}');
  fs.writeFileSync(path.join(d, 'weights.bin'), 'x');
  fs.writeFileSync(path.join(d, 'metadata.json'), JSON.stringify({ labels, modelName: name, timeStamp: '2026-11-20' }));
}

test('모델이 없으면 연습 모드, 실험실 폴더에 넣으면 그 실험실 모델', () => {
  const db = freshDb();
  assert.equal(recognitionConfig(db, labId(db, 'chem')).modelBase, null);
  putModel('chem', ['dryer', 'not_equipment'], '화학실 모델');
  const cfg = recognitionConfig(db, labId(db, 'chem'));
  assert.equal(cfg.modelBase, '/model/chem/');
  assert.equal(cfg.modelVersion, '화학실 모델 2026-11-20');
  assert.equal(recognitionConfig(db, labId(db, 'bio')).modelBase, null, '생물실은 아직 없음');
});

test('예전 위치(public/model/ 바로 아래) 모델은 첫 번째 실험실(생물실) 모델로 인정', () => {
  const db = freshDb();
  putModel('', ['autoclave', 'not_equipment'], '옛 모델');
  const bio = RA.modelInfo(db, labId(db, 'bio'));
  assert.equal(bio.base, '/model/');
  assert.equal(bio.legacy, true);
  assert.equal(RA.modelInfo(db, labId(db, 'phys')).base, null, '다른 실험실은 옛 모델을 쓰지 않음');
  putModel('bio', ['autoclave', 'not_equipment'], '새 모델');
  assert.equal(RA.modelInfo(db, labId(db, 'bio')).base, '/model/bio/', '실험실 폴더가 있으면 그쪽이 먼저');
});

test('연결 표와 경고는 실험실별로 따로', () => {
  const db = freshDb();
  const chem = labId(db, 'chem');
  putModel('chem', ['dryer', 'fume_hood', 'not_equipment']);
  const v = RA.classMapView(db, chem);
  assert.equal(v.equipment.length, 0, '화학실에는 아직 기구가 없음');
  assert.ok(v.warnings.some((w) => w.type === 'unmapped' && w.text.includes('[화학실]') && w.text.includes('fume_hood')));
  // 생물실 경고는 화학실 모델과 상관없음
  assert.ok(!RA.classMapView(db, labId(db, 'bio')).warnings.some((w) => w.text.includes('fume_hood')));
});

test('같은 분류 이름(dryer)을 실험실마다 다른 기구에 연결할 수 있고, 서로 지우지 않는다', () => {
  const db = freshDb();
  const chem = labId(db, 'chem');
  const bio = labId(db, 'bio');
  const { id: chemDryer } = A.saveEquipment(db, { lab_id: chem, name: '건조기', max_minutes: 60, time_options: [] });
  RA.saveClassMap(db, 'dryer', [chemDryer], chem);
  assert.deepEqual(recognitionConfig(db, chem).classes.dryer.map((u) => u.id), [chemDryer]);
  assert.deepEqual(recognitionConfig(db, bio).classes.dryer.map((u) => u.id), [5], '생물실 건조기 연결은 그대로');
  // 다른 실험실 기구는 연결할 수 없음
  assert.throws(() => RA.saveClassMap(db, 'dryer', [5], chem), /이 실험실에 없는 기구/);
});

test('인식 기록에 실험실이 남고, 정확도를 실험실별로 볼 수 있다', () => {
  const db = freshDb();
  const chem = labId(db, 'chem');
  const { id: chemDryer } = A.saveEquipment(db, { lab_id: chem, name: '건조기', max_minutes: 60, time_options: [] });
  RA.saveClassMap(db, 'dryer', [chemDryer], chem);
  saveLog(db, { predictedClass: 'dryer', confidence: 0.9, top3: [], decidedBy: '자동 결정', confirmedEquipmentId: chemDryer, modelVersion: '화학' });
  saveLog(db, { predictedClass: 'autoclave', confidence: 0.9, top3: [], decidedBy: '자동 결정', confirmedEquipmentId: 1, modelVersion: '생물' });
  assert.equal(RA.accuracy(db, null, chem).overall.total, 1);
  assert.equal(RA.accuracy(db, null, labId(db, 'bio')).overall.total, 1);
  assert.equal(RA.accuracy(db).overall.total, 2);
});

test('실험실 영어 코드로만 폴더를 만든다 (이상한 경로 불가)', () => {
  const db = freshDb();
  RA.ensureModelFolders(db);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['bio', 'chem', 'phys']);
  db.prepare("UPDATE labs SET code = '../evil' WHERE code = 'phys'").run(); // 규칙을 어긴 값이 들어갔다고 쳐도
  RA.ensureModelFolders(db);
  assert.ok(!fs.existsSync(path.join(dir, '..', 'evil')));
  assert.equal(RA.modelInfo(db, labId(db, '../evil')).base, null);
});
