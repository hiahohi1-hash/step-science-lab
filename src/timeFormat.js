// ─────────────────────────────────────────────
// 한국 시간 계산·표시, 학번 가리기
// ─────────────────────────────────────────────
// 컴퓨터 시간대 설정과 상관없이 항상 한국 시간(Asia/Seoul) 기준으로 계산합니다.

const TZ = 'Asia/Seoul';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000; // 한국은 세계 표준시보다 9시간 빠름 (서머타임 없음)
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

// Date → 한국 시간 기준 { year, month, day, hour, minute, weekday }
function kstParts(date) {
  const k = new Date(date.getTime() + KST_OFFSET_MS); // 9시간 더한 뒤 "UTC 값"을 읽으면 한국 시각
  return {
    year: k.getUTCFullYear(),
    month: k.getUTCMonth() + 1,
    day: k.getUTCDate(),
    hour: k.getUTCHours(),
    minute: k.getUTCMinutes(),
    weekday: DAYS[k.getUTCDay()],
  };
}

// date 와 같은 날(한국 날짜)의 "HH:MM" 시각을 Date 로 만듦. 예: kstTimeOnSameDay(now, '18:00')
function kstTimeOnSameDay(date, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const p = kstParts(date);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, h, m) - KST_OFFSET_MS);
}

// "오후 3:00" 모양
function formatTime(date) {
  const { hour, minute } = kstParts(date);
  const ampm = hour < 12 ? '오전' : '오후';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${ampm} ${h12}:${String(minute).padStart(2, '0')}`;
}

// "11월 14일 (토) 오후 3:00" 모양
function formatDateTime(date) {
  const p = kstParts(date);
  return `${p.month}월 ${p.day}일 (${p.weekday}) ${formatTime(date)}`;
}

// 오늘이면 "오후 4:20", 다른 날이면 "11월 15일 (일) 오전 4:17" (배양기처럼 하루를 넘기는 경우)
function formatTimeSmart(date, base) {
  const a = kstParts(date);
  const b = kstParts(base);
  const sameDay = a.year === b.year && a.month === b.month && a.day === b.day;
  return sameDay ? formatTime(date) : formatDateTime(date);
}

// 분 → "1시간 20분", "3일 2시간" 모양
function formatDuration(totalMinutes) {
  const m = Math.max(0, Math.round(totalMinutes));
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  const parts = [];
  if (days) parts.push(`${days}일`);
  if (hours) parts.push(`${hours}시간`);
  if (mins || parts.length === 0) parts.push(`${mins}분`);
  return parts.join(' ');
}

// 학번 뒤 두 자리 가리기: "20315" → "203**"
function maskStudentId(id) {
  if (!id) return '(지워짐)';
  const s = String(id);
  return s.length <= 2 ? '**' : s.slice(0, -2) + '**';
}

module.exports = { kstParts, kstTimeOnSameDay, formatTime, formatTimeSmart, formatDateTime, formatDuration, maskStudentId };
