import { $, esc, km, nearby, search, api, arrivals, arrivalsAll, arrivalRows, justPassed, makeMap, dotMarker, nowText } from "./lib.js";

// 한 화면: 목록에 마우스를 올리면 지도 핀 강조, 목록·핀을 누르면 그 정류장으로 확대 + 말풍선(도착·직전 버스·버스 위치)
let pos = null, stops = [], seq = 0, timer = null, map = null, mapMsg = "";
let pins = [], overlays = [], sel = -1, pop = null, popSeq = 0, popTimer = null, openRoute = "", busOverlays = [], popStop = null;
const list = $("#list"), where = $("#where");
const say = (t) => (where.textContent = t);
const place = (s) => (s.km != null ? Math.round(s.km * 1000) + "m" : esc(s.cityname));
const stopProp = (el) => ["click", "mousedown", "touchstart", "wheel", "dblclick"].forEach((t) => el.addEventListener(t, (e) => e.stopPropagation()));   // 지도 위 요소 조작이 지도로 새지 않게

async function ensureMap(center) {
  if (map || mapMsg) return map;
  try { map = await makeMap($("#map"), center.lat, center.lng, 4); kakao.maps.event.addListener(map, "click", closePop); }
  catch (e) { mapMsg = e.message; $("#map").innerHTML = `<p class="msg">${esc(e.message)}</p>`; }   // 지도가 안 돼도 목록은 동작
  return map;
}

// ── 강조: 목록 ↔ 지도 핀 ──
function setHl(i) {
  pins.forEach((p, k) => { p.el.classList.toggle("hl", k === i); p.ov.setZIndex(k === i ? 10 : 3); });
  list.querySelectorAll(".stop").forEach((a) => a.classList.toggle("hl", +a.dataset.i === i));
}

// ── 지도 ──
async function drawMap(center, fitMe) {   // fitMe: 내 위치 기준일 때만 지도 범위에 내 위치를 넣음(검색은 결과 정류장만)
  if (!(await ensureMap(center))) return;
  closePop(); overlays.forEach((o) => o.setMap(null)); pins.forEach((p) => p.ov.setMap(null)); overlays = []; pins = [];
  const bounds = new kakao.maps.LatLngBounds();
  if (pos) { overlays.push(dotMarker(map, pos.lat, pos.lng)); if (fitMe) bounds.extend(new kakao.maps.LatLng(pos.lat, pos.lng)); }
  stops.forEach((s, i) => {
    const p = new kakao.maps.LatLng(s.lat, s.lng), el = document.createElement("div");
    el.className = "pin"; el.title = s.name; el.innerHTML = `<span>${i + 1}</span>`;
    stopProp(el);
    el.addEventListener("click", () => select(i, false));
    el.addEventListener("mouseenter", () => setHl(i)); el.addEventListener("mouseleave", () => setHl(-1));
    pins.push({ el, ov: new kakao.maps.CustomOverlay({ map, position: p, content: el, xAnchor: 0.5, yAnchor: 1.2, zIndex: 3 }) });
    bounds.extend(p);
  });
  if (stops.length || fitMe) map.setBounds(bounds, 40, 40, 40, 40);
  if (stops.length === 1 && !fitMe) map.setLevel(3);
}

