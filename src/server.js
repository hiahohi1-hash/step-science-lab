// ─────────────────────────────────────────────
// 서버 시작점: 이 파일을 실행하면 과학실 관리 앱이 켜집니다.
// 실행 방법: 터미널에서  npm start
// ─────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const { loadOrCreateCert } = require('./certs');
const { now } = require('./clock');
const { getDb } = require('./db');
const { addClient, broadcast } = require('./events');
const { startScheduler } = require('./scheduler');
const { ensureAdminPassword, isLoggedIn } = require('./auth');
const { getSetting } = require('./settings');
const { photoFilePath } = require('./rules/photo');

// 1) .env 파일 읽기 (없으면 기본값으로 실행하고 안내만 함)
const ENV_FILE = path.join(__dirname, '..', '.env');
if (fs.existsSync(ENV_FILE)) {
  process.loadEnvFile(ENV_FILE); // Node.js 에 들어 있는 기능이라 따로 설치할 패키지가 없음
} else {
  console.warn('⚠ .env 파일이 없습니다. .env.example 을 복사해 .env 를 만들어 주세요. (지금은 기본값으로 켭니다)');
}
const HTTP_PORT = Number(process.env.HTTP_PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;

// 2) 시간대를 한국 시간으로 고정
process.env.TZ = 'Asia/Seoul';

const app = express();
app.disable('x-powered-by'); // 어떤 서버 프로그램인지 밖에 알리지 않음
// 화면에서 보내는 JSON 데이터를 읽을 수 있게 함 (너무 큰 데이터는 거절)
// 기구 사진 올리기 주소만 3MB 까지, 나머지는 200KB 까지
const smallJson = express.json({ limit: '200kb' });
const photoJson = express.json({ limit: '3mb' });
const PHOTO_UPLOAD = /^\/api\/admin\/(equipment\/\d+\/photo|training\/upload)$/;
// 18단계: 학습한 모델 저장은 모델 파일(2~5MB)이 커서 10MB 까지
const modelJson = express.json({ limit: '10mb' });
const MODEL_SAVE = /^\/api\/admin\/model\/save$/;
// (로그인한 관리자일 때만 큰 데이터를 받아 줌 → 로그인 안 한 사람이 큰 데이터로 서버를 괴롭히지 못하게)
app.use((req, res, next) => {
  const big = isLoggedIn(req) && (MODEL_SAVE.test(req.path) ? modelJson : PHOTO_UPLOAD.test(req.path) ? photoJson : null);
  return (big || smallJson)(req, res, next);
});

// 기본 보안 머리말: 다른 사이트가 이 화면을 몰래 틀 안에 넣거나(클릭 속이기), 파일 종류를 착각하게 하는 것을 막음
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// 3) 화면 파일(public 폴더) 보내기
app.use(express.static(path.join(__dirname, '..', 'public')));

// 3-1) 기구 사진: 서버가 만든 이름 모양(equip-번호-무작위.jpg)만, 항상 JPEG 그림으로 보냄
app.get('/photos/equipment/:file', (req, res) => {
  const file = photoFilePath(req.params.file);
  if (!file || !fs.existsSync(file)) return res.status(404).end();
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400'); // 이름이 매번 바뀌므로 하루 동안 다시 받지 않아도 됨
  res.sendFile(file);
});

// 4) 브라우저에서 쓸 라이브러리 파일을 node_modules 에서 꺼내 보내기
//    (인터넷 CDN 대신 이 컴퓨터에서 바로 보내므로 학교 인터넷이 막혀도 동작)
//    ※ 텐서플로와 티처블 머신 파일은 npm 패키지로 설치하지 않고 public/lib 폴더에 파일로 넣어 두었습니다.
//      npm 패키지로 설치하면 오래된 node-fetch(보안 취약점 있음)가 서버에 같이 깔리기 때문입니다.
const lib = (file) => path.join(__dirname, '..', 'node_modules', file);
const libFiles = {
  '/lib/zxing-browser.min.js': lib('@zxing/browser/umd/zxing-browser.min.js'),
  '/lib/tesseract.min.js': lib('tesseract.js/dist/tesseract.min.js'),
  '/lib/tesseract-worker.min.js': lib('tesseract.js/dist/worker.min.js'),
};
for (const [url, file] of Object.entries(libFiles)) {
  app.get(url, (req, res) => res.sendFile(file));
}
// 라벨 글자 읽기(tesseract.js)의 엔진과 영어 글자 데이터도 이 컴퓨터에서 보냄 (인터넷 연결 없이 동작)
app.use('/lib/tesseract-core', express.static(lib('tesseract.js-core')));
app.use('/lib/tessdata', express.static(lib('@tesseract.js-data/eng/4.0.0_best_int')));

// 5) 서버가 잘 켜졌는지 확인하는 주소
app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: '서버가 잘 동작하고 있어요.', serverTime: now().toISOString() });
});

