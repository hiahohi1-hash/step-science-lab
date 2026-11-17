// 기구 사진 올리기 테스트 (명세 7-1 "사진(선택)") — 보안 검사 위주
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { freshDb, EQUIP } = require('./helpers');
const Photo = require('../src/rules/photo');

// 진짜 uploads 폴더 대신 임시 폴더에 저장
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lab-photo-'));

// 아주 작은 진짜 JPEG 모양 (FF D8 FF … FF D9)
const fakeJpeg = (size = 200) => {
  const b = Buffer.alloc(size, 0x11);
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[size - 2] = 0xff; b[size - 1] = 0xd9;
  return b;
};
const dataUrl = (buf, type = 'image/jpeg') => `data:${type};base64,${buf.toString('base64')}`;

test('JPEG 사진은 저장되고, 서버가 정한 이름으로만 저장된다', () => {
  const db = freshDb();
  const dir = tmpDir();
  const r = Photo.savePhoto(db, EQUIP.멸균기, dataUrl(fakeJpeg()), dir);
  assert.match(r.photo, /^equip-1-[0-9a-f]{16}\.jpg$/);
  assert.equal(r.url, `/photos/equipment/${r.photo}`);
  assert.ok(fs.existsSync(path.join(dir, r.photo)));
});

test('사진을 바꾸면 예전 파일은 지워지고, 지우기도 된다', () => {
  const db = freshDb();
  const dir = tmpDir();
  const a = Photo.savePhoto(db, EQUIP.멸균기, dataUrl(fakeJpeg()), dir);
  const b = Photo.savePhoto(db, EQUIP.멸균기, dataUrl(fakeJpeg(300)), dir);
  assert.ok(!fs.existsSync(path.join(dir, a.photo)), '예전 사진 지워짐');
  Photo.removePhoto(db, EQUIP.멸균기, dir);
  assert.ok(!fs.existsSync(path.join(dir, b.photo)));
  assert.equal(db.prepare('SELECT photo FROM equipment WHERE id = ?').get(EQUIP.멸균기).photo, null);
});

test('JPEG 가 아닌 파일은 거절한다 (이름만 바꾼 파일, 다른 형식)', () => {
  const db = freshDb();
  const dir = tmpDir();
  const html = Buffer.from('<html><script>alert(1)</script></html>'.repeat(10));
  assert.throws(() => Photo.savePhoto(db, 1, dataUrl(html), dir), /JPEG 사진이 아니에요/);
  assert.throws(() => Photo.savePhoto(db, 1, dataUrl(fakeJpeg(), 'image/svg+xml'), dir), /형식이 올바르지/);
  assert.throws(() => Photo.savePhoto(db, 1, 'not a data url', dir), /형식이 올바르지/);
  assert.equal(fs.readdirSync(dir).length, 0, '아무 파일도 저장되지 않음');
});

test('2MB 가 넘는 사진은 거절한다', () => {
  const db = freshDb();
  assert.throws(() => Photo.savePhoto(db, 1, dataUrl(fakeJpeg(Photo.MAX_BYTES + 10)), tmpDir()), /너무 커요/);
});

test('사진 주소로 다른 폴더의 파일을 꺼낼 수 없다', () => {
  for (const bad of ['../../.env', '..\\..\\data\\lab.db', 'equip-1-abc.jpg', 'equip-1-0123456789abcdef.png', '/etc/passwd']) {
    assert.equal(Photo.photoFilePath(bad), null, bad);
  }
  assert.ok(Photo.photoFilePath('equip-1-0123456789abcdef.jpg'));
});

test('없는 기구에는 사진을 넣을 수 없다', () => {
  const db = freshDb();
  assert.throws(() => Photo.savePhoto(db, 999, dataUrl(fakeJpeg()), tmpDir()), /찾을 수 없어요/);
});
