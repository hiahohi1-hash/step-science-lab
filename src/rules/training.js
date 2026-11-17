// ─────────────────────────────────────────────
// 18단계: 앱 안에서 기구 인식 모델 다시 학습하기 — 서버 쪽
// ─────────────────────────────────────────────
// 흐름
//  ① 태블릿: 인식 → "○○가 맞나요?" → 예 / 다른 기구 고름
//     → 그 순간의 사진(가운데 224×224)을 "최종 확인한 기구"의 분류 이름 폴더에 저장
//  ② 관리자 화면: 분류별 사진 장수를 보고 [모델 다시 학습] → 관리자 컴퓨터 브라우저가 학습
//  ③ 학습한 모델을 서버로 보내면 public/model/<실험실>/ 에 저장 (이전 모델은 백업)
//
// 저장 위치: training/<실험실 코드>/<분류 이름>/s-<시각>-<무작위>.jpg
//  - public 폴더 밖이라 누구나 볼 수 없고, 관리자만 정해진 주소로 볼 수 있음
//  - 학번·이름과 연결하지 않음 (사진 파일만 저장)
//  - 폴더·파일 이름은 정해진 모양만 허용 → "../" 같은 이름으로 다른 폴더에 쓰기 불가

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RuleError, checkId } = require('./common');
const { getSetting } = require('../settings');
const { decodeJpeg } = require('./photo');
const { now } = require('../clock');

let TRAINING_DIR = path.join(__dirname, '..', '..', 'training');
let MODEL_DIR = path.join(__dirname, '..', '..', 'public', 'model');
// (테스트 전용) 진짜 폴더를 건드리지 않게 임시 폴더로 바꿈
function setDirsForTest(trainingDir, modelDir) { TRAINING_DIR = trainingDir; MODEL_DIR = modelDir; }

const SAFE_CLASS = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/; // 폴더 이름으로 쓰는 분류 이름: 영어·숫자·_·- 만
const SAMPLE_FILE = /^s-\d{13}-[0-9a-f]{8}\.jpg$/;      // 서버가 만든 사진 이름 모양
const LAB_CODE = /^[a-z][a-z0-9_-]{1,19}$/;
const MAX_SAMPLE_BYTES = 150 * 1024;   // 224×224 JPEG 은 보통 10~30KB
const MAX_PER_CLASS = 2000;            // 분류 하나에 이만큼 넘게는 저장하지 않음 (디스크 보호)
const MIN_PER_CLASS = 5;               // 학습에 넣으려면 분류마다 최소 이만큼
const MODEL_FILES = ['model.json', 'metadata.json', 'weights.bin'];
const KEEP_BACKUPS = 5;

function labRow(db, labId) {
  const lab = db.prepare('SELECT id, name, code FROM labs WHERE id = ?').get(checkId(labId, '실험실'));
  if (!lab || !LAB_CODE.test(lab.code)) throw new RuleError('그 실험실을 찾을 수 없어요.', '', 404);
  return lab;
}
const classDir = (code, c) => path.join(TRAINING_DIR, code, c);
const listJpgs = (dir) => { try { return fs.readdirSync(dir).filter((f) => SAMPLE_FILE.test(f)); } catch (e) { return []; } };

function writeSample(code, className, buf) {
  const dir = classDir(code, className);
  if (listJpgs(dir).length >= MAX_PER_CLASS) throw new RuleError(`"${className}" 사진이 너무 많아요 (${MAX_PER_CLASS}장).`, '관리자 화면에서 오래된 사진을 지워 주세요.');
  fs.mkdirSync(dir, { recursive: true });
  const name = `s-${String(now().getTime()).padStart(13, '0')}-${crypto.randomBytes(4).toString('hex')}.jpg`;
  fs.writeFileSync(path.join(dir, name), buf);
  return name;
}

function checkSampleJpeg(dataUrl) {
  const buf = decodeJpeg(dataUrl);
  if (buf.length > MAX_SAMPLE_BYTES) throw new RuleError('학습용 사진이 너무 커요.', '화면을 새로 고친 뒤 다시 해 주세요.');
  return buf;
}