// 5-0) 무언가를 바꾸는 요청(POST)이 성공하면 모든 화면에 "바뀌었어요" 소식 보내기 (실시간 갱신)
//      단, 읽기만 하는 POST(내 기록 보기, 내 차례 확인, 본인 확인)는 제외
//      (제외하지 않으면 "소식 받음 → 내 차례 확인 → 또 소식" 이 끝없이 반복됨)
const READ_ONLY_POSTS = [/^\/reagents\/loans\/mine$/, /^\/equipment\/my-queue$/, /^\/equipment\/\d+\/me$/,
  /^\/admin\/login$/, /^\/admin\/logout$/, /^\/admin\/password$/, /^\/admin\/notifications\/read-all$/,
  /^\/reagents\/find-by-text$/, /^\/recognition\/log$/, /^\/recognition\/sample$/, /^\/topics$/];
app.use('/api', (req, res, next) => {
  if (req.method === 'POST' && !READ_ONLY_POSTS.some((re) => re.test(req.path))) {
    res.on('finish', () => { if (res.statusCode < 400) broadcast('change', { reason: '사용자 요청' }); });
  }
  next();
});

// 5-1) 시약 관련 주소
app.use('/api/reagents', require('./routes/reagents'));
// 5-2) 기구 관련 주소
app.use('/api/equipment', require('./routes/equipment'));
// 5-2-1) 기구 사진 인식 (연결 표, 인식 기록)
app.use('/api/recognition', require('./routes/recognition'));
// 5-2-2) 실험실 목록 (태블릿 "이 태블릿은 어느 실험실?" 고르기, 현황판 탭) — 13단계
app.get('/api/labs', (req, res) => {
  res.json({ ok: true, labs: require('./rules/labs').listLabs(getDb()).map((l) => ({ id: l.id, name: l.name, code: l.code })) });
});
// 5-2-3) 16단계: 실험 주제로 기구·기자재 추천 (로그인 없음)
app.get('/api/recommend', (req, res) => {
  const db = getDb();
  res.json({ ok: true, ...require('./rules/recommend').recommend(db, req.query.q, require('./rules/labs').labFilter(db, req.query.lab)) });
});
// 학생이 안내 전용 기구 화면에서 적은 실험 주제 (선택, 학번·이름 없음)
// 한 기기에서 너무 많이 보내면 막음 (추천 결과를 일부러 흐리는 것 방지)
const topicHits = new Map();
setInterval(() => topicHits.clear(), 60 * 60 * 1000).unref();
app.post('/api/topics', (req, res) => {
  const ip = req.ip || 'x';
  const n = (topicHits.get(ip) || 0) + 1;
  topicHits.set(ip, n);
  if (n > 30) return res.status(429).json({ ok: false, message: '잠시 뒤에 다시 보내 주세요.', hint: '한 시간에 30번까지 보낼 수 있어요.' });
  const b = req.body || {};
  res.json({ ok: true, ...(require('./rules/recommend').saveTopic(getDb(), b.equipmentId, b.topic) || { saved: false }) });
});

// 5-3) 경고 띠 내용
app.use('/api/alerts', require('./routes/alerts'));
// 5-4) 실시간 소식 받기
app.get('/api/events', (req, res) => addClient(req, res));
// 5-5) 관리자 (로그인 필요)
app.use('/api/admin', require('./routes/admin'));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
// 6) 기구 현황판 (휴대폰용, 로그인 없음): /status
app.get('/status', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'status.html')));

