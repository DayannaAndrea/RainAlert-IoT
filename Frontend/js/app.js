const NODOS = ["nodo1", "nodo2", "nodo3"];
const MAX_H = 30;
let mqttClient = null,
  chart = null,
  graficaActual = "lluvia";
const estado = {},
  hist = {},
  globalLabels = [];
const nivelDOM = {};
const pendingUpdate = new Set();
let rafPending = false;

NODOS.forEach((n) => {
  estado[n] = {
    temperatura: "--",
    humedad: "--",
    presion: "--",
    lluvia_raw: "--",
    luz: "--",
    humedad_suelo: "--",
    nivel: "1",
    prediccion: "normal",
    ts: null,
  };
  hist[n] = {
    lluvia: [],
    temperatura: [],
    humedad: [],
    suelo: [],
    presion: [],
    luz: [],
  };
  nivelDOM[n] = 0;
});

/* ── MINI ESCENA ── */
function buildScene(n) {
  return `<div class="weather-scene nivel-1" id="scene-${n}">
<div class="ws-sky"></div><div class="ws-sun"></div><div class="ws-cloud"></div>
<div class="ws-rope"></div>
<div class="ws-cloth ws-cloth-1"></div><div class="ws-cloth ws-cloth-2"></div>
<div class="ws-cloth ws-cloth-3"></div><div class="ws-cloth ws-cloth-4"></div>
<div class="ws-drops" id="drops-${n}"></div>
<div class="ws-ground"></div><div class="ws-puddle"></div>
<div class="ws-label" id="wslabel-${n}">☀ SECO</div>
</div>`;
}

function actualizarEscena(nodo, nivel) {
  if (nivelDOM[nodo] === nivel) return;
  nivelDOM[nodo] = nivel;
  const scene = document.getElementById(`scene-${nodo}`);
  if (!scene) return;
  scene.className = `weather-scene nivel-${nivel}`;
  const drops = document.getElementById(`drops-${nodo}`);
  drops.innerHTML = "";
  if (nivel >= 2) {
    const frag = document.createDocumentFragment();
    const count = nivel === 2 ? 8 : 18;
    for (let i = 0; i < count; i++) {
      const d = document.createElement("div");
      d.className = "ws-drop";
      d.style.cssText = `left:${Math.random() * 100}%;height:${4 + Math.random() * 8}px;animation-duration:${0.3 + Math.random() * 0.4}s;animation-delay:${Math.random() * 0.8}s;`;
      frag.appendChild(d);
    }
    drops.appendChild(frag);
  }
  document.getElementById(`wslabel-${nodo}`).textContent =
    { 1: "☀ SECO", 2: "🌦 LLOVIZNA", 3: "⛈ AGUACERO" }[nivel] || "☀ SECO";
}

/* ── TARJETA ── */
function tarjeta(n) {
  return `<div class="node-card nivel-1" id="card-${n}">
<div class="card-stripe"></div>
<div class="card-head">
<div>
    <div class="card-id">SENSOR NODE</div>
    <div class="card-name">${n.toUpperCase()}</div>
    <div class="card-ts" id="last-${n}">Sin datos aún</div>
</div>
${buildScene(n)}
</div>
<div class="card-body">
<div class="sensors-grid">
    <div class="s-tile">
    <div class="s-lbl">Temperatura</div>
    <div class="s-val"><span id="temp-${n}">--</span><span class="s-unit">°C</span></div>
    </div>
    <div class="s-tile">
    <div class="s-lbl">Humedad aire</div>
    <div class="s-val"><span id="hum-${n}">--</span><span class="s-unit">%</span></div>
    </div>
    <div class="s-tile">
    <div class="s-lbl">Presión</div>
    <div class="s-val"><span id="pres-${n}">--</span><span class="s-unit">hPa</span></div>
    </div>
    <div class="s-tile">
    <div class="s-lbl">Luminosidad</div>
    <div class="s-val"><span id="luz-${n}">--</span><span class="s-unit">lux</span></div>
    </div>
    <div class="s-tile">
    <div class="s-lbl">Lluvia raw</div>
    <div class="s-val"><span id="raw-${n}">--</span><span class="s-unit">ADC</span></div>
    </div>
    <div class="s-tile">
    <div class="s-lbl">Suelo raw</div>
    <div class="s-val"><span id="sraw-${n}">--</span><span class="s-unit">ADC</span></div>
    </div>
</div>
<div class="bar-row">
    <div class="bar-meta"><span>🌧 Intensidad lluvia</span><span id="rain-pct-${n}">--%</span></div>
    <div class="bar-track"><div class="bar-fill" id="rain-bar-${n}" style="width:0%"></div></div>
</div>
<div class="bar-row">
    <div class="bar-meta"><span>🌱 Humedad suelo</span><span id="soil-pct-${n}">--%</span></div>
    <div class="bar-track"><div class="bar-fill" id="soil-bar-${n}" style="width:0%"></div></div>
</div>
<div class="bar-row">
    <div class="bar-meta"><span>☀ Luminosidad</span><span id="luz-pct-${n}">--%</span></div>
    <div class="bar-track"><div class="bar-fill" id="luz-bar-${n}" style="width:0%;background:var(--amber)"></div></div>
</div>
<div id="pred-${n}" class="pred-tag pred-ok">○ Condiciones normales</div>
</div>
</div>`;
}

