"""전국 버스정류장 파일(odcloud 15067528) → data/cities/{도시코드}.json + data/cities.json (도시 목록·범위).
실행: DATA_GO_KR_KEY=키 python tools/build_stops.py   (약 3분, 정류장 파일이 갱신되면 다시 실행해 커밋)
도시 파일 한 줄 = [정류장번호, 이름, 위도, 경도]. 페이지가 이 파일을 바로 읽어 근처·이름 검색을 함(키 불필요)."""
import json
import os
import sys
import time

import requests

URL = "https://api.odcloud.kr/api/15067528/v1/uddi:ed6af349-4869-4c9a-82e1-82ecc32c686e"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")


def main():
    key = os.environ.get("DATA_GO_KR_KEY") or sys.exit("DATA_GO_KR_KEY 환경변수가 필요합니다.")
    cities, page, total = {}, 1, None
    while total is None or (page - 1) * 1000 < total:
        for attempt in range(4):   # 한 쪽이 실패해도 다시 시도
            try:
                r = requests.get(URL, timeout=60, params={"serviceKey": key, "perPage": 1000, "page": page})
                r.raise_for_status()
                j = r.json()
                break
            except Exception as e:
                print("재시도", page, e)
                time.sleep(2 * (attempt + 1))
        else:
            sys.exit(f"{page}쪽을 받지 못했습니다.")
        total = j["totalCount"]
        for x in j["data"]:
            c = cities.setdefault(int(x["도시코드"]), {"name": x["도시명"], "stops": []})
            c["stops"].append([x["정류장번호"], x["정류장명"], round(float(x["위도"]), 5), round(float(x["경도"]), 5)])
        page += 1
        if page % 20 == 0:
            print(page, "/", total // 1000 + 1)
    os.makedirs(os.path.join(ROOT, "cities"), exist_ok=True)
    index = []
    for code, c in sorted(cities.items()):
        s = c["stops"]
        with open(os.path.join(ROOT, "cities", f"{code}.json"), "w", encoding="utf-8") as f:
            json.dump(s, f, ensure_ascii=False, separators=(",", ":"))
        lats, lngs = [t[2] for t in s], [t[3] for t in s]
        index.append({"code": code, "name": c["name"], "n": len(s), "box": [min(lats), min(lngs), max(lats), max(lngs)]})
    with open(os.path.join(ROOT, "cities.json"), "w", encoding="utf-8") as f:
        json.dump({"built": time.strftime("%Y-%m-%d"), "total": total, "cities": index}, f, ensure_ascii=False, separators=(",", ":"))
    print("도시", len(index), "정류장", total)


if __name__ == "__main__":
    main()