// 6) 없는 주소로 들어왔을 때 안내
app.use((req, res) => {
  res.status(404).json({ ok: false, message: `"${req.path}" 주소는 없어요. 주소를 다시 확인해 주세요.` });
});

// 7) 예상하지 못한 오류가 났을 때 안내 (서버가 꺼지지 않게 함)
app.use((err, req, res, next) => {
  // 규칙 위반(예: 72시간 초과)은 학생이 고칠 수 있는 오류 → 무엇이 잘못됐는지 + 어떻게 하면 되는지 알려 줌
  if (err.name === 'RuleError') {
    return res.status(err.status || 400).json({ ok: false, message: err.message, hint: err.hint });
  }
  // 화면에서 보낸 데이터 모양이 깨진 경우
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, message: '보낸 내용이 너무 커요.', hint: '글을 줄여서 다시 보내 주세요.' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, message: '보낸 내용을 읽지 못했어요.', hint: '화면을 새로 고친 뒤 다시 해 주세요.' });
  }
  console.error('서버 오류:', err);
  res.status(500).json({ ok: false, message: '서버에서 오류가 났어요. 잠시 뒤 다시 해 보고, 계속되면 담당 선생님께 알려 주세요.' });
});

// 8) http 서버와 https 서버를 함께 켜기
async function start() {
  // 데이터베이스 준비 (처음이면 표를 만들고 예시 데이터를 넣음)
  try {
    const db = getDb();
    const n = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    console.log(`✔ 데이터베이스 준비 완료: 시약 ${n('reagents')}종, 기구 ${n('equipment')}대`);
    // 관리자 비밀번호 준비 (.env 의 ADMIN_PASSWORD → 암호화해서 저장)
    ensureAdminPassword(db);
    if (!getSetting(db, 'admin_password_hash')) {
      console.warn('⚠ 관리자 비밀번호가 없어요. .env 파일에 ADMIN_PASSWORD=비밀번호 를 적고 다시 켜 주세요.');
    } else if (getSetting(db, 'admin_password_is_example') === '1') {
      console.warn('⚠ 관리자 비밀번호가 예시 그대로예요. 처음 로그인하면 꼭 바꿔 주세요.');
    }
    // 1분마다 자동 검사 시작 (연체, 기구 시간 종료, 예약 대기 넘기기)
    startScheduler(db, broadcast);
    // 15단계: 실험실마다 인식 모델 폴더(public/model/bio 등)를 만들어 둠
    require('./rules/recognitionAdmin').ensureModelFolders(db);
    console.log('✔ 1분마다 자동 검사를 시작했어요.');
  } catch (e) {
    console.error('✘ 데이터베이스를 열지 못했어요. data 폴더가 다른 프로그램에서 열려 있지 않은지 확인하세요.', e.message);
    process.exit(1);
  }

  // http(암호화 안 됨)는 이 컴퓨터 안에서만 열리게 함(127.0.0.1).
  // 학번·이름·관리자 비밀번호가 와이파이에서 암호화 없이 오가지 않도록, 다른 기기는 https 로만 들어올 수 있음.
  http.createServer(app).listen(HTTP_PORT, '127.0.0.1', () => {
    console.log(`✔ 이 컴퓨터에서 보기:   http://localhost:${HTTP_PORT}`);
  });

  try {
    const { key, cert, ips, created } = await loadOrCreateCert();
    if (created) console.log('✔ https 용 자체 인증서를 새로 만들었어요. (certs 폴더)');
    https.createServer({ key, cert }, app).listen(HTTPS_PORT, () => {
      console.log(`✔ https 로 보기:        https://localhost:${HTTPS_PORT}`);
      for (const ip of ips) {
        console.log(`✔ 태블릿·휴대폰에서 보기: https://${ip}:${HTTPS_PORT}   (같은 와이파이에 연결해야 해요)`);
      }
    });
  } catch (e) {
    console.error('✘ https 서버를 켜지 못했어요. 카메라는 이 컴퓨터(localhost)에서만 쓸 수 있어요.', e.message);
  }
}

// 이 파일을 직접 실행했을 때만 서버를 켬 (테스트에서 불러올 때는 켜지 않음)
if (require.main === module) {
  start();
}

module.exports = { app };
