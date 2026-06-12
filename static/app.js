const state = {
  tenders: [],
  current: null,
  statuses: [],
  view: "dashboard",
  editItemId: null,
  editWonId: null,
  pendingProposalFormat: "docx",
  viewModes: { won: "grid", proposalItems: "grid", orders: "grid", finished: "grid" },
  deletedItem: null,
  undoTimer: null,
  uploadContext: null,
  users: [],
  account: null,
  currentDate: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const WIN_STATUSES = ["Aguardando Habilitação", "Julgado e Habilitado", "Adjudicada"];
const ORDER_STATUSES = ["Nota de empenho emitida", "Entregue"];

const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const numberValue = (value) => {
  let text = String(value ?? "").replace("R$", "").replace(/\s/g, "").trim();
  if (!text) return 0;
  if (text.includes(",")) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (text.includes(".")) {
    const parts = text.split(".");
    text = parts.at(-1).length <= 2 ? `${parts.slice(0, -1).join("")}.${parts.at(-1)}` : text.replace(/\./g, "");
  }
  return Number(text) || 0;
};
const isoDate = (value) => value ? new Date(value) : null;
const brDate = (value) => {
  const date = isoDate(value);
  return date && !Number.isNaN(date) ? date.toLocaleDateString("pt-BR") : "-";
};
const brDateTime = (value) => {
  const date = isoDate(value);
  return date && !Number.isNaN(date) ? date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "-";
};

const appNow = () => {
  const browserNow = new Date();
  const serverToday = state.currentDate ? new Date(`${state.currentDate}T00:00:00`) : null;
  return serverToday && serverToday > browserNow ? serverToday : browserNow;
};

const countdownLabel = (value) => {
  const target = isoDate(value);
  if (!target || Number.isNaN(target)) return "-";
  let diff = target - new Date();
  if (diff <= 0) return "começou";
  const days = Math.floor(diff / 86400000);
  diff -= days * 86400000;
  const hours = Math.floor(diff / 3600000);
  diff -= hours * 3600000;
  const minutes = Math.floor(diff / 60000);
  diff -= minutes * 60000;
  const seconds = Math.floor(diff / 1000);
  return `${days ? `${days}d ` : ""}${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
};

function deliveryStatus(item) {
  const due = isoDate(item.prazo_entrega);
  if (!due || Number.isNaN(due)) {
    return { cls: "missing", label: "Sem prazo", detail: "Defina a data limite de entrega" };
  }
  const diff = Math.ceil((due - appNow()) / 86400000);
  if (diff < 0) return { cls: "late", label: "Atrasada", detail: `Vencida há ${Math.abs(diff)} dia${Math.abs(diff) === 1 ? "" : "s"}` };
  if (diff === 0) return { cls: "due", label: "Vence hoje", detail: "Entrega precisa de atenção hoje" };
  if (diff <= 7) return { cls: "due", label: "Próxima", detail: `Vence em ${diff} dia${diff === 1 ? "" : "s"}` };
  return { cls: "ok", label: "No prazo", detail: `Vence em ${diff} dias` };
}

function deliveryDeadlineBlock(item) {
  const status = deliveryStatus(item);
  return `
    <div class="delivery-deadline ${status.cls}">
      <div>
        <small>Prazo para entrega</small>
        <strong>${brDate(item.prazo_entrega)}</strong>
      </div>
      <span>${status.label}</span>
      <p>${status.detail}</p>
    </div>
  `;
}

function updateCountdowns() {
  $$(".countdown[data-deadline]").forEach((el) => {
    el.textContent = countdownLabel(el.dataset.deadline);
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Erro na requisição");
  return data;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function fillForm(form, data = {}) {
  form.reset();
  Object.entries(data).forEach(([key, value]) => {
    const field = form.elements[key];
    if (field) field.value = value ?? "";
  });
}

function statusTag(status) {
  const cls = /Habilitado|Adjudicada|emitida|Entregue/.test(status) ? "ok" : /cadastro|Aguardando|Futura/.test(status) ? "warn" : /Perdido/.test(status) ? "bad" : "";
  return `<span class="tag ${cls}">${status || "Sem status"}</span>`;
}

function itemValue(item) {
  return numberValue(item.valor_ganho) || numberValue(item.valor_unitário);
}

function itemTotal(item) {
  if (Number(item.selecionado_cadastro ?? 1) === 0) return 0;
  if (Number(item.valor_sigiloso || 0)) return 0;
  return Number(item.qtd || 0) * itemValue(item);
}

function itemTotalLabel(item) {
  return Number(item.valor_sigiloso || 0) ? "Sigiloso" : money(itemTotal(item));
}

function unitValueLabel(item) {
  return Number(item.valor_sigiloso || 0) ? "Sigiloso" : money(itemValue(item));
}

function sectorSummary(rows) {
  const disputados = rows.filter((item) => Number(item.selecionado_cadastro ?? 1) !== 0);
  const total = disputados.reduce((sum, item) => sum + itemTotal(item), 0);
  return `<div class="sector-summary"><span>${disputados.length} produtos</span><strong>${money(total)}</strong></div>`;
}

function productFacts(item) {
  return `
    <div class="product-facts">
      <span><small>Qtd</small><strong>${item.qtd || 0}</strong></span>
      <span><small>Unitário</small><strong>${unitValueLabel(item)}</strong></span>
      <span><small>Total</small><strong>${itemTotalLabel(item)}</strong></span>
    </div>
  `;
}

function productIdentity(item) {
  return `
    <div class="product-title">
      <strong>${item.marca || "-"}</strong>
      <span>${item.modelo || item.referência || "-"}</span>
    </div>
  `;
}

function productMeta(item, extras = "") {
  return `
    <div class="meta">
      <span class="tag">Pregão ${item.tender.pregão}</span>
      <span class="tag">UASG ${item.tender.uasg}</span>
      ${extras}
    </div>
  `;
}

function wonStatusControl(item) {
  if (state.editWonId !== item.id) {
    return `<span class="tag">${item.status}</span>`;
  }
  return `
    <select class="status-select" onchange="saveWonStatus(${item.id}, this.value)">
      ${WIN_STATUSES.map((status) => `<option ${status === item.status ? "selected" : ""}>${status}</option>`).join("")}
    </select>
  `;
}

function escapeAttr(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function selectedTenderItems(tender) {
  if (!tender.items) return Array.from({ length: Number(tender.itens_ativos ?? tender.itens ?? 0) });
  return (tender.items || []).filter((item) => Number(item.selecionado_cadastro ?? 1) !== 0);
}

function pricesComplete(tender) {
  if (!tender.items) {
    const active = Number(tender.itens_ativos ?? tender.itens ?? 0);
    return Boolean(active) && Number(tender.itens_precificados ?? 0) >= active;
  }
  const items = selectedTenderItems(tender);
  return Boolean(items.length) && items.every((item) => (
    numberValue(item.valor_cadastro) > 0 &&
    numberValue(item.valor_mínimo) > 0 &&
    (Number(item.valor_sigiloso || 0) || numberValue(item.valor_unitário) > 0)
  ));
}

function flattenItems() {
  return state.tenders.flatMap((tender) => (tender.items || []).map((item) => ({ ...item, tender })));
}

function searchUrl(site, item) {
  const query = encodeURIComponent(`${item.marca || ""} ${item.modelo || item.referência || ""}`.trim());
  const urls = {
    ml: `https://lista.mercadolivre.com.br/${query}`,
    amazon: `https://www.amazon.com.br/s?k=${query}`,
    sweetwater: `https://www.sweetwater.com/store/search?s=${query}`,
    bh: `https://www.bhphotovideo.com/c/search?q=${query}`,
  };
  return urls[site];
}

