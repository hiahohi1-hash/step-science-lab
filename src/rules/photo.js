// ─────────────────────────────────────────────
// 기구 사진 (명세 7-1 "사진(선택)")
// ─────────────────────────────────────────────
// 사진 올리기는 보안상 조심할 게 많아서 이렇게 막아 둡니다.
//  1) 관리자만 올릴 수 있음 (routes/admin.js 의 로그인 문지기 뒤)
//  2) 관리자 화면이 올리기 전에 사진을 가로·세로 1024 이하 JPEG 로 "새로 그려서" 보냄
//     → 휴대폰 사진에 숨어 있는 촬영 위치(GPS)·기기 정보가 지워지고, 크기도 작아짐
//  3) 서버는 JPEG 파일이 맞는지(파일 맨 앞·맨 끝 표시) 확인하고, 2MB 가 넘으면 거절
//  4) 파일 이름은 서버가 무작위로 정함 (사용자가 보낸 이름을 쓰지 않음 → 다른 폴더에 몰래 쓰기 불가)
//  5) public 폴더가 아니라 uploads 폴더에 저장하고, 정해진 모양의 이름만 "그림"으로 보냄

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RuleError, checkId } = require('./common');

const PHOTO_DIR = path.join(__dirname, '..', '..', 'uploads', 'equipment');
const MAX_BYTES = 2 * 1024 * 1024;
const FILE_NAME = /^equip-\d+-[0-9a-f]{16}\.jpg$/; // 서버가 만든 이름 모양만 허용

// "data:image/jpeg;base64,...." → 사진 바이트
function decodeJpeg(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new RuleError('사진 형식이 올바르지 않아요.', 'JPG·PNG 사진 파일을 골라 주세요.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_BYTES) throw new RuleError('사진이 너무 커요 (2MB 초과).', '더 작은 사진을 골라 주세요.');
  // JPEG 파일은 FF D8 FF 로 시작하고 FF D9 로 끝남
  const isJpeg = buf.length > 100 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
    && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
  if (!isJpeg) throw new RuleError('JPEG 사진이 아니에요.', '사진 파일을 다시 골라 주세요.');
  return buf;
}

// 기구 사진 저장 (예전 사진은 지움)
function savePhoto(db, equipmentId, dataUrl, dir = PHOTO_DIR) {
  const id = checkId(equipmentId, '기구');
  const e = db.prepare('SELECT id, photo FROM equipment WHERE id = ? AND archived = 0').get(id);
  if (!e) throw new RuleError('그 기구를 찾을 수 없어요.', '목록을 새로 고쳐 주세요.', 404);
  const buf = decodeJpeg(dataUrl);
  fs.mkdirSync(dir, { recursive: true });
  const name = `equip-${id}-${crypto.randomBytes(8).toString('hex')}.jpg`;
  fs.writeFileSync(path.join(dir, name), buf);
  db.prepare('UPDATE equipment SET photo = ? WHERE id = ?').run(name, id);
  deleteFile(e.photo, dir);
  return { photo: name, url: photoUrl(name) };
}

// 기구 사진 지우기
function removePhoto(db, equipmentId, dir = PHOTO_DIR) {
  const id = checkId(equipmentId, '기구');
  const e = db.prepare('SELECT id, photo FROM equipment WHERE id = ?').get(id);
  if (!e) throw new RuleError('그 기구를 찾을 수 없어요.', '', 404);
  db.prepare('UPDATE equipment SET photo = NULL WHERE id = ?').run(id);
  deleteFile(e.photo, dir);
}

function deleteFile(name, dir) {
  if (name && FILE_NAME.test(name)) {
    try { fs.unlinkSync(path.join(dir, name)); } catch (e) { /* 이미 없으면 그냥 넘어감 */ }
  }
}

// 화면에서 쓸 주소 (사진이 없으면 null)
function photoUrl(name) {
  return name && FILE_NAME.test(name) ? `/photos/equipment/${name}` : null;
}

// 주소의 파일 이름이 서버가 만든 모양일 때만 실제 파일 경로를 돌려줌
function photoFilePath(name, dir = PHOTO_DIR) {
  return FILE_NAME.test(String(name || '')) ? path.join(dir, name) : null;
}

module.exports = { savePhoto, removePhoto, photoUrl, photoFilePath, decodeJpeg, PHOTO_DIR, MAX_BYTES };
