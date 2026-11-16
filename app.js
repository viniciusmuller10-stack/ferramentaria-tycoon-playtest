"use strict";
const CFG = window.PLAYTEST_CONFIG || {};
const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
let session = null, image = null, filter = "", admin = store.get("ft_admin") || "", reports = [], timer = null;
const STATUS = ["Aberto", "Em Ajuste", "Corrigido"];

/* ---------- download + novidades ---------- */
fetch("version.json", { cache: "no-store" }).then((r) => r.json()).then((v) => {
  $("curver").textContent = "v" + v.version;
  $("dlver").textContent = "v" + v.version;
  if (v.installer_url) $("dl").href = v.installer_url;
  $("changelog").innerHTML = (v.changelog || []).map((c) =>
    `<div class="ver">Versão ${esc(c.version)} <span class="hint">${esc(c.date || "")}</span></div><ul>${(c.notes || []).map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`
  ).join("") || "Sem novidades registradas.";
}).catch(() => { $("changelog").textContent = "Não foi possível carregar as novidades agora."; });

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

/* ---------- backend (Supabase RPC) ---------- */
async function rpc(name, args) {
  if (!CFG.supabaseUrl) throw new Error("Mural ainda não configurado.");
  const r = await fetch(CFG.supabaseUrl + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: { apikey: CFG.anonKey, Authorization: "Bearer " + CFG.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!r.ok) {
    const msg = data && data.message ? data.message : "Erro " + r.status;
    throw new Error(/convite/.test(msg) ? "Código de convite inválido." : msg);
  }
  return data;
}

/* ---------- sessão ---------- */
function enter(name, code) { session = { name, code }; $("login").hidden = true; $("app").hidden = false; $("who").textContent = name; startFeed(); }
(function restore() {
  try { const s = JSON.parse(store.get("ft_session") || "null"); if (s && s.name && s.code) enter(s.name, s.code); } catch (e) {}
})();
$("btnEnter").onclick = async () => {
  const name = $("inName").value.trim(), code = $("inCode").value.trim();
  $("loginErr").textContent = "";
  if (!name || !code) { $("loginErr").textContent = "Preencha nome e código."; return; }
  try { await rpc("list_reports", { p_code: code }); store.set("ft_session", JSON.stringify({ name, code })); enter(name, code); }
  catch (e) { $("loginErr").textContent = e.message; }
};
$("inCode").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btnEnter").click(); });
$("btnExit").onclick = () => { store.del("ft_session"); clearInterval(timer); location.reload(); };
$("btnAdmin").onclick = () => {
  const k = prompt("Chave de administrador (deixe vazio para desativar):", admin);
  if (k === null) return;
  admin = k.trim(); admin ? store.set("ft_admin", admin) : store.del("ft_admin"); render();
};

/* ---------- imagem (colar / anexar, compressão no navegador) ---------- */
function loadImage(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => {
    const max = 1280, s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    let q = 0.78, data = c.toDataURL("image/jpeg", q);
    while (data.length > 480000 && q > 0.35) { q -= 0.1; data = c.toDataURL("image/jpeg", q); }
    image = data; $("preview").src = data; $("preview").hidden = false; $("btnClear").hidden = false; $("dropHint").hidden = true;
    URL.revokeObjectURL(url);
  };
  img.src = url;
}
document.addEventListener("paste", (e) => {
  if ($("app").hidden) return;
  for (const it of (e.clipboardData || {}).items || []) if (it.type.startsWith("image/")) { loadImage(it.getAsFile()); e.preventDefault(); break; }
});
$("drop").onclick = () => $("drop").focus();
$("btnFile").onclick = () => $("fFile").click();
$("fFile").onchange = (e) => loadImage(e.target.files[0]);
$("btnClear").onclick = (e) => { e.stopPropagation(); image = null; $("preview").hidden = true; $("btnClear").hidden = true; $("dropHint").hidden = false; };
["dragover", "dragenter"].forEach((n) => $("drop").addEventListener(n, (e) => { e.preventDefault(); $("drop").classList.add("over"); }));
["dragleave", "drop"].forEach((n) => $("drop").addEventListener(n, (e) => { e.preventDefault(); $("drop").classList.remove("over"); }));
$("drop").addEventListener("drop", (e) => loadImage(e.dataTransfer.files[0]));

/* ---------- enviar ---------- */
$("form").onsubmit = async (e) => {
  e.preventDefault(); $("formErr").textContent = "";
  const desc = $("fDesc").value.trim();
  if (desc.length < 3) { $("formErr").textContent = "Descreva o problema."; return; }
  $("btnSend").disabled = true;
  try {
    await rpc("add_report", { p_code: session.code, p_author: session.name, p_category: $("fCat").value, p_version: $("fVer").value.trim(), p_description: desc, p_image: image });
    $("fDesc").value = ""; $("btnClear").click();
    await refresh();
  } catch (err) { $("formErr").textContent = err.message; }
  $("btnSend").disabled = false;
};

/* ---------- mural ---------- */
async function refresh() {
  try { reports = await rpc("list_reports", { p_code: session.code }) || []; render(); } catch (e) { /* mantém o que já está na tela */ }
}
function startFeed() { refresh(); clearInterval(timer); timer = setInterval(() => { if (!document.hidden && !document.activeElement.closest(".cmform")) refresh(); }, 8000); }
document.querySelectorAll("#filters .chip").forEach((b) => b.onclick = () => {
  document.querySelectorAll("#filters .chip").forEach((x) => x.classList.remove("on")); b.classList.add("on"); filter = b.dataset.f; render();
});
function render() {
  const list = reports.filter((r) => !filter || r.status === filter);
  $("feed").innerHTML = list.map((r) => `
    <div class="item" data-id="${r.id}">
      <div class="meta"><span class="badge st-${r.status.replace(/\s+/g, "")}">${esc(r.status)}</span><span class="cat">${esc(r.category)}</span><b>${esc(r.author)}</b>
        <span>${new Date(r.created_at).toLocaleString("pt-BR")}</span>${r.version ? `<span>v${esc(r.version)}</span>` : ""}
        ${admin ? `<span class="adm"><select data-st="${r.id}">${STATUS.map((s) => `<option${s === r.status ? " selected" : ""}>${s}</option>`).join("")}</select></span>` : ""}</div>
      <p>${esc(r.description)}</p>
      ${r.image ? `<img class="shot" src="${r.image}" alt="print do relato">` : ""}
      <div class="comments">${(r.comments || []).map((c) => `<div class="cm"><b>${esc(c.author)}:</b> ${esc(c.body)}</div>`).join("")}
        <div class="cmform"><input maxlength="500" placeholder="Comentar..." data-cm="${r.id}"><button class="ghost" data-send="${r.id}">Enviar</button></div></div>
    </div>`).join("") || '<p class="hint">Nenhum relato por aqui ainda.</p>';
  document.querySelectorAll("img.shot").forEach((i) => i.onclick = () => { $("lightbox").firstElementChild.src = i.src; $("lightbox").hidden = false; });
  document.querySelectorAll("[data-send]").forEach((b) => b.onclick = () => sendComment(b.dataset.send));
  document.querySelectorAll("[data-cm]").forEach((i) => i.addEventListener("keydown", (e) => { if (e.key === "Enter") sendComment(i.dataset.cm); }));
  document.querySelectorAll("[data-st]").forEach((s) => s.onchange = async () => {
    try { await rpc("set_status", { p_admin_key: admin, p_report: s.dataset.st, p_status: s.value }); refresh(); } catch (e) { alert(e.message); }
  });
}
async function sendComment(id) {
  const input = document.querySelector(`[data-cm="${id}"]`), body = input.value.trim();
  if (!body) return;
  try { await rpc("add_comment", { p_code: session.code, p_report: id, p_author: session.name, p_body: body }); await refresh(); } catch (e) { alert(e.message); }
}
$("lightbox").onclick = () => { $("lightbox").hidden = true; };

/* ---------- contador de instalações (API pública de Releases do GitHub) ---------- */
(function downloadCounter() {
  const REPO = "viniciusmuller10-stack/ferramentaria-tycoon-playtest";
  const KEY = "ft_dl_count", TTL = 5 * 60 * 1000;
  const box = $("dlcount"), num = $("dlnum");
  let total = null;
  const fmt = (n) => Number(n).toLocaleString("pt-BR");
  const show = (n) => { total = n; num.textContent = fmt(n); box.classList.remove("off"); };
  const bump = () => { box.classList.remove("bump"); void box.offsetWidth; box.classList.add("bump"); };

  // Cada instalação = asset Setup_*.exe (o executável do jogo e os .pck não contam como instalação).
  async function fetchTotal() {
    let sum = 0;
    for (let page = 1; page <= 5; page++) {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`, { headers: { Accept: "application/vnd.github+json" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const releases = await r.json();
      for (const rel of releases) for (const a of rel.assets || []) if (/^Setup_.*\.exe$/i.test(a.name)) sum += a.download_count || 0;
      if (releases.length < 100) break;
    }
    return sum;
  }
  let cached = null;
  try { cached = JSON.parse(store.get(KEY) || "null"); } catch (e) {}
  if (cached && typeof cached.n === "number") show(cached.n);          // mostra o último valor conhecido na hora
  if (!cached || Date.now() - cached.t > TTL) {
    fetchTotal().then((n) => { store.set(KEY, JSON.stringify({ n, t: Date.now() })); show(n); })
      .catch(() => { if (!cached) { num.textContent = "—"; box.classList.add("off"); box.title = "Contador indisponível no momento"; } });
  }
  // +1 visual imediato ao clicar em baixar (guardado no cache para não "voltar" ao recarregar)
  $("dl").addEventListener("click", () => {
    if (total === null) return;
    show(total + 1); bump();
    store.set(KEY, JSON.stringify({ n: total, t: (cached && cached.t) || Date.now() }));
  });
})();

/* ---------- ranking oficial (leitura publica, sem codigo de convite) ---------- */
(function ranking() {
  const DIFF = { facil: "Fácil", medio: "Médio", dificil: "Difícil", patrao: "Modo Patrão" };
  let rows = [], diff = "", sort = "net_worth";
  const body = $("rkBody");
  const money = (n) => "R$ " + Number(n).toLocaleString("pt-BR");
  function render() {
    const list = rows.filter((r) => !diff || r.difficulty === diff).sort((a, b) => Number(b[sort]) - Number(a[sort])).slice(0, 100);
    $("rkcount").textContent = rows.length + " oficina" + (rows.length === 1 ? "" : "s");
    if (!list.length) { body.innerHTML = '<tr><td colspan="8" class="hint">Nenhuma oficina neste filtro ainda.</td></tr>'; return; }
    body.innerHTML = list.map((r, i) => `<tr class="${i < 3 ? "podium" : ""}"><td>${i + 1}</td><td>${esc(r.company_name)}</td><td>${esc(r.director_name)}</td><td>${esc(DIFF[r.difficulty] || r.difficulty)}</td><td>${Number(r.level)}</td><td>${Number(r.days)}</td><td>★ ${Number(r.reputation).toFixed(1)}</td><td>${money(r.net_worth)}</td></tr>`).join("");
  }
  async function load() {
    try {
      const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).get("rankapi");
      if (local) {
        const r = await fetch(local + "/rest/v1/rpc/list_ranking", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        rows = await r.json();
      } else {
        rows = (await rpc("list_ranking", {})) || [];
      }
      render();
    } catch (e) {
      body.innerHTML = '<tr><td colspan="8" class="hint">Ranking indisponível no momento.</td></tr>';
      $("rkcount").textContent = "—";
    }
  }
  $("rkDiff").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; diff = b.dataset.d; [...$("rkDiff").children].forEach((c) => c.classList.toggle("on", c === b)); render(); };
  $("rkSort").onclick = (e) => { const b = e.target.closest("button"); if (!b || !b.dataset.s) return; sort = b.dataset.s; [...$("rkSort").querySelectorAll("button")].forEach((c) => c.classList.toggle("on", c === b)); render(); };
  load();
  setInterval(load, 30000);
})();
