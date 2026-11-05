const DEFAULT_PASSWORD = "";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const password = env.DASHBOARD_PASSWORD || DEFAULT_PASSWORD;

    if (url.pathname === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    if (request.method === "GET") {
      if (!password) {
        return new Response("Dashboard disabled. Configure DASHBOARD_PASSWORD in Worker secrets.", { status: 503 });
      }

      if (url.searchParams.get("pass") !== password) {
        return new Response("Unauthorized. Please provide the correct ?pass= parameter.", { status: 401 });
      }

      if (!env.TELEMETRY_KV) {
        return new Response("TELEMETRY_KV namespace not bound.", { status: 500 });
      }

      const rawData = [];

      let cursor = null;
      let isComplete = false;

      while (!isComplete) {
        const kvList = await env.TELEMETRY_KV.list({ prefix: "inst:", cursor });

        for (const key of kvList.keys) {
          if (key.metadata) {
            rawData.push({
              version: key.metadata.v || "unknown",
              os: key.metadata.o || "unknown",
              distribution: key.metadata.d || "unknown",
              architecture: key.metadata.a || "unknown",
              platform: [key.metadata.o, key.metadata.d, key.metadata.a]
                .filter((value) => value && value.toLowerCase() !== "unknown" && value.toLowerCase() !== "notapplicable")
                .join(" / ") || "unknown",
              target: key.metadata.t || "unknown",
              country: key.metadata.c || "unknown",
              count: 1 // Since each key is a unique instance
            });
          }
        }

        isComplete = kvList.list_complete;
        cursor = kvList.cursor;
      }

      // Return the HTML/JS Dashboard
      return new Response(renderDashboard(rawData), {
        headers: { "Content-Type": "text/html" }
      });
    }

    // HANDLE INCOMING TELEMETRY REQUEST
    if (request.method === "POST") {
      try {
        const data = await request.json();

        const { InstanceId, os, distribution, architecture, target, appVersion } = data;
        if (!InstanceId || !appVersion) {
          return new Response("Bad Request", { status: 400 });
        }

        // Sanitize string inputs
        const clean = (val) => String(val || "unknown").replace(/[^a-zA-Z0-9.+-]/g, "");
        const sVersion = clean(appVersion);
        const sOs = clean(os);
        const sDistribution = clean(distribution);
        const sArchitecture = clean(architecture);
        const sTarget = clean(target);
        const sId = clean(InstanceId);
        const sCountry = request.cf && request.cf.country ? String(request.cf.country).replace(/[^a-zA-Z]/g, "") : "unknown";

        if (env.TELEMETRY_KV) {
          await env.TELEMETRY_KV.put(`inst:${sId}`, "", {
            metadata: {
              v: sVersion,
              o: sOs,
              d: sDistribution,
              a: sArchitecture,
              t: sTarget,
              c: sCountry,
              lastSeen: new Date().toISOString()
            }
          });
        }

        return new Response(JSON.stringify({ status: "success" }), {
          status: 200, headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response("Bad Request", { status: 400 });
      }
    }

    return new Response("Method Not Allowed", { status: 405 });
  }
};

// HTML & CHART
function renderDashboard(data) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="dark">
    <meta name="theme-color" content="#101010">
    <title>Posterizarr Telemetry</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script type="text/javascript" src="https://www.gstatic.com/charts/loader.js"></script>
    <style>
      :root { color-scheme: dark; --ink: #101010; --surface: #181818; --raised: #202020; --line: #303030; --text: #f2f2f2; --muted: #a7a7a7; --orange: #ff880d; --orange-soft: #ffb36d; --rust: #b24c0c; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; background: var(--ink); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
      .container { width: min(1180px, 100% - 48px); margin: 0 auto; padding: 48px 0 64px; }
      .page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding-bottom: 26px; border-bottom: 1px solid var(--line); }
      .eyebrow { margin: 0 0 10px; color: var(--orange-soft); font-size: 11px; font-weight: 750; letter-spacing: .14em; text-transform: uppercase; }
      h1 { margin: 0; color: var(--text); font-size: clamp(30px, 4vw, 44px); font-weight: 650; letter-spacing: -.035em; line-height: 1.08; }
      .intro { max-width: 620px; margin: 12px 0 0; color: var(--muted); font-size: 15px; line-height: 1.6; }
      .privacy-badge { flex: none; padding: 9px 12px; border: 1px solid #4d321c; border-radius: 4px; background: #21180f; color: var(--orange-soft); font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
      .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 22px 0; }
      .metric { min-width: 0; padding: 17px 18px; border: 1px solid var(--line); border-top: 2px solid var(--orange); border-radius: 4px; background: var(--surface); }
      .metric-label { display: block; color: var(--muted); font-size: 12px; }
      .metric-value { display: block; overflow: hidden; margin-top: 8px; color: var(--text); font-size: 24px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
      .metric-note { display: block; margin-top: 5px; color: #777; font-size: 11px; }
      .analytics-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
      .panel { min-width: 0; padding: 18px 20px; border: 1px solid var(--line); border-radius: 4px; background: var(--surface); }
      .panel-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
      .panel-heading h2 { margin: 0; color: var(--text); font-size: 16px; font-weight: 600; }
      .panel-heading .eyebrow { margin: 0; color: var(--muted); font-size: 10px; }
      .chart-frame { position: relative; height: 210px; }
      .map-panel { margin-top: 14px; }
      .map-container { height: 340px; }
      .table-panel { margin-top: 14px; }
      .table-scroll { overflow-x: auto; }
      .data-table { width: 100%; min-width: 540px; margin-top: 8px; border-collapse: collapse; }
      .data-table th, .data-table td { padding: 11px 12px; border-bottom: 1px solid var(--line); text-align: left; font-size: 13px; }
      .data-table th { color: var(--muted); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      .data-table td:last-child, .data-table th:last-child { text-align: right; }
      .data-table tbody tr:hover { background: #ffffff08; }
      .empty-state { margin: 18px 0 0; padding: 22px; border: 1px dashed #484848; color: var(--muted); text-align: center; }
      [hidden] { display: none !important; }
      @media (max-width: 760px) {
        .container { width: min(100% - 28px, 560px); padding: 28px 0 44px; }
        .page-header { align-items: flex-start; flex-direction: column; }
        .privacy-badge { align-self: flex-start; }
        .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
        .metric { padding: 14px; }
        .metric-value { font-size: 20px; }
        .analytics-grid { grid-template-columns: 1fr; }
        .chart-frame { height: 190px; }
        .map-container { height: 260px; }
      }
    </style>
  </head>
  <body>
    <main class="container">
      <header class="page-header">
        <div>
          <p class="eyebrow">POSTERIZARR / TELEMETRY</p>
          <h1>Usage overview</h1>
          <p class="intro">Aggregated installation signals help guide development. No file paths, library names, server addresses, or API keys are part of this dashboard.</p>
        </div>
        <div class="privacy-badge">Anonymous · Opt-out</div>
      </header>

      <section class="metric-grid" aria-label="Telemetry summary">
        <article class="metric"><span class="metric-label">Unique installations</span><strong class="metric-value" id="totalCount">0</strong><span class="metric-note">Deduplicated by random instance ID</span></article>
        <article class="metric"><span class="metric-label">Leading version</span><strong class="metric-value" id="topVersion">—</strong><span class="metric-note">Most recently reported app version</span></article>
        <article class="metric"><span class="metric-label">Leading platform</span><strong class="metric-value" id="topOS">—</strong><span class="metric-note">Runtime environment</span></article>
        <article class="metric"><span class="metric-label">Leading media server</span><strong class="metric-value" id="topTarget">—</strong><span class="metric-note">Configured target</span></article>
      </section>

      <p class="empty-state" id="emptyState" hidden>No telemetry records are available yet.</p>

      <section class="analytics-grid" id="analyticsGrid" aria-label="Aggregated installation charts">
        <article class="panel">
          <div class="panel-heading"><p class="eyebrow">RELEASES</p><h2>App versions</h2></div>
          <div class="chart-frame"><canvas id="chartVersion" aria-label="Installations by app version"></canvas></div>
        </article>
        <article class="panel">
          <div class="panel-heading"><p class="eyebrow">ENVIRONMENT</p><h2>Operating systems</h2></div>
          <div class="chart-frame"><canvas id="chartOS" aria-label="Installations by operating system"></canvas></div>
        </article>
        <article class="panel">
          <div class="panel-heading"><p class="eyebrow">PLATFORM DETAILS</p><h2>System profiles</h2></div>
          <div class="chart-frame"><canvas id="chartPlatform" aria-label="Installations by operating system, distribution, and architecture"></canvas></div>
        </article>
        <article class="panel">
          <div class="panel-heading"><p class="eyebrow">MEDIA SERVERS</p><h2>Configured targets</h2></div>
          <div class="chart-frame"><canvas id="chartTarget" aria-label="Installations by media server"></canvas></div>
        </article>
        <article class="panel">
          <div class="panel-heading"><p class="eyebrow">REGIONS</p><h2>Country signals</h2></div>
          <div class="chart-frame"><canvas id="chartCountry" aria-label="Installations by country"></canvas></div>
        </article>
      </section>

      <section class="panel map-panel" id="mapPanel">
        <div class="panel-heading"><div><p class="eyebrow">GLOBAL REACH</p><h2>Reported countries</h2></div></div>
        <div class="map-container"><div id="regions_div" style="width: 100%; height: 100%;"></div></div>
      </section>

      <section class="panel table-panel" id="tablePanel">
        <div class="panel-heading"><div><p class="eyebrow">DETAILS</p><h2>Aggregated records</h2></div></div>
        <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Version</th>
              <th>OS</th>
              <th>Distribution</th>
              <th>Architecture</th>
              <th>Target</th>
              <th>Country</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody id="dataTableBody">
          </tbody>
        </table>
        </div>
      </section>
    </main>

    <script>
      const rawData = ${JSON.stringify(data)};

      // Aggregate data helpers
      const aggregate = (field) => {
        const counts = {};
        rawData.forEach(d => {
          counts[d[field]] = (counts[d[field]] || 0) + d.count;
        });

        // Sort by count descending
        return Object.fromEntries(
            Object.entries(counts).sort(([,a],[,b]) => b - a)
        );
      };

      const total = rawData.reduce((acc, d) => acc + d.count, 0);
      document.getElementById('totalCount').innerText = total.toLocaleString();
      const hasData = rawData.length > 0;
      document.getElementById('emptyState').hidden = hasData;
      document.getElementById('analyticsGrid').hidden = !hasData;
      document.getElementById('mapPanel').hidden = !hasData;
      document.getElementById('tablePanel').hidden = !hasData;

      const buildChart = (ctxId, aggregatedData) => {
        const entries = Object.entries(aggregatedData).slice(0, 8);
        const topKey = entries[0]?.[0] || "-";
        if (typeof Chart === 'undefined') return topKey;

        new Chart(document.getElementById(ctxId), {
          type: 'bar',
          data: {
            labels: entries.map(([label]) => label),
            datasets: [{
              label: 'Installations',
              data: entries.map(([, count]) => count),
              backgroundColor: entries.map((_, index) => index === 0 ? '#ff880d' : '#b24c0c'),
              borderRadius: 3,
              borderSkipped: false,
              maxBarThickness: 22
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            animation: false,
            plugins: { legend: { display: false }, tooltip: { mode: 'nearest', intersect: true } },
            scales: {
              x: { beginAtZero: true, grid: { color: '#303030' }, border: { display: false }, ticks: { color: '#a7a7a7', precision: 0, maxTicksLimit: 5 } },
              y: { grid: { display: false }, border: { display: false }, ticks: { color: '#d8d8d8', autoSkip: false } }
            }
          }
        });
        return topKey;
      };

      const getCountryName = (code) => {
        if (!code || code.toLowerCase() === 'unknown') return 'Unknown';
        try {
          return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) || code;
        } catch (e) {
          return code;
        }
      };

      // Render categorical installation charts.
      document.getElementById('topVersion').innerText = buildChart('chartVersion', aggregate('version'));
      document.getElementById('topOS').innerText = buildChart('chartOS', aggregate('os'));
      buildChart('chartPlatform', aggregate('platform'));
      document.getElementById('topTarget').innerText = buildChart('chartTarget', aggregate('target'));
      
      const countryData = aggregate('country');
      const countryDataNamed = {};
      for (const [code, count] of Object.entries(countryData)) {
        countryDataNamed[getCountryName(code)] = count;
      }
      // Limit to top 10 so the graph doesn't skip labels like Germany
      const topCountriesArray = Object.entries(countryDataNamed)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      const topCountriesObj = Object.fromEntries(topCountriesArray);
      
      buildChart('chartCountry', topCountriesObj);

      // Populate Data Table
      const tableAgg = {};
      rawData.forEach(d => {
        const key = d.version + '|' + d.os + '|' + d.distribution + '|' + d.architecture + '|' + d.target + '|' + d.country;
        if (!tableAgg[key]) {
          tableAgg[key] = { ...d, count: 0 };
        }
        tableAgg[key].count += d.count;
      });
      const tableData = Object.values(tableAgg).sort((a, b) => b.count - a.count);
      
      const tbody = document.getElementById('dataTableBody');
      let html = '';
      tableData.forEach(row => {
        html += '<tr>' +
          '<td>' + row.version + '</td>' +
          '<td>' + row.os + '</td>' +
          '<td>' + row.distribution + '</td>' +
          '<td>' + row.architecture + '</td>' +
          '<td>' + row.target + '</td>' +
          '<td>' + getCountryName(row.country) + '</td>' +
          '<td>' + row.count + '</td>' +
        '</tr>';
      });
      if (tbody) tbody.innerHTML = html;

      // The country map is optional; the rest of the dashboard works without its CDN.
      if (window.google && google.charts) {
        google.charts.load('current', { packages: ['geochart'] });
        google.charts.setOnLoadCallback(drawRegionsMap);
      } else {
        document.getElementById('mapPanel').hidden = true;
      }

      function drawRegionsMap() {
        const countryData = aggregate('country');
        const dataArray = [['Country', 'Installs']];

        for (const [country, count] of Object.entries(countryData)) {
          if (country && country.toLowerCase() !== "unknown") {
            dataArray.push([country, count]);
          }
        }

        const data = google.visualization.arrayToDataTable(dataArray);

        const options = {
          backgroundColor: 'transparent',
          datalessRegionColor: '#252525',
          defaultColor: '#b24c0c',
          colorAxis: { colors: ['#ffcc9a', '#ff880d', '#b24c0c'] },
          legend: 'none',
          keepAspectRatio: true
        };

        const chart = new google.visualization.GeoChart(document.getElementById('regions_div'));
        chart.draw(data, options);
      }
    </script>
  </body>
  </html>
  `;
}