// 기구의 분류 이름 찾기. 연결된 분류가 없으면 "eq_<번호>" 분류를 새로 만들어 연결 (새 기구도 배우게)
function classForEquipment(db, equipmentId) {
  const e = db.prepare('SELECT id, lab_id FROM equipment WHERE id = ? AND archived = 0').get(checkId(equipmentId, '기구'));
  if (!e) throw new RuleError('그 기구를 찾을 수 없어요.', '', 404);
  const mapped = db.prepare('SELECT class_name FROM model_class_map WHERE equipment_id = ? ORDER BY id').all(e.id)
    .map((r) => r.class_name).find((c) => SAFE_CLASS.test(c));
  if (mapped) return { className: mapped, labId: e.lab_id, created: false };
  const className = `eq_${e.id}`;
  db.prepare('INSERT INTO model_class_map (class_name, equipment_id) VALUES (?, ?)').run(className, e.id);
  return { className, labId: e.lab_id, created: true };
}

// ① 태블릿이 보낸 확인된 사진 저장
function saveSample(db, data) {
  if (getSetting(db, 'training_collect') !== '1') return { saved: false, reason: 'off' };
  const buf = checkSampleJpeg(data && data.dataUrl);
  const { className, labId } = classForEquipment(db, data && data.equipmentId);
  if (className === getSetting(db, 'not_equipment_class')) throw new RuleError('"기구 아님" 분류에는 저장할 수 없어요.');
  const lab = labRow(db, labId);
  writeSample(lab.code, className, buf);
  return { saved: true, className };
}

// 관리자가 사진을 직접 올림 (주로 "기구 아님" 사진)
function uploadSamples(db, labId, className, dataUrls) {
  const lab = labRow(db, labId);
  const c = String(className ?? '').trim();
  if (!SAFE_CLASS.test(c)) throw new RuleError('분류 이름이 올바르지 않아요.', '영어·숫자·_ 로 된 분류 이름만 쓸 수 있어요.');
  const notEq = getSetting(db, 'not_equipment_class');
  const known = c === notEq || db.prepare(`SELECT 1 FROM model_class_map m JOIN equipment e ON e.id = m.equipment_id
                                           WHERE m.class_name = ? AND e.lab_id = ? AND e.archived = 0`).get(c, lab.id);
  if (!known) throw new RuleError(`"${c}"는 이 실험실에 연결된 분류 이름이 아니에요.`, '모델 연결 표에서 먼저 기구와 연결해 주세요.');
  const list = Array.isArray(dataUrls) ? dataUrls : [];
  if (!list.length || list.length > 30) throw new RuleError('사진은 한 번에 1~30장씩 올려 주세요.');
  const bufs = list.map(checkSampleJpeg); // 하나라도 이상하면 하나도 저장하지 않음
  for (const b of bufs) writeSample(lab.code, c, b);
  return { saved: bufs.length };
}

// ② 관리자 화면: 분류별 사진 현황
function overview(db, labId) {
  const lab = labRow(db, labId);
  const notEq = getSetting(db, 'not_equipment_class');
  const rows = db.prepare(`SELECT m.class_name, e.name, e.unit_label FROM model_class_map m JOIN equipment e ON e.id = m.equipment_id
                           WHERE e.lab_id = ? AND e.archived = 0 ORDER BY m.class_name, e.unit_label`).all(lab.id);
  const names = {};
  for (const r of rows) (names[r.class_name] ||= []).push(r.unit_label ? `${r.name} ${r.unit_label}` : r.name);
  let dirs = [];
  try { dirs = fs.readdirSync(path.join(TRAINING_DIR, lab.code)).filter((d) => SAFE_CLASS.test(d)); } catch (e) { /* 아직 없음 */ }
  const all = [...new Set([...Object.keys(names).filter((c) => SAFE_CLASS.test(c)), ...dirs, notEq])].sort();
  const classes = all.map((c) => {
    const count = listJpgs(classDir(lab.code, c)).length;
    return { className: c, equipment: names[c] || [], count, isNotEquipment: c === notEq, trainable: count >= MIN_PER_CLASS && (c === notEq || !!names[c]) };
  });
  const { modelInfo } = require('./recognitionAdmin');
  const model = modelInfo(db, lab.id);
  return {
    lab: { id: lab.id, name: lab.name, code: lab.code },
    collect: getSetting(db, 'training_collect') === '1',
    minPerClass: MIN_PER_CLASS,
    classes,
    total: classes.reduce((s, c) => s + c.count, 0),
    hasBaseModel: model.kind === 'real',
    backups: listBackups(lab.code).length,
  };
}

