// ─────────────────────────────────────────────
// 처음 실행할 때 넣는 예시 데이터 (시약, 기구, 모델 분류 연결, 기본 설정)
// ─────────────────────────────────────────────
// 표가 비어 있을 때만 넣습니다. 관리자가 고치거나 지운 내용은 다시 덮어쓰지 않습니다.

// 예시 내용 맨 위에 붙이는 표시 (7-1)
const SAMPLE_NOTICE = '⚠ 학교 기구 설명서를 보고 담당 교사가 검토해야 하는 예시 내용입니다';

// ── 예시 시약 10가지 (5-1) ──
// 보관 위치와 병 수는 명세에 없어서 임시 값입니다. 관리자 화면(7단계)에서 실제 값으로 고쳐 주세요.
const SAMPLE_REAGENTS = [
  ['염산',         '7647-01-0', '고위험'],
  ['황산',         '7664-93-9', '고위험'],
  ['질산',         '7697-37-2', '고위험'],
  ['수산화나트륨', '1310-73-2', '고위험'],
  ['질산은',       '7761-88-8', '고위험'],
  ['에탄올',       '64-17-5',   '일반'],
  ['아세톤',       '67-64-1',   '일반'],
  ['염화나트륨',   '7647-14-5', '일반'],
  ['페놀프탈레인', '77-09-8',   '일반'],
  ['과산화수소',   '7722-84-1', '일반'],
];

