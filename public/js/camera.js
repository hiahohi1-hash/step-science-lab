// ─────────────────────────────────────────────
// "카메라로 찍기" 화면 (4번, 5-2, 11-2)
// ─────────────────────────────────────────────
// 1초에 약 4번 화면을 살펴봄:
//   ① 시약 바코드가 보이면 → 시약 흐름 (바코드가 기구 인식보다 먼저)
//   ② 바코드가 없으면 → 기구 사진 인식 (판정 규칙은 recognition-core.js)
// "라벨 글자 읽기" 버튼 → 사진 한 장의 글자를 읽어 카스 번호로 시약 찾기
// ※ 사진은 서버로 보내지 않습니다. 모두 태블릿 안에서 처리합니다.

const SCAN_INTERVAL_MS = 250;
let recConfig = null;            // 서버의 인식 설정 + 연결 표
let pendingRecognition = null;   // 사용자가 기구를 최종 확인하면 기록할 인식 결과

async function openScanner() {
  const video = h('video', { class: 'scan-video', playsinline: true, muted: true, autoplay: true });
  const status = h('div', { class: 'scan-status' }, '카메라를 켜는 중…');
  const msg = h('div');
  const practiceBox = h('div');
  const canvas = document.createElement('canvas');
  let stream = null;
  let timer = null;
  let stopped = false;
  let busy = false;

  const stop = () => { stopped = true; clearTimeout(timer); stopCamera(stream); };

  show(
    topNav('카메라로 찍기'),
    h('div', { class: 'scan-box' }, video, h('div', { class: 'scan-frame' })),
    status,
    h('p', { class: 'muted center' }, '시약 바코드나 기구 전체가 화면에 들어오게 비춰 주세요.'),
    msg,
    h('div', { class: 'row' },
      h('button', { onclick: () => readLabel(video, stream, msg, () => { stop(); }) }, '🔤 라벨 글자 읽기'),
      h('button', { onclick: () => { stop(); searchReagent(''); } }, '시약 직접 찾기'),
      h('button', { onclick: () => { stop(); pendingRecognition = null; searchEquipment(''); } }, '기구 직접 찾기')),
    practiceBox,
  );
  onLeave(stop); // 다른 화면으로 가면 카메라를 끔
  pendingRecognition = null;

  // 인식 설정·모델·바코드 도구 준비
  let classifier, reader, judge;
  try {
    recConfig = await api('/api/recognition/config?' + labParam());
    [classifier, reader] = await Promise.all([loadClassifier(recConfig), getBarcodeReader()]);
    judge = RecognitionCore.createJudge({
      threshold: recConfig.threshold,
      holdSeconds: recConfig.holdSeconds,
      candidateSeconds: recConfig.candidateSeconds,
      notEquipmentClass: recConfig.notEquipmentClass,
      knownClasses: Object.keys(recConfig.classes),
    });
    if (classifier.reset) classifier.reset();
    if (classifier.panel) practiceBox.replaceChildren(classifier.panel);
  } catch (err) {
    status.textContent = '';
    msg.replaceChildren(errorBox(err));
    return;
  }
  if (stopped) return;

  // 카메라 켜기 (실패해도 연습 모드면 기구 인식 흐름은 연습할 수 있게 계속)
  try {
    stream = await startCamera(video);
    if (stopped) return stopCamera(stream);
  } catch (err) {
    msg.replaceChildren(errorBox(err));
    if (classifier.kind !== 'fake') { status.textContent = ''; return; }
    status.textContent = '카메라 없이 연습 모드로 기구 인식만 해 볼 수 있어요.';
  }

  // ── 살펴보기 반복 ──
  async function scanOnce() {
    if (stopped || busy) return;
    busy = true;
    try {
      const hasVideo = stream && video.readyState >= 2 && video.videoWidth > 0;
      if (hasVideo) {
        // 사진 한 장 뜨기 (너무 크면 느리므로 가로 640 정도로)
        const scale = Math.min(1, 640 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

        // ① 바코드 먼저
        const code = decodeBarcode(reader, canvas);
        if (code) {
          stop();
          beep(1, 1200);
          return handleBarcode(code);
        }
      }
      // ② 기구 인식 (진짜 모델은 영상이 있어야 함)
      if (classifier.kind === 'fake' || hasVideo) {
        const predictions = await classifier.predict(hasVideo ? canvas : null);
        const r = judge.update(predictions, performance.now());
        if (r.type === 'decided') { stop(); return confirmRecognized(r, classifier.version); }
        if (r.type === 'candidates') { stop(); return showCandidates(r, classifier.version); }
        if (r.type === 'watching') status.textContent = `인식 중… ${nameOfClass(r.className)} ${Math.round(r.probability * 100)}%`;
        else status.textContent = '바코드나 기구를 찾는 중…'; // "기구 아님" → 아무 반응 없이 계속
      }
    } catch (e) {
      console.error(e);
    } finally {
      busy = false;
      if (!stopped) timer = setTimeout(scanOnce, SCAN_INTERVAL_MS);
    }
  }
  status.textContent = '바코드나 기구를 찾는 중…';
  scanOnce();
}

// 분류 이름 → 기구 이름 (예: autoclave → 고압 멸균기(오토클레이브))
function nameOfClass(className) {
  const units = recConfig && recConfig.classes[className];
  return units ? units[0].name : className;
}

// ═════════════════ 바코드 → 시약 ═════════════════
async function handleBarcode(code) {
  try {
    const { reagentId } = await api('/api/reagents/by-barcode/' + encodeURIComponent(code));
    confirmReagent(reagentId);
  } catch (err) {
    show(topNav('바코드'), errorBox(err),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: openScanner }, '다시 찍기 (라벨 글자 읽기)'),
        h('button', { onclick: () => searchReagent('') }, '시약 직접 찾기')));
  }
}

