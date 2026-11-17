// ─────────────────────────────────────────────
// 기구 사진 분류 모델 불러오기 (11-1)
// ─────────────────────────────────────────────
// - public/model/model.json 이 있으면 → 티처블 머신 진짜 모델
// - 없으면 → 연습용 가짜 모델 (화면의 "연습 모드" 상자에서 결과를 직접 정함)
// 진짜 모델 파일만 넣으면 코드를 고치지 않아도 자동으로 바뀝니다.

// 15단계: 실험실마다 모델이 다름 → 모델 주소(또는 연습 모드 + 실험실)별로 한 번씩만 불러옴
const classifierCache = {};

function loadClassifier(config) {
  // 18단계: 모델을 다시 학습하면 버전이 바뀜 → 버전까지 열쇠에 넣어 새 모델을 다시 불러옴
  const key = config.modelBase ? config.modelBase + '|' + (config.modelVersion || '') : 'fake:' + Object.keys(config.classes).sort().join(',');
  if (!classifierCache[key]) classifierCache[key] = createClassifier(config).catch((e) => { delete classifierCache[key]; throw e; });
  return classifierCache[key];
}

// 서버가 알려 준 모델 주소(config.modelBase)가 있으면 진짜 모델, 없으면 연습 모드
async function createClassifier(config) {
  if (config.modelBase) return createRealClassifier(config.modelBase);
  return createFakeClassifier(config);
}

// ── 진짜 모델 (티처블 머신 → 텐서플로 자바스크립트) ──
async function createRealClassifier(base) {
  try {
    await loadScript('/lib/tf-1.3.1.min.js');
    await loadScript('/lib/teachablemachine-image-0.8.5.min.js');
    // ?t= : 다시 학습한 새 모델 파일을 브라우저가 예전 것(캐시)으로 읽지 않게
    const t = '?t=' + Date.now();
    const model = await window.tmImage.load(base + 'model.json' + t, base + 'metadata.json' + t);
    const meta = await fetch(base + 'metadata.json' + t).then((r) => r.json()).catch(() => ({}));
    // 모델 버전: 티처블 머신이 적어 둔 이름 + 만든 시각 (인식 기록에서 모델을 구분하는 데 씀)
    const version = `${meta.modelName || 'model'} ${meta.timeStamp || ''}`.trim().slice(0, 80);
    return {
      kind: 'real',
      version,
      labels: model.getClassLabels(),
      // 화면 속 사진 한 장을 분류 → [{ className, probability }]
      predict: (source) => model.predict(source),
    };
  } catch (e) {
    throw { message: '기구 인식 모델을 불러오지 못했어요.', hint: '그 실험실 모델 폴더(public/model/실험실코드)의 model.json, metadata.json, weights.bin 세 파일이 티처블 머신에서 함께 내보낸 것인지 확인해 주세요.' };
  }
}

// ── 연습용 가짜 모델 ──
// 연습 모드 상자에서 고른 기구와 확신도대로 결과를 냄. "흔들림"을 켜면 결과가 계속 바뀜 (후보 화면 연습용)
function createFakeClassifier(config) {
  const labels = [...Object.keys(config.classes), config.notEquipmentClass];
  const state = { className: config.notEquipmentClass, confidence: 0.95, wobble: false };

  const select = h('select', { 'aria-label': '보이는 척할 기구' }, ...labels.map((c) => {
    const units = config.classes[c];
    return h('option', { value: c }, units ? `${units[0].name} (${c})` : `기구 아님 (${c})`);
  }));
  select.value = state.className;
  const slider = h('input', { type: 'range', min: 30, max: 100, step: 1, value: 95, 'aria-label': '확신도' });
  const sliderText = h('span', {}, '95%');
  const wobble = h('input', { type: 'checkbox', id: 'fake-wobble' });
  select.addEventListener('change', () => { state.className = select.value; });
  slider.addEventListener('input', () => { state.confidence = slider.value / 100; sliderText.textContent = slider.value + '%'; });
  wobble.addEventListener('change', () => { state.wobble = wobble.checked; });

  const panel = h('div', { class: 'practice-panel' },
    h('strong', {}, '🧪 연습 모드 (진짜 모델 파일이 아직 없어요)'),
    h('div', { class: 'muted small' }, (config.modelFolder || 'public/model/실험실코드/') + ' 폴더에 티처블 머신 모델을 넣으면 이 상자는 사라져요.'),
    h('label', {}, '카메라에 보이는 척할 것'), select,
    h('label', {}, '확신도 ', sliderText), slider,
    h('label', { for: 'fake-wobble' }, wobble, '결과가 계속 바뀜 (흔들림)'));

  let tick = 0;
  return {
    kind: 'fake',
    version: '연습용',
    labels,
    panel,
    // 카메라 화면을 새로 열 때마다 "기구 아님 95%" 로 되돌림 (지난 연습 결과가 섞이지 않게)
    reset: () => {
      state.className = config.notEquipmentClass; state.confidence = 0.95; state.wobble = false;
      select.value = state.className; slider.value = 95; sliderText.textContent = '95%'; wobble.checked = false;
    },
    predict: async () => {
      tick += 1;
      let main = state.className;
      // 흔들림: 2번에 1번은 다른 기구로 바뀜
      if (state.wobble && tick % 2 === 0) {
        const others = labels.filter((l) => l !== main && l !== config.notEquipmentClass);
        if (others.length) main = others[tick % others.length];
      }
      const rest = (1 - state.confidence) / Math.max(1, labels.length - 1);
      return labels.map((l) => ({ className: l, probability: l === main ? state.confidence : rest }));
    },
  };
}