/* ── UI ── */
function iniciarUI() {
  const g = document.getElementById("nodesGrid");
  if (g.children.length === 0)
    NODOS.forEach((n) => g.insertAdjacentHTML("beforeend", tarjeta(n)));
  if (!chart) iniciarGrafica();
}

/* ── MQTT ── */
function conectar() {
  if (mqttClient && mqttClient.connected) return;
  const ip = document.getElementById("brokerIP").value.trim();
  const port = document.getElementById("brokerPort").value.trim();
  setStatus("", "Conectando...");
  mqttClient = mqtt.connect(`ws://${ip}:${port}/mqtt`, {
    clientId: "RainDash_" + Math.random().toString(16).substr(2, 6),
    connectTimeout: 8000,
    reconnectPeriod: 0, // sin reconexión automática — evita el "parpadeo"
    keepalive: 30,
  });
  mqttClient.on("connect", () => {
    setStatus("connected", `Broker ${ip}`);
    mqttClient.subscribe("rainAlert/#");
    addLog("sistema", "Suscrito a rainAlert/#", "✓");
    document.getElementById("btnCon").style.display = "none";
    document.getElementById("btnDis").style.display = "";
  });
  mqttClient.on("message", (topic, msg) =>
    procesarMensaje(topic, msg.toString()),
  );
  mqttClient.on("error", (e) => {
    setStatus("error", "Error");
    addLog("error", e.message, "✗");
  });
  mqttClient.on("close", () => {
    setStatus("", "Desconectado");
    document.getElementById("btnCon").style.display = "";
    document.getElementById("btnDis").style.display = "none";
  });
}

function desconectar() {
  if (mqttClient) {
    mqttClient.end(true);
    mqttClient = null;
  }
  setStatus("", "Desconectado");
  document.getElementById("btnCon").style.display = "";
  document.getElementById("btnDis").style.display = "none";
}

/* ── MENSAJES — solo acumula, nunca toca DOM ── */
function procesarMensaje(topic, valor) {
  const p = topic.split("/");
  if (p.length < 3) return;
  const nodo = p[1],
    variable = p[2];
  if (!estado[nodo]) return;
  estado[nodo][variable] = valor;
  estado[nodo].ts = new Date();
  addLog(topic, valor, "↓");
  actualizarLabelsGlobales();
  actualizarHistorial(nodo, variable, valor);
  pendingUpdate.add(nodo);
  if (!rafPending) {
    rafPending = true;
    requestAnimationFrame(flushUpdates);
  }
  if (variable === "nivel" && parseInt(valor) === 3) mostrarAlerta(nodo);
}

function flushUpdates() {
  rafPending = false;
  pendingUpdate.forEach((n) => actualizarTarjeta(n));
  pendingUpdate.clear();
  actualizarGrafica();
}

function actualizarLabelsGlobales() {
  const t = new Date().toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  if (!globalLabels.length || globalLabels[globalLabels.length - 1] !== t) {
    globalLabels.push(t);
    if (globalLabels.length > MAX_H) globalLabels.shift();
  }
}

