// 시험: node tools/test_track.mjs  (지나간 버스 추정 규칙)
import { track } from "../lib.js";
const st = { city: 1, id: "X1" }, m = 60000, t0 = 1_000_000_000_000;
const bus = (route, minutes, left = 5) => ({ route_id: route, route_no: route, dest: "종점", minutes, left });
let p;
assert(track(st, [bus("A", 2), bus("B", 20)], t0).length === 0, "처음 본 화면엔 지나간 버스를 알 수 없음");
p = track(st, [bus("B", 19)], t0 + 30000);   // A(2분)가 사라짐 → 지나감
assert(p.length === 1 && p[0].route_id === "A", "곧 도착하던 A가 사라지면 지나감");
assert(p[0].at >= t0 && p[0].at <= t0 + 30000, "지나간 시각은 확인 시각 사이");
p = track(st, [bus("B", 18)], t0 + 90000);   // 1분 지남 → 계속 보임
assert(p.length === 1 && p[0].route_id === "A", "A 표시 유지");
p = track(st, [bus("A", 12), bus("B", 17)], t0 + 120000);   // 다음 A 도착 예정이 뜸 → 지움
assert(p.length === 0, "같은 노선 도착 예정이 뜨면 지나감 정보 삭제");
track(st, [bus("C", 15)], t0 + 150000);
p = track(st, [], t0 + 180000);   // C는 15분 전이라 임박이 아님 → 지나간 것으로 보지 않음
assert(p.length === 0, "멀리 있던 버스가 사라진 건 지나감이 아님");
track(st, [bus("D", 1)], t0 + 200000); p = track(st, [], t0 + 230000);
assert(p.length === 1, "D 지나감");
p = track(st, [], t0 + 230000 + 16 * m);
assert(p.length === 0, "15분 뒤 지움");
console.log("ok");
function assert(c, msg) { if (!c) { console.error("실패:", msg); process.exit(1); } }
