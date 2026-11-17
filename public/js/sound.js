// ─────────────────────────────────────────────
// 삐 소리 (Web Audio) — 소리 파일 없이 브라우저가 직접 소리를 만듭니다.
// ─────────────────────────────────────────────
// 브라우저는 사용자가 화면을 한 번 눌러야 소리를 낼 수 있게 해 줍니다.
// 그래서 처음에 "알림 소리 켜기" 버튼을 눌러 enableSound() 를 불러야 합니다.

let audioCtx = null;

// "알림 소리 켜기" 버튼을 눌렀을 때 부름
function enableSound() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  beep(1, 660); // 켜졌다는 확인 소리
}

function soundEnabled() {
  return !!audioCtx && audioCtx.state === 'running';
}

// times 번 삐 소리 (freq: 높이, 높을수록 날카로움)
function beep(times = 3, freq = 880) {
  if (!audioCtx) return;
  const start = audioCtx.currentTime;
  for (let i = 0; i < times; i++) {
    const t0 = start + i * 0.35;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    // 딱딱 끊기지 않게 소리를 살짝 키웠다가 줄임
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.26);
  }
}
