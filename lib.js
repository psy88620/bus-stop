// 공용: 정류장 파일(data/) 읽기·검색, Worker 호출, 카카오 지도 불러오기, 도착 목록 그리기
import { API_BASE, KAKAO_JS_KEY } from "./config.js";

export const $ = (s, r = document) => r.querySelector(s);
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function km(lat1, lng1, lat2, lng2) {
  const dx = (lng2 - lng1) * 111.32 * Math.cos((lat1 * Math.PI) / 180), dy = (lat2 - lat1) * 110.57;
  return Math.hypot(dx, dy);
}

// ── 정류장 파일: 도시별 [번호, 이름, 위도, 경도] (tools/build_stops.py가 만듦) ──
let cityList;
export const cities = async () => (cityList ??= fetch("data/cities.json").then((r) => r.json()).then((j) => j.cities));
const files = new Map();
export function cityStops(c) {   // c = cities() 한 줄
  if (!files.has(c.code)) files.set(c.code, fetch(`data/cities/${c.code}.json`).then((r) => { if (!r.ok) throw new Error("정류장 파일을 받지 못했습니다."); return r.json(); })
    .then((rows) => rows.map(([id, name, lat, lng]) => ({ id, name, lat, lng, city: c.code, cityname: c.name }))));
  return files.get(c.code);
}

/** 내 위치 가까운 정류장 (반경 maxKm 안, 가까운 순). 위치가 걸치는 도시 파일만 읽음 */
export async function nearby(lat, lng, { limit = 12, maxKm = 1.5 } = {}) {
  const m = 0.03;   // 도시 경계 근처는 이웃 도시 정류장도 보이게 여유
  const cs = (await cities()).filter((c) => lat >= c.box[0] - m && lat <= c.box[2] + m && lng >= c.box[1] - m && lng <= c.box[3] + m);
  const all = (await Promise.all(cs.map(cityStops))).flat().map((s) => ({ ...s, km: km(lat, lng, s.lat, s.lng) }));
  return all.filter((s) => s.km <= maxKm).sort((a, b) => a.km - b.km).slice(0, limit);
}

/** 도시(필수) + 읍·면·리(선택) + 정류장 이름. 읍·면·리가 있으면 이름은 비워도 됨 */
export async function search({ region, area, q }, { limit = 12 } = {}) {
  if (region.length < 2) throw new Error("도시를 두 글자 이상 입력하세요. (예: 아산, 서울)");
  if (!area && !q) throw new Error("정류장 이름이나 읍·면·리를 입력하세요.");
  const cs = (await cities()).filter((c) => c.name.includes(region));
  if (!cs.length) throw new Error(`'${region}' 도시를 찾지 못했습니다.`);
  if (!area) {
    const all = (await Promise.all(cs.slice(0, 6).map(cityStops))).flat().filter((s) => s.name.includes(q));   // '광주'처럼 여러 도시가 걸리면 앞 6곳까지
    return all.sort((a, b) => !a.name.startsWith(q) - !b.name.startsWith(q) || a.name.length - b.name.length).slice(0, limit);
  }
  // 정류장 파일엔 읍·면·리 항목이 없어 카카오 주소 검색의 중심 좌표 반경으로 가름 (경계가 아니라 반경이라 큰 면의 끝자락은 빠질 수 있음)
  const k = await loadKakao();
  const doc = await new Promise((res) => new k.maps.services.Geocoder().addressSearch(`${region} ${area}`, (r, st) => res(st === k.maps.services.Status.OK ? r[0] : null)));
  if (!doc) throw new Error(`'${region} ${area}' 지역을 찾지 못했습니다.`);
  const lat = +doc.y, lng = +doc.x, r = "리동가".includes(area.at(-1)) ? 1.5 : 4;
  const mine = cs.filter((c) => lat >= c.box[0] - 0.03 && lat <= c.box[2] + 0.03 && lng >= c.box[1] - 0.03 && lng <= c.box[3] + 0.03);
  const all = (await Promise.all(mine.map(cityStops))).flat().map((s) => ({ ...s, km: km(lat, lng, s.lat, s.lng) }));
  const out = all.filter((s) => s.km <= r && s.name.includes(q)).sort((a, b) => a.km - b.km).slice(0, limit);
  out.forEach((s) => { s.cityname = doc.address_name; delete s.km; });   // 거리는 읍·면 중심 기준이라 보여 주지 않음
  out.center = { lat, lng };
  return out;
}

// ── Worker (도착 예정·버스 위치) ──
export async function api(path, params) {
  if (!API_BASE) throw new Error("config.js에 Worker 주소(API_BASE)가 아직 없습니다.");
  const res = await fetch(`${API_BASE}${path}?${new URLSearchParams(params)}`);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "버스 정보를 받지 못했습니다.");
  return j;
}
export const arrivals = (s) => api("/arrivals", { city: s.city, stop: s.id });
/** 정류장 여러 곳의 도착 정보를 4개씩 (공공데이터 동시 접속 한도 보호). 실패한 곳은 null */
export async function arrivalsAll(stops, n = 4) {
  const out = new Array(stops.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < stops.length) { const i = next++; out[i] = await arrivals(stops[i]).catch(() => null); } }));
  return out;
}

// ── 카카오 지도 ──
let kakaoP;
export function loadKakao() {
  return (kakaoP ??= new Promise((res, rej) => {
    if (!KAKAO_JS_KEY) return rej(new Error("카카오 지도 키(config.js의 KAKAO_JS_KEY)가 아직 없습니다."));
    const s = document.createElement("script");
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(KAKAO_JS_KEY)}&libraries=services&autoload=false`;
    s.onload = () => kakao.maps.load(() => res(kakao));
    s.onerror = () => rej(new Error("카카오 지도를 불러오지 못했습니다. (키·등록한 사이트 주소를 확인하세요)"));
    document.head.append(s);
  }));
}
export async function makeMap(el, lat, lng, level = 4) {
  const k = await loadKakao();
  return new k.maps.Map(el, { center: new k.maps.LatLng(lat, lng), level });
}
export function dotMarker(map, lat, lng) {   // 내 위치: 파란 점
  const el = document.createElement("div"); el.className = "me-dot"; el.setAttribute("aria-label", "내 위치");
  return new kakao.maps.CustomOverlay({ map, position: new kakao.maps.LatLng(lat, lng), content: el, zIndex: 5 });
}

// ── 도착 목록 ──
export const stopUrl = (s, route = "") => `stop.html?${new URLSearchParams({ city: s.city, id: s.id, name: s.name, lat: s.lat, lng: s.lng, ...(route && { route }) })}`;
const soon = (r) => (r.minutes != null && r.minutes <= 3) || r.left === 1;
export function arrivalRows(list, rowTag, attrs = () => "") {   // rowTag: 'a'(눌러 상세로) | 'button'(눌러 버스 위치)
  return list.map((r) => `<${rowTag} class="arr${soon(r) ? " soon" : ""}" ${attrs(r)}><span class="no">${esc(r.route_no)}번</span>
    <span class="to">${esc(r.dest ? r.dest + " 방면" : r.type)}</span>
    <span class="tm">${r.minutes == null ? "-" : r.minutes + "분"}${soon(r) ? '<span class="soon-tag">곧 도착</span>' : ""}${r.left != null ? `<small>${r.left}정류장 전</small>` : ""}</span></${rowTag}>`).join("");
}
export const nowText = () => new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) + " 기준 · 30초마다 자동 갱신";