// ── 선택: 확대 + 말풍선 ──
async function select(i, fromList) {
  if (!map) return say(mapMsg || "지도를 불러오는 중입니다.");
  const s = stops[i];
  closePop(); sel = i;
  list.querySelectorAll(".stop").forEach((a) => a.classList.toggle("sel", +a.dataset.i === i));
  pins.forEach((p, k) => p.el.classList.toggle("sel", k === i));   // 선택한 핀은 계속 강조
  const p = new kakao.maps.LatLng(s.lat, s.lng);
  map.setLevel(2); map.setCenter(p);
  map.panBy(0, -Math.min(150, $("#map").clientHeight * 0.3));   // 말풍선이 핀 위에 들어갈 자리를 위해 핀을 화면 아래쪽으로
  if (fromList) $("#map").scrollIntoView({ block: "nearest", behavior: "smooth" });   // 폰: 목록이 지도 아래라 지도가 보이게
  else list.querySelector(`.stop[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
  openPop(s, p);
}

function openPop(s, position) {
  // 크기 0의 기준점(.popanchor)에 아래 모서리를 붙임: 내용이 채워져 말풍선이 커져도 핀 위치에서 위로만 늘어남. 아래 여백(.popwrap padding) = 핀이 들어갈 자리
  const el = document.createElement("div"); el.className = "popanchor";
  el.innerHTML = `<div class="popwrap"><div class="pop"><button class="x" type="button" aria-label="닫기">×</button><h3>${esc(s.name)} <small>${place(s)}</small></h3><div class="rows"><p class="msg">불러오는 중…</p></div></div></div>`;
  el.querySelector(".x").addEventListener("click", closePop);
  el.addEventListener("click", (e) => { const b = e.target.closest("[data-route]"); if (b) toggleRoute(b); });
  stopProp(el);
  popStop = s; openRoute = "";
  pop = new kakao.maps.CustomOverlay({ map, position, content: el, xAnchor: 0, yAnchor: 0, zIndex: 20 });
  fillPop(); popTimer = setInterval(() => { if (!document.hidden) fillPop(); }, 30000);
}

function closePop() {
  popSeq++; clearInterval(popTimer); popTimer = null;
  if (pop) { pop.setMap(null); pop = null; }
  clearBuses(); openRoute = ""; popStop = null;
  if (sel >= 0) { sel = -1; list.querySelectorAll(".stop.sel").forEach((a) => a.classList.remove("sel")); pins.forEach((p) => p.el.classList.remove("sel")); }
}

async function fillPop() {   // 도착 예정 + 노선별 직전 버스 (30초마다 다시)
  const my = ++popSeq, s = popStop, box = pop?.getContent().querySelector(".rows");
  if (!box) return;
  let a;
  try { a = await arrivals(s); } catch (e) { if (my === popSeq) box.innerHTML = `<p class="msg">${esc(e.message)}</p>`; return; }
  if (my !== popSeq) return;
  box.innerHTML = a.length ? a.slice(0, 8).map((r) => `<div class="rt">${arrivalRows([r], "button", (x) => `data-route="${esc(x.route_id)}" data-no="${esc(x.route_no)}"`)}<div class="loc" hidden></div><div class="prev" data-prev="${esc(r.route_id)}"></div></div>`).join("")
    : '<p class="none">지금 도착 예정인 버스가 없습니다.</p>';
  const el = openRoute && box.querySelector(`[data-route="${CSS.escape(openRoute)}"]`);
  if (el) showLoc(el); else openRoute = "";
  // 노선마다 직전 버스(이미 지나간 버스): 3곳씩 조회 — 공공데이터 동시 접속 한도 보호
  const ids = [...new Set(a.slice(0, 8).map((r) => r.route_id))]; let next = 0;
  await Promise.all([0, 1, 2].map(async () => {
    while (next < ids.length && my === popSeq) {
      const id = ids[next++];
      const p = await api("/location", { city: s.city, route: id, stop: s.id }).then(justPassed, () => null);
      const t = my === popSeq && box.querySelector(`[data-prev="${CSS.escape(id)}"]`);
      if (t) t.textContent = p ? `직전 버스는 ${p.stops}정류장 앞(${p.name})을 지나갔어요 · 약 ${p.minutes}분 전 (추정)` : "";
    }
  }));
}

function clearBuses() { busOverlays.forEach((o) => o.setMap(null)); busOverlays = []; }

function toggleRoute(btn) {   // 노선을 누르면 그 버스들의 위치를 말풍선과 지도에 표시, 다시 누르면 닫음
  const box = btn.nextElementSibling;
  if (!box.hidden) { box.hidden = true; clearBuses(); openRoute = ""; } else showLoc(btn);
}

async function showLoc(btn) {
  const root = btn.closest(".rows"), box = btn.nextElementSibling, my = popSeq;
  root.querySelectorAll(".loc").forEach((l) => { if (l !== box) l.hidden = true; });
  clearBuses();
  box.hidden = false; if (!box.innerHTML) box.textContent = "버스 위치를 불러오는 중…";
  openRoute = btn.dataset.route;
  try {
    const buses = (await api("/location", { city: popStop.city, route: openRoute, stop: popStop.id })).filter((b) => b.left >= 0);   // 이 정류장으로 오는 버스만
    if (my !== popSeq && !pop) return;
    box.innerHTML = buses.length ? buses.slice(0, 3).map((b) => `<p>${b.left === 0 ? "<b>지금 이 정류장</b>" : `<b>${b.left}정류장 전</b> · ${esc(b.name)}`}</p>`).join("") : "이 정류장으로 오는 버스 위치가 아직 없습니다.";
    const bounds = new kakao.maps.LatLngBounds(); bounds.extend(new kakao.maps.LatLng(popStop.lat, popStop.lng));
    buses.slice(0, 3).forEach((b) => {
      const el = document.createElement("div"); el.className = "bus-pin"; el.textContent = btn.dataset.no;
      const p = new kakao.maps.LatLng(b.lat, b.lng); bounds.extend(p);
      busOverlays.push(new kakao.maps.CustomOverlay({ map, position: p, content: el, zIndex: 6 }));
    });
    // 버스가 멀면 정류장과 버스가 모두 보이게 맞춤 (화면 밖 표시는 그려지지 않음), 위는 말풍선 자리. 정류장 바로 앞이면 지금 화면 그대로
    if (buses.slice(0, 3).some((b) => km(popStop.lat, popStop.lng, +b.lat, +b.lng) > 0.08)) map.setBounds(bounds, (pop?.getContent().querySelector(".popwrap").offsetHeight || 260) + 20, 50, 60, 50);
  } catch (e) { box.textContent = e.message; }
}

// ── 목록 ──
function render(arr) {
  list.innerHTML = stops.length ? stops.map((s, i) => {
    const a = arr[i];
    return `<article class="stop${i === sel ? " sel" : ""}" data-i="${i}" tabindex="0" role="button" aria-label="${esc(s.name)} 지도에서 보기"><h2><span class="num">${i + 1}</span>${esc(s.name)} <small>${place(s)}</small></h2>
      ${a === undefined ? '<p class="msg">불러오는 중…</p>' : a === null ? '<p class="msg">도착 정보를 받지 못했습니다.</p>'
        : a.length ? arrivalRows(a.slice(0, 5), "div") : '<p class="none">지금 도착 예정인 버스가 없습니다.</p>'}</article>`;
  }).join("") : "";
}

list.addEventListener("mouseover", (e) => { const a = e.target.closest(".stop"); setHl(a ? +a.dataset.i : -1); });   // 마우스를 올리면 지도 핀 강조
list.addEventListener("mouseleave", () => setHl(-1));
list.addEventListener("focusin", (e) => { const a = e.target.closest(".stop"); if (a) setHl(+a.dataset.i); });
list.addEventListener("focusout", () => setHl(-1));
list.addEventListener("click", (e) => { const a = e.target.closest(".stop"); if (a) select(+a.dataset.i, true); });
list.addEventListener("keydown", (e) => { const a = e.target.closest(".stop"); if (a && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(+a.dataset.i, true); } });

async function loadArrivals(silent) {
  const my = ++seq;
  if (!silent) render([]);
  const arr = await arrivalsAll(stops);
  if (my !== seq) return;
  render(arr);
  $("#at").textContent = nowText();
}

async function show(found, title, center, fitMe) {
  stops = found; sel = -1;
  say(stops.length ? title : title + " — 정류장을 찾지 못했습니다.");
  list.innerHTML = ""; $("#at").textContent = "";
  await drawMap(center || pos || { lat: 37.5665, lng: 126.978 }, fitMe);
  if (!stops.length) return;
  await loadArrivals();
  clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden) loadArrivals(true); }, 30000);
}

const HINT = " · 목록에 마우스를 올리면 지도에 표시, 누르면 확대해서 상세 정보";
async function byGps() {
  if (!navigator.geolocation) return say("이 기기에서는 위치를 쓸 수 없습니다. 아래에서 도시와 정류장 이름으로 검색하세요.");
  say("내 위치를 찾는 중…");
  navigator.geolocation.getCurrentPosition(async (p) => {
    pos = { lat: p.coords.latitude, lng: p.coords.longitude };
    try { await show(await nearby(pos.lat, pos.lng), "내 위치 기준" + HINT, pos, true); }
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
    await show(found, `검색: ${[f.region, f.area, f.q].filter(Boolean).join(" ")}` + HINT, found.center);
  } catch (err) { say(err.message); }
});

byGps();