// 분류 하나의 사진 이름 목록 (새것부터)
function listSamples(db, labId, className) {
  const lab = labRow(db, labId);
  if (!SAFE_CLASS.test(String(className))) throw new RuleError('분류 이름이 올바르지 않아요.');
  return listJpgs(classDir(lab.code, className)).sort().reverse();
}

// 사진 파일 경로 (모양이 맞을 때만)
function samplePath(db, labId, className, file) {
  const lab = labRow(db, labId);
  if (!SAFE_CLASS.test(String(className)) || !SAMPLE_FILE.test(String(file))) return null;
  const p = path.join(classDir(lab.code, className), file);
  return fs.existsSync(p) ? p : null;
}

function deleteSamples(db, labId, className, files) {
  const lab = labRow(db, labId);
  if (!SAFE_CLASS.test(String(className))) throw new RuleError('분류 이름이 올바르지 않아요.');
  let n = 0;
  for (const f of (Array.isArray(files) ? files : []).slice(0, 500)) {
    if (!SAMPLE_FILE.test(String(f))) continue;
    try { fs.unlinkSync(path.join(classDir(lab.code, className), f)); n += 1; } catch (e) { /* 이미 없음 */ }
  }
  return { deleted: n };
}

// 학습에 쓸 사진 목록: 사진이 MIN_PER_CLASS 장 이상이고 기구와 연결된(또는 기구 아님) 분류만
function trainingSet(db, labId) {
  const ov = overview(db, labId);
  const use = ov.classes.filter((c) => c.trainable);
  if (use.length < 2) throw new RuleError('학습하려면 사진이 있는 분류가 2개 이상 필요해요.', `분류마다 사진을 ${MIN_PER_CLASS}장 이상 모아 주세요.`);
  return {
    labels: use.map((c) => c.className),
    files: use.flatMap((c) => listJpgs(classDir(ov.lab.code, c.className)).map((f) => ({ c: c.className, f }))),
    skipped: ov.classes.filter((c) => !c.trainable && c.count > 0).map((c) => ({ className: c.className, count: c.count })),
  };
}

// ── ③ 학습한 모델 저장 ──
const prod = (shape) => shape.reduce((a, b) => a * b, 1);
function lastDenseUnits(node, found = []) {
  if (Array.isArray(node)) node.forEach((x) => lastDenseUnits(x, found));
  else if (node && typeof node === 'object') {
    if (node.class_name === 'Dense' && node.config && Number.isInteger(node.config.units)) found.push(node.config.units);
    Object.values(node).forEach((x) => lastDenseUnits(x, found));
  }
  return found;
}

