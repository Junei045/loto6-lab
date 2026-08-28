#!/usr/bin/env python3
"""
Loto6 データ自動更新スクリプト
- 公開CSV (https://loto6.thekyo.jp/data/loto6.csv) を取得
- CP932 デコード・バリデーション
- 過去10年（ローリング）のデータに絞り込み
- data/draws.js / data/stats.js / data/stats.json を生成（アトミック置換）
- バリデーション失敗時は既存ファイルを変更せず非零終了
"""
import csv
import io
import json
import os
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone, timedelta
from collections import Counter

# リポジトリ内でどこから実行しても動くよう、スクリプト自身の場所を基準にする
APP_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_URL = "https://loto6.thekyo.jp/data/loto6.csv"
JST = timezone(timedelta(hours=9))

def log(msg):
    print(f"[loto6-update] {msg}", flush=True)

def fail(msg):
    log(f"FAIL: {msg}")
    sys.exit(1)

def download_csv():
    req = urllib.request.Request(
        CSV_URL, headers={"User-Agent": "Mozilla/5.0 (compatible; Loto6Updater)"}
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
    except Exception as e:
        fail(f"ダウンロード失敗: {e}")
    try:
        text = raw.decode("cp932")
    except Exception:
        try:
            text = raw.decode("utf-8")
        except Exception as e:
            fail(f"デコード失敗: {e}")
    return text

def parse_draws(text):
    reader = csv.reader(io.StringIO(text))
    header = next(reader, None)
    if not header or "第1数字" not in header:
        fail("ヘッダ異常")
    rows = []
    for r in reader:
        if not r or not r[0].strip():
            continue
        try:
            num = int(r[0].strip())
            d = datetime.strptime(r[1].strip(), "%Y/%m/%d")
            date = d.strftime("%Y-%m-%d")
            main = [int(x) for x in r[2:8]]
            bonus = int(r[8])
            winners = [int(x) for x in r[9:14]] if len(r) >= 14 else None   # 1〜5等 口数
            prize1 = int(r[14]) if len(r) >= 15 else None                    # 1等賞金
        except (ValueError, IndexError):
            continue
        if len(main) != 6 or len(set(main)) != 6:
            continue
        if not all(1 <= n <= 43 for n in main):
            continue
        if not (1 <= bonus <= 43):
            continue
        rows.append({
            "num": num,
            "date": date,
            "main": main,
            "bonus": bonus,
            "winners": winners,
            "prize1": prize1,
        })
    if len(rows) < 500:
        fail(f"有効行が少なすぎ: {len(rows)}")
    nums = [r["num"] for r in rows]
    if nums != sorted(nums):
        fail("抽せん回号が単調増加でない")
    return rows

def filter_10y(rows):
    now = datetime.now(JST)
    cutoff = now.replace(year=now.year - 10, tzinfo=None)
    sub = [r for r in rows if datetime.strptime(r["date"], "%Y-%m-%d") >= cutoff]
    if len(sub) < 500:
        fail(f"10年フィルタ後データ不足: {len(sub)}")
    return sub

def compute_popularity(draws):
    """
    5等（本数字3個一致）の当せん口数から、各数字の「買われやすさ」を推定する。
    5等は口数が毎回10万〜30万と多く安定し、賞金1,000円固定で分け前の影響を受けない。
    モデル: log(5等口数) = 年ダミー + Σ β_n × [数字nが出た]
    年ダミーで売上の年次変動を吸収し、β_n を平均0に正規化して指数(100=平均)にする。
    ブートストラップで標準誤差も出す。
    """
    try:
        import numpy as np
    except ImportError:
        log("numpy が無いため人気度推定をスキップ")
        return None
    sub = [d for d in draws if d.get("winners") and d["winners"][4] > 0]
    if len(sub) < 300:
        return None
    years = sorted({int(d["date"][:4]) for d in sub})
    n = len(sub)
    X = np.zeros((n, 43 + len(years)))
    for i, d in enumerate(sub):
        for m in d["main"]:
            X[i, m - 1] = 1
        X[i, 43 + years.index(int(d["date"][:4]))] = 1
    y = np.log(np.array([d["winners"][4] for d in sub], float))
    lam = 1e-6  # 数字列と年列が共線（各行の数字列は必ず6個）なので極小リッジで解く
    def solve(Xa, ya):
        b = np.linalg.solve(Xa.T @ Xa + lam * np.eye(Xa.shape[1]), Xa.T @ ya)[:43]
        return b - b.mean()
    beta = solve(X, y)
    rng = np.random.default_rng(0)
    bs = []
    for _ in range(200):
        idx = rng.integers(0, n, n)
        bs.append(solve(X[idx], y[idx]))
    se = np.std(bs, axis=0)
    full = np.linalg.solve(X.T @ X + lam * np.eye(X.shape[1]), X.T @ y)
    r2 = 1 - float(np.var(y - X @ full) / np.var(y))
    index = np.exp(beta) * 100
    return {
        "method": "5等口数の対数を年ダミー＋数字ダミーで回帰",
        "draws_used": n,
        "r2": round(r2, 3),
        "list": [{"num": i + 1, "index": round(float(index[i]), 1), "se": round(float(se[i] * 100), 1)} for i in range(43)],
        "avg_1_31": round(float(index[:31].mean()), 1),
        "avg_32_43": round(float(index[31:].mean()), 1),
    }

def compute_stats(draws):
    all_num = [n for d in draws for n in d["main"]]
    freq = Counter(all_num)
    freq_list = [{"num": k, "count": v, "pct": round(v / len(draws) * 100, 2)} for k, v in sorted(freq.items())]
    total = len(draws)
    expected = round(total * 6 / 43, 1)
    hot = sorted(freq_list, key=lambda x: (-x["count"], x["num"]))[:10]
    cold = sorted(freq_list, key=lambda x: (x["count"], x["num"]))[:10]
    all_bonus = [d["bonus"] for d in draws]
    bfreq = Counter(all_bonus)
    bonus_list = [{"num": k, "count": v, "pct": round(v / total * 100, 2)} for k, v in sorted(bfreq.items())]
    recent_50 = draws[-50:]
    recent_100 = draws[-100:]
    def hot_cold(sub, n=8):
        c = Counter(x for d in sub for x in d["main"])
        hot_ = [{"num": k, "count": v} for k, v in sorted(c.items(), key=lambda x: (-x[1], x[0]))[:n]]
        cl = [{"num": k, "count": v} for k, v in sorted(c.items(), key=lambda x: (x[1], x[0]))[:n]]
        return {"hot": hot_, "cold": cl}
    oe = {}
    for d in draws:
        o = sum(1 for n in d["main"] if n % 2 == 1)
        oe[(o, 6 - o)] = oe.get((o, 6 - o), 0) + 1
    oe_list = [{"odd": k[0], "even": k[1], "count": v, "pct": round(v / total * 100, 1)} for k, v in sorted(oe.items())]
    sums = [sum(d["main"]) for d in draws]
    sum_bins = {}
    for s in sums:
        b = (s // 20) * 20
        sum_bins[b] = sum_bins.get(b, 0) + 1
    sum_hist = [{"bin": f"{b}-{b+19}", "count": v} for b, v in sorted(sum_bins.items())]
    consec = 0
    for d in draws:
        m = sorted(d["main"])
        if any(m[i + 1] - m[i] == 1 for i in range(5)):
            consec += 1
    chi = round(sum((c["count"] - expected) ** 2 / expected for c in freq_list), 2)
    latest = draws[-1]
    return {
        "total_draws": total,
        "date_range": {"start": draws[0]["date"], "end": draws[-1]["date"],
                       "first_draw": draws[0]["num"], "last_draw": draws[-1]["num"]},
        "latest_draw": {"num": latest["num"], "date": latest["date"], "main": latest["main"], "bonus": latest["bonus"]},
        "expected_per_number": expected,
        "chi_square": chi,
        "chi_critical_5pct": 58.12,  # χ²分布 自由度42・上側5%点
        "frequency": freq_list,
        "bonus_frequency": bonus_list,
        "hot_alltime": hot,
        "cold_alltime": cold,
        "recent_50": hot_cold(recent_50),
        "recent_100": hot_cold(recent_100),
        "odd_even": oe_list,
        "sum_stats": {
            "min": min(sums), "max": max(sums),
            "mean": round(sum(sums) / len(sums), 1),
            "median": round(sorted(sums)[len(sums) // 2], 1),
            "stdev": round((sum((x - sum(sums) / len(sums)) ** 2 for x in sums) / len(sums)) ** 0.5, 1),
        },
        "sum_histogram": sum_hist,
        "consecutive": {"with_consec": consec, "without": total - consec, "pct": round(consec / total * 100, 1)},
        "popularity": compute_popularity(draws),
        "generated_at": datetime.now(JST).strftime("%Y-%m-%d %H:%M JST"),
    }

def atomic_write(path, content):
    d = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp_", suffix=".js")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(content)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)

def main():
    log("ダウンロード開始")
    text = download_csv()
    log(f"CSVサイズ: {len(text)} bytes")
    all_draws = parse_draws(text)
    log(f"全有効抽せん: {len(all_draws)} 回 (最新 第{all_draws[-1]['num']}回 {all_draws[-1]['date']})")
    draws10 = filter_10y(all_draws)
    log(f"10年対象: {len(draws10)} 回")
    stats = compute_stats(draws10)

    draws_js = f"// ロト6 過去10年データ (自動生成 {stats['generated_at']})\n"
    draws_js += "window.LOTO6_DRAWS = " + json.dumps(draws10, ensure_ascii=False) + ";\n"
    stats_js = f"// ロト6 統計データ (自動生成 {stats['generated_at']})\n"
    stats_js += "window.LOTO6_STATS = " + json.dumps(stats, ensure_ascii=False) + ";\n"
    stats_json = json.dumps(stats, ensure_ascii=False, indent=2)

    atomic_write(os.path.join(APP_DIR, "data", "draws.js"), draws_js)
    atomic_write(os.path.join(APP_DIR, "data", "stats.js"), stats_js)
    atomic_write(os.path.join(APP_DIR, "data", "stats.json"), stats_json)
    log(f"更新完了: 第{stats['latest_draw']['num']}回 ({stats['latest_draw']['date']}) / {stats['generated_at']}")
    return stats

if __name__ == "__main__":
    main()
