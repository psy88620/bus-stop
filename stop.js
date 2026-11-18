import { $, esc, cities, cityStops, api, arrivals, arrivalRows, makeMap, dotMarker, nowText } from "./lib.js";

const q = new URLSearchParams(location.search);
let stop = { city: +q.get("city"), id: q.get("id"), name: q.get("name") || "", lat: +q.get("lat"), lng: +q.get("lng") };
const list = $("#list"), where = $("#where");
let map = null, busOverlays = [], openRoute = q.get("route") || "", arr = [], timer = null;

async function init() {
  if (!stop.city || !stop.id) return (where.textContent = "정류장 정보가 없습니다. 목록에서 정류장을 선택하세요.");
  if (!stop.name || !stop.lat) {   // 주소에 이름·좌표가 없으면 정류장 파일에서 찾음
    const c = (await cities()).find((x) => x.code === stop.city);
    const s = c && (await cityStops(c)).find((x) => x.id === stop.id);
    if (!s) return (where.textContent = "정류장을 찾지 못했습니다.");
    stop = s;
  }
  $("#name").textContent = stop.name; document.title = `${stop.name} · 실시간 정보`;
  try {
    map = await makeMap($("#map"), stop.lat, stop.lng, 4);
    new kakao.maps.Marker({ map, position: new kakao.maps.LatLng(stop.lat, stop.lng), title: stop.name });
  } catch (e) { $("#map").innerHTML = `<p class="msg">${esc(e.message)}</p>`; }
  await refresh();
  timer = setInterval(() => { if (!document.hidden) refresh(true); }, 30000);
}

async function refresh() {
  try { arr = await arrivals(stop); } catch (e) { where.textContent = e.message; return; }
  where.textContent = "";
  list.innerHTML = arr.length ? arr.map((r) => `<div>${arrivalRows([r], "button", (x) => `data-route="${esc(x.route_id)}" data-no="${esc(x.route_no)}"`)}<div class="loc" hidden></div></div>`).join("")
    : '<p class="none">지금 도착 예정인 버스가 없습니다.</p>';
  $("#at").textContent = nowText();
  const el = openRoute && list.querySelector(`[data-route="${CSS.escape(openRoute)}"]`);
  if (el) showLoc(el); else openRoute = "";
}

async function showLoc(btn) {   // 노선 버스 위치: 목록 + 지도에 버스 표시
  const box = btn.nextElementSibling;
  list.querySelectorAll(".loc").forEach((l) => { if (l !== box) l.hidden = true; });
  busOverlays.forEach((o) => o.setMap(null)); busOverlays = [];
  box.hidden = false; if (!box.innerHTML) box.textContent = "버스 위치를 불러오는 중…";
  openRoute = btn.dataset.route;
  try {
    const buses = await api("/location", { city: stop.city, route: openRoute, stop: stop.id });
    box.innerHTML = buses.length ? buses.slice(0, 3).map((b) => `<p>${b.left === 0 ? "<b>지금 이 정류장</b>" : `<b>${b.left}정류장 전</b> · ${esc(b.name)}`}</p>`).join("") : "이 정류장으로 오는 버스 위치가 아직 없습니다.";
    if (map) buses.slice(0, 3).forEach((b) => {
      const el = document.createElement("div"); el.className = "bus-pin"; el.textContent = btn.dataset.no;
      busOverlays.push(new kakao.maps.CustomOverlay({ map, position: new kakao.maps.LatLng(b.lat, b.lng), content: el, zIndex: 6 }));
    });
  } catch (e) { box.textContent = e.message; }
}

list.addEventListener("click", (e) => {
  const b = e.target.closest("[data-route]");
  if (!b) return;
  const box = b.nextElementSibling;
  if (!box.hidden) { box.hidden = true; busOverlays.forEach((o) => o.setMap(null)); busOverlays = []; openRoute = ""; } else showLoc(b);
});
$("#refresh").addEventListener("click", () => refresh());
init();