// ═════════════════ 라벨 글자 읽기 → 카스 번호 → 시약 ═════════════════
let ocrWorker = null;
async function readLabel(video, stream, msg, stopScan) {
  if (!stream || video.readyState < 2) {
    return msg.replaceChildren(errorBox({ message: '카메라가 켜져 있어야 글자를 읽을 수 있어요.', hint: '카메라가 없으면 "시약 직접 찾기"를 써 주세요.' }));
  }
  // 지금 화면을 크게 한 장 찍음 (글자는 해상도가 높아야 잘 읽힘)
  const shot = document.createElement('canvas');
  shot.width = video.videoWidth; shot.height = video.videoHeight;
  shot.getContext('2d').drawImage(video, 0, 0);
  stopScan();

  const progress = h('p', { class: 'center' }, '🔤 라벨 글자를 읽는 중… (처음에는 10초쯤 걸릴 수 있어요)');
  show(topNav('라벨 글자 읽기'), progress);
  try {
    await loadScript('/lib/tesseract.min.js');
    if (!ocrWorker) {
      // 엔진과 영어 글자 데이터를 모두 이 서버에서 받음 (인터넷 연결 없이 동작)
      ocrWorker = await Tesseract.createWorker('eng', 1, {
        workerPath: '/lib/tesseract-worker.min.js',
        corePath: '/lib/tesseract-core',
        langPath: '/lib/tessdata',
        workerBlobURL: false,
      });
      await ocrWorker.setParameters({ tessedit_char_whitelist: '0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .:' });
    }
    const { data } = await ocrWorker.recognize(shot);
    const r = await api('/api/reagents/find-by-text', { text: data.text });
    if (r.reagents.length === 1) return confirmReagent(r.reagents[0].id);
    if (r.reagents.length > 1) {
      return show(topNav('라벨 글자 읽기'), h('h2', {}, '어느 시약인가요?'),
        ...r.reagents.map((x) => h('button', { class: 'card clickable', style: 'width:100%', onclick: () => confirmReagent(x.id) }, `${x.name} (${x.cas_number})`)));
    }
    const why = r.casNumbers.length
      ? { message: `카스 번호 ${r.casNumbers.join(', ')} 는 읽었지만, 등록된 시약이 아니에요.`, hint: '이름으로 찾거나 선생님께 시약 등록을 부탁하세요.' }
      : { message: '라벨에서 올바른 카스 번호를 찾지 못했어요.', hint: '카스 번호(예: 7647-01-0)가 화면 가운데에 크고 또렷하게 보이게 다시 찍어 보세요.' };
    show(topNav('라벨 글자 읽기'), errorBox(why),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: openScanner }, '다시 찍기'),
        h('button', { onclick: () => searchReagent('') }, '시약 직접 찾기')));
  } catch (err) {
    show(topNav('라벨 글자 읽기'), errorBox(err.message ? err : { message: '글자를 읽지 못했어요.', hint: '다시 찍거나 "시약 직접 찾기"를 써 주세요.' }),
      h('div', { class: 'row' }, h('button', { onclick: openScanner }, '다시 찍기'), h('button', { onclick: () => searchReagent('') }, '시약 직접 찾기')));
  }
}

