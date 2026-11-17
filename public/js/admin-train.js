// ─────────────────────────────────────────────
// 18단계: 관리자 화면 — 학습 사진 보기·올리기·지우기, [모델 다시 학습]
// ─────────────────────────────────────────────
// 학습 방법 (티처블 머신과 같은 방식)
//  - 지금 모델의 앞부분(MobileNet: 사진 → 숫자 1280개)은 그대로 씀
//  - 뒷부분(숫자 1280개 → 어떤 기구인지)만 모아 둔 사진으로 새로 학습
//  - 학습은 이 관리자 컴퓨터의 브라우저에서 하고, 다 되면 모델 파일만 서버로 보냄
// admin.js 의 h, adminApi, flash, table, td, editing, renderTab 을 함께 씀

const TRAIN = { epochs: 50, batchSize: 16, learningRate: 0.001, valRatio: 0.15 };
let sampleUrl = (lab, c, f) => `/api/admin/training/file?lab=${lab}&class=${encodeURIComponent(c)}&file=${encodeURIComponent(f)}`;

// 사진 하나 불러오기
function loadImage(src) {
  return new Promise((ok, no) => { const img = new Image(); img.onload = () => ok(img); img.onerror = () => no(new Error('사진을 불러오지 못했어요: ' + src)); img.src = src; });
}
// 가운데 정사각형을 size×size 캔버스로 (태블릿이 보내는 사진과 같은 모양)
function cropSquare(img, size = 224, canvas = document.createElement('canvas')) {
  const w = img.naturalWidth || img.width, hh = img.naturalHeight || img.height, s = Math.min(w, hh);
  canvas.width = canvas.height = size;
  canvas.getContext('2d').drawImage(img, (w - s) / 2, (hh - s) / 2, s, s, 0, 0, size, size);
  return canvas;
}
function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ── 모델 연결 탭에 붙는 "학습 사진과 다시 학습" 카드 ──
async function trainingCard(lab) {
  const v = await adminApi('/training?lab=' + lab);
  const out = h('div');
  const log = h('pre', { class: 'train-log' });
  const viewer = h('div');

  // 분류별 사진 장수 표
  const rows = v.classes.map((c) => h('tr', { class: c.count && !c.trainable ? 'overdue-row' : '' },
    td(h('code', {}, c.className), c.isNotEquipment ? h('div', { class: 'small' }, '기구 아님') : null),
    td(c.equipment.length ? c.equipment.join(', ') : (c.isNotEquipment ? '-' : h('span', { class: 'muted' }, '연결된 기구 없음'))),
    td(`${c.count}장`, c.count && c.count < v.minPerClass ? h('div', { class: 'small' }, `${v.minPerClass}장부터 학습에 들어가요`) : null),
    td(c.count ? h('button', { onclick: () => showSamples(lab, c.className, viewer) }, '사진 보기') : '')));

  // 사진 직접 올리기 (주로 "기구 아님")
  const targets = v.classes.filter((c) => c.isNotEquipment || c.equipment.length);
  const pick = h('select', {}, ...targets.map((c) => h('option', { value: c.className }, c.isNotEquipment ? `${c.className} (기구 아님)` : `${c.className} (${c.equipment[0]})`)));
  const notEq = targets.find((c) => c.isNotEquipment);
  if (notEq) pick.value = notEq.className;
  const files = h('input', { type: 'file', accept: 'image/*', multiple: true });
  const upBtn = h('button', {
    onclick: async () => {
      if (!files.files.length) return flash({ message: '올릴 사진을 골라 주세요.' }, true);
      editing = true;
      try {
        const list = [...files.files];
        let done = 0;
        for (let i = 0; i < list.length; i += 10) {
          const dataUrls = [];
          for (const f of list.slice(i, i + 10)) {
            const url = URL.createObjectURL(f);
            try { dataUrls.push(cropSquare(await loadImage(url)).toDataURL('image/jpeg', 0.85)); } finally { URL.revokeObjectURL(url); }
          }
          await adminApi('/training/upload', { labId: lab, className: pick.value, dataUrls });
          done += dataUrls.length;
          log.textContent = `사진 올리는 중… ${done}/${list.length}`;
        }
        editing = false; flash(`사진 ${done}장을 "${pick.value}"에 넣었어요.`); renderTab();
      } catch (err) { editing = false; flash(err, true); }
    },
  }, '사진 올리기');

  const trainBtn = h('button', {
    class: 'primary',
    onclick: async () => {
      if (!confirm('모아 둔 사진으로 이 실험실 모델을 다시 학습할까요?\n1~3분쯤 걸리고, 그동안 이 탭을 닫지 마세요.')) return;
      trainBtn.disabled = true;
      editing = true; // 학습하는 동안 실시간 소식으로 화면이 다시 그려지지 않게
      try {
        const r = await retrainModel(lab, (t) => { log.textContent = t; });
        editing = false;
        flash(`새 모델을 저장했어요. 검증 정확도 ${Math.round(r.valAccuracy * 100)}% (사진 ${r.count}장, 분류 ${r.labels.length}개). 태블릿은 카메라 화면을 다시 열면 새 모델을 써요.`);
        renderTab();
      } catch (err) {
        editing = false; trainBtn.disabled = false;
        log.textContent += '\n✖ ' + (err.message || err);
        flash(err.message ? err : { message: String(err) }, true);
      }
    },
  }, '🧠 모델 다시 학습');
  if (!v.hasBaseModel) trainBtn.disabled = true;

  out.append(h('div', { class: 'card' },
    h('h2', { style: 'margin-top:0' }, `📸 학습 사진과 모델 다시 학습 (${v.lab.name})`),
    h('p', { class: 'muted small' },
      `태블릿에서 학생이 "맞아요" 또는 다른 기구로 확인한 사진이 자동으로 여기에 모여요 (지금 ${v.collect ? '모으는 중' : '모으지 않음 — 설정 탭에서 켤 수 있어요'}). `,
      '사진이 쌓이면 [모델 다시 학습]만 누르면 돼요. 티처블 머신에서 다시 내보낼 필요가 없어요.'),
    table(['분류 이름', '연결된 기구', '사진', ''], rows),
    h('p', {}, `모두 ${v.total}장`),
    h('div', { class: 'row-actions' }, h('label', {}, '사진 직접 넣기: '), pick, files, upBtn),
    h('p', { class: 'muted small' }, '"기구 아님" 사진(바닥, 벽, 책상, 사람, 시약병, 목록에 없는 기기)도 꼭 넣어 주세요. 없으면 아무 데나 비춰도 기구라고 착각해요.'),
    h('div', { class: 'row-actions', style: 'margin-top:10px' },
      trainBtn,
      v.backups ? action('↩ 이전 모델로 되돌리기', () => adminApi('/model/rollback', { labId: lab }), { confirm: '바로 전 모델로 되돌릴까요?', done: '이전 모델로 되돌렸어요.' }) : null),
    !v.hasBaseModel ? h('p', { class: 'small' }, '⚠ 처음 한 번은 티처블 머신에서 만든 모델을 이 실험실 모델 폴더에 넣어야 해요 (사진을 숫자로 바꾸는 앞부분이 필요해요).') : null,
    log),
  viewer);
  return out;
}