// ── 예시 기구 (7-1) ──
// classes: 이 기구와 연결할 티처블 머신 분류 이름 (11-3)
// units:   같은 종류가 여러 대면 구분 이름 목록 (배양기만 2대로 정함)
const SAMPLE_EQUIPMENT = [
  {
    name: '고압 멸균기(오토클레이브)',
    className: 'autoclave',
    units: [''],
    location: '과학실 뒤쪽',
    maxMinutes: 120,
    isDangerous: 1,
    timeOptions: [
      { label: '멸균 20분 과정 (총 1시간)', minutes: 60 },
      { label: '멸균 30분 과정 (총 1시간 20분)', minutes: 80 },
    ],
    howto: [
      SAMPLE_NOTICE,
      '1. 내열 장갑과 보안경을 착용합니다.',
      '2. 기구 안쪽 바닥의 물 양을 확인합니다. 물이 표시선보다 적으면 정제수(증류수)를 표시선까지 채웁니다. 수돗물은 넣지 않습니다.',
      '3. 넣을 물건을 확인합니다. 병은 뚜껑을 반쯤 풀어 두거나 솜마개·알루미늄 포일로 막습니다. 꽉 잠근(밀봉된) 병은 절대 넣지 않습니다.',
      '4. 멸균 테이프를 붙이고, 물건끼리 너무 빽빽하지 않게 바구니에 넣습니다. 액체는 용기의 2/3 이하만 채웁니다.',
      '5. 뚜껑의 고무 패킹에 이물질이 없는지 보고, 뚜껑을 닫은 뒤 잠금 장치를 끝까지 잠급니다.',
      '6. 배기 밸브(공기 빼는 밸브)가 기구 설명서대로 맞춰져 있는지 확인합니다.',
      '7. 온도를 121℃, 시간을 고른 과정(20분 또는 30분)으로 설정하고 시작 버튼을 누릅니다.',
      '8. 작동 중에는 뚜껑을 열거나 잠금 장치를 건드리지 않습니다. 압력계와 온도계가 정상으로 올라가는지 처음 몇 분 동안 지켜봅니다.',
      '9. 끝났다는 신호가 나와도 바로 열지 않습니다. 압력계가 0이 되고, 온도가 충분히 내려갈 때까지(기구 설명서 기준, 보통 80℃ 이하) 기다립니다.',
      '10. 내열 장갑을 낀 채 얼굴을 뚜껑에서 멀리 두고 천천히 엽니다. 뜨거운 김이 나올 수 있습니다.',
      '11. 액체가 든 병은 갑자기 끓어 넘칠 수 있으니 흔들지 말고 천천히 꺼내 식힙니다.',
      '12. 멸균 테이프 색이 바뀌었는지 확인하고, 사용 기록을 마칩니다.',
    ],
    checklist: [
      '물 양을 확인했다 (표시선까지, 정제수 사용)',
      '밀봉된(꽉 잠근) 병을 넣지 않았다',
      '넣으면 안 되는 물건(인화성 물질, 표백제, 일부 플라스틱 등)을 넣지 않았다',
      '뚜껑을 끝까지 잠갔다',
      '내열 장갑과 보안경을 준비했다',
    ],
    cautions: [
      SAMPLE_NOTICE,
      '압력이 0이 되고 온도가 충분히 내려가기 전에는 절대 뚜껑을 열지 않습니다. 화상과 폭발 위험이 있습니다.',
      '밀봉된 병, 인화성 물질, 표백제(차아염소산), 고온에 녹는 플라스틱은 넣지 않습니다.',
      '작동 중 이상한 소리, 김 새는 소리, 압력이 비정상으로 오르면 전원을 끄고 즉시 담당 선생님께 알립니다.',
      '물 없이 작동시키지 않습니다 (기구 고장, 화재 위험).',
      '혼자 처음 사용할 때는 반드시 선생님과 함께 사용합니다.',
    ],
  },
  {
    name: '배양기',
    className: 'incubator',
    units: ['1번(창가)', '2번(문 쪽)'],
    location: '과학실 창가 / 문 쪽',
    maxMinutes: 72 * 60,
    isDangerous: 0,
    timeOptions: [
      { label: '12시간', minutes: 12 * 60 },
      { label: '24시간', minutes: 24 * 60 },
      { label: '48시간', minutes: 48 * 60 },
    ],
    howto: [
      SAMPLE_NOTICE,
      '1. 화면에 표시된 설정 온도가 실험에 맞는지 확인합니다 (예: 37℃). 다른 사람의 설정을 함부로 바꾸지 않습니다.',
      '2. 배양 접시나 시험관에 이름, 날짜, 내용물을 적은 라벨을 붙입니다.',
      '3. 배양 접시는 뚜껑이 아래로 가게 뒤집어 넣습니다 (물방울이 떨어지지 않게).',
      '4. 문은 빨리 열고 닫아 안쪽 온도가 변하지 않게 합니다.',
      '5. 끝나면 내 물건을 모두 꺼내고, 흘린 것이 있으면 소독용 에탄올로 닦습니다.',
    ],
    checklist: [
      '설정 온도를 확인했다',
      '내 배양물에 이름·날짜 라벨을 붙였다',
      '다른 사람의 배양물을 건드리지 않았다',
    ],
    cautions: [
      SAMPLE_NOTICE,
      '미생물 배양물은 뚜껑을 열지 않은 채로 다루고, 다 쓴 배양물은 멸균한 뒤 버립니다.',
      '배양기 안에서 흘린 것은 바로 닦고 선생님께 알립니다.',
    ],
  },
  {
    name: '원심분리기',
    className: 'centrifuge',
    units: [''],
    location: '실험대 위',
    maxMinutes: 60,
    isDangerous: 0,
    timeOptions: [
      { label: '10분', minutes: 10 },
      { label: '20분', minutes: 20 },
      { label: '30분', minutes: 30 },
    ],
    howto: [
      SAMPLE_NOTICE,
      '1. 튜브에 같은 양을 담아 무게를 맞춥니다. 튜브가 하나뿐이면 물을 담은 튜브를 하나 더 만듭니다.',
      '2. 튜브를 서로 마주 보는 자리에 넣어 균형을 맞춥니다.',
      '3. 뚜껑을 닫고 속도와 시간을 설정한 뒤 시작합니다.',
      '4. 완전히 멈출 때까지 뚜껑을 열지 않습니다.',
    ],
    checklist: [
      '튜브 무게(양)를 맞췄다',
      '튜브를 마주 보는 자리에 넣었다',
      '뚜껑을 닫았다',
    ],
    cautions: [
      SAMPLE_NOTICE,
      '균형이 맞지 않으면 기계가 심하게 흔들리고 고장 날 수 있습니다. 흔들리면 바로 정지 버튼을 누릅니다.',
      '돌고 있는 동안 뚜껑을 열거나 손을 넣지 않습니다.',
    ],
  },
  {
    name: '건조기',
    className: 'dryer',
    units: [''],
    location: '과학실 뒤쪽',
    maxMinutes: 8 * 60,
    isDangerous: 0,
    timeOptions: [
      { label: '1시간', minutes: 60 },
      { label: '2시간', minutes: 120 },
      { label: '4시간', minutes: 240 },
    ],
    howto: [
      SAMPLE_NOTICE,
      '1. 넣을 유리 기구의 물기를 털어 냅니다.',
      '2. 설정 온도를 확인합니다 (예: 유리 기구 건조 105℃).',
      '3. 기구를 선반에 넣고 문을 닫은 뒤 시작합니다.',
      '4. 꺼낼 때는 내열 장갑을 낍니다.',
    ],
    checklist: [
      '에탄올·아세톤 같은 인화성 물질이 묻은 기구를 넣지 않았다',
      '플라스틱 기구를 넣지 않았다',
      '내열 장갑을 준비했다',
    ],
    cautions: [
      SAMPLE_NOTICE,
      '인화성 물질이 묻은 기구는 불이 날 수 있으니 넣지 않습니다.',
      '꺼낸 기구는 매우 뜨겁습니다. 식을 때까지 맨손으로 만지지 않습니다.',
    ],
  },
  {
    name: '무균 작업대(클린벤치)',
    className: 'clean_bench',
    units: [''],
    location: '준비실',
    maxMinutes: 3 * 60,
    isDangerous: 0,
    timeOptions: [
      { label: '30분', minutes: 30 },
      { label: '1시간', minutes: 60 },
      { label: '2시간', minutes: 120 },
    ],
    howto: [
      SAMPLE_NOTICE,
      '1. 자외선(UV) 등이 켜져 있으면 끈 뒤에 앞 유리를 엽니다.',
      '2. 송풍(바람) 스위치를 켜고 몇 분 기다립니다.',
      '3. 작업대 바닥을 소독용 에탄올(70%)로 닦습니다.',
      '4. 작업이 끝나면 물건을 모두 꺼내고 다시 에탄올로 닦은 뒤 유리를 닫습니다.',
    ],
    checklist: [
      '자외선 등을 껐다',
      '송풍을 켰다',
      '작업대를 소독용 에탄올로 닦았다',
    ],
    cautions: [
      SAMPLE_NOTICE,
      '자외선 등이 켜진 상태에서 들여다보거나 손을 넣지 않습니다 (눈과 피부 손상).',
      '에탄올 근처에서 불(알코올램프, 라이터)을 쓰지 않습니다.',
    ],
  },
];