function searchLinks(item) {
  return `
    <div class="search-links">
      <a href="${searchUrl("ml", item)}" target="_blank">ML</a>
      <a href="${searchUrl("amazon", item)}" target="_blank">Amazon</a>
      <a href="${searchUrl("sweetwater", item)}" target="_blank">Sweetwater</a>
      <a href="${searchUrl("bh", item)}" target="_blank">B&H</a>
    </div>
  `;
}

function renderDashboard() {
  const now = appNow();
  const month = now.getMonth();
  const year = now.getFullYear();
  const future = state.tenders
    .filter((t) => isoDate(t.data_limite) && isoDate(t.data_limite) >= now)
    .sort((a, b) => isoDate(a.data_limite) - isoDate(b.data_limite));
  const orders = flattenItems().filter((i) => i.order_id && i.status_encomenda !== "Entregue");
  const riskyOrders = orders
    .filter((i) => isoDate(i.prazo_entrega))
    .sort((a, b) => isoDate(a.prazo_entrega) - isoDate(b.prazo_entrega))
    .filter((i) => isoDate(i.prazo_entrega) < now)
    .slice(0, 5);
  const upcomingOrders = orders
    .filter((i) => isoDate(i.prazo_entrega) && isoDate(i.prazo_entrega) >= now)
    .sort((a, b) => isoDate(a.prazo_entrega) - isoDate(b.prazo_entrega))
    .slice(0, 5);
  const wonItems = flattenItems().filter((i) => WIN_STATUSES.includes(i.status) || ORDER_STATUSES.includes(i.tender.status));
  const monthWon = wonItems.filter((i) => {
    const d = isoDate(i.tender.data_limite || i.tender.created_at);
    return d && d.getMonth() === month && d.getFullYear() === year;
  }).reduce((sum, item) => sum + itemTotal(item), 0);
  const yearWon = wonItems.filter((i) => {
    const d = isoDate(i.tender.data_limite || i.tender.created_at);
    return d && d.getFullYear() === year;
  }).reduce((sum, item) => sum + itemTotal(item), 0);

  $("#dashboard").innerHTML = `
    <div class="metrics">
      <div class="metric"><span>Próximas licitações</span><strong>${future.length}</strong></div>
      <div class="metric countdown-metric"><span>Próxima licitação em</span><strong class="countdown" data-deadline="${future[0]?.data_limite || ""}">${countdownLabel(future[0]?.data_limite)}</strong></div>
      <div class="metric"><span>Itens ganhos no mês</span><strong>${money(monthWon)}</strong></div>
      <div class="metric"><span>Itens ganhos no ano</span><strong>${money(yearWon)}</strong></div>
    </div>
    <div class="dashboard-grid">
      <div class="alert-stack">
        <h2>Próximas licitações</h2>
        ${future.slice(0, 5).map((t) => alertTender(t)).join("") || `<div class="alert-card">Nenhuma licitação futura com data cadastrada.</div>`}
      </div>
      <div class="alert-stack">
        <h2>Encomendas atrasadas</h2>
        ${riskyOrders.map(orderAlert).join("") || `<div class="alert-card ok">Nenhuma encomenda atrasada.</div>`}
        <h2>Próximas encomendas a vencer</h2>
        ${upcomingOrders.map(orderAlert).join("") || `<div class="alert-card ok">Nenhuma encomenda próxima do vencimento.</div>`}
      </div>
    </div>
  `;
  updateCountdowns();
}

function alertTender(t) {
  const items = selectedTenderItems(t);
  const ready = pricesComplete(t);
  return `
    <article class="alert-card ${ready ? "ok" : ""}">
      <strong>${brDateTime(t.data_limite)}</strong>
      <div class="countdown-line">Faltam <span class="countdown" data-deadline="${t.data_limite || ""}">${countdownLabel(t.data_limite)}</span></div>
      <div class="big">Pregão ${t.pregão}</div>
      <p>UASG ${t.uasg} - ${t.órgão}</p>
      <div class="meta"><span class="tag">${items.length} itens cadastrados</span><span class="tag ${ready ? "ok" : "warn"}">${ready ? "Preços completos" : "Preços pendentes"}</span></div>
      <div class="actions"><button onclick="openDetail(${t.id})">Abrir</button></div>
    </article>
  `;
}

function orderAlert(item) {
  const due = isoDate(item.prazo_entrega);
  const diff = due ? Math.ceil((due - appNow()) / 86400000) : 999;
  const cls = diff < 0 ? "danger" : diff <= 7 ? "danger" : diff <= 15 ? "" : "ok";
  const label = diff < 0 ? `Vencida há ${Math.abs(diff)} dias` : `Vence em ${diff} dias`;
  return `
    <article class="alert-card ${cls}">
      <strong>${label}</strong>
      <div class="big">${brDate(item.prazo_entrega)}</div>
      <p>${item.marca || ""} ${item.modelo || ""} · Pregão ${item.tender.pregão} · UASG ${item.tender.uasg}</p>
      <div class="meta"><span class="tag">Qtd ${item.qtd || 0}</span><span class="tag">Unit. ${unitValueLabel(item)}</span><span class="tag">Total ${itemTotalLabel(item)}</span></div>
      <div class="actions"><button onclick="openDetail(${item.tender.id})">Abrir</button></div>
    </article>
  `;
}

function tenderCard(t) {
  const items = selectedTenderItems(t);
  const ready = pricesComplete(t);
  return `
    <article class="card timeline-card ${ready ? "tender-ready" : ""}">
      <div class="date-badge"><strong>${brDate(t.data_limite)}</strong><span>${isoDate(t.data_limite)?.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) || "sem horário"}</span></div>
      <div>
        <h3>Pregão Eletrônico Nº ${t.pregão}</h3>
        <p>UASG ${t.uasg} - ${t.órgão}</p>
        <div class="meta">${statusTag(t.status)}<span class="tag">${items.length} itens cadastrados</span><span class="tag ${ready ? "ok" : "warn"}">${ready ? "Preços completos" : "Preços pendentes"}</span><span class="tag">${money(t.valor_total)}</span><span class="tag">${t.localidade || "Sem localidade"}</span></div>
      </div>
      <div class="actions">
        <button onclick="openDetail(${t.id})">Abrir</button>
        <button onclick="editTender(${t.id})">Editar</button>
        <button class="danger" onclick="deleteTender(${t.id})">Apagar</button>
      </div>
    </article>
  `;
}

