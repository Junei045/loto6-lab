// ===== ロト6 分析＆予測ラボ — app.js =====
(function () {
  const STATS = window.LOTO6_STATS;
  const DRAWS = window.LOTO6_DRAWS.map((r) => ({
    draw: r.num, date: r.date, mains: r.main, bonus: r.bonus, winners: r.winners, prize1: r.prize1,
  })); // sorted ascending by draw number

  // ---------- Theme toggle (respects system preference) ----------
  (function () {
    const root = document.documentElement;
    let dark = matchMedia('(prefers-color-scheme:dark)').matches;
    const apply = () => {
      root.setAttribute('data-theme', dark ? 'dark' : 'light');
      const b = document.getElementById('themeBtn');
      if (b) b.textContent = dark ? '☀️' : '🌙';
    };
    apply();
    const btn = document.getElementById('themeBtn');
    if (btn) btn.addEventListener('click', () => { dark = !dark; apply(); });
  })();

  // ---------- Header / KPIs ----------
  document.getElementById('hdr-count').textContent = STATS.total_draws.toLocaleString('ja-JP');
  document.getElementById('range-pill').textContent =
    `第${STATS.date_range.first_draw}回 〜 第${STATS.date_range.last_draw}回`;
  document.getElementById('kpi-draws').textContent = STATS.total_draws.toLocaleString('ja-JP') + '回';

  // ---------- データ鮮度表示 ----------
  (function () {
    const latestEl = document.getElementById('fresh-latest');
    const updatedEl = document.getElementById('fresh-updated');
    if (latestEl && STATS.latest_draw) {
      latestEl.textContent = `第${STATS.latest_draw.num}回 (${STATS.latest_draw.date})`;
    }
    if (updatedEl && STATS.generated_at) {
      updatedEl.textContent = STATS.generated_at;
    }
  })();
  document.getElementById('kpi-period').textContent =
    STATS.date_range.start.slice(0, 7).replace('-', '/') + ' 〜 ' + STATS.date_range.end.slice(0, 7).replace('-', '/');
  document.getElementById('kpi-chi').textContent = STATS.chi_square;
  document.getElementById('kpi-mean').textContent = STATS.sum_stats.mean;

  // ---------- Chart color helpers ----------
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const gold = () => cssVar('--color-gold') || '#e8950a';
  const muted = () => cssVar('--color-text-muted') || '#6a655c';
  const border = () => cssVar('--color-border') || '#d8d3c8';
  const text = () => cssVar('--color-text') || '#1f1c16';

  Chart.defaults.font.family = "'Noto Sans JP', sans-serif";
  Chart.defaults.color = muted();
  Chart.defaults.borderColor = border();

  // ---------- Frequency chart ----------
  const freqCtx = document.getElementById('freqChart');
  const freqLabels = STATS.frequency.map((f) => f.num);
  const freqCounts = STATS.frequency.map((f) => f.count);
  const expected = STATS.expected_per_number;
  new Chart(freqCtx, {
    type: 'bar',
    data: {
      labels: freqLabels,
      datasets: [
        {
          label: '出現回数',
          data: freqCounts,
          backgroundColor: freqCounts.map((c) =>
            c > expected * 1.08 ? gold() : c < expected * 0.92 ? color('muted-cold') : color('neutral')
          ),
          borderRadius: 3,
          maxBarThickness: 16,
        },
        {
          label: `期待値 (${expected})`,
          data: freqLabels.map(() => expected),
          type: 'line',
          borderColor: text(),
          borderDash: [4, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              if (ctx.dataset.type === 'line') return ctx.dataset.label;
              const pct = STATS.frequency[ctx.dataIndex].pct;
              return `出現 ${ctx.raw}回 (${pct}%)`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { font: { size: 10 }, maxTicksLimit: 22, autoSkip: true, maxRotation: 0 }, grid: { display: false } },
        y: { beginAtZero: true, grid: { color: border() } },
      },
    },
  });

  function color(kind) {
    if (kind === 'muted-cold') return getComputedStyle(document.documentElement).getPropertyValue('--color-text-faint') || '#a8a296';
    return getComputedStyle(document.documentElement).getPropertyValue('--color-border') || '#d8d3c8';
  }

  document.getElementById('chi-note').textContent =
    STATS.chi_square < STATS.chi_critical_5pct
      ? `カイ二乗統計量 ${STATS.chi_square}（自由度42・有意水準5%の臨界値 ${STATS.chi_critical_5pct}）。臨界値未満のため、出現回数の偏りは統計的に有意ではなく、番号選出はランダム性と一致します。ホット／コールドの差は「サイコロを1,000回振ったときの目の偏り」と同じ、偶然の範囲内です。`
      : `カイ二乗統計量 ${STATS.chi_square}（自由度42・有意水準5%の臨界値 ${STATS.chi_critical_5pct}）。臨界値を超えており、有意水準5%では出現回数に偏りが見られます（ただし多重検定・期間の切り方による見かけの偏りの可能性もあります）。`;

  // ---------- Hot / Cold lists ----------
  function renderNumList(elId, list) {
    const el = document.getElementById(elId);
    el.innerHTML = list
      .map(
        (item) =>
          `<li><span class="ball-mini">${item.num}</span><span class="cnt">${item.count}回 (${item.pct}%)</span></li>`
      )
      .join('');
  }
  renderNumList('hotList', STATS.hot_alltime);
  renderNumList('coldList', STATS.cold_alltime);

  // ---------- Odd/Even chart ----------
  new Chart(document.getElementById('oeChart'), {
    type: 'bar',
    data: {
      labels: STATS.odd_even.map((o) => `奇${o.odd}:偶${o.even}`),
      datasets: [
        {
          data: STATS.odd_even.map((o) => o.count),
          backgroundColor: gold(),
          borderRadius: 4,
          maxBarThickness: 28,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `${ctx.raw}回 (${STATS.odd_even[ctx.dataIndex].pct}%)` } },
      },
      scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: { beginAtZero: true, grid: { color: border() } } },
    },
  });

  // ---------- Sum distribution chart ----------
  document.getElementById('sumMean').textContent = STATS.sum_stats.mean;
  new Chart(document.getElementById('sumChart'), {
    type: 'bar',
    data: {
      labels: STATS.sum_histogram.map((b) => b.bin),
      datasets: [
        {
          data: STATS.sum_histogram.map((b) => b.count),
          backgroundColor: gold(),
          borderRadius: 4,
          maxBarThickness: 28,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 60 } }, y: { beginAtZero: true, grid: { color: border() } } },
    },
  });

  // ---------- Consecutive stat ----------
  document.getElementById('consecPct').textContent = STATS.consecutive.pct + '%';

  // ---------- Recent draws table ----------
  const RECENT_N = 20;
  const recent = DRAWS.slice(-RECENT_N).reverse();
  document.getElementById('recentCount').textContent = RECENT_N;
  document.getElementById('recentTable').innerHTML = recent
    .map(
      (r) => `<tr>
      <td>第${r.draw}回</td>
      <td>${r.date}</td>
      <td><span class="ball-row">${r.mains.map((m) => `<span class="ball-mini">${m}</span>`).join('')}</span></td>
      <td><span class="ball-mini bonus-ball">${r.bonus}</span></td>
      <td>${r.winners ? `${r.winners[0]}口${r.winners[0] ? ` <span class="prize">${(r.prize1 / 1e8).toFixed(2)}億円</span>` : ' <span class="prize">CO</span>'}` : '—'}</td>
    </tr>`
    )
    .join('');

  // ---------- Prediction generator ----------
  const freqMap = {};
  STATS.frequency.forEach((f) => (freqMap[f.num] = f.count));
  const allNums = Array.from({ length: 43 }, (_, i) => i + 1);
  const POP = STATS.popularity; // null の場合あり
  const popMap = {};
  if (POP) POP.list.forEach((p) => (popMap[p.num] = p.index));

  function weightedSample(weights, count) {
    // weights: {num: weight}
    const pool = allNums.map((n) => ({ num: n, w: Math.max(weights[n] || 1, 0.1) }));
    const picked = [];
    while (picked.length < count) {
      const total = pool.reduce((s, p) => s + p.w, 0);
      let r = Math.random() * total;
      for (let i = 0; i < pool.length; i++) {
        r -= pool[i].w;
        if (r <= 0) {
          picked.push(pool[i].num);
          pool.splice(i, 1);
          break;
        }
      }
    }
    return picked.sort((a, b) => a - b);
  }

  function generateSet(mode) {
    if (mode === 'freq') {
      return weightedSample(freqMap, 6);
    }
    if (mode === 'recent') {
      // weight recent 100 draws directly
      const w = {};
      allNums.forEach((n) => (w[n] = 1));
      const last100 = DRAWS.slice(-100);
      last100.forEach((r) => r.mains.forEach((m) => (w[m] = (w[m] || 1) + 3)));
      return weightedSample(w, 6);
    }
    if (mode === 'balance') {
      // aim for 3odd/3even (or close), spread across ranges, avoid too many consecutive
      let attempt = 0;
      while (attempt < 60) {
        attempt++;
        const picks = weightedSample(freqMap, 6);
        const odds = picks.filter((n) => n % 2 === 1).length;
        const ranges = new Set(picks.map((n) => Math.min(Math.floor((n - 1) / 11), 3)));
        const consec = picks.some((n, i) => i > 0 && picks[i] - picks[i - 1] === 1);
        if (odds >= 2 && odds <= 4 && ranges.size >= 3 && !consec) return picks;
      }
      return weightedSample(freqMap, 6);
    }
    if (mode === 'unpopular' && POP) {
      // 買われにくい数字ほど重く。(100/指数)^8 で 40→約2.5倍、11→約0.4倍
      const w = {};
      allNums.forEach((n) => (w[n] = Math.pow(100 / popMap[n], 8)));
      return weightedSample(w, 6);
    }
    // pure random
    const w = {};
    allNums.forEach((n) => (w[n] = 1));
    return weightedSample(w, 6);
  }
  // 組合せの「同じ数字を買っている人の多さ」: 各数字の指数(100=平均)の積
  function setPopularity(nums) {
    if (!POP) return null;
    return nums.reduce((p, n) => p * (popMap[n] / 100), 1);
  }
  function renderPop(nums) {
    const el = document.getElementById('predictPop');
    const r = setPopularity(nums);
    if (r == null) { el.textContent = ''; return; }
    el.innerHTML = `この組合せを買っている人は平均の約 <strong>${r.toFixed(2)}倍</strong>（1未満なら当せん時に一人占めしやすい・当せん確率は不変）`;
  }

  const modeNames = { freq: '頻度重視（過去10年の出現頻度で重み付け）', recent: '直近トレンド重視（直近100回を強く反映）', balance: 'バランス型（奇偶バランス・数字レンジの分散・連番回避を優先）', random: '完全ランダム（統計無視・参考比較用）', unpopular: '分け前重視（買われにくい数字に重み付け。当たったとき分け前が減りにくい）' };
  if (!POP) { const b = document.querySelector('[data-mode="unpopular"]'); if (b) b.remove(); }

  let currentMode = 'freq';

  function renderBalls(nums, bonus) {
    const container = document.getElementById('predictBalls');
    container.innerHTML = nums.map((n) => `<span class="ball spin">${n}</span>`).join('') + (bonus ? `<span class="ball bonus spin">${bonus}</span>` : '');
  }

  document.querySelectorAll('.btn-mode').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-mode').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentMode = btn.dataset.mode;
      document.getElementById('predictMeta').textContent = modeNames[currentMode];
    });
  });
  document.getElementById('predictMeta').textContent = modeNames[currentMode];

  document.getElementById('generateBtn').addEventListener('click', () => {
    const set = generateSet(currentMode);
    renderBalls(set);
    renderPop(set);
    document.getElementById('predictNote').textContent =
      '生成条件: ' + modeNames[currentMode] + '。この番号が当選する可能性は、他のどの組み合わせとも完全に同一です（宝くじは独立事象のため）。';
    document.getElementById('predictSet').innerHTML = '';
  });

  document.getElementById('gen5Btn').addEventListener('click', () => {
    const rows = [];
    for (let i = 0; i < 5; i++) {
      const set = generateSet(currentMode);
      const r = setPopularity(set);
      rows.push(
        `<div class="set-row"><span class="set-label">候補${i + 1}</span>${set
          .map((n) => `<span class="ball-mini">${n}</span>`)
          .join('')}${r != null ? `<span class="note" style="margin:0 0 0 auto">買われ方 ${r.toFixed(2)}倍</span>` : ''}</div>`
      );
    }
    document.getElementById('predictSet').innerHTML = rows.join('');
    document.getElementById('predictBalls').innerHTML =
      '<span class="ball placeholder">?</span>'.repeat(6);
    document.getElementById('predictPop').textContent = '';
    document.getElementById('predictNote').textContent =
      '生成条件: ' + modeNames[currentMode] + '。5セットとも当選確率は同一です。';
  });

  // ---------- 買われやすさ指数チャート ----------
  (function () {
    const sec = document.getElementById('popChart').closest('section');
    if (!POP) { sec.style.display = 'none'; return; }
    const idx = POP.list.map((p) => p.index);
    new Chart(document.getElementById('popChart'), {
      type: 'bar',
      data: {
        labels: POP.list.map((p) => p.num),
        datasets: [
          {
            label: '買われやすさ指数',
            data: idx,
            backgroundColor: idx.map((v) => (v > 103 ? gold() : v < 97 ? color('muted-cold') : color('neutral'))),
            borderRadius: 3, maxBarThickness: 16,
          },
          { label: '平均 (100)', data: idx.map(() => 100), type: 'line', borderColor: text(), borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0, fill: false },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: (ctx) => ctx.dataset.type === 'line' ? ctx.dataset.label : `指数 ${ctx.raw}（±${POP.list[ctx.dataIndex].se}）` } },
        },
        scales: {
          x: { ticks: { font: { size: 10 }, maxTicksLimit: 22, autoSkip: true, maxRotation: 0 }, grid: { display: false } },
          y: { min: 80, max: 120, grid: { color: border() } },
        },
      },
    });
    const top = [...POP.list].sort((a, b) => b.index - a.index).slice(0, 5).map((p) => p.num).join(', ');
    const low = [...POP.list].sort((a, b) => a.index - b.index).slice(0, 5).map((p) => p.num).join(', ');
    document.getElementById('pop-note').textContent =
      `みずほ銀行公表の5等（3個一致）当せん口数 ${POP.draws_used}回分を、年ごとの売上変動を除いて回帰分析した推定値（決定係数 ${POP.r2}）。` +
      `よく買われる: ${top} ／ あまり買われない: ${low}。1〜31の平均 ${POP.avg_1_31}、32〜43の平均 ${POP.avg_32_43}。` +
      `これは「出やすさ」ではなく「他の人と重なりやすさ」です。当せん確率には一切影響しません。`;
  })();

  // ---------- 当せん確率（理論値） ----------
  (function () {
    const C = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return Math.round(r); };
    const total = C(43, 6); // 6,096,454
    const fmt = (n) => Math.round(n).toLocaleString('ja-JP');
    const rows = [
      { rank: '1等', cond: '本数字6個すべて一致', ways: 1 },
      { rank: '2等', cond: '本数字5個＋ボーナス数字', ways: C(6, 5) * 1 },
      { rank: '3等', cond: '本数字5個（ボーナス不一致）', ways: C(6, 5) * (37 - 1) },
      { rank: '4等', cond: '本数字4個', ways: C(6, 4) * C(37, 2) },
      { rank: '5等', cond: '本数字3個', ways: C(6, 3) * C(37, 3) },
    ];
    document.getElementById('oddsTable').innerHTML =
      '<thead><tr><th>等級</th><th>条件</th><th>確率</th></tr></thead><tbody>' +
      rows.map((r) => `<tr><td>${r.rank}</td><td class="cond">${r.cond}</td><td>1 / ${fmt(total / r.ways)}</td></tr>`).join('') +
      '</tbody>';
  })();

  // ---------- バックテスト ----------
  const BT_DRAWS = 200, BT_TICKETS = 200;
  document.getElementById('btDraws').textContent = BT_DRAWS;
  document.getElementById('btTickets').textContent = BT_TICKETS;

  function weightsFor(mode, hist) {
    const w = {};
    allNums.forEach((n) => (w[n] = 1));
    if (mode === 'freq' || mode === 'balance') {
      hist.forEach((r) => r.mains.forEach((m) => (w[m] += 1)));
    } else if (mode === 'recent') {
      hist.slice(-100).forEach((r) => r.mains.forEach((m) => (w[m] += 3)));
    } else if (mode === 'unpopular') {
      allNums.forEach((n) => (w[n] = Math.pow(100 / popMap[n], 8)));
    }
    return w;
  }
  function sampleFor(mode, w) {
    if (mode !== 'balance') return weightedSample(w, 6);
    for (let attempt = 0; attempt < 60; attempt++) {
      const p = weightedSample(w, 6);
      const odds = p.filter((n) => n % 2 === 1).length;
      const ranges = new Set(p.map((n) => Math.min(Math.floor((n - 1) / 11), 3)));
      const consec = p.some((n, i) => i > 0 && p[i] - p[i - 1] === 1);
      if (odds >= 2 && odds <= 4 && ranges.size >= 3 && !consec) return p;
    }
    return weightedSample(w, 6);
  }

  document.getElementById('backtestBtn').addEventListener('click', () => {
    const btn = document.getElementById('backtestBtn');
    const status = document.getElementById('btStatus');
    btn.disabled = true; status.textContent = '計算中…';
    const modes = POP ? ['freq', 'recent', 'balance', 'random', 'unpopular'] : ['freq', 'recent', 'balance', 'random'];
    const label = { freq: '① 頻度重視', recent: '② 直近トレンド', balance: '③ バランス型', random: '④ 完全ランダム', unpopular: '⑤ 分け前重視' };
    const res = {}; modes.forEach((m) => (res[m] = { hits: [0, 0, 0, 0, 0, 0, 0], sum: 0 }));
    const start = Math.max(100, DRAWS.length - BT_DRAWS);
    let i = start;
    const step = () => {
      const t0 = performance.now();
      while (i < DRAWS.length && performance.now() - t0 < 40) {
        const hist = DRAWS.slice(0, i);
        const target = new Set(DRAWS[i].mains);
        modes.forEach((m) => {
          const w = weightsFor(m, hist);
          for (let t = 0; t < BT_TICKETS; t++) {
            const k = sampleFor(m, w).filter((n) => target.has(n)).length;
            res[m].hits[k]++; res[m].sum += k;
          }
        });
        i++;
      }
      status.textContent = `計算中… ${i - start} / ${DRAWS.length - start} 回`;
      if (i < DRAWS.length) return requestAnimationFrame(step);
      const nTickets = (DRAWS.length - start) * BT_TICKETS;
      const pct = (v) => (v / nTickets * 100).toFixed(2) + '%';
      document.getElementById('btTable').innerHTML =
        '<thead><tr><th>モード</th><th>平均一致数/口</th><th>3個以上(5等〜)</th><th>4個以上(4等〜)</th><th>5個以上(3等〜)</th></tr></thead><tbody>' +
        modes.map((m) => {
          const h = res[m].hits;
          const ge = (k) => h.slice(k).reduce((s, v) => s + v, 0);
          return `<tr><td class="mode">${label[m]}</td><td class="hl">${(res[m].sum / nTickets).toFixed(3)}</td><td>${pct(ge(3))}</td><td>${pct(ge(4))}</td><td>${pct(ge(5))}</td></tr>`;
        }).join('') +
        `<tr><td class="mode">理論値（どの買い方でも）</td><td>0.837</td><td>2.72%</td><td>0.17%</td><td>0.004%</td></tr></tbody>`;
      document.getElementById('btNote').textContent =
        `合計 ${nTickets.toLocaleString('ja-JP')} 口を検証しました。各モードの平均一致数が理論値 0.837 とほぼ同じなら、統計的な絞り込みには当せん確率を上げる効果がない（＝抽せんが独立ランダムである）ことを意味します。数値は実行のたびに少し変わります（乱数のため）。`;
      status.textContent = '完了'; btn.disabled = false;
    };
    requestAnimationFrame(step);
  });
})();