// 분류 하나의 사진 보기 (잘못 들어간 사진 지우기)
async function showSamples(lab, className, box) {
  const { files } = await adminApi(`/training/list?lab=${lab}&class=${encodeURIComponent(className)}`);
  const shown = files.slice(0, 200);
  const checks = shown.map((f) => ({ f, cb: h('input', { type: 'checkbox', 'aria-label': f }) }));
  const del = h('button', {
    onclick: async () => {
      const sel = checks.filter((x) => x.cb.checked).map((x) => x.f);
      if (!sel.length) return flash({ message: '지울 사진을 골라 주세요.' }, true);
      if (!confirm(`사진 ${sel.length}장을 지울까요? 되돌릴 수 없어요.`)) return;
      try { const r = await adminApi('/training/delete', { labId: lab, className, files: sel }); flash(`${r.deleted}장을 지웠어요.`); renderTab(); } catch (err) { flash(err, true); }
    },
  }, '선택한 사진 지우기');
  box.replaceChildren(h('div', { class: 'card' },
    h('h2', { style: 'margin-top:0' }, `"${className}" 사진 ${files.length}장`, files.length > shown.length ? ` (새것 ${shown.length}장만 표시)` : ''),
    h('p', { class: 'muted small' }, '이 기구가 아닌 사진(다른 기구, 바닥만 찍힌 것 등)을 골라 지우면 학습이 더 정확해져요.'),
    h('div', { class: 'thumb-grid' }, ...checks.map(({ f, cb }) => h('label', { class: 'thumb' }, h('img', { src: sampleUrl(lab, className, f), loading: 'lazy', alt: '' }), cb))),
    h('div', { class: 'row-actions' }, del, h('button', { onclick: () => box.replaceChildren() }, '닫기'))));
  box.scrollIntoView({ behavior: 'smooth' });
}