function renderFuture() {
  const q = ($("#futureSearch")?.value || "").toLowerCase();
  const now = appNow();
  const rows = state.tenders
    .filter((t) => {
      const date = isoDate(t.data_limite);
      return date ? date >= now : t.status === "Futura licitação";
    })
    .filter((t) => `${t.pregão} ${t.uasg} ${t.órgão}`.toLowerCase().includes(q))
    .sort((a, b) => (isoDate(a.data_limite) || new Date(8640000000000000)) - (isoDate(b.data_limite) || new Date(8640000000000000)));
  $("#futureList").innerHTML = rows.map(tenderCard).join("") || `<div class="card">Nenhuma licitação futura encontrada.</div>`;
}

function renderPast() {
  const q = ($("#pastSearch")?.value || "").toLowerCase();
  const year = ($("#pastYear")?.value || "").trim();
  const month = ($("#pastMonth")?.value || "").trim();
  const exactDate = ($("#pastDate")?.value || "").trim();
  const now = appNow();
  const rows = state.tenders
    .filter((t) => isoDate(t.data_limite) && isoDate(t.data_limite) < now)
    .filter((t) => {
      const haystack = `${t.pregão} ${t.uasg} ${t.órgão} ${(t.items || []).map((i) => `${i.marca} ${i.modelo} ${i.referência}`).join(" ")}`.toLowerCase();
      const d = isoDate(t.data_limite);
      if (q && !haystack.includes(q)) return false;
      if (year && String(d.getFullYear()) !== year) return false;
      if (month && String(d.getMonth() + 1).padStart(2, "0") !== month.padStart(2, "0")) return false;
      if (exactDate && d.toISOString().slice(0, 10) !== exactDate) return false;
      return true;
    })
    .sort((a, b) => isoDate(b.data_limite) - isoDate(a.data_limite));
  $("#pastList").innerHTML = rows.map(tenderCard).join("") || `<div class="card">Nenhuma licitação passada encontrada.</div>`;
}

function renderWon() {
  const status = $("#wonStatusFilter")?.value || "";
  const rows = flattenItems()
    .filter((i) => WIN_STATUSES.includes(i.status) && !i.order_id)
    .filter((i) => !status || i.status === status)
    .sort((a, b) => itemTotal(b) - itemTotal(a));
  $("#wonList").classList.toggle("list-mode", state.viewModes.won === "list");
  $("#wonList").innerHTML = sectorSummary(rows) + (rows.map((i) => `
    <article class="product-card">
      <header><h3>Item ${i.item || "-"}</h3>${wonStatusControl(i)}</header>
      ${productIdentity(i)}
      <div class="value">${itemTotalLabel(i)}</div>
      ${productFacts(i)}
      ${productMeta(i)}
      <div class="actions">
        <button onclick="editWonData(${i.id})">${state.editWonId === i.id ? "Cancelar edição" : "Editar status"}</button>
        <button onclick="openDetail(${i.tender.id})">Abrir pregão</button>
        <button onclick='editOrder(${JSON.stringify(i)})'>Colocar em encomenda</button>
        <button onclick='openUpload(${i.tender.id}, ${i.id}, "Empenho")'>Upload empenho</button>
        <button class="danger" onclick="deleteItemGlobal(${i.id}, 'item ganho')">Apagar</button>
      </div>
    </article>
  `).join("") || `<div class="card">Nenhum item ganho sem empenho.</div>`);
}

function renderProposalItems() {
  const rows = flattenItems()
    .filter((i) => i.status === "Proposta enviada")
    .sort((a, b) => String(a.tender.data_limite || "").localeCompare(String(b.tender.data_limite || "")));
  $("#proposalItemsList").classList.toggle("list-mode", state.viewModes.proposalItems === "list");
  $("#proposalItemsList").innerHTML = sectorSummary(rows) + (rows.map((i) => `
    <article class="product-card">
      <header><h3>Item ${i.item || "-"}</h3>${statusTag(i.status)}</header>
      ${productIdentity(i)}
      <div class="value">${itemTotalLabel(i)}</div>
      ${productFacts(i)}
      ${productMeta(i)}
      <div class="actions">
        <button onclick="markItemWon(${i.id})">Item ganho</button>
        <button onclick="updateSingleItem(${i.id}, {status: 'Perdido'})">Não aprovado</button>
        <button onclick="openDetail(${i.tender.id})">Abrir</button>
        <button class="danger" onclick="deleteItemGlobal(${i.id}, 'item em proposta')">Apagar</button>
      </div>
    </article>
  `).join("") || `<div class="card">Nenhum item em proposta no momento.</div>`);
}

function renderOrders() {
  const sort = $("#orderSort")?.value || "due";
  let rows = flattenItems().filter((i) => i.order_id && i.status_encomenda !== "Entregue");
  if (sort === "value") rows = rows.sort((a, b) => itemTotal(b) - itemTotal(a));
  else if (sort === "status") rows = rows.sort((a, b) => String(a.status_encomenda || "").localeCompare(String(b.status_encomenda || "")));
  else rows = rows.sort((a, b) => (isoDate(a.prazo_entrega) || new Date(8640000000000000)) - (isoDate(b.prazo_entrega) || new Date(8640000000000000)));
  $("#ordersList").classList.toggle("list-mode", state.viewModes.orders === "list");
  $("#ordersList").innerHTML = sectorSummary(rows) + (rows.map((i) => {
    const deadline = deliveryStatus(i);
    const cls = deadline.cls === "late" ? "late" : deadline.cls === "due" ? "due" : "";
    return `
      <article class="order-card ${cls}">
        <header><h3>Item ${i.item || "-"}</h3><span class="tag ${deadline.cls === "late" ? "bad" : deadline.cls === "due" ? "warn" : deadline.cls === "missing" ? "" : "ok"}">${deadline.label}</span></header>
        ${productIdentity(i)}
        <div class="value">${itemTotalLabel(i)}</div>
        ${productFacts(i)}
        ${deliveryDeadlineBlock(i)}
        ${productMeta(i)}
        <div class="address-text"><small>Endereço de entrega</small><span>${i.endereço_entrega || "Sem endereço de entrega"}</span></div>
        <div class="actions"><button onclick="openDetail(${i.tender.id})">Abrir</button><button onclick='editOrder(${JSON.stringify(i)})'>Editar</button><button onclick='openUpload(${i.tender.id}, ${i.id}, "Empenho")'>Empenho</button><button class="primary" onclick="finishOrder(${i.id})">Finalizar</button><button class="danger" onclick="deleteOrder(${i.order_id})">Apagar</button></div>
      </article>
    `;
  }).join("") || `<div class="card">Nenhuma encomenda cadastrada ainda.</div>`);
}

