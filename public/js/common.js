// ─────────────────────────────────────────────
// 여러 화면이 함께 쓰는 도구
// ─────────────────────────────────────────────

// 화면 요소 만들기: h('button', { class: 'primary', onclick: fn }, '글자')
// ※ 사용자가 입력한 글자는 항상 textContent 로 넣습니다 (innerHTML 금지).
//   그래야 누군가 이름 칸에 <script> 같은 걸 써도 그냥 글자로만 보여서 안전합니다.
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  // 버튼처럼 누르는 카드는 키보드 Enter·스페이스로도 누를 수 있게
  if (attrs && attrs.role === 'button' && typeof attrs.onclick === 'function') {
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); attrs.onclick(e); } });
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// 서버에 요청 보내기. 실패하면 { message, hint } 를 가진 오류를 던짐
async function api(path, body) {
  let res;
  try {
    res = await fetch(path, body === undefined ? {} : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw { message: '서버에 연결하지 못했어요.', hint: '와이파이 연결과, 서버 컴퓨터가 켜져 있는지 확인해 주세요.' };
  }
  let data;
  try { data = await res.json(); } catch (e) { data = {}; }
  if (!res.ok || !data.ok) {
    throw { message: data.message || '알 수 없는 오류가 났어요.', hint: data.hint || '잠시 뒤 다시 해 보세요.' };
  }
  return data;
}

// 오류 상자 만들기
function errorBox(err) {
  return h('div', { class: 'error', role: 'alert' },
    h('div', {}, '⚠ ' + (err.message || '오류가 났어요.')),
    err.hint ? h('div', { class: 'hint' }, '→ ' + err.hint) : null);
}

// 큰 라이브러리 파일은 필요할 때만 불러옴 (처음 화면이 빨리 뜨게)
const loadedScripts = {};
function loadScript(src) {
  if (!loadedScripts[src]) {
    loadedScripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { delete loadedScripts[src]; reject({ message: '프로그램 파일을 불러오지 못했어요.', hint: '서버가 켜져 있는지, 와이파이가 연결됐는지 확인해 주세요.' }); };
      document.head.append(s);
    });
  }
  return loadedScripts[src];
}

// 카메라 켜기 (뒤쪽 카메라 우선). 실패하면 이유를 쉬운 말로 알려 줌
async function startCamera(video) {
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw { message: '이 주소에서는 카메라를 쓸 수 없어요.', hint: 'https:// 로 시작하는 주소(또는 이 컴퓨터의 localhost)로 들어와 주세요.' };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = stream;
    video.setAttribute('playsinline', ''); // 아이폰에서 화면 전체로 커지지 않게
    video.muted = true;
    await video.play();
    return stream;
  } catch (e) {
    if (e && e.name === 'NotAllowedError') throw { message: '카메라 사용이 허용되지 않았어요.', hint: '주소창의 자물쇠(또는 ⓘ) → 카메라 → 허용으로 바꾼 뒤 다시 해 주세요.' };
    if (e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError')) throw { message: '카메라를 찾지 못했어요.', hint: '카메라가 있는 기기에서 해 주세요. 지금은 "직접 찾기"를 써 주세요.' };
    if (e && e.name === 'NotReadableError') throw { message: '다른 프로그램이 카메라를 쓰고 있어요.', hint: '다른 앱을 닫고 다시 해 주세요.' };
    throw { message: '카메라를 켜지 못했어요.', hint: '화면을 새로 고친 뒤 다시 해 주세요.' };
  }
}

function stopCamera(stream) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
}

// 바코드 읽기 도구 (ZXing). 한 번만 만들어 씀
let barcodeReader = null;
async function getBarcodeReader() {
  await loadScript('/lib/zxing-browser.min.js');
  if (!barcodeReader) barcodeReader = new window.ZXingBrowser.BrowserMultiFormatReader();
  return barcodeReader;
}
// 캔버스(사진 한 장)에서 바코드 찾기. 없으면 null
function decodeBarcode(reader, canvas) {
  try { return reader.decodeFromCanvas(canvas).getText(); } catch (e) { return null; }
}

// 기구 상태 표시 (색깔 + 글자): 사용 가능 초록 / 사용 중 빨강 / 예약 대기 노랑 / 점검 중 회색
const STATUS_CLASS = { '사용 가능': 'ok', '사용 중': 'busy', '예약 대기': 'reserved', '점검 중': 'maint' };
function statusBadge(status) {
  return h('span', { class: 'status ' + (STATUS_CLASS[status] || '') }, status);
}

// 분 → "1시간 20분"
function durationText(totalMinutes) {
  const m = Math.max(0, Math.round(totalMinutes));
  const d = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), mm = m % 60;
  const parts = [];
  if (d) parts.push(`${d}일`);
  if (hh) parts.push(`${hh}시간`);
  if (mm || parts.length === 0) parts.push(`${mm}분`);
  return parts.join(' ');
}

// 받침에 맞는 조사 붙이기: josa('마이크로피펫', '이', '가') → '마이크로피펫이', josa('배양기', '을', '를') → '배양기를'
// 괄호로 끝나면 괄호 앞 글자를 봄 (예: '배양기 1번(창가)' → '번' → '배양기 1번(창가)을')
function josa(word, withBatchim, withoutBatchim) {
  const w = String(word || '');
  const last = w.replace(/\s*\([^()]*\)\s*$/, '').trim().slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  const hasBatchim = code >= 0 && code <= 11171 && code % 28 !== 0; // 한글이 아니면 받침 없는 것으로 봄
  return w + (hasBatchim ? withBatchim : withoutBatchim);
}

// 학번 뒤 두 자리 가리기
function maskId(id) {
  const s = String(id || '');
  return s.length <= 2 ? '**' : s.slice(0, -2) + '**';
}
