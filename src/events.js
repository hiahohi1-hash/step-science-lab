// ─────────────────────────────────────────────
// 화면 실시간 갱신 (Server-Sent Events)
// ─────────────────────────────────────────────
// 화면이 /api/events 에 연결해 두면, 서버가 상태가 바뀔 때마다 "바뀌었어요" 소식을 바로 보냅니다.
// 화면은 그 소식을 받고 필요한 부분만 다시 불러옵니다 (새로고침 없이).
//
// ⚠ 이 소식은 로그인 없이 누구나 받을 수 있으므로 학생 이름은 절대 넣지 않습니다.
//   학번은 뒤 두 자리를 가린 것(203**)만 넣습니다.

const clients = new Set();
const MAX_CLIENTS = 200; // 너무 많이 연결해서 서버가 느려지는 것을 막음

// 화면 하나가 연결했을 때
function addClient(req, res) {
  if (clients.size >= MAX_CLIENTS) {
    return res.status(503).json({ ok: false, message: '연결한 화면이 너무 많아요.', hint: '잠시 뒤 다시 열어 주세요.' });
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 3000\n\n'); // 연결이 끊기면 3초 뒤 자동으로 다시 연결
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

// 연결된 모든 화면에 소식 보내기
// type: 'change'(무언가 바뀜), 'equipment-finished'(기구 사용 끝), 'turn'(예약 차례), 'overdue-new'(새 연체)
function broadcast(type, data = {}) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

// 25초마다 "살아 있어요" 신호 (와이파이 공유기가 조용한 연결을 끊지 않게)
setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 25000).unref();

module.exports = { addClient, broadcast, clientCount: () => clients.size };