function renderFinished() {
  const sort = $("#finishedSort")?.value || "recent";
  let rows = flattenItems().filter((i) => i.status_encomenda === "Entregue" || i.status === "Entregue");
  if (sort === "value") rows = rows.sort((a, b) => itemTotal(b) - itemTotal(a));
  else if (sort === "pregao") rows = rows.sort((a, b) => String(a.tender.pregão).localeCompare(String(b.tender.pregão)));
  else rows = rows.sort((a, b) => String(b.prazo_entrega || b.tender.data_limite || "").localeCompare(String(a.prazo_entrega || a.tender.data_limite || "")));
  $("#finishedList").classList.toggle("list-mode", state.viewModes.finished === "list");
  $("#finishedList").innerHTML = rows.map((i) => `
    <article class="product-card finished-card">
      <header><h3>Item ${i.item || "-"}</h3><span class="tag ok">Finalizado</span></header>
      <div class="finished-title">
        <strong>${i.marca || "-"}</strong>
        <span>${i.modelo || i.referência || "-"}</span>
      </div>
      <div class="value">${itemTotalLabel(i)}</div>
      <div class="finished-facts">
        <span><small>Qtd</small><strong>${i.qtd || 0}</strong></span>
        <span><small>Unitário</small><strong>${unitValueLabel(i)}</strong></span>
        <span><small>Total</small><strong>${itemTotalLabel(i)}</strong></span>
      </div>
      ${productMeta(i, `<span class="tag">Entrega ${brDate(i.prazo_entrega)}</span><span class="tag ${Number(i.pagamento_recebido || 0) ? "ok" : "warn"}">${Number(i.pagamento_recebido || 0) ? "Pago" : "Pagamento pendente"}</span>`)}
      <p class="address-text">${i.endereço_entrega || "Sem endereço registrado"}</p>
      <div class="actions"><button onclick="openDetail(${i.tender.id})">Abrir histórico</button><button onclick="togglePayment(${i.id}, ${Number(i.pagamento_recebido || 0) ? 0 : 1})">${Number(i.pagamento_recebido || 0) ? "Marcar não pago" : "Confirmar pagamento"}</button><button class="danger" onclick="deleteItemGlobal(${i.id}, 'item finalizado')">Apagar</button></div>
    </article>
  `).join("") || `<div class="card">Nenhum item finalizado ainda.</div>`;
}

async function openDetail(id) {
  state.current = await api(`/api/tenders/${id}`);
  showView("detail");
  const t = state.current;
  $("#detail").innerHTML = `
    <div class="detail-top">
      <div>
        <h2>Pregão Eletrônico Nº ${t.pregão}</h2>
        <p>UASG ${t.uasg} - ${t.órgão}</p>
        <div class="meta">${statusTag(t.status)}<span class="tag">${money(t.valor_total)}</span><span class="tag">${brDateTime(t.data_limite)}</span></div>
      </div>
      <div class="actions">
        <button onclick="showView('dashboard')">Voltar</button>
        <button onclick="editTender(${t.id})">Editar licitação</button>
        <button onclick='openUpload(${t.id}, "", "Proposta")'>Propostas</button>
        <button onclick='openUpload(${t.id}, "", "Empenho")'>Empenho</button>
        <button onclick='openUpload(${t.id}, "", "Ata")'>Ata</button>
        <button onclick='openUpload(${t.id}, "", "Contrato")'>Contrato</button>
      </div>
    </div>
    <div class="proposal-bar">
      <label><input type="checkbox" id="selectAllItems" checked /> Selecionar itens para proposta</label>
      <div class="actions">
        <button onclick="prepareProposal('docx')">Gerar DOCX</button>
        <button class="primary" onclick="prepareProposal('pdf')">Gerar PDF</button>
      </div>
    </div>
    <div class="bulk-bar">
      <button onclick="addBlankItem()">+ Item avulso</button>
      <button onclick="addLotItem()">+ Item em lote</button>
      <span class="tag">Links e status entram apenas na etapa de proposta ou item ganho.</span>
    </div>
    <div id="itemsGroups" class="items-groups">
      ${renderItemGroups(t.items)}
    </div>
  `;
  $("#selectAllItems").addEventListener("change", (event) => {
    $$(".proposal-item").forEach((box) => box.checked = event.target.checked);
  });
  bindLiveTotals();
}

function renderItemGroups(items) {
  const avulsos = items.filter((item) => !item.lote);
  const lots = [...new Set(items.filter((item) => item.lote).map((item) => item.lote))].sort((a, b) => String(a).localeCompare(String(b), "pt-BR", { numeric: true }));
  const avulsosHtml = itemGroup("Itens avulsos", "", avulsos.length ? avulsos : [blankItemData()]);
  const lotsHtml = lots.map((lot) => itemGroup(`Lote ${lot}`, lot, items.filter((item) => item.lote === lot))).join("");
  return avulsosHtml + (lotsHtml || `<section class="item-group empty-lots"><header><div><h3>Lotes</h3><p>Nenhum lote cadastrado ainda.</p></div><button onclick="addLotItem()">+ Criar lote</button></header></section>`);
}

function itemGroup(title, lot, items) {
  return `
    <section class="item-group" data-lot="${lot || ""}">
      <header>
        <div>
          <h3>${title}</h3>
          <p>${lot ? "Itens vinculados a um mesmo lote da licitação." : "Itens independentes, sem composição de lote."}</p>
        </div>
        <button data-lot="${escapeAttr(lot || "")}" onclick="${lot ? "addLotItemFromButton(this)" : "addBlankItem()"}">+ Item</button>
      </header>
      <div class="sheet-wrap">
        <table>
          <thead>
            <tr>
              <th></th><th>Item</th><th>Produto</th><th>Cadastrar?</th><th class="num">Qtd</th><th class="num">Valor unit.</th><th>Sigiloso</th><th class="num">Total</th><th class="num">Cadastro</th><th class="num">Mínimo</th><th>Pesquisa</th><th></th>
            </tr>
          </thead>
          <tbody>${items.map((item) => itemRow(item, lot)).join("")}</tbody>
        </table>
      </div>
    </section>
  `;
}

function docList(docs) {
  if (!docs.length) return "";
  return `<div class="doc-list">${docs.map((d) => `<a href="/attachments/${d.id}/download" target="_blank">${d.tipo}: ${d.filename}</a>`).join("")}</div>`;
}