function saveModel(db, labId, data) {
  const lab = labRow(db, labId);
  const labels = Array.isArray(data && data.labels) ? data.labels.map(String) : [];
  if (labels.length < 2 || labels.length > 100 || labels.some((l) => !SAFE_CLASS.test(l)) || new Set(labels).size !== labels.length) {
    throw new RuleError('학습한 모델의 분류 이름이 올바르지 않아요.');
  }
  const mj = data && data.modelJson;
  if (!mj || typeof mj !== 'object' || !mj.modelTopology || !Array.isArray(mj.weightsManifest) || mj.weightsManifest.length !== 1) {
    throw new RuleError('모델 형식이 올바르지 않아요.');
  }
  const manifest = mj.weightsManifest[0];
  if (!Array.isArray(manifest.weights) || !manifest.weights.every((w) => w && typeof w.name === 'string' && Array.isArray(w.shape) && w.dtype === 'float32' && w.shape.every((n) => Number.isInteger(n) && n > 0))) {
    throw new RuleError('모델 가중치 정보가 올바르지 않아요.');
  }
  const weights = Buffer.from(String(data.weightsBase64 || ''), 'base64');
  const expected = manifest.weights.reduce((s, w) => s + prod(w.shape) * 4, 0);
  if (!weights.length || weights.length !== expected || weights.length > 40 * 1024 * 1024) throw new RuleError('모델 가중치 크기가 맞지 않아요.', '다시 학습해 주세요.');
  const units = lastDenseUnits(mj.modelTopology);
  if (!units.length || units[units.length - 1] !== labels.length) throw new RuleError('모델의 출력 개수와 분류 이름 개수가 달라요.');

  const modelJson = { modelTopology: mj.modelTopology, format: 'layers-model', generatedBy: 'scilab-retrain', convertedBy: null, weightsManifest: [{ paths: ['weights.bin'], weights: manifest.weights }] };
  const stamp = now().toISOString();
  const metadata = {
    tfjsVersion: '1.3.1', tmVersion: '2.4.19', packageVersion: '0.8.5', packageName: '@teachablemachine/image',
    timeStamp: stamp, userMetadata: { trainedIn: 'scilab', images: Number(data.imageCount) || null, valAccuracy: Number(data.valAccuracy) || null },
    modelName: 'scilab-retrain', labels, imageSize: 224,
  };
  const dir = path.join(MODEL_DIR, lab.code);
  fs.mkdirSync(dir, { recursive: true });
  backupModel(lab.code, dir);
  // 새 파일을 임시 이름으로 다 쓴 뒤 한꺼번에 이름 바꾸기 (쓰는 도중 태블릿이 반쪽짜리 모델을 읽지 않게)
  const out = { 'model.json': JSON.stringify(modelJson), 'metadata.json': JSON.stringify(metadata, null, 2), 'weights.bin': weights };
  for (const [f, content] of Object.entries(out)) fs.writeFileSync(path.join(dir, f + '.tmp'), content);
  for (const f of MODEL_FILES) fs.renameSync(path.join(dir, f + '.tmp'), path.join(dir, f));
  return { version: `scilab-retrain ${stamp}`, labels };
}

const backupRoot = (code) => path.join(TRAINING_DIR, code, '_models');
function listBackups(code) {
  try { return fs.readdirSync(backupRoot(code)).filter((d) => /^\d{13}$/.test(d)).sort(); } catch (e) { return []; }
}
function backupModel(code, dir) {
  if (!MODEL_FILES.every((f) => fs.existsSync(path.join(dir, f)))) return;
  const to = path.join(backupRoot(code), String(now().getTime()).padStart(13, '0'));
  fs.mkdirSync(to, { recursive: true });
  for (const f of MODEL_FILES) fs.copyFileSync(path.join(dir, f), path.join(to, f));
  for (const old of listBackups(code).slice(0, -KEEP_BACKUPS)) fs.rmSync(path.join(backupRoot(code), old), { recursive: true, force: true });
}

// 바로 전 모델로 되돌리기
function rollbackModel(db, labId) {
  const lab = labRow(db, labId);
  const list = listBackups(lab.code);
  if (!list.length) throw new RuleError('되돌릴 이전 모델이 없어요.');
  const from = path.join(backupRoot(lab.code), list[list.length - 1]);
  const dir = path.join(MODEL_DIR, lab.code);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of MODEL_FILES) fs.copyFileSync(path.join(from, f), path.join(dir, f + '.tmp'));
  for (const f of MODEL_FILES) fs.renameSync(path.join(dir, f + '.tmp'), path.join(dir, f));
  fs.rmSync(from, { recursive: true, force: true });
  return { restored: list[list.length - 1] };
}

module.exports = {
  saveSample, uploadSamples, overview, listSamples, samplePath, deleteSamples, trainingSet, saveModel, rollbackModel,
  classForEquipment, setDirsForTest, SAFE_CLASS, MIN_PER_CLASS,
};
