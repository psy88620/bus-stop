// 버스 중계 Worker: 공공데이터(TAGO) 키를 숨기고 도착 예정·버스 위치만 대신 받아 줌. 정류장 목록은 페이지의 정적 파일(data/cities)이 맡음.
//   GET /arrivals?city=34390&stop=GGB...   → [{route_id, route_no, type, dest, minutes, left}] 빠른 순 (15초 캐시)
//   GET /location?city=&route=&stop=       → [{name, left, lat, lng, vehicle}] 노선의 같은 방향 버스, left 오름차순: 음수=지나간 버스, 0 이상=오는 버스 (10초 캐시)
// 스쿨패스 modules/common/bus.py 와 같은 계산(방면 = 같은 방향의 노선 마지막 정류장).
const BASE = "https://apis.data.go.kr/1613000";
const ROUTE_STOPS = `${BASE}/BusRouteInfoInqireService/getRouteAcctoThrghSttnList`;
const BUS_LOC = `${BASE}/BusLcInfoInqireService/getRouteAcctoBusLcList`;
const ARRIVAL = `${BASE}/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList`;

const ID = /^[A-Za-z0-9_-]{3,40}$/;   // 정류장·노선 ID 형식 (그 밖은 거절)

async function tago(url, params, env) {
  const u = new URL(url);
  u.search = new URLSearchParams({ serviceKey: env.DATA_GO_KR_KEY, _type: "json", numOfRows: "500", ...params });
  for (let n = 0; ; n++) {
    const res = await fetch(u);
    if (!res.ok) throw new Error("TAGO " + res.status);
    const r = (await res.json()).response;
    if (String(r.header.resultCode) === "00") {
      const items = r.body.items?.item || [];
      return Array.isArray(items) ? items : [items];
    }
    // 동시 접속 한도(30)가 찼으면 잠깐 뒤 다시. 그 밖의 오류는 빈 결과로 오해하지 않게 오류로
    if (n >= 3 || !String(r.header.resultMsg).includes("세션")) throw new Error(r.header.resultMsg || "TAGO 오류");
    await new Promise((ok) => setTimeout(ok, 400 * (n + 1)));
  }
}

// 같은 요청은 ttl초 동안 Cloudflare 캐시에서 (공공데이터 호출 수·접속 폭주 완화)
async function cached(request, ttl, make) {
  const key = new Request(request.url, { method: "GET" });
  const hit = await caches.default.match(key);
  if (hit) return hit;
  const body = JSON.stringify(await make());
  const res = new Response(body, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${ttl}` } });
  await caches.default.put(key, res.clone());
  return res;
}

async function routeStops(city, routeId, env, ctx) {   // 노선 정류장 순서 (하루 캐시)
  const key = new Request(`https://cache.invalid/route/${city}/${routeId}`);
  const hit = await caches.default.match(key);
  if (hit) return hit.json();
  const out = (await tago(ROUTE_STOPS, { cityCode: city, routeId }, env))
    .map((i) => ({ id: i.nodeid, name: i.nodenm, ord: i.nodeord, dir: i.updowncd }))
    .sort((a, b) => a.ord - b.ord);
  ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(out), { headers: { "cache-control": "public, max-age=86400" } })));
  return out;
}

const destOf = (st, nodeId) => {
  const me = st.find((x) => x.id === nodeId);
  return me ? st.filter((x) => x.dir === me.dir).at(-1).name : "";
};

export async function arrivals(city, stop, env, ctx) {
  const items = await tago(ARRIVAL, { cityCode: city, nodeId: stop, numOfRows: "50" }, env);
  const dests = {};   // 노선별 방면: 처음 보는 노선은 3개씩 조회(하루 캐시), 동시 접속 한도를 넘지 않게
  const ids = [...new Set(items.map((i) => i.routeid))];
  for (let k = 0; k < ids.length; k += 3)
    await Promise.all(ids.slice(k, k + 3).map(async (id) => { try { dests[id] = destOf(await routeStops(city, id, env, ctx), stop); } catch { dests[id] = ""; /* 방면은 없어도 됨 */ } }));
  const out = items.map((i) => {
    const dest = dests[i.routeid];
    return { route_id: i.routeid, route_no: String(i.routeno), type: i.routetp || "", dest,
             minutes: i.arrtime == null ? null : Math.max(1, Math.round(i.arrtime / 60)), left: i.arrprevstationcnt ?? null };
  });
  return out.sort((a, b) => (a.minutes == null) - (b.minutes == null) || (a.minutes ?? 0) - (b.minutes ?? 0));
}

export async function location(city, route, stop, env, ctx) {
  const st = await routeStops(city, route, env, ctx), me = st.find((x) => x.id === stop);
  if (!me) return null;   // 이 정류장에 서지 않는 노선
  // left = 이 정류장까지 남은 정류장 수. 음수는 이미 지나간 버스(-1이면 한 정류장 앞). 같은 진행 방향의 버스만 (반대 방향 구간의 버스는 뺌)
  return (await tago(BUS_LOC, { cityCode: city, routeId: route }, env)).flatMap((b) => {
    const at = st.find((x) => x.ord === Number(b.nodeord));
    return at && at.dir === me.dir ? [{ name: b.nodenm, left: me.ord - Number(b.nodeord), lat: b.gpslati, lng: b.gpslong, vehicle: b.vehicleno || "" }] : [];
  }).sort((a, b) => a.left - b.left);
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("origin") || "";
    const ok = (env.ALLOWED_ORIGINS || "").split(",").includes(origin);
    const cors = ok ? { "access-control-allow-origin": origin, vary: "origin" } : {};
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...cors } });
    if (request.method === "OPTIONS") return new Response(null, { headers: { ...cors, "access-control-allow-methods": "GET" } });
    if (!ok) return json({ error: "허용되지 않은 주소입니다." }, 403);
    const q = new URL(request.url).searchParams, path = new URL(request.url).pathname;
    const city = q.get("city") || "", stop = q.get("stop") || "", route = q.get("route") || "";
    if (!/^\d{1,6}$/.test(city) || !ID.test(stop) || (path === "/location" && !ID.test(route))) return json({ error: "요청 값이 올바르지 않습니다." }, 400);
    try {
      let res;
      if (path === "/arrivals") res = await cached(request, 15, () => arrivals(city, stop, env, ctx));
      else if (path === "/location") res = await cached(request, 10, async () => {
        const b = await location(city, route, stop, env, ctx);
        if (!b) throw Object.assign(new Error("이 정류장에 서지 않는 노선입니다."), { status: 400 });
        return b;
      });
      else return json({ error: "없는 주소입니다." }, 404);
      const h = new Headers(res.headers); Object.entries(cors).forEach(([k, v]) => h.set(k, v));
      return new Response(res.body, { status: res.status, headers: h });
    } catch (e) {
      console.log("[BUS ERROR]", path, e.message);
      return json({ error: e.status === 400 ? e.message : "버스 정보를 받지 못했습니다. 잠시 후 다시 시도하세요." }, e.status || 502);
    }
  },
};