function itemRow(i, groupLot = "") {
  const editing = !i.id || state.editItemId === i.id;
  const total = itemTotal(i);
  const inactive = Number(i.selecionado_cadastro ?? 1) === 0;
  const ready = !inactive && numberValue(i.valor_cadastro) > 0 && numberValue(i.valor_mínimo) > 0;
  const alt = Boolean(i.opção_produto);
  if (!editing) {
    return `
      <tr class="readonly-row ${inactive ? "item-inactive" : ready ? "item-ready" : ""}" data-id="${i.id}">
        <td><input class="proposal-item row-select" type="checkbox" value="${i.id}" /></td>
        <td><div class="cell-main">${i.item || "-"}</div>${alt ? '<div class="cell-muted">Alternativa</div>' : ""}</td>
        <td><div class="cell-main">${i.marca || "-"} · ${i.modelo || "-"}</div>${i.observação ? `<div class="obs-alert">Observação</div>` : ""}</td>
        <td>${inactive ? '<span class="tag bad">Não disputar</span>' : '<span class="tag ok">Cadastrar</span>'}</td>
        <td class="num">${i.qtd || 0}</td>
        <td class="num">${Number(i.valor_sigiloso || 0) ? "Sigiloso" : money(i.valor_unitário)}</td>
        <td>${Number(i.valor_sigiloso || 0) ? "Sim" : "Não"}</td>
        <td class="num"><strong>${inactive ? "Não soma" : itemTotalLabel(i)}</strong></td>
        <td class="num">${money(i.valor_cadastro)}</td>
        <td class="num">${money(i.valor_mínimo)}</td>
        <td>${searchLinks(i)}</td>
        <td class="inline-actions">
          <button onclick="editItemInline(${i.id})">Editar</button>
          <button class="primary" onclick="markItemProposal(${i.id})">Item em Proposta</button>
          <button onclick="addAlternative(${i.id})">Alternativa</button>
          <button onclick="editObservation(${i.id})">Observação</button>
          <button class="danger" onclick="toggleDispute(${i.id}, ${inactive ? 1 : 0})">${inactive ? "Reativar" : "X"}</button>
          <button class="danger" onclick="deleteItem(${i.id})">Apagar</button>
        </td>
      </tr>
    `;
  }
  return `
    <tr data-id="${i.id || ""}">
      <td><input class="proposal-item row-select" type="checkbox" value="${i.id || ""}" /></td>
      <td>
        <input name="item" value="${i.item || ""}" placeholder="Nº item" />
        <input type="hidden" name="lote" value="${i.lote || groupLot || ""}" />
      </td>
      <td>
        <input name="marca" required value="${i.marca || ""}" placeholder="Marca" />
        <input name="modelo" required value="${i.modelo || i.referência || ""}" placeholder="Modelo" />
      </td>
      <td>
        <label class="inline-check"><input name="selecionado_cadastro" type="checkbox" ${Number(i.selecionado_cadastro ?? 1) ? "checked" : ""} /> Cadastrar/disputar</label>
        <input type="hidden" name="opção_produto" value="${i.opção_produto || ""}" />
      </td>
      <td class="num"><input name="qtd" type="number" min="1" value="${i.qtd || 1}" ${alt ? "readonly" : ""} /></td>
      <td class="num"><input name="valor_unitário" required value="${i.valor_unitário || ""}" ${alt ? "readonly" : ""} /></td>
      <td><input name="valor_sigiloso" type="checkbox" ${Number(i.valor_sigiloso || 0) ? "checked" : ""} /></td>
      <td class="num live-total">${Number(i.valor_sigiloso || 0) ? "Sigiloso" : money(total)}</td>
      <td class="num"><input name="valor_cadastro" value="${i.valor_cadastro || ""}" ${alt ? "readonly" : ""} /></td>
      <td class="num"><input name="valor_mínimo" value="${i.valor_mínimo || ""}" ${alt ? "readonly" : ""} /></td>
      <td>${searchLinks(i)}</td>
      <td class="inline-actions"><button onclick="saveItemRow(this)">Salvar</button><button onclick="${i.id ? "cancelEdit()" : "cancelNewItem(this)"}">Cancelar</button><button onclick="editObservation(${i.id || "null"})">Observação</button></td>
    </tr>
  `;
}

function blankItemData(lote = "") {
  return { tender_id: state.current?.id, lote, qtd: 1, status: "Em cadastro de preços", selecionado_cadastro: 1 };
}

function blankItemRow(lote = "") {
  return itemRow(blankItemData(lote), lote);
}

function addBlankItem() {
  const body = $('.item-group[data-lot=""] tbody');
  body?.insertAdjacentHTML("beforeend", blankItemRow());
  bindLiveTotals();
}

function addLotItem(existingLot = "") {
  const lot = existingLot || prompt("Número/nome do lote:");
  if (!lot) return;
  const group = findLotBody(lot);
  if (group) {
    group.insertAdjacentHTML("beforeend", blankItemRow(lot));
  } else {
    $("#itemsGroups").insertAdjacentHTML("beforeend", itemGroup(`Lote ${lot}`, lot, [blankItemData(lot)]));
  }
  bindLiveTotals();
}

function addLotItemFromButton(button) {
  addLotItem(button.dataset.lot || "");
}

function cancelNewItem(button) {
  button.closest("tr")?.remove();
}

function findLotBody(lot) {
  return $$(".item-group").find((group) => group.dataset.lot === String(lot))?.querySelector("tbody");
}

function addAlternative(itemId) {
  const base = state.current.items.find((item) => Number(item.id) === Number(itemId));
  if (!base) return;
  const body = base.lote ? findLotBody(base.lote) : $('.item-group[data-lot=""] tbody');
  body?.insertAdjacentHTML("beforeend", itemRow({
    ...blankItemData(base.lote || ""),
      item: base.item,
      qtd: base.qtd || 1,
      valor_unitário: base.valor_unitário || "",
      valor_cadastro: base.valor_cadastro || "",
      valor_mínimo: base.valor_mínimo || "",
      valor_sigiloso: base.valor_sigiloso || 0,
      opção_produto: `Alternativa do item ${base.item}`,
      selecionado_cadastro: 0,
  }, base.lote || ""));
  bindLiveTotals();
}

async function toggleDispute(id, active) {
  const item = state.current?.items.find((candidate) => Number(candidate.id) === Number(id));
  if (active && item) {
    const siblings = state.current.items.filter((candidate) => (
      Number(candidate.id) !== Number(id) &&
      String(candidate.item || "") === String(item.item || "") &&
      String(candidate.lote || "") === String(item.lote || "")
    ));
    for (const sibling of siblings) {
      await api("/api/items", { method: "POST", body: JSON.stringify({ ...sibling, selecionado_cadastro: 0 }) });
    }
  }
  await updateSingleItem(id, { selecionado_cadastro: active });
  if (state.current) await openDetail(state.current.id);
}

async function deleteItem(id) {
  const item = state.current.items.find((candidate) => Number(candidate.id) === Number(id));
  if (!item) return;
  if (!confirm(`Apagar o item ${item.item || ""} - ${item.marca || ""} ${item.modelo || ""}?`)) return;
  state.deletedItem = { ...item, id: "" };
  await fetch(`/api/items/${id}`, { method: "DELETE" });
  showUndoToast();
  await load();
  await openDetail(state.current.id);
}

