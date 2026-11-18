// 시험: DATA_GO_KR_KEY=키 node test.mjs  (Worker 코드를 직접 불러 실제 TAGO에 물음, 캐시는 가짜)
import { arrivals, location } from "./src/index.js";
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
const env = { DATA_GO_KR_KEY: process.env.DATA_GO_KR_KEY }, ctx = { waitUntil: () => {} };
const a = await arrivals("34040", "ASB288000775", env, ctx);   // 아산시청
console.log("도착", a.length, a[0]);
console.assert(Array.isArray(a));
const r = a.find((x) => x.minutes != null) || a[0];
if (r) { const b = await location("34040", r.route_id, "ASB288000775", env, ctx); console.log("위치", b?.slice(0, 2)); console.assert(b === null || Array.isArray(b)); }
console.assert((await location("34040", "NOPE12345", "ASB288000775", env, ctx).catch(() => null)) === null);
console.log("ok");