// ═════════════════ 11-2-5 결정됨 → "고압 멸균기가 맞나요?" ═════════════════
function confirmRecognized(r, version) {
  const units = recConfig.classes[r.className];
  const name = units[0].name;
  show(
    topNav('기구 인식'),
    h('div', { class: 'card center' },
      h('div', { class: 'big-name' }, name),
      h('p', { class: 'muted' }, `확신도 ${Math.round(r.confidence * 100)}%`)),
    h('h2', { class: 'center' }, `${josa(name, '이', '가')} 맞나요?`),
    h('div', { class: 'row' },
      h('button', {
        class: 'primary',
        onclick: () => {
          pendingRecognition = { predictedClass: r.className, confidence: r.confidence, top3: r.top3, decidedBy: '자동 결정', modelVersion: version };
          goToUnits(units);
        },
      }, '예'),
      h('button', { onclick: () => showCandidates(r, version, r.className) }, '아니오 (다른 후보 보기)')),
  );
}

// ═════════════════ 11-2-3 후보 상위 3개에서 고르기 ═════════════════
// exclude: "아니오"를 누른 기구는 후보에서 뺌
function showCandidates(r, version, exclude) {
  const top3 = (r.top3 || []).filter((c) => c.className !== exclude && recConfig.classes[c.className]);
  const base = { predictedClass: r.className, confidence: r.confidence, top3: r.top3, modelVersion: version };
  const summary = top3.map((c) => `${nameOfClass(c.className)} ${Math.round(c.probability * 100)}%`).join(', ');
  show(
    topNav('기구 인식'),
    h('h2', {}, '어느 기구인가요?'),
    top3.length ? h('p', {}, `후보: ${summary}`) : h('p', {}, '확실한 후보가 없어요.'),
    ...top3.map((c) => h('button', {
      class: 'card clickable cand-btn',
      onclick: () => { pendingRecognition = { ...base, decidedBy: '후보에서 선택' }; goToUnits(recConfig.classes[c.className]); },
    }, h('strong', {}, nameOfClass(c.className)), h('span', { class: 'muted' }, ` ${Math.round(c.probability * 100)}%`))),
    h('div', { class: 'row', style: 'margin-top:12px' },
      h('button', { onclick: () => { pendingRecognition = { ...base, decidedBy: '직접 찾기' }; searchEquipment(''); } }, '목록에 없어요 → 기구 직접 찾기'),
      h('button', { onclick: openScanner }, '다시 찍기')),
  );
  // searchEquipment 가 화면을 바꿔도 pendingRecognition 은 유지되어, 기구를 고르면 '직접 찾기'로 기록됨
}

// 11-2-6 같은 종류가 여러 대면 "1번(창가) / 2번(문 쪽)" 고르기
function goToUnits(units) {
  if (units.length > 1) chooseUnit(units);
  else openEquipment(units[0].id);
}

// 기구 화면이 열릴 때 부름: 인식으로 들어왔으면 최종 확인한 기구와 함께 기록 (11-4)
function logRecognitionIfAny(equipmentId) {
  if (!pendingRecognition) return;
  const data = { ...pendingRecognition, confirmedEquipmentId: equipmentId };
  pendingRecognition = null;
  api('/api/recognition/log', data).catch(() => { /* 기록 실패는 학생 흐름을 막지 않음 */ });
}