async function deleteTender(id) {
  const tender = state.tenders.find((candidate) => Number(candidate.id) === Number(id));
  if (!tender) return;
  if (!confirm(`Apagar a licitação ${tender.pregão}? Todos os itens, encomendas e anexos vinculados serão removidos.`)) return;
  await fetch(`/api/tenders/${id}`, { method: "DELETE" });
  if (state.current && Number(state.current.id) === Number(id)) {
    state.current = null;
    showView("dashboard");
  }
  await load();
}

async function deleteItemGlobal(id, label = "item") {
  const item = flattenItems().find((candidate) => Number(candidate.id) === Number(id));
  if (!item) return;
  if (!confirm(`Apagar este ${label}: item ${item.item || "-"} - ${item.marca || ""} ${item.modelo || ""}?`)) return;
  await fetch(`/api/items/${id}`, { method: "DELETE" });
  await load();
}

async function deleteOrder(orderId) {
  if (!orderId) return;
  if (!confirm("Apagar esta encomenda? O item ganho continuará cadastrado.")) return;
  await fetch(`/api/orders/${orderId}`, { method: "DELETE" });
  await load();
}

function showUndoToast() {
  clearTimeout(state.undoTimer);
  $(".undo-toast")?.remove();
  document.body.insertAdjacentHTML("beforeend", `
    <div class="undo-toast">
      <span>Item apagado.</span>
      <button onclick="undoDelete()">Desfazer</button>
    </div>
  `);
  state.undoTimer = setTimeout(() => {
    state.deletedItem = null;
    $(".undo-toast")?.remove();
  }, 7000);
}

async function undoDelete() {
  if (!state.deletedItem) return;
  await api("/api/items", { method: "POST", body: JSON.stringify(state.deletedItem) });
  state.deletedItem = null;
  $(".undo-toast")?.remove();
  clearTimeout(state.undoTimer);
  await load();
  if (state.current) await openDetail(state.current.id);
}

async function saveItemRow(button) {
  const tr = button.closest("tr");
  const existing = state.current.items.find((item) => String(item.id) === String(tr.dataset.id)) || {};
  const data = { ...existing, id: tr.dataset.id, tender_id: state.current.id, status: existing.status || "Em cadastro de preços" };
  $$("input, select", tr).forEach((field) => {
    if (!field.name) return;
    data[field.name] = field.type === "checkbox" ? field.checked : field.value;
  });
  const missing = [];
  const isAlternative = Boolean(data.opção_produto);
  if (!String(data.item || "").trim()) missing.push("Item");
  if (!String(data.marca || "").trim()) missing.push("Marca");
  if (!String(data.modelo || "").trim()) missing.push("Modelo");
  if (numberValue(data.qtd) <= 0) missing.push("Qtd");
  if (!isAlternative && numberValue(data.valor_unitário) <= 0) missing.push("Valor unitário");
  if (missing.length) return alert(`Preencha os campos obrigatórios: ${missing.join(", ")}.`);
  const saved = await api("/api/items", { method: "POST", body: JSON.stringify(data) });
  if (data.selecionado_cadastro) {
    const siblings = state.current.items.filter((candidate) => (
      Number(candidate.id) !== Number(saved.id) &&
      String(candidate.item || "") === String(data.item || "") &&
      String(candidate.lote || "") === String(data.lote || "")
    ));
    for (const sibling of siblings) {
      await api("/api/items", { method: "POST", body: JSON.stringify({ ...sibling, selecionado_cadastro: 0 }) });
    }
  }
  state.editItemId = null;
  await load();
  await openDetail(state.current.id);
}

function editItemInline(id) {
  state.editItemId = id;
  openDetail(state.current.id);
}

function cancelEdit() {
  state.editItemId = null;
  openDetail(state.current.id);
}

function bindLiveTotals() {
  $$("tr").forEach((tr) => {
    const qtd = $('input[name="qtd"]', tr);
    const unit = $('input[name="valor_unitário"]', tr);
    const sigiloso = $('input[name="valor_sigiloso"]', tr);
    const total = $(".live-total", tr);
    if (!qtd || !unit || !total) return;
    const update = () => {
      total.textContent = sigiloso?.checked ? "Sigiloso" : money(numberValue(qtd.value) * numberValue(unit.value));
    };
    qtd.addEventListener("input", update);
    unit.addEventListener("input", update);
    sigiloso?.addEventListener("change", update);
    update();
  });
}

async function applyBulk() {
  const ids = $$(".row-select").filter((box) => box.checked && box.value).map((box) => box.value);
  if (!ids.length) return alert("Selecione pelo menos um item já salvo.");
  await api("/api/items/bulk", {
    method: "POST",
    body: JSON.stringify({ item_ids: ids, status: $("#bulkStatus").value, valor_ganho: $("#bulkWonValue").value }),
  });
  await load();
  await openDetail(state.current.id);
}

async function updateSingleItem(id, updates) {
  const item = flattenItems().find((i) => Number(i.id) === Number(id));
  if (!item) return;
  await api("/api/items", { method: "POST", body: JSON.stringify({ ...item, ...updates }) });
  await load();
}

async function markItemWon(id) {
  await updateSingleItem(id, { status: "Aguardando Habilitação" });
  alert("Item enviado para Itens ganhos.");
}

async function editWonData(id) {
  state.editWonId = state.editWonId === id ? null : id;
  renderWon();
}

async function saveWonStatus(id, status) {
  if (!WIN_STATUSES.includes(status)) return;
  await updateSingleItem(id, { status });
  state.editWonId = null;
  renderWon();
}

async function markItemProposal(id) {
  await updateSingleItem(id, { status: "Proposta enviada" });
  alert("Item enviado para Itens em Proposta.");
}

async function editObservation(id) {
  if (!id) return alert("Salve o item antes de registrar observação.");
  const item = flattenItems().find((candidate) => Number(candidate.id) === Number(id));
  if (!item) return;
  const text = prompt("Observação do item:", item.observação || "");
  if (text === null) return;
  await updateSingleItem(id, { observação: text });
  if (state.current) await openDetail(state.current.id);
}

async function finishOrder(itemId) {
  const item = flattenItems().find((candidate) => Number(candidate.id) === Number(itemId));
  if (!item) return;
  await api("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      item_id: item.id,
      prazo_entrega: item.prazo_entrega,
      ordem_fornecimento: item.ordem_fornecimento,
      endereço_entrega: item.endereço_entrega,
      nota_empenho: item.nota_empenho,
      status: "Entregue",
      observação: item.observação_encomenda || "",
    }),
  });
  await updateSingleItem(item.id, { status: "Entregue" });
}

