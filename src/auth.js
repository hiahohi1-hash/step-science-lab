// ─────────────────────────────────────────────
// 관리자 로그인 보안
// ─────────────────────────────────────────────
// 1) 비밀번호는 그대로 저장하지 않고 "scrypt" 방식으로 바꿔서(해시) 저장합니다.
//    데이터베이스 파일을 누가 가져가도 원래 비밀번호를 알 수 없습니다.
// 2) 로그인하면 아무도 짐작할 수 없는 긴 무작위 "출입증"(세션)을 쿠키로 줍니다.
//    - HttpOnly: 화면의 자바스크립트가 출입증을 읽을 수 없음 (도난 방지)
//    - SameSite=Strict: 다른 사이트에서 몰래 관리자 요청을 보내지 못함
//    - Secure(https 일 때): 암호화된 연결로만 보냄
// 3) 같은 기기에서 비밀번호를 5번 틀리면 5분 동안 로그인을 막습니다. (무작정 맞히기 방지)
// 4) 출입증은 8시간 뒤 자동으로 만료됩니다.

const crypto = require('crypto');
const { getSetting, setSetting } = require('./settings');

const SESSION_HOURS = 8;
const MAX_FAILS = 5;
const LOCK_MINUTES = 5;
const COOKIE = 'lab_admin';
const EXAMPLE_PASSWORD = 'change-me-1234'; // .env.example 에 적힌 예시 비밀번호

const sessions = new Map(); // 출입증 → { expires }
const fails = new Map();    // 기기(IP) → { count, lockedUntil }

// ── 비밀번호 해시 만들기 / 확인하기 ──
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [kind, saltHex, hashHex] = String(stored || '').split(':');
  if (kind !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual); // 비교 시간으로 비밀번호를 짐작하지 못하게
}

// ── 처음 실행: .env 의 ADMIN_PASSWORD 로 관리자 비밀번호를 만듦 ──
function ensureAdminPassword(db) {
  if (getSetting(db, 'admin_password_hash')) return;
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return; // 비밀번호가 없으면 로그인할 때 안내함
  setSetting(db, 'admin_password_hash', hashPassword(pw));
  setSetting(db, 'admin_password_is_example', pw === EXAMPLE_PASSWORD ? '1' : '0');
}

// ── 쿠키 읽기 (cookie-parser 패키지 없이) ──
function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function setSessionCookie(req, res, token, maxAgeSec) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${secure}`);
}

// ── 로그인 ──
// 성공하면 { ok: true, mustChange }, 실패하면 { ok: false, message, hint }
function login(db, req, res, password) {
  const ip = req.ip || 'unknown';
  const f = fails.get(ip) || { count: 0, lockedUntil: 0 };
  const nowMs = Date.now();
  if (f.lockedUntil > nowMs) {
    const min = Math.ceil((f.lockedUntil - nowMs) / 60000);
    return { ok: false, status: 429, message: `비밀번호를 여러 번 틀려서 잠시 막혔어요.`, hint: `${min}분 뒤에 다시 시도해 주세요.` };
  }

  ensureAdminPassword(db);
  const stored = getSetting(db, 'admin_password_hash');
  if (!stored) {
    return { ok: false, status: 503, message: '관리자 비밀번호가 아직 정해지지 않았어요.', hint: '.env 파일에 ADMIN_PASSWORD=비밀번호 를 적고 서버를 다시 켜 주세요.' };
  }

  if (typeof password !== 'string' || password.length > 200 || !verifyPassword(password, stored)) {
    f.count += 1;
    if (f.count >= MAX_FAILS) { f.lockedUntil = nowMs + LOCK_MINUTES * 60000; f.count = 0; }
    fails.set(ip, f);
    return { ok: false, status: 401, message: '비밀번호가 맞지 않아요.', hint: `${MAX_FAILS}번 틀리면 ${LOCK_MINUTES}분 동안 막혀요.` };
  }

  fails.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { expires: nowMs + SESSION_HOURS * 3600000 });
  setSessionCookie(req, res, token, SESSION_HOURS * 3600);
  return { ok: true, mustChange: getSetting(db, 'admin_password_is_example') === '1' };
}

function logout(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) sessions.delete(token);
  setSessionCookie(req, res, '', 0);
}

function isLoggedIn(req) {
  const token = readCookie(req, COOKIE);
  const s = token && sessions.get(token);
  if (!s) return false;
  if (s.expires < Date.now()) { sessions.delete(token); return false; }
  return true;
}

// ── 관리자만 들어갈 수 있게 막는 문지기 ──
function requireAdmin(req, res, next) {
  if (!isLoggedIn(req)) {
    return res.status(401).json({ ok: false, message: '관리자 로그인이 필요해요.', hint: '다시 로그인해 주세요.', needLogin: true });
  }
  // 바꾸는 요청은 JSON 으로만 받음 (다른 사이트의 몰래 보내는 양식 요청 차단)
  if (req.method !== 'GET' && !req.is('application/json')) {
    return res.status(415).json({ ok: false, message: '요청 형식이 올바르지 않아요.', hint: '화면을 새로 고친 뒤 다시 해 주세요.' });
  }
  next();
}

// ── 비밀번호 바꾸기 ──
function changePassword(db, req, res, current, next1, next2) {
  const stored = getSetting(db, 'admin_password_hash');
  if (!verifyPassword(String(current || ''), stored)) return { ok: false, message: '지금 비밀번호가 맞지 않아요.', hint: '다시 입력해 주세요.' };
  const n = String(next1 || '');
  if (n.length < 8 || n.length > 100) return { ok: false, message: '새 비밀번호는 8글자 이상이어야 해요.', hint: '숫자·영어·기호를 섞으면 더 안전해요.' };
  if (n !== next2) return { ok: false, message: '새 비밀번호 두 칸이 서로 달라요.', hint: '똑같이 두 번 입력해 주세요.' };
  if (n === EXAMPLE_PASSWORD) return { ok: false, message: '예시 비밀번호는 쓸 수 없어요.', hint: '다른 비밀번호를 정해 주세요.' };
  setSetting(db, 'admin_password_hash', hashPassword(n));
  setSetting(db, 'admin_password_is_example', '0');
  // 다른 기기의 로그인은 모두 끊고, 지금 기기만 새로 로그인 상태로
  sessions.clear();
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { expires: Date.now() + SESSION_HOURS * 3600000 });
  setSessionCookie(req, res, token, SESSION_HOURS * 3600);
  return { ok: true };
}

// 오래된 기록 정리 (1시간마다)
setInterval(() => {
  const t = Date.now();
  for (const [k, s] of sessions) if (s.expires < t) sessions.delete(k);
  for (const [k, f] of fails) if (f.lockedUntil < t && f.count === 0) fails.delete(k);
}, 3600000).unref();

module.exports = { hashPassword, verifyPassword, ensureAdminPassword, login, logout, isLoggedIn, requireAdmin, changePassword };
