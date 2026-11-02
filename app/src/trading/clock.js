// The New York Stock Exchange's clock, worked out here rather than asked of
// the operating system.
//
// A server in Baghdad, a laptop in Frankfurt and a test runner in UTC must all
// agree that 15:55 in New York is fifteen fifty-five, so nothing reads the
// machine's own zone or its tz database. Daylight time follows the US rule
// since 2007 (second Sunday of March to first Sunday of November, 2:00 local).
// The holidays and early closes are the exchange's published calendar, read
// from nyse.com for the day-trader skill this desk descends from; a year that
// is not on the list is reported as unknown, never guessed.

export const OPEN_MIN = 9 * 60 + 30;
export const CLOSE_MIN = 16 * 60;
export const EARLY_CLOSE_MIN = 13 * 60;
export const BAR_MIN = 5;

const HOLIDAYS = {
  2026: ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25'],
  2027: ['2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24'],
};
const EARLY = { 2026: ['2026-11-27', '2026-12-24'], 2027: ['2027-11-26'] };

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function nthSunday(year, month, n) {
  const d = new Date(Date.UTC(year, month - 1, 1));
  d.setUTCDate(1 + ((7 - d.getUTCDay()) % 7) + 7 * (n - 1));
  return d;
}

/** Hours from UTC for New York at this instant: -4 in daylight time, -5 otherwise. */
export function nyOffset(at = new Date()) {
  const y = at.getUTCFullYear();
  const start = nthSunday(y, 3, 2); start.setUTCHours(7);   // 2:00 EST
  const end = nthSunday(y, 11, 1); end.setUTCHours(6);      // 2:00 EDT
  return at >= start && at < end ? -4 : -5;
}

/** The New York wall clock at an instant: its date, minutes since midnight and weekday. */
export function toNY(at = new Date()) {
  const local = new Date(at.getTime() + nyOffset(at) * 3600_000);
  return { day: ymd(local), minutes: local.getUTCHours() * 60 + local.getUTCMinutes(), weekday: local.getUTCDay(), hhmm: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}` };
}

/** A New York date and "HH:MM" as the instant it names. */
export function nyToUtc(day, hhmm = '00:00') {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi] = String(hhmm).split(':').map(Number);
  for (const off of [-4, -5]) {
    const at = new Date(Date.UTC(y, m - 1, d, h - off, mi));
    if (nyOffset(at) === off) return at;
  }
  return new Date(Date.UTC(y, m - 1, d, h + 5, mi));
}

export const parseHHMM = (s, fallback) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return fallback;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v < 24 * 60 ? v : fallback;
};
export const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/**
 * One New York date: is it a trading day, and when does it close.
 * `known` is false for a year whose holidays nobody has written down here.
 */
export function session(day) {
  const y = Number(day.slice(0, 4));
  const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
  const known = Boolean(HOLIDAYS[y]);
  if (wd === 0 || wd === 6) return { day, trading: false, why: 'weekend', known };
  if (known && HOLIDAYS[y].includes(day)) return { day, trading: false, why: 'holiday', known };
  const early = Boolean(EARLY[y]?.includes(day));
  return { day, trading: true, open: OPEN_MIN, close: early ? EARLY_CLOSE_MIN : CLOSE_MIN, early, known };
}

/** The next trading day strictly after `day`. */
export function nextTradingDay(day) {
  const d = new Date(`${day}T12:00:00Z`);
  for (let i = 0; i < 10; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    const s = session(ymd(d));
    if (s.trading) return s.day;
  }
  return null;
}

/**
 * The desk's view of the clock: where the session is, the window in which an
 * entry may be taken, and the time by which every position is closed. On an
 * early close the afternoon limits move up by the three hours the session lost,
 * so "no entries after 15:30" becomes 12:30 and "flat by 15:55" becomes 12:55.
 */
export function deskClock(at = new Date(), { noEntriesBefore = '09:45', noEntriesAfter = '15:30', flatBy = '15:55' } = {}) {
  const ny = toNY(at);
  const s = session(ny.day);
  const shift = s.early ? CLOSE_MIN - EARLY_CLOSE_MIN : 0;
  const window = {
    from: parseHHMM(noEntriesBefore, 9 * 60 + 45),
    to: parseHHMM(noEntriesAfter, 15 * 60 + 30) - shift,
    flatBy: parseHHMM(flatBy, 15 * 60 + 55) - shift,
  };
  let state = 'closed';
  if (s.trading) state = ny.minutes < OPEN_MIN ? 'pre' : ny.minutes < s.close ? 'open' : 'post';
  const nextOpenDay = s.trading && ny.minutes < OPEN_MIN ? ny.day : nextTradingDay(ny.day);
  return {
    now: at.toISOString(),
    ny: `${ny.day} ${ny.hhmm}`,
    day: ny.day,
    minutes: ny.minutes,
    state,
    why: s.trading ? (s.early ? 'early close at 13:00' : null) : s.why,
    known: s.known,
    early: Boolean(s.early),
    closesAt: s.trading ? hhmm(s.close) : null,
    canEnter: state === 'open' && ny.minutes >= window.from && ny.minutes < window.to,
    mustBeFlat: state === 'open' && ny.minutes >= window.flatBy,
    window: { from: hhmm(window.from), to: hhmm(window.to), flatBy: hhmm(window.flatBy) },
    windowMin: window,
    nextOpen: nextOpenDay ? `${nextOpenDay} 09:30` : null,
  };
}