async function togglePayment(itemId, paid) {
  const item = flattenItems().find((candidate) => Number(candidate.id) === Number(itemId));
  if (!item) return;
  await api("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      item_id: item.id,
      prazo_entrega: item.prazo_entrega,
      ordem_fornecimento: item.ordem_fornecimento,
      endereço_entrega: item.endereço_entrega,
      nota_empenho: item.nota_empenho,
      status: item.status_encomenda || "Entregue",
      pagamento_recebido: paid,
      observação: item.observação_encomenda || "",
    }),
  });
  await load();
}

function selectedProposalItems() {
  const ids = $$(".proposal-item").filter((box) => box.checked && box.value).map((box) => Number(box.value));
  return ids.map((id) => state.current.items.find((item) => Number(item.id) === id)).filter(Boolean);
}

function prepareProposal(format) {
  const items = selectedProposalItems();
  if (!items.length) return alert("Selecione pelo menos um item salvo para gerar a proposta.");
  state.pendingProposalFormat = format;
  $("#proposalLinksFields").innerHTML = items.map((item) => `
    <div class="proposal-link-row" data-id="${item.id}">
      <div><strong>Item ${item.item || "-"}</strong><div class="cell-muted">${item.marca || ""} ${item.modelo || ""}</div></div>
      <div class="grid2">
        <label>Link do fornecedor <input name="link" required placeholder="https://..." value="${item.link_referência || item.link_br || item.link_usa || ""}" /></label>
        <label>Valor ganho <input name="valor_ganho" required inputmode="decimal" placeholder="R$ 0,00" value="${item.valor_ganho || item.valor_unitário || ""}" /></label>
      </div>
    </div>
  `).join("");
  $("#proposalLinksDialog").showModal();
}