// ── 다시 학습 (브라우저 안에서) ──
async function retrainModel(lab, say) {
  say('학습할 사진 목록을 받는 중…');
  const set = await adminApi('/training/set?lab=' + lab);
  const cfg = await api('/api/recognition/config?lab=' + lab);
  if (!cfg.modelBase) throw new Error('이 실험실에 기본 모델이 없어요. 티처블 머신 모델을 먼저 넣어 주세요.');
  await loadScript('/lib/tf-1.3.1.min.js');

  say('지금 모델을 불러오는 중…');
  const base = await tf.loadLayersModel(cfg.modelBase + 'model.json?t=' + Date.now());
  const feature = base.layers[0]; // 사진 → 숫자들 (MobileNet 부분)
  const outShape = feature.outputShape;
  if (base.layers.length !== 2 || !Array.isArray(outShape) || outShape.length !== 2) throw new Error('티처블 머신에서 만든 모델 모양이 아니에요.');
  const dim = outShape[1];
  const labels = set.labels;
  const index = Object.fromEntries(labels.map((l, i) => [l, i]));

  // ① 사진마다 숫자 1280개 뽑기
  const n = set.files.length;
  const X = new Float32Array(n * dim);
  const Y = new Int32Array(n);
  const canvas = document.createElement('canvas');
  for (let i = 0; i < n; i++) {
    const { c, f } = set.files[i];
    const img = await loadImage(sampleUrl(lab, c, f));
    cropSquare(img, 224, canvas);
    const emb = tf.tidy(() => feature.predict(tf.browser.fromPixels(canvas).toFloat().div(tf.scalar(127)).sub(tf.scalar(1)).expandDims(0)));
    X.set(await emb.data(), i * dim);
    emb.dispose();
    Y[i] = index[c];
    if (i % 20 === 0 || i === n - 1) say(`① 사진 특징 뽑는 중… ${i + 1}/${n}`);
  }

  // ② 섞어서 학습용 85% / 검증용 15% 로 나누기 (분류마다 같은 비율)
  const order = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const trainIdx = [], valIdx = [], seen = {};
  const perClass = labels.map((_, k) => order.filter((i) => Y[i] === k).length);
  for (const i of order) {
    const k = Y[i]; seen[k] = (seen[k] || 0) + 1;
    (seen[k] <= Math.max(1, Math.round(perClass[k] * TRAIN.valRatio)) ? valIdx : trainIdx).push(i);
  }
  const pickX = (idx) => { const a = new Float32Array(idx.length * dim); idx.forEach((i, r) => a.set(X.subarray(i * dim, (i + 1) * dim), r * dim)); return tf.tensor2d(a, [idx.length, dim]); };
  const pickY = (idx) => tf.oneHot(tf.tensor1d(idx.map((i) => Y[i]), 'int32'), labels.length).toFloat();
  const xTrain = pickX(trainIdx), yTrain = pickY(trainIdx), xVal = pickX(valIdx), yVal = pickY(valIdx);

  // ③ 뒷부분(판단하는 부분) 새로 학습 — 티처블 머신과 같은 구조 (100칸 → 분류 수)
  // 이름을 직접 정함: 자동 이름(sequential_1 등)이 앞부분 이름과 겹치면 저장한 모델을 다시 불러올 때 뒤섞임
  const tag = 'scilab' + Date.now();
  const head = tf.sequential({ name: tag + '_head' });
  head.add(tf.layers.dense({ name: tag + '_dense1', inputShape: [dim], units: 100, activation: 'relu', kernelInitializer: 'varianceScaling', useBias: true }));
  head.add(tf.layers.dense({ name: tag + '_dense2', units: labels.length, activation: 'softmax', kernelInitializer: 'varianceScaling', useBias: false }));
  head.compile({ optimizer: tf.train.adam(TRAIN.learningRate), loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
  // 한 번(에포크)씩 나눠 학습: 학습 도구는 원래 "화면 그리기"에 맞춰 쉬어 가는데,
  // 관리자가 다른 탭을 보면 화면 그리기가 멈춰 학습도 멈춤 → yieldEvery:'never' + 우리가 직접 잠깐씩 쉼
  for (let e = 0; e < TRAIN.epochs; e++) {
    const hist = await head.fit(xTrain, yTrain, { epochs: 1, batchSize: TRAIN.batchSize, shuffle: true, validationData: [xVal, yVal], yieldEvery: 'never' });
    const logs = Object.fromEntries(Object.entries(hist.history).map(([k, v]) => [k, v[0]]));
    say(`② 학습 중… ${e + 1}/${TRAIN.epochs}회  학습 정확도 ${Math.round((logs.acc ?? logs.accuracy) * 100)}%  검증 정확도 ${Math.round((logs.val_acc ?? logs.val_accuracy) * 100)}%`);
    await new Promise((ok) => setTimeout(ok, 0));
  }

  // ④ 검증용 사진으로 분류별 정확도
  const pred = await tf.tidy(() => head.predict(xVal).argMax(-1)).data();
  const per = labels.map(() => ({ ok: 0, all: 0 }));
  valIdx.forEach((i, r) => { per[Y[i]].all += 1; if (pred[r] === Y[i]) per[Y[i]].ok += 1; });
  const okAll = per.reduce((s, p) => s + p.ok, 0), all = per.reduce((s, p) => s + p.all, 0);
  const valAccuracy = all ? okAll / all : 0;
  const report = labels.map((l, k) => `  ${l}: ${per[k].ok}/${per[k].all}`).join('\n');
  [xTrain, yTrain, xVal, yVal].forEach((t) => t.dispose());

  // ⑤ 앞부분 + 새 뒷부분을 합쳐 저장
  say(`③ 저장하는 중… 검증 정확도 ${Math.round(valAccuracy * 100)}%\n${report}`);
  const full = tf.sequential({ name: tag + '_model' });
  full.add(feature);
  full.add(head);
  let art = null;
  await full.save(tf.io.withSaveHandler(async (a) => { art = a; return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } }; }));
  await adminApi('/model/save', {
    labId: lab, labels, imageCount: n, valAccuracy,
    modelJson: { modelTopology: art.modelTopology, weightsManifest: [{ paths: ['weights.bin'], weights: art.weightSpecs }] },
    weightsBase64: bufferToBase64(art.weightData),
  });
  say(`✔ 완료! 사진 ${n}장 · 분류 ${labels.length}개 · 검증 정확도 ${Math.round(valAccuracy * 100)}%\n분류별 검증 결과 (맞힘/검증 사진)\n${report}` +
    (set.skipped.length ? `\n※ 사진이 적어 이번 학습에서 빠진 분류: ${set.skipped.map((s) => `${s.className}(${s.count}장)`).join(', ')}` : ''));
  return { valAccuracy, count: n, labels };
}