/* ── ACTUALIZAR TARJETA — solo textContent, sin innerHTML ── */
function actualizarTarjeta(nodo) {
  const d = estado[nodo];
  const nv = parseInt(d.nivel) || 1;

  setTxt(`temp-${nodo}`, d.temperatura);
  setTxt(`hum-${nodo}`, d.humedad);
  setTxt(`pres-${nodo}`, d.presion);
  setTxt(`luz-${nodo}`, d.luz);
  setTxt(`raw-${nodo}`, d.lluvia_raw);
  setTxt(`sraw-${nodo}`, d.humedad_suelo);
  if (d.ts)
    setTxt(`last-${nodo}`, "Actualizado " + d.ts.toLocaleTimeString("es-CO"));

  const card = document.getElementById(`card-${nodo}`);
  const nc = `node-card nivel-${nv}`;
  if (card && card.className !== nc) card.className = nc;
  actualizarEscena(nodo, nv);

  /* Barra lluvia */
  const raw = parseInt(d.lluvia_raw) || 4095;
  const rpct = Math.round(((4095 - raw) / 4095) * 100);
  setTxt(`rain-pct-${nodo}`, rpct + "%");
  const rb = document.getElementById(`rain-bar-${nodo}`);
  if (rb) {
    rb.style.width = rpct + "%";
    rb.style.background =
      rpct < 30 ? "var(--mint)" : rpct < 70 ? "var(--sky)" : "var(--coral)";
  }

  /* Barra suelo */
  const spct = Math.round(
    ((4095 - (parseInt(d.humedad_suelo) || 4095)) / 4095) * 100,
  );
  setTxt(`soil-pct-${nodo}`, spct + "%");
  const sb = document.getElementById(`soil-bar-${nodo}`);
  if (sb) {
    sb.style.width = spct + "%";
    sb.style.background =
      spct < 30 ? "var(--coral)" : spct < 60 ? "var(--amber)" : "var(--violet)";
  }

  /* Barra luminosidad — luz raw: 0=oscuro, 4095=máx luz */
  const luzRaw = parseInt(d.luz) || 0;
  const lpct = Math.round((luzRaw / 4095) * 100);
  setTxt(`luz-pct-${nodo}`, lpct + "%");
  const lb = document.getElementById(`luz-bar-${nodo}`);
  if (lb) {
    lb.style.width = lpct + "%";
    lb.style.background =
      lpct < 20 ? "var(--muted)" : lpct < 60 ? "var(--amber)" : "var(--rose)";
  }

  /* Predicción */
  const pe = document.getElementById(`pred-${nodo}`);
  if (pe) {
    if (d.prediccion === "lluvia_proxima") {
      if (pe.className !== "pred-tag pred-warn")
        pe.className = "pred-tag pred-warn";
      pe.textContent = "⚠ Lluvia próxima detectada";
    } else {
      if (pe.className !== "pred-tag pred-ok")
        pe.className = "pred-tag pred-ok";
      pe.textContent = "○ Condiciones normales";
    }
  }
}

function setTxt(id, val) {
  const e = document.getElementById(id);
  if (e && e.textContent !== String(val)) e.textContent = val;
}

/* ── HISTORIAL ── */
function actualizarHistorial(nodo, variable, valor) {
  const h = hist[nodo],
    num = parseFloat(valor);
  if (isNaN(num)) return;
  const map = {
    lluvia_raw: "lluvia",
    temperatura: "temperatura",
    humedad: "humedad",
    humedad_suelo: "suelo",
    presion: "presion",
    luz: "luz",
  };
  const key = map[variable];
  if (!key) return;
  const val = key === "lluvia" ? Math.round(((4095 - num) / 4095) * 100) : num;
  while (h[key].length < globalLabels.length - 1) h[key].push(null);
  if (h[key].length < globalLabels.length) h[key].push(val);
  else h[key][h[key].length - 1] = val;
  if (h[key].length > MAX_H) h[key].shift();
}

/* ── GRÁFICA ── */
const COLORES = {
  nodo1: { border: "#3a8fc4", bg: "rgba(58,143,196,0.07)" },
  nodo2: { border: "#2e9e72", bg: "rgba(46,158,114,0.07)" },
  nodo3: { border: "#b07d2e", bg: "rgba(176,125,46,0.07)" },
};

