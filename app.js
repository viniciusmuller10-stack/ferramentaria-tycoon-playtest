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