// ── 기본 설정 (8번 설정 + 11번 인식 설정) ──
const DEFAULT_SETTINGS = {
  normal_max_loan_hours: '72',        // 일반 시약 최장 반출 시간
  normal_min_loan_hours: '1',         // 일반 시약 최소 반출 시간
  extend_max_hours: '24',             // 시약 연장 최대 시간
  high_risk_return_time: '18:00',     // 고위험 시약 반납 시각 (이후 반출 금지)
  high_risk_approval_minutes: '30',   // 고위험 승인 대기 자동 취소 시간
  reservation_priority_minutes: '10', // 예약 대기 우선 시간
  ending_soon_minutes: '10',          // "곧 사용 가능" 표시 시점
  just_finished_notice_minutes: '30', // "방금 사용이 끝났습니다" 안내 시간
  queue_enabled: '0',                 // 기구 대기 기능 (0: 끔 — 지금 누가 쓰는지만 보여 줌, 1: 켬) — 학교 의견으로 기본 끔
  anonymize_after_year: '0',          // 1년 지난 기록 학번·이름 지우기 (0: 끔, 1: 켬)
  not_equipment_class: 'not_equipment', // "기구 아님" 분류 이름 (11-3)
  recognition_threshold: '0.8',       // 자동 결정 확신도 기준 80%
  recognition_hold_seconds: '2',      // 같은 결과가 이어져야 하는 시간
  recognition_candidate_seconds: '5', // 결정 안 되면 후보 3개를 보여 줄 때까지 시간
  // 16단계: 주제 추천에서 "같은 뜻"으로 볼 말 묶음 (한 줄 = 한 묶음, 쉼표로 구분). 관리자 설정에서 고칠 수 있음
  recommend_synonyms: [
    '세균, 박테리아, 미생물, 균, 유산균, 젖산균',
    '효모, 이스트',
    '곰팡이, 균류',
    '효소, 카탈레이스, 아밀레이스',
    'DNA, 디엔에이, 유전자, 유전 물질',
    '온도, 가열, 열, 고온',
    '희석, 농도, 묽히기',
    '무균, 멸균, 소독, 살균',
    '배양, 키우기, 증식, 생장',
    '분리, 추출, 거르기',
  ].join('\n'),
};