function iniciarGrafica() {
  const ctx = document.getElementById("mainChart").getContext("2d");
  chart = new Chart(ctx, {
    type: "line",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: {
            color: "#7a92a8",
            font: { family: "DM Mono", size: 11 },
            boxWidth: 12,
          },
        },
        tooltip: {
          backgroundColor: "#ffffff",
          titleColor: "#1e2d3d",
          bodyColor: "#7a92a8",
          borderColor: "rgba(100,130,160,0.15)",
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          ticks: {
            color: "#7a92a8",
            font: { family: "DM Mono", size: 10 },
            maxTicksLimit: 8,
          },
          grid: { color: "rgba(100,130,160,0.08)" },
        },
        y: {
          ticks: { color: "#7a92a8", font: { family: "DM Mono", size: 10 } },
          grid: { color: "rgba(100,130,160,0.08)" },
        },
      },
    },
  });
}

function actualizarGrafica() {
  if (!chart) return;
  chart.data.labels = [...globalLabels];
  chart.data.datasets = NODOS.map((n) => ({
    label: n.toUpperCase(),
    data: [...(hist[n][graficaActual] || [])],
    borderColor: COLORES[n].border,
    backgroundColor: COLORES[n].bg,
    borderWidth: 2,
    pointRadius: 2,
    tension: 0.4,
    fill: true,
    spanGaps: true,
  }));
  chart.update("none");
}

function cambiarGrafica(v, btn) {
  graficaActual = v;
  document
    .querySelectorAll(".ctab")
    .forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");
  actualizarGrafica();
}

/* ── LOG ── */
function addLog(topic, valor, dir) {
  const lista = document.getElementById("logList");
  const item = document.createElement("div");
  item.className = "log-item";
  const t = document.createElement("span");
  t.className = "lt";
  t.textContent = new Date().toLocaleTimeString("es-CO");
  const p = document.createElement("span");
  p.className = "lp";
  p.textContent = topic;
  const v = document.createElement("span");
  v.className = "lv";
  v.textContent = `${dir} ${valor}`;
  item.append(t, p, v);
  lista.insertBefore(item, lista.firstChild);
  if (lista.children.length > 80) lista.removeChild(lista.lastChild);
}
function limpiarLog() {
  document.getElementById("logList").innerHTML = "";
}

/* ── STATUS ── */
function setStatus(cls, txt) {
  const d = document.getElementById("statusDot");
  d.className =
    "dot" + (cls === "connected" ? " on" : cls === "error" ? " err" : "");
  document.getElementById("statusText").textContent = txt;
}

/* ── ALERTA ── */
let legAngle = 0,
  legRAF = null;
function animarPiernas() {
  const L = document.getElementById("legL"),
    R = document.getElementById("legR");
  if (!L || !R) return;
  legAngle += 0.26;
  const a = Math.sin(legAngle) * 20;
  L.setAttribute("x2", 14 + a);
  L.setAttribute("y2", 74 - Math.abs(a) * 0.3);
  R.setAttribute("x2", 48 - a);
  R.setAttribute("y2", 70 - Math.abs(a) * 0.3);
  legRAF = requestAnimationFrame(animarPiernas);
}
function mostrarAlerta(nodo) {
  if (document.getElementById("alertOverlay").classList.contains("show"))
    return;
  document.getElementById("alertMsg").textContent =
    `Lluvia intensa detectada en ${nodo.toUpperCase()}`;
  document.getElementById("alertNode").textContent =
    `⚡ ${nodo.toUpperCase()} — ¡RECOGE LA ROPA YA!`;
  const c = document.getElementById("rainContainer");
  c.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 130; i++) {
    const d = document.createElement("div");
    d.className = "r-drop";
    d.style.cssText = `left:${Math.random() * 100}%;height:${8 + Math.random() * 20}px;opacity:${0.35 + Math.random() * 0.65};animation-duration:${0.35 + Math.random() * 0.55}s;animation-delay:${Math.random() * 1.5}s;`;
    frag.appendChild(d);
  }
  c.appendChild(frag);
  document.getElementById("alertOverlay").classList.add("show");
  animarPiernas();
}
function cerrarAlerta() {
  document.getElementById("alertOverlay").classList.remove("show");
  if (legRAF) {
    cancelAnimationFrame(legRAF);
    legRAF = null;
  }
}

/* ── ARRANQUE ── */
iniciarUI();

let demoNivel = 1;
document
  .getElementById("logoBtn")
  .addEventListener("dblclick", () => mostrarAlerta("nodo1"));
document.getElementById("logoBtn").addEventListener("click", (e) => {
  if (e.detail > 1) return;
  demoNivel = demoNivel >= 3 ? 1 : demoNivel + 1;
  estado["nodo1"].nivel = String(demoNivel);
  pendingUpdate.add("nodo1");
  if (!rafPending) {
    rafPending = true;
    requestAnimationFrame(flushUpdates);
  }
});

