// ─────────────────────────────────────────────
// https 용 "자체 인증서"를 만들고 불러오는 파일
// ─────────────────────────────────────────────
// 태블릿 브라우저는 https 주소에서만 카메라를 켜 줍니다.
// 그래서 이 컴퓨터가 스스로 서명한 인증서를 만들어 https 서버를 켭니다.
// (진짜 인증 기관이 만든 것이 아니라서 태블릿에서 처음 한 번 "고급 → 계속"을 눌러야 합니다.)

const fs = require('fs');
const os = require('os');
const path = require('path');
const selfsigned = require('selfsigned');

const CERT_DIR = path.join(__dirname, '..', 'certs');
const KEY_FILE = path.join(CERT_DIR, 'key.pem');
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');
const INFO_FILE = path.join(CERT_DIR, 'info.json'); // 인증서에 넣은 IP 목록을 적어 둔 파일

// 이 컴퓨터의 와이파이/유선 IP 주소 목록 (예: 192.168.0.5)
function getLocalIPs() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

// 인증서를 불러옴. 없거나, 컴퓨터 IP가 바뀌었으면 새로 만듦
async function loadOrCreateCert() {
  const ips = getLocalIPs();
  const wanted = ['127.0.0.1', ...ips].sort().join(',');

  // 이미 만들어 둔 인증서가 있고 IP 목록이 같으면 그대로 사용
  if (fs.existsSync(KEY_FILE) && fs.existsSync(CERT_FILE) && fs.existsSync(INFO_FILE)) {
    const info = JSON.parse(fs.readFileSync(INFO_FILE, 'utf8'));
    if (info.ips === wanted) {
      return { key: fs.readFileSync(KEY_FILE), cert: fs.readFileSync(CERT_FILE), ips, created: false };
    }
  }

  // 새로 만들기 (유효 기간 3년)
  const notBefore = new Date();
  const notAfter = new Date(notBefore.getTime() + 3 * 365 * 24 * 60 * 60 * 1000);
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'science-lab' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notBeforeDate: notBefore,
    notAfterDate: notAfter,
    extensions: [
      {
        // 이 인증서를 쓸 수 있는 주소 목록: localhost + 이 컴퓨터의 모든 IP
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          ...ips.map((ip) => ({ type: 7, ip })),
        ],
      },
    ],
  });

  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILE, pems.private);
  fs.writeFileSync(CERT_FILE, pems.cert);
  fs.writeFileSync(INFO_FILE, JSON.stringify({ ips: wanted, createdAt: notBefore.toISOString() }));
  return { key: pems.private, cert: pems.cert, ips, created: true };
}

module.exports = { loadOrCreateCert, getLocalIPs };
