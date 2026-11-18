import { $, esc, km, nearby, search, arrivalsAll, arrivalRows, stopUrl, makeMap, loadKakao, dotMarker, nowText } from "./lib.js";

let pos = null, stops = [], seq = 0, timer = null, map = null, mapMsg = "";
const list = $("#list"), where = $("#where");
const say = (t) => (where.textContent = t);

async function ensureMap(center) {
  if (map || mapMsg) return map;
  try { map = await makeMap($("#map"), center.lat, center.lng, 4); }
  catch (e) { mapMsg = e.message; $("#map").innerHTML = `<p class="msg">${esc(e.message)}</p>`; }   // 지도가 안 돼도 목록은 동작
  return map;
}

let overlays = [];
async function drawMap(center, fitMe) {   // fitMe: 내 위치 기준일 때만 지도 범위에 내 위치를 넣음(검색은 결과 정류장만)
  if (!(await ensureMap(center))) return;
  overlays.forEach((o) => o.setMap(null)); overlays = [];
  const bounds = new kakao.maps.LatLngBounds();
  if (pos) { overlays.push(dotMarker(map, pos.lat, pos.lng)); if (fitMe) bounds.extend(new kakao.maps.LatLng(pos.lat, pos.lng)); }
  stops.forEach((s) => {
    const p = new kakao.maps.LatLng(s.lat, s.lng), m = new kakao.maps.Marker({ map, position: p, title: s.name });
    kakao.maps.event.addListener(m, "click", () => { location.href = stopUrl(s); });   // 정류장을 누르면 실시간 정보 페이지로
    overlays.push(m); bounds.extend(p);
  });
  if (stops.length || fitMe) map.setBounds(bounds, 40, 40, 40, 40);
  if (stops.length === 1 && !fitMe) map.setLevel(3);
}

function render(arr) {
  list.innerHTML = stops.length ? stops.map((s, i) => {
    const a = arr[i];
    return `<article class="stop"><h2><a href="${esc(stopUrl(s))}">${esc(s.name)}</a> <small>${s.km != null ? Math.round(s.km * 1000) + "m" : esc(s.cityname)}</small></h2>
      ${a === undefined ? '<p class="msg">불러오는 중…</p>' : a === null ? '<p class="msg">도착 정보를 받지 못했습니다.</p>'
        : a.length ? arrivalRows(a.slice(0, 5), "a", (r) => `href="${esc(stopUrl(s, r.route_id))}"`) : '<p class="none">지금 도착 예정인 버스가 없습니다.</p>'}</article>`;
  }).join("") : "";
}

async function loadArrivals(silent) {
  const my = ++seq;
  if (!silent) render([]);
  const arr = await arrivalsAll(stops);
  if (my !== seq) return;
  render(arr);
  $("#at").textContent = nowText();
}

async function show(found, title, center, fitMe) {
  stops = found;
  say(stops.length ? title : title + " — 정류장을 찾지 못했습니다.");
  list.innerHTML = ""; $("#at").textContent = "";
  await drawMap(center || pos || { lat: 37.5665, lng: 126.978 }, fitMe);
  if (!stops.length) return;
  await loadArrivals();
  clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden) loadArrivals(true); }, 30000);
}

async function byGps() {
  if (!navigator.geolocation) return say("이 기기에서는 위치를 쓸 수 없습니다. 아래에서 도시와 정류장 이름으로 검색하세요.");
  say("내 위치를 찾는 중…");
  navigator.geolocation.getCurrentPosition(async (p) => {
    pos = { lat: p.coords.latitude, lng: p.coords.longitude };
    try { await show(await nearby(pos.lat, pos.lng), "내 위치 기준 · 정류장을 누르면 실시간 정보"); }
    catch (e) { say(e.message); }
  }, () => say("위치 권한이 없습니다. 아래에서 도시와 정류장 이름으로 검색하세요."), { timeout: 10000, enableHighAccuracy: true });
}

$("#gps").addEventListener("click", () => { $("#region").value = $("#area").value = $("#q").value = ""; byGps(); });
$("#search").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = { region: $("#region").value.trim(), area: $("#area").value.trim(), q: $("#q").value.trim() };
  say("검색 중…");
  try {
    const found = await search(f);
    await show(found, `검색: ${[f.region, f.area, f.q].filter(Boolean).join(" ")} · 정류장을 누르면 실시간 정보`, found.center);
  } catch (err) { say(err.message); }
});

byGps();