/* ── GATITO ── */
(function() {
    const kitty  = document.getElementById("kitty");
    const tail   = document.getElementById("kittyTail");
    const pL1    = document.getElementById("pL1");
    const pL2    = document.getElementById("pL2");
    const pR1    = document.getElementById("pR1");
    const pR2    = document.getElementById("pR2");
    const pupilL = document.getElementById("pupilL");
    const pupilR = document.getElementById("pupilR");

    let x = 80, y = window.innerHeight - 58;
    let vx = 1.1, vy = 0;
    let stepAngle = 0;
    let tailAngle = 0;
    let blinkTimer = 0;
    let isBlinking = false;
    let pauseTimer = 0;
    let paused = false;
    let sitTimer = 0;
    let sitting = false;

    function lerp(a, b, t) { return a + (b - a) * t; }

    function tick() {
        requestAnimationFrame(tick);

        // pausa aleatoria (el gato se sienta)
        if (paused) {
            pauseTimer--;
            tailAngle += 0.04;
            const tw = Math.sin(tailAngle) * 10;
            tail.setAttribute("d", `M37 28 Q${46 + tw} ${22 - Math.abs(tw)*0.3} 44 16`);
            animateBlink();
            return;
        }

        // decide sentarse de vez en cuando
        sitTimer--;
        if (sitTimer <= 0) {
            sitTimer = 300 + Math.random() * 400;
            if (Math.random() < 0.3) {
                paused = true;
                sitting = true;
                pauseTimer = 120 + Math.random() * 180;
                setTimeout(() => { paused = false; sitting = false; }, pauseTimer * 16);
            }
        }

        // movimiento
        x += vx;
        y += vy;

        // rebotar en bordes
        const margin = 10;
        if (x < margin)          { x = margin;                      vx = Math.abs(vx); }
        if (x > window.innerWidth - 58) { x = window.innerWidth - 58; vx = -Math.abs(vx); }
        if (y < 64)              { y = 64;                           vy = Math.abs(vy); }
        if (y > window.innerHeight - 48) { y = window.innerHeight - 48; vy = -Math.abs(vy); }

        // pequeña deriva vertical aleatoria
        vy += (Math.random() - 0.5) * 0.04;
        vy  = Math.max(-0.6, Math.min(0.6, vy));

        // dirección
        if (vx > 0) kitty.classList.remove("flip");
        else        kitty.classList.add("flip");

        kitty.style.left   = x + "px";
        kitty.style.bottom = (window.innerHeight - y - 40) + "px";

        // animación patas
        stepAngle += 0.18;
        const s = Math.sin(stepAngle);
        const c = Math.cos(stepAngle);
        pL1.setAttribute("x2", 14 + s * 4);
        pL1.setAttribute("y2", 37 + Math.abs(s) * 2);
        pL2.setAttribute("x2", 19 - s * 4);
        pL2.setAttribute("y2", 37 + Math.abs(c) * 2);
        pR1.setAttribute("x2", 29 + c * 4);
        pR1.setAttribute("y2", 37 + Math.abs(c) * 2);
        pR2.setAttribute("x2", 34 - c * 4);
        pR2.setAttribute("y2", 37 + Math.abs(s) * 2);

        // cola ondulante
        tailAngle += 0.03;
        const tw = Math.sin(tailAngle) * 7;
        tail.setAttribute("d", `M37 28 Q${46 + tw} ${22 - Math.abs(tw)*0.3} 44 16`);

        // parpadeo
        animateBlink();
    }

    function animateBlink() {
        blinkTimer--;
        if (blinkTimer <= 0 && !isBlinking) {
            isBlinking = true;
            blinkTimer = 180 + Math.random() * 200;
            // cerrar ojos
            pupilL.setAttribute("ry", "0.3");
            pupilR.setAttribute("ry", "0.3");
            setTimeout(() => {
                pupilL.setAttribute("ry", "1.4");
                pupilR.setAttribute("ry", "1.4");
                isBlinking = false;
            }, 120);
        }
    }

    // posición inicial aleatoria
    x = 100 + Math.random() * (window.innerWidth - 200);
    kitty.style.left   = x + "px";
    kitty.style.bottom = "18px";

    tick();
})();