// 표가 비어 있으면 예시 데이터를 넣음
function seedIfEmpty(db) {
  // 한꺼번에 처리 (중간에 오류가 나면 아무것도 안 들어간 상태로 되돌림)
  const run = db.transaction(() => {
    // 설정: 없는 항목만 채움 (나중에 새 설정이 생겨도 자동으로 추가됨)
    const addSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) addSetting.run(k, v);

    // 시약
    if (db.prepare('SELECT COUNT(*) AS n FROM reagents').get().n === 0) {
      const add = db.prepare(`INSERT INTO reagents (name, cas_number, hazard, location, quantity, memo)
                              VALUES (?, ?, ?, ?, ?, ?)`);
      for (const [name, cas, hazard] of SAMPLE_REAGENTS) {
        add.run(name, cas, hazard, '시약장', 1, '예시 데이터: 실제 보관 위치와 병 수로 고쳐 주세요');
      }
    }

    // 기구 + 모델 분류 연결
    if (db.prepare('SELECT COUNT(*) AS n FROM equipment').get().n === 0) {
      const add = db.prepare(`INSERT INTO equipment
        (name, unit_label, location, howto, checklist, cautions, time_options, max_minutes, is_dangerous, sample_notice)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);
      const link = db.prepare('INSERT INTO model_class_map (class_name, equipment_id) VALUES (?, ?)');
      for (const e of SAMPLE_EQUIPMENT) {
        for (const unit of e.units) {
          const info = add.run(
            e.name, unit, e.location,
            JSON.stringify(e.howto), JSON.stringify(e.checklist), JSON.stringify(e.cautions),
            JSON.stringify(e.timeOptions), e.maxMinutes, e.isDangerous,
          );
          link.run(e.className, info.lastInsertRowid);
        }
      }
    }
  });
  run();
}

// ── 14단계: 안내 전용 기구 예시 (예약·대기 없이 사용법·주의사항만 보여 주는 기구) ──
const SAMPLE_GUIDE_EQUIPMENT = [
  {
    name: '마이크로피펫',
    className: 'micropipette',
    location: '생물실 실험대 피펫 거치대',
    howto: [
      SAMPLE_NOTICE,
      '1. 옮길 부피에 맞는 마이크로피펫을 고릅니다 (예: P20, P200, P1000). 피펫마다 쓸 수 있는 용량 범위가 적혀 있어요.',
      '2. 부피 조절 손잡이를 돌려 원하는 부피를 맞춥니다. 용량 범위 밖으로는 절대 돌리지 않습니다.',
      '3. 알맞은 크기의 팁을 팁 상자에서 눌러 끼웁니다. 팁은 손으로 만지지 않습니다.',
      '4. 누름 버튼을 "첫 번째 멈춤"까지 누른 채로, 팁 끝을 액체에 2~3mm만 담급니다.',
      '5. 버튼을 천천히 놓아 액체를 빨아들입니다.',
      '6. 옮길 용기 벽에 팁을 대고 "첫 번째 멈춤"까지 천천히 누른 뒤, "두 번째 멈춤"까지 끝까지 눌러 남은 액체를 내보냅니다.',
      '7. 버튼을 누른 채로 팁을 용기에서 빼낸 뒤 버튼을 놓습니다.',
      '8. 팁 제거 버튼을 눌러 쓴 팁을 폐기 용기에 버립니다.',
      '9. 다 쓰면 가장 큰 용량으로 돌려 두고 거치대에 세워 보관합니다.',
    ],
    checklist: [
      '옮길 부피가 이 피펫의 용량 범위 안에 있다',
      '알맞은 팁을 끼웠다',
      '첫 번째 멈춤(빨아들이기)과 두 번째 멈춤(끝까지 내보내기)을 구분할 수 있다',
    ],
    cautions: [
      SAMPLE_NOTICE,
      '액체가 든 채로 눕히거나 거꾸로 들지 않습니다. 본체 안으로 액체가 들어가 고장 나요.',
      '버튼을 갑자기 놓지 않습니다. 액체가 튀어 본체로 들어갈 수 있어요.',
      '용량 범위 밖으로 손잡이를 돌리지 않습니다.',
      '팁 없이 액체에 넣지 않습니다.',
      '시료가 바뀔 때마다 팁을 새것으로 바꿉니다 (섞임·오염 방지).',
    ],
  },
  {
    name: '피펫 에이드',
    className: 'pipette_aid',
    location: '생물실 실험대 충전 거치대',
    howto: [
      SAMPLE_NOTICE,
      '1. 충전 상태를 확인합니다. 배터리가 부족하면 충전 거치대에 꽂아 둡니다.',
      '2. 일회용 눈금 피펫(혈청 피펫)의 위쪽 끝을 피펫 에이드 입구에 똑바로 끼웁니다. 살짝 밀어 넣어 단단히 고정합니다.',
      '3. 피펫 끝을 액체에 담그고 위쪽(흡입) 버튼을 살살 눌러, 원하는 눈금보다 조금 위까지 빨아들입니다. 세게 누를수록 빨라져요.',
      '4. 눈금을 눈높이에서 보면서 아래쪽(배출) 버튼을 살짝 눌러 정확한 눈금에 맞춥니다.',
      '5. 옮길 용기에 피펫 끝을 대고 아래쪽 버튼으로 내보냅니다.',
      '6. 다 쓴 피펫을 빼서 폐기함에 버리고, 피펫 에이드는 거치대에 세워 둡니다.',
    ],
    checklist: [
      '입구 안쪽 필터가 젖어 있지 않다',
      '피펫을 똑바로, 단단히 끼웠다',
      '배터리가 충분하다',
    ],
    cautions: [
      SAMPLE_NOTICE,
      '액체가 입구 안쪽 필터까지 올라오지 않게 합니다. 필터가 젖으면 사용을 멈추고 선생님께 알립니다.',
      '피펫을 끼운 채로 눕히거나 거꾸로 들지 않습니다.',
      '처음 빨아들일 때는 버튼을 살살 눌러 천천히 올립니다.',
    ],
  },
];

// 안내 전용 예시는 한 번만 넣음 (13단계 전에 만든 데이터베이스에도 들어가게, 관리자가 지우면 다시 넣지 않음)
function seedGuideExamples(db) {
  if (db.prepare("SELECT value FROM settings WHERE key = 'seeded_guide_examples'").get()) return;
  const lab = db.prepare("SELECT id FROM labs WHERE code = 'bio'").get() || db.prepare('SELECT id FROM labs ORDER BY sort, id LIMIT 1').get();
  db.transaction(() => {
    const add = db.prepare(`INSERT INTO equipment (name, unit_label, location, howto, checklist, cautions, time_options, max_minutes, is_dangerous, sample_notice, kind, lab_id)
                            VALUES (?, '', ?, ?, ?, ?, '[]', 60, 0, 1, '안내', ?)`);
    const link = db.prepare('INSERT OR IGNORE INTO model_class_map (class_name, equipment_id) VALUES (?, ?)');
    for (const e of SAMPLE_GUIDE_EQUIPMENT) {
      const info = add.run(e.name, e.location, JSON.stringify(e.howto), JSON.stringify(e.checklist), JSON.stringify(e.cautions), lab ? lab.id : null);
      link.run(e.className, info.lastInsertRowid);
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('seeded_guide_examples', '1')").run();
  })();
}

// ── 16단계: 예시 키워드 (쓰이는 실험·주제) — 교사 검토 필요 ──
// 기구 이름으로 찾아 넣음. 이미 키워드가 있으면 건드리지 않음. 한 번만 넣음.
const SAMPLE_KEYWORDS = {
  '고압 멸균기(오토클레이브)': ['멸균', '배지 만들기', '미생물 배양 준비', '실험 기구 멸균', '폐기물 멸균'],
  '배양기': ['미생물 배양', '세균', '효모', '곰팡이', '발효', '세포 배양', '생장', '온도에 따른 생장'],
  '원심분리기': ['분리', '침전', 'DNA 추출', '세포 분리', '단백질', '혈액'],
  '건조기': ['건조', '수분 함량', '유리 기구 말리기', '질량 측정', '증발'],
  '무균 작업대(클린벤치)': ['무균 조작', '접종', '미생물 배양', '식물 조직 배양', '오염 방지'],
  '마이크로피펫': ['소량 정량', 'DNA', '효소 반응', '희석', 'PCR', '시료 옮기기'],
  '피펫 에이드': ['정량', '희석', '배지 만들기', '용액 옮기기', '시약 분주'],
};
// 16단계 처음 기본값 (관리자가 이 값 그대로 두었으면 새 기본값으로 바꿔 줌, 고쳤으면 건드리지 않음)
const OLD_SYNONYMS_V1 = ['세균, 박테리아, 미생물, 균', '효모, 이스트', '곰팡이, 균류', '효소, 카탈레이스, 아밀레이스, 단백질 분해',
  'DNA, 디엔에이, 유전자, 유전 물질', '온도, 가열, 열, 고온', '희석, 농도, 묽히기', '무균, 멸균, 소독, 살균', '배양, 키우기, 증식, 생장', '분리, 추출, 거르기'].join('\n');
function upgradeSynonyms(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'recommend_synonyms'").get();
  if (row && row.value === OLD_SYNONYMS_V1) {
    db.prepare("UPDATE settings SET value = ? WHERE key = 'recommend_synonyms'").run(DEFAULT_SETTINGS.recommend_synonyms);
  }
}

function seedKeywordExamples(db) {
  upgradeSynonyms(db);
  if (db.prepare("SELECT value FROM settings WHERE key = 'seeded_keywords'").get()) return;
  db.transaction(() => {
    const set = db.prepare("UPDATE equipment SET keywords = ? WHERE name = ? AND keywords = '[]'");
    for (const [name, kws] of Object.entries(SAMPLE_KEYWORDS)) set.run(JSON.stringify(kws), name);
    db.prepare("INSERT INTO settings (key, value) VALUES ('seeded_keywords', '1')").run();
  })();
}

module.exports = { seedIfEmpty, seedGuideExamples, seedKeywordExamples, DEFAULT_SETTINGS, SAMPLE_NOTICE };