async function generateSelected(format) {
  if (!state.current) return;
  const ids = selectedProposalItems().map((item) => item.id);
  if (!ids.length) return alert("Selecione pelo menos um item salvo para gerar a proposta.");
  const response = await fetch(`/proposal/${state.current.id}?format=${format}&items=${ids.join(",")}`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    alert(data.error || "Não foi possível gerar a proposta.");
    return;
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : `proposta.${format}`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
  await api("/api/items/bulk", { method: "POST", body: JSON.stringify({ item_ids: ids, status: "Proposta enviada" }) });
  await load();
  if (state.current) await openDetail(state.current.id);
}

function showView(view) {
  state.view = view;
  $$(".view").forEach((el) => el.classList.add("hidden"));
  $(`#${view}`).classList.remove("hidden");
  $$(".nav").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
  if (view === "users") loadUsers();
  renderView(view);
}

function renderView(view = state.view) {
  const renderers = {
    dashboard: renderDashboard,
    future: renderFuture,
    past: renderPast,
    proposalItems: renderProposalItems,
    won: renderWon,
    orders: renderOrders,
    finished: renderFinished,
    users: renderUsers,
  };
  renderers[view]?.();
  renderViewToggles();
}

function editTender(id) {
  const tender = state.tenders.find((t) => t.id === id) || {};
  fillForm($("#tenderForm"), tender);
  $("#tenderDialog").showModal();
}

function editOrder(item) {
  fillForm($("#orderForm"), {
    item_id: item.id,
    prazo_entrega: item.prazo_entrega,
    ordem_fornecimento: item.ordem_fornecimento,
    endereço_entrega: item.endereço_entrega,
    nota_empenho: item.nota_empenho,
    status: item.status_encomenda || "Pendente",
    observação: item.observação_encomenda,
  });
  $("#orderDialog").showModal();
}

async function openUpload(tenderId, itemId = "", tipo = "Empenho") {
  state.uploadContext = { tenderId, itemId: itemId || "", tipo };
  fillForm($("#uploadForm"), { tender_id: tenderId, item_id: itemId || "", tipo });
  await renderUploadExisting();
  $("#uploadDialog").showModal();
}

async function renderUploadExisting() {
  const box = $("#uploadExisting");
  if (!box || !state.uploadContext) return;
  const { tenderId, itemId, tipo } = state.uploadContext;
  box.innerHTML = `<div class="upload-card">Carregando arquivos...</div>`;
  const docs = await api(`/api/attachments?tender_id=${tenderId}${itemId ? `&item_id=${itemId}` : ""}`);
  const filtered = docs.filter((doc) => doc.tipo === tipo);
  box.innerHTML = `
    <div class="upload-card">
      <strong>${tipo === "Proposta" ? "Propostas geradas" : `${tipo}s anexados`}</strong>
      ${filtered.length ? filtered.map((doc) => `
        <div class="upload-row">
          <a href="/attachments/${doc.id}/download" target="_blank">${doc.filename}</a>
          <button type="button" class="danger" onclick="deleteAttachment(${doc.id})">Apagar</button>
        </div>
      `).join("") : `<p>Nenhum arquivo enviado ainda.</p>`}
    </div>
  `;
}

async function deleteAttachment(id) {
  if (!confirm("Apagar este arquivo?")) return;
  await fetch(`/api/attachments/${id}`, { method: "DELETE" });
  await load();
  await renderUploadExisting();
  if (state.current) state.current = await api(`/api/tenders/${state.current.id}`);
}

async function openUsers() {
  await loadUsers();
  clearUserForm();
  showView("users");
}

async function loadUsers() {
  state.users = await api("/api/users");
  renderUsers();
}

function renderUsers() {
  const box = $("#usersList");
  if (!box) return;
  const count = $("#usersCount");
  if (count) count.textContent = `${state.users.length} usuário${state.users.length === 1 ? "" : "s"}`;
  box.innerHTML = state.users.map((user) => `
    <article class="user-row">
      <div>
        <strong>${user.nome}</strong>
        <span>${user.email}</span>
      </div>
      <span class="tag ${Number(user.ativo) ? "ok" : "bad"}">${Number(user.ativo) ? "Ativo" : "Inativo"}</span>
      <span class="tag">${user.perfil}</span>
      <div class="actions">
        <button type="button" onclick="editUser(${user.id})">Editar</button>
        <button type="button" class="danger" onclick="deleteUser(${user.id})">Apagar</button>
      </div>
    </article>
  `).join("") || `<div class="card">Nenhum usuário cadastrado.</div>`;
}

function clearUserForm() {
  fillForm($("#userForm"), { perfil: "Precificação", ativo: "on" });
  $("#userForm").elements.ativo.checked = true;
}

function editUser(id) {
  const user = state.users.find((candidate) => Number(candidate.id) === Number(id));
  if (!user) return;
  fillForm($("#userForm"), { ...user, senha: "" });
  $("#userForm").elements.ativo.checked = Boolean(Number(user.ativo));
}

async function saveUser(event) {
  event.preventDefault();
  const form = event.target;
  const data = formData(form);
  data.ativo = form.elements.ativo.checked ? 1 : 0;
  await api("/api/users", { method: "POST", body: JSON.stringify(data) });
  clearUserForm();
  await loadUsers();
}

async function deleteUser(id) {
  const user = state.users.find((candidate) => Number(candidate.id) === Number(id));
  if (!user) return;
  if (!confirm(`Apagar o usuário ${user.nome}?`)) return;
  await fetch(`/api/users/${id}`, { method: "DELETE" });
  await loadUsers();
}

async function uploadFile(event) {
  event.preventDefault();
  const form = event.target;
  const file = form.elements.file.files[0];
  if (!file) return;
  const dataUrl = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
  await api("/api/attachments", {
    method: "POST",
    body: JSON.stringify({
      tender_id: form.elements.tender_id.value,
      item_id: form.elements.item_id.value,
      tipo: form.elements.tipo.value,
      filename: file.name,
      content_type: file.type,
      data: dataUrl,
    }),
  });
  form.reset();
  fillForm(form, {
    tender_id: state.uploadContext?.tenderId || "",
    item_id: state.uploadContext?.itemId || "",
    tipo: state.uploadContext?.tipo || "Empenho",
  });
  await load();
  await renderUploadExisting();
  if (state.current) state.current = await api(`/api/tenders/${state.current.id}`);
}

async function submitProposalLinks(event) {
  event.preventDefault();
  const rows = $$(".proposal-link-row", $("#proposalLinksFields"));
  for (const row of rows) {
    const id = Number(row.dataset.id);
    const item = state.current.items.find((candidate) => Number(candidate.id) === id);
    const link = $('input[name="link"]', row).value.trim();
    const valorGanho = $('input[name="valor_ganho"]', row).value.trim();
    if (!link) return alert("Informe o link do fornecedor para todos os itens selecionados.");
    if (!valorGanho) return alert("Informe o valor ganho para todos os itens selecionados.");
    await api("/api/items", { method: "POST", body: JSON.stringify({ ...item, link_referência: link, valor_ganho: valorGanho }) });
  }
  $("#proposalLinksDialog").close();
  await load();
  state.current = await api(`/api/tenders/${state.current.id}`);
  await generateSelected(state.pendingProposalFormat);
}

function renderAll() {
  renderDashboard();
  renderFuture();
  renderPast();
  renderProposalItems();
  renderWon();
  renderOrders();
  renderFinished();
  renderUsers();
  renderViewToggles();
}

function logout() {
  localStorage.removeItem("licitaum-session");
  state.account = null;
  document.body.classList.add("login-active");
  $("#loginForm")?.reset();
}

function setAccount(user) {
  state.account = user;
  localStorage.setItem("licitaum-session", JSON.stringify(user));
  $("#accountName").textContent = user.nome || "Usuário";
  $("#accountEmail").textContent = user.email || "";
  $("#accountAvatar").textContent = (user.nome || user.email || "U").trim().slice(0, 1).toUpperCase();
}

async function submitLogin(event) {
  event.preventDefault();
  const form = event.target;
  const button = $("button", form);
  button.disabled = true;
  button.textContent = "Entrando...";
  try {
    const user = await api("/api/login", { method: "POST", body: JSON.stringify(formData(form)) });
    setAccount(user);
    document.body.classList.remove("login-active");
    await load();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Entrar";
  }
}

function renderViewToggles() {
  $$(".view-toggle").forEach((toggle) => {
    const target = toggle.dataset.target;
    $$("button", toggle).forEach((button) => {
      button.classList.toggle("active", state.viewModes[target] === button.dataset.mode);
      button.title = button.dataset.mode === "grid" ? "Ver em grid" : "Ver em lista";
    });
  });
}

async function load() {
  state.tenders = await api("/api/tenders");
  for (const tender of state.tenders) {
    const detail = await api(`/api/tenders/${tender.id}`);
    tender.items = detail.items;
    tender.attachments = detail.attachments;
  }
  renderAll();
}

async function boot() {
  const savedTheme = localStorage.getItem("licitaum-theme");
  if (savedTheme === "dark") document.body.classList.add("dark");
  updateThemeButton();
  $("#loginForm").addEventListener("submit", submitLogin);
  const savedSession = localStorage.getItem("licitaum-session");
  if (savedSession) {
    try {
      setAccount(JSON.parse(savedSession));
      document.body.classList.remove("login-active");
    } catch {
      localStorage.removeItem("licitaum-session");
      document.body.classList.add("login-active");
    }
  } else {
    document.body.classList.add("login-active");
  }
  const meta = await api("/api/meta");
  state.statuses = meta.status;
  state.currentDate = meta.current_date;
  $("#tenderForm select[name=status]").innerHTML = state.statuses.map((s) => `<option>${s}</option>`).join("");

  $$(".nav[data-view]").forEach((btn) => btn.addEventListener("click", () => showView(btn.dataset.view)));
  $("#themeToggle").addEventListener("click", () => {
    document.body.classList.toggle("dark");
    localStorage.setItem("licitaum-theme", document.body.classList.contains("dark") ? "dark" : "light");
    updateThemeButton();
  });
  $("#newTender").addEventListener("click", () => {
    fillForm($("#tenderForm"), { status: "Futura licitação" });
    $("#tenderDialog").showModal();
  });
  $$("[data-close]").forEach((btn) => btn.addEventListener("click", () => btn.closest("dialog").close()));
  $("#futureSearch").addEventListener("input", renderFuture);
  $("#pastSearch").addEventListener("input", renderPast);
  $("#pastYear").addEventListener("input", renderPast);
  $("#pastMonth").addEventListener("input", renderPast);
  $("#pastDate").addEventListener("change", renderPast);
  $("#wonStatusFilter").addEventListener("change", renderWon);
  $("#orderSort").addEventListener("change", renderOrders);
  $("#finishedSort").addEventListener("change", renderFinished);
  $$(".view-toggle button").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.closest(".view-toggle").dataset.target;
      state.viewModes[target] = button.dataset.mode;
      renderAll();
    });
  });

  $("#tenderForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/tenders", { method: "POST", body: JSON.stringify(formData(event.target)) });
    $("#tenderDialog").close();
    await load();
  });
  $("#orderForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/orders", { method: "POST", body: JSON.stringify(formData(event.target)) });
    $("#orderDialog").close();
    await load();
    if (state.current) await openDetail(state.current.id);
  });
  $("#uploadForm").addEventListener("submit", uploadFile);
  $("#userForm").addEventListener("submit", saveUser);
  $("#uploadForm").elements.tipo.addEventListener("change", (event) => {
    if (!state.uploadContext) return;
    state.uploadContext.tipo = event.target.value;
    renderUploadExisting();
  });
  $("#proposalLinksForm").addEventListener("submit", submitProposalLinks);
  setInterval(updateCountdowns, 1000);

  if (state.account) await load();
}

boot().catch((error) => alert(error.message));

function updateThemeButton() {
  const button = $("#themeToggle");
  if (!button) return;
  const dark = document.body.classList.contains("dark");
  button.querySelector(".nav-icon").textContent = dark ? "☼" : "☾";
  button.querySelector(".nav-text").textContent = dark ? "Modo claro" : "Modo escuro";
}
