const state = {
  tenders: [],
  current: null,
  statuses: [],
  view: "dashboard",
  editItemId: null,
  editWonId: null,
  pendingProposalFormat: "docx",
  viewModes: { won: "list", proposalItems: "list", orders: "list", finished: "list" },
  deletedItem: null,
  undoTimer: null,
  uploadContext: null,
  users: [],
  account: null,
  currentDate: null,
  dashboardMonth: "",
  observationItemId: null,
  proposalItemId: null,
  orderItemIds: [],
  caronaItemIds: [],
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

function monthKey(value) {
  const date = isoDate(value);
  return date && !Number.isNaN(date) ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` : "";
}

function monthLabel(value) {
  if (!value) return "Todos os meses";
  const [year, month] = value.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
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
  const cls = statusClass(status);
  return `<span class="tag ${cls}">${status || "Sem status"}</span>`;
}

function statusClass(status = "") {
  if (/Pagamento pendente|Perdido|Atrasada/.test(status)) return "bad";
  if (/Adjudicada|Pago/.test(status)) return "status-adjudicated";
  if (/Julgado e Habilitado/.test(status)) return "status-enabled";
  if (/Aguardando Habilitação|cadastro|Futura|Proposta enviada/.test(status)) return "status-wait";
  if (/emitida|Entregue|Finalizado/.test(status)) return "ok";
  return "";
}

function itemValue(item) {
  return numberValue(item.valor_ganho) || numberValue(item.valor_unitário);
}

function displayQty(item) {
  return item.order_id && numberValue(item.qtd_empenhada) > 0 ? numberValue(item.qtd_empenhada) : Number(item.qtd || 0);
}

function itemTotal(item) {
  if (Number(item.selecionado_cadastro ?? 1) === 0) return 0;
  if (Number(item.valor_sigiloso || 0) && !numberValue(item.valor_ganho)) return 0;
  return Number(item.qtd || 0) * itemValue(item);
}

function itemBusinessTotal(item) {
  if (Number(item.selecionado_cadastro ?? 1) === 0) return 0;
  const unit = numberValue(item.valor_ganho) || numberValue(item.valor_unitário);
  return displayQty(item) * unit;
}

function itemTotalLabel(item) {
  return Number(item.valor_sigiloso || 0) && !numberValue(item.valor_ganho) ? "Sigiloso" : money(itemTotal(item));
}

function unitValueLabel(item) {
  return Number(item.valor_sigiloso || 0) && !numberValue(item.valor_ganho) ? "Sigiloso" : money(itemValue(item));
}

function sectorSummary(rows, label = "") {
  const disputados = rows.filter((item) => Number(item.selecionado_cadastro ?? 1) !== 0);
  const total = disputados.reduce((sum, item) => sum + itemBusinessTotal(item), 0);
  return `<div class="sector-summary">${label ? `<b>${label}</b>` : ""}<span>${disputados.length} produtos</span><strong>${money(total)}</strong></div>`;
}

function productFacts(item) {
  const qty = displayQty(item);
  const total = qty * itemValue(item);
  return `
    <div class="product-facts">
      <span><small>${item.order_id && numberValue(item.qtd_empenhada) > 0 ? "Qtd empenhada" : "Qtd"}</small><strong>${qty || 0}</strong></span>
      <span><small>Unitário</small><strong>${unitValueLabel(item)}</strong></span>
      <span><small>Total</small><strong>${Number(item.valor_sigiloso || 0) && !numberValue(item.valor_ganho) ? "Sigiloso" : money(total)}</strong></span>
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
    return statusTag(item.status);
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

function tenderValueLabel(tender) {
  const items = selectedTenderItems(tender);
  if (!tender.items && Number(tender.itens_ativos || 0) > 0 && Number(tender.itens_sigilosos || 0) === Number(tender.itens_ativos || 0)) return "Sigiloso";
  if (items.length && items.every((item) => Number(item.valor_sigiloso || 0))) return "Sigiloso";
  return money(tender.valor_total);
}

function tenderMinimumLabel(tender) {
  return `Total mínimo ${money(tender.valor_minimo_total)}`;
}

function lotMinimumTotal(items) {
  return items
    .filter((item) => Number(item.selecionado_cadastro ?? 1) !== 0)
    .reduce((sum, item) => sum + (Number(item.qtd || 0) * numberValue(item.valor_mínimo)), 0);
}

function flattenItems() {
  return state.tenders.flatMap((tender) => (tender.items || []).map((item) => ({ ...item, tender })));
}

function flattenOrders() {
  return flattenItems().flatMap((item) => (item.orders || []).map((order) => ({
    ...item,
    order_id: order.id,
    group_id: order.group_id,
    qtd_empenhada: order.qtd_empenhada,
    prazo_entrega: order.prazo_entrega,
    ordem_fornecimento: order.ordem_fornecimento,
    endereço_entrega: order.endereço_entrega,
    nota_empenho: order.nota_empenho,
    status_encomenda: order.status,
    pagamento_recebido: order.pagamento_recebido,
    observação_encomenda: order.observação,
    origem_encomenda: order.origem || "Empenho",
    órgão_solicitante: order.órgão_solicitante || "",
  })));
}

function pendingOrderQty(item) {
  return Math.max(numberValue(item.qtd) - numberValue(item.qtd_empenhada_total), 0);
}

function itemFilterMatch(item, searchSelector, minSelector) {
  const q = ($(searchSelector)?.value || "").toLowerCase().trim();
  const min = numberValue($(minSelector)?.value || "");
  const haystack = `${item.item || ""} ${item.marca || ""} ${item.modelo || ""} ${item.referência || ""} ${item.tender?.pregão || ""} ${item.tender?.uasg || ""} ${item.tender?.órgão || ""}`.toLowerCase();
  if (q && !haystack.includes(q)) return false;
  if (min > 0 && itemBusinessTotal(item) < min) return false;
  return true;
}

function searchUrl(site, item) {
  const query = encodeURIComponent(`${item.marca || ""} ${item.modelo || item.referência || ""}`.trim());
  const urls = {
    ml: `https://lista.mercadolivre.com.br/${query}`,
    amazon: `https://www.amazon.com/s?k=${query}`,
    google: `https://www.google.com/search?q=${query}`,
    sweetwater: `https://www.sweetwater.com/store/search?s=${query}`,
    bh: `https://www.bhphotovideo.com/c/search?q=${query}`,
  };
  return urls[site];
}

function searchLinks(item) {
  return `
    <div class="search-links">
      <a href="${searchUrl("ml", item)}" target="_blank" rel="noopener noreferrer">ML</a>
      <a href="${searchUrl("amazon", item)}" target="_blank" rel="noopener noreferrer">Amazon</a>
      <a href="${searchUrl("google", item)}" target="_blank" rel="noopener noreferrer">Google</a>
      <a href="${searchUrl("sweetwater", item)}" target="_blank" rel="noopener noreferrer">Sweetwater</a>
      <a href="${searchUrl("bh", item)}" target="_blank" rel="noopener noreferrer">B&H</a>
    </div>
  `;
}

function renderDashboard() {
  const now = appNow();
  const activeItems = flattenItems().filter((item) => Number(item.selecionado_cadastro ?? 1) !== 0);
  const allOrders = flattenOrders();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthOptions = [...new Set([
    currentMonth,
    ...activeItems.map((item) =>
      monthKey(item.tender.data_limite || item.tender.created_at),
    ).filter(Boolean),
    ...allOrders.map((item) => monthKey(item.prazo_entrega || item.tender.data_limite || item.tender.created_at)).filter(Boolean),
  ])].sort().reverse();
  const selectedMonth = state.dashboardMonth === null ? "" : (state.dashboardMonth || currentMonth);
  const future = state.tenders
    .filter((t) => isoDate(t.data_limite) && isoDate(t.data_limite) >= now)
    .sort((a, b) => isoDate(a.data_limite) - isoDate(b.data_limite));
  const orders = allOrders.filter((i) => i.status_encomenda !== "Entregue");
  const riskyOrders = groupOrderRows(orders
    .filter((i) => isoDate(i.prazo_entrega))
    .sort((a, b) => isoDate(a.prazo_entrega) - isoDate(b.prazo_entrega))
    .filter((i) => isoDate(i.prazo_entrega) < now))
    .slice(0, 5);
  const upcomingOrders = groupOrderRows(orders
    .filter((i) => isoDate(i.prazo_entrega) && isoDate(i.prazo_entrega) >= now)
    .sort((a, b) => isoDate(a.prazo_entrega) - isoDate(b.prazo_entrega)))
    .slice(0, 5);
  const inSelectedMonth = (item, dateField = "tender") => {
    if (!selectedMonth) return true;
    const value = dateField === "order" ? (item.prazo_entrega || item.tender.data_limite || item.tender.created_at) : (item.tender.data_limite || item.tender.created_at);
    const date = isoDate(value);
    return date && `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` === selectedMonth;
  };
  const valorGanho = activeItems
    .filter((item) => WIN_STATUSES.includes(item.status) && inSelectedMonth(item))
    .reduce((sum, item) => sum + itemBusinessTotal(item), 0);
  const valorEmpenhado = allOrders
    .filter((item) => inSelectedMonth(item, "order"))
    .reduce((sum, item) => sum + itemBusinessTotal(item), 0);
  const valorPago = allOrders
    .filter((item) => Number(item.pagamento_recebido || 0) && inSelectedMonth(item, "order"))
    .reduce((sum, item) => sum + itemBusinessTotal(item), 0);

  $("#dashboard").innerHTML = `
    <div class="dashboard-overview">
      <div class="metrics operational-metrics">
        <div class="metric"><span>Próximas licitações</span><strong>${future.length}</strong></div>
        <div class="metric countdown-metric"><span>Próxima licitação em</span><strong class="countdown" data-deadline="${future[0]?.data_limite || ""}">${countdownLabel(future[0]?.data_limite)}</strong></div>
      </div>
      <section class="financial-overview">
        <header>
          <div><small>Resumo financeiro</small><strong>${monthLabel(selectedMonth)}</strong></div>
          <label>Período
            <select id="dashboardMonth">
              <option value="" ${selectedMonth === "" ? "selected" : ""}>Todos os meses</option>
              ${monthOptions.map((option) => `<option value="${option}" ${selectedMonth === option ? "selected" : ""}>${monthLabel(option)}</option>`).join("")}
            </select>
          </label>
        </header>
        <div class="financial-metrics">
          <div class="metric"><span>Valor ganho</span><strong>${money(valorGanho)}</strong></div>
          <div class="metric"><span>Valor empenhado</span><strong>${money(valorEmpenhado)}</strong></div>
          <div class="metric"><span>Valor pago</span><strong>${money(valorPago)}</strong></div>
        </div>
      </section>
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
  $("#dashboardMonth")?.addEventListener("change", (event) => {
    state.dashboardMonth = event.target.value || null;
    renderDashboard();
  });
  updateCountdowns();
}

function clearDashboardMonth() {
  state.dashboardMonth = null;
  renderDashboard();
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

function orderAlert(group) {
  const item = group.items[0];
  const isCarona = item.origem_encomenda === "Carona";
  const due = isoDate(item.prazo_entrega);
  const diff = due ? Math.ceil((due - appNow()) / 86400000) : 999;
  const cls = diff < 0 ? "danger" : diff <= 15 ? "warn" : "ok";
  const label = diff < 0 ? `Vencida há ${Math.abs(diff)} dias` : `Vence em ${diff} dias`;
  const total = group.items.reduce((sum, current) => sum + itemBusinessTotal(current), 0);
  return `
    <article class="alert-card dashboard-order-alert ${cls}">
      <div class="alert-head"><strong>${label}</strong><span>${brDate(item.prazo_entrega)}</span></div>
      <div class="dashboard-order-title">
        <div>
          <small>${isCarona ? "Carona" : group.items.length > 1 ? "Encomenda agrupada" : "Encomenda"}</small>
          <strong>${isCarona ? (item.órgão_solicitante || "Órgão solicitante") : `Pregão ${item.tender.pregão}`}</strong>
        </div>
        <div><small>Total</small><strong>${money(total)}</strong></div>
      </div>
      <div class="meta">${isCarona ? `<span class="tag">Referência: Pregão ${item.tender.pregão}</span>` : ""}<span class="tag">UASG ${item.tender.uasg}</span><span class="tag">${group.items.length} produto${group.items.length === 1 ? "" : "s"}</span></div>
      <div class="dashboard-order-products">
        ${group.items.map((current) => `
          <div>
            <span><b>Item ${current.item || "-"}</b> ${current.marca || ""} ${current.modelo || current.referência || ""}</span>
            <span>Qtd ${displayQty(current)} · ${money(itemBusinessTotal(current))}</span>
          </div>
        `).join("")}
      </div>
      <div class="actions"><button onclick="openDetail(${item.tender.id})">Abrir</button></div>
    </article>
  `;
}

function tenderCard(t) {
  const items = selectedTenderItems(t);
  const ready = pricesComplete(t);
  const platform = t.plataforma || "ComprasNet";
  return `
    <article class="card timeline-card ${ready ? "tender-ready" : ""}">
      <div class="date-badge"><strong>${brDate(t.data_limite)}</strong><span>${isoDate(t.data_limite)?.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) || "sem horário"}</span></div>
      <div>
        <h3>Pregão Eletrônico Nº ${t.pregão}</h3>
        <p>UASG ${t.uasg} - ${t.órgão}</p>
        <div class="meta">${statusTag(t.status)}<span class="tag">${platform}</span><span class="tag">${items.length} itens cadastrados</span><span class="tag ${ready ? "ok" : "warn"}">${ready ? "Preços completos" : "Preços pendentes"}</span><span class="tag">${tenderValueLabel(t)}</span><span class="tag">${tenderMinimumLabel(t)}</span><span class="tag">${t.localidade || "Sem localidade"}</span></div>
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
  const platform = $("#futurePlatform")?.value || "";
  const now = appNow();
  const rows = state.tenders
    .filter((t) => {
      const date = isoDate(t.data_limite);
      return date ? date >= now : t.status === "Futura licitação";
    })
    .filter((t) => !platform || (t.plataforma || "ComprasNet") === platform)
    .filter((t) => `${t.pregão} ${t.uasg} ${t.órgão} ${t.plataforma || "ComprasNet"}`.toLowerCase().includes(q))
    .sort((a, b) => (isoDate(a.data_limite) || new Date(8640000000000000)) - (isoDate(b.data_limite) || new Date(8640000000000000)));
  $("#futureList").innerHTML = rows.map(tenderCard).join("") || `<div class="card">Nenhuma licitação futura encontrada.</div>`;
}

function renderPast() {
  const q = ($("#pastSearch")?.value || "").toLowerCase();
  const platform = $("#pastPlatform")?.value || "";
  const year = ($("#pastYear")?.value || "").trim();
  const month = ($("#pastMonth")?.value || "").trim();
  const exactDate = ($("#pastDate")?.value || "").trim();
  const now = appNow();
  const rows = state.tenders
    .filter((t) => isoDate(t.data_limite) && isoDate(t.data_limite) < now)
    .filter((t) => {
      const haystack = `${t.pregão} ${t.uasg} ${t.órgão} ${t.plataforma || "ComprasNet"} ${(t.items || []).map((i) => `${i.marca} ${i.modelo} ${i.referência}`).join(" ")}`.toLowerCase();
      const d = isoDate(t.data_limite);
      if (q && !haystack.includes(q)) return false;
      if (platform && (t.plataforma || "ComprasNet") !== platform) return false;
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
  const sort = $("#wonSort")?.value || "value_desc";
  let rows = flattenItems()
    .filter((i) => WIN_STATUSES.includes(i.status) && pendingOrderQty(i) > 0)
    .filter((i) => !status || i.status === status)
    .map((i) => ({ ...i, qtd_original: i.qtd, qtd: pendingOrderQty(i) }))
    .filter((i) => itemFilterMatch(i, "#wonSearch", "#wonMinValue"));
  if (sort === "value_asc") rows = rows.sort((a, b) => itemBusinessTotal(a) - itemBusinessTotal(b));
  else if (sort === "status") rows = rows.sort((a, b) => String(a.status || "").localeCompare(String(b.status || "")));
  else if (sort === "pregao") rows = rows.sort((a, b) => String(a.tender.pregão || "").localeCompare(String(b.tender.pregão || "")));
  else rows = rows.sort((a, b) => itemBusinessTotal(b) - itemBusinessTotal(a));
  $("#wonList").classList.toggle("list-mode", state.viewModes.won === "list");
  $("#wonList").innerHTML = sectorSummary(rows) + `
    <div class="bulk-order-bar">
      <div><strong id="wonSelectionCount">0 selecionados</strong><span>Selecione os itens que pertencem ao mesmo empenho.</span></div>
      <button id="createBulkOrder" class="primary" disabled>Colocar selecionados em encomenda</button>
    </div>
  ` + (rows.map((i) => `
    <article class="product-card">
      <header>
        <label class="item-selector"><input class="won-order-select" type="checkbox" value="${i.id}" onchange="updateWonSelection()" /><span>Item ${i.item || "-"}</span></label>
        ${wonStatusControl(i)}
      </header>
      ${productIdentity(i)}
      <div class="value">${itemTotalLabel(i)}</div>
      ${productFacts(i)}
      ${productMeta(i, `<span class="tag">Ganho ${i.qtd_original}</span><span class="tag">Empenhado ${numberValue(i.qtd_empenhada_total)}</span><span class="tag status-wait">Pendente ${i.qtd}</span>`)}
      <div class="actions">
        <button onclick="editWonData(${i.id})">${state.editWonId === i.id ? "Cancelar edição" : "Editar status"}</button>
        <button onclick="openDetail(${i.tender.id})">Abrir pregão</button>
        <button onclick="editOrder(${i.id})">Colocar em encomenda</button>
        <button onclick='openUpload(${i.tender.id}, ${i.id}, "Empenho")'>Upload empenho</button>
        <button class="danger" onclick="deleteItemGlobal(${i.id}, 'item ganho')">Apagar</button>
      </div>
    </article>
  `).join("") || `<div class="card">Nenhum item ganho com quantidade pendente de empenho.</div>`);
  $("#createBulkOrder")?.addEventListener("click", openBulkOrder);
}

function renderProposalItems() {
  const rows = flattenItems()
    .filter((i) => i.status === "Proposta enviada")
    .filter((i) => itemFilterMatch(i, "#proposalSearch", "#proposalMinValue"))
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

function groupOrderRows(rows) {
  const groups = new Map();
  rows.forEach((item) => {
    const key = item.group_id || `order-${item.order_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return [...groups.entries()].map(([id, items]) => ({ id, items }));
}

function orderGroupTotal(group) {
  return group.items.reduce((sum, item) => sum + itemBusinessTotal(item), 0);
}

function orderGroupFilterMatch(group, searchSelector, minSelector) {
  const q = ($(searchSelector)?.value || "").toLowerCase().trim();
  const min = numberValue($(minSelector)?.value || "");
  const haystack = group.items.map((item) => (
    `${item.item || ""} ${item.marca || ""} ${item.modelo || ""} ${item.referência || ""} ${item.tender.pregão || ""} ${item.tender.uasg || ""} ${item.tender.órgão || ""} ${item.órgão_solicitante || ""}`
  )).join(" ").toLowerCase();
  return (!q || haystack.includes(q)) && (!min || orderGroupTotal(group) >= min);
}

function completedDeliveryBlock(item) {
  return `
    <div class="delivery-deadline completed">
      <div><small>Entrega concluída</small><strong>${brDate(item.prazo_entrega)}</strong></div>
      <span>Finalizada</span>
      <p>Prazo registrado no histórico da encomenda.</p>
    </div>
  `;
}

function orderProductRow(item, finished = false) {
  const paid = Number(item.pagamento_recebido || 0);
  return `
    <div class="order-group-product">
      <div class="order-product-identity">
        <span>${item.origem_encomenda === "Carona" ? `Pregão ${item.tender.pregão} · ` : ""}Item ${item.item || "-"}</span>
        <strong>${item.marca || "-"} · ${item.modelo || item.referência || "-"}</strong>
      </div>
      ${productFacts(item)}
      <div class="order-product-actions">
        ${finished ? `
          <span class="tag ${paid ? "ok status-adjudicated" : "bad"}">${paid ? "Pago" : "Pagamento pendente"}</span>
          <button onclick="togglePayment(${item.order_id}, ${paid ? 0 : 1})">${paid ? "Marcar não pago" : "Confirmar pagamento"}</button>
          <button class="danger" onclick="deleteOrder(${item.order_id})">Apagar</button>
        ` : `
          <button onclick="editOrder(${item.id}, ${item.order_id})">Editar</button>
          <button onclick='openUpload(${item.tender.id}, ${item.id}, "Empenho")'>Empenho</button>
          <button class="primary" onclick="finishOrder(${item.order_id})">Finalizar</button>
          <button class="danger" onclick="deleteOrder(${item.order_id})">Apagar</button>
        `}
      </div>
    </div>
  `;
}

function orderGroupCard(group, finished = false) {
  const first = group.items[0];
  const deadline = deliveryStatus(first);
  const total = orderGroupTotal(group);
  const allPaid = group.items.every((item) => Number(item.pagamento_recebido || 0));
  const isCarona = first.origem_encomenda === "Carona";
  const cls = !finished && deadline.cls === "late" ? "late" : !finished && deadline.cls === "due" ? "due" : "";
  return `
    <article class="order-group-card ${finished ? "finished-group" : ""} ${cls}">
      <header class="order-group-header">
        <div>
          <small>${isCarona ? "Carona" : group.items.length > 1 ? "Encomenda agrupada" : "Encomenda"}</small>
          <h3>${isCarona ? (first.órgão_solicitante || "Órgão solicitante") : `Pregão ${first.tender.pregão}`}</h3>
          <div class="meta">
            ${isCarona ? `<span class="tag">Referência: Pregão ${first.tender.pregão}</span>` : ""}
            <span class="tag">UASG ${first.tender.uasg}</span>
            <span class="tag">${group.items.length} produto${group.items.length === 1 ? "" : "s"}</span>
            ${finished ? `<span class="tag ${allPaid ? "ok status-adjudicated" : "bad"}">${allPaid ? "Pagamento recebido" : "Pagamento pendente"}</span>` : ""}
          </div>
        </div>
        <div class="order-group-total"><small>${finished ? "Total entregue" : "Total da encomenda"}</small><strong>${money(total)}</strong></div>
      </header>
      <div class="order-group-shared">
        ${finished ? completedDeliveryBlock(first) : deliveryDeadlineBlock(first)}
        <div class="address-text"><small>Endereço de entrega</small><span>${first.endereço_entrega || "Sem endereço registrado"}</span></div>
      </div>
      <div class="order-group-products">
        ${group.items.map((item) => orderProductRow(item, finished)).join("")}
      </div>
      <footer class="order-group-footer">
        <span>${isCarona ? "Carona" : "Encomenda"} ${String(group.id).slice(-6)}</span>
        <button onclick="openDetail(${first.tender.id})">${finished ? "Abrir histórico" : "Abrir pregão"}</button>
      </footer>
    </article>
  `;
}

function renderOrders() {
  const sort = $("#orderSort")?.value || "due";
  let groups = groupOrderRows(flattenOrders().filter((i) => i.status_encomenda !== "Entregue"))
    .filter((group) => orderGroupFilterMatch(group, "#orderSearch", "#orderMinValue"));
  if (sort === "value_desc") groups.sort((a, b) => orderGroupTotal(b) - orderGroupTotal(a));
  else if (sort === "value_asc") groups.sort((a, b) => orderGroupTotal(a) - orderGroupTotal(b));
  else if (sort === "status") groups.sort((a, b) => String(a.items[0].status_encomenda || "").localeCompare(String(b.items[0].status_encomenda || "")));
  else groups.sort((a, b) => (isoDate(a.items[0].prazo_entrega) || new Date(8640000000000000)) - (isoDate(b.items[0].prazo_entrega) || new Date(8640000000000000)));
  const rows = groups.flatMap((group) => group.items);
  $("#ordersList").classList.toggle("list-mode", state.viewModes.orders === "list");
  $("#ordersList").innerHTML = sectorSummary(rows) + (
    groups.map((group) => orderGroupCard(group)).join("")
    || `<div class="card">Nenhuma encomenda cadastrada ainda.</div>`
  );
}

function renderFinished() {
  const sort = $("#finishedSort")?.value || "recent";
  const payment = $("#finishedPayment")?.value || "";
  let groups = groupOrderRows(flattenOrders().filter((i) => i.status_encomenda === "Entregue"))
    .filter((group) => orderGroupFilterMatch(group, "#finishedSearch", "#finishedMinValue"))
    .filter((group) => payment !== "paid" || group.items.every((item) => Number(item.pagamento_recebido || 0)))
    .filter((group) => payment !== "pending" || group.items.some((item) => !Number(item.pagamento_recebido || 0)));
  if (sort === "value_desc") groups.sort((a, b) => orderGroupTotal(b) - orderGroupTotal(a));
  else if (sort === "value_asc") groups.sort((a, b) => orderGroupTotal(a) - orderGroupTotal(b));
  else if (sort === "pregao") groups.sort((a, b) => String(a.items[0].tender.pregão).localeCompare(String(b.items[0].tender.pregão)));
  else groups.sort((a, b) => String(b.items[0].prazo_entrega || b.items[0].tender.data_limite || "").localeCompare(String(a.items[0].prazo_entrega || a.items[0].tender.data_limite || "")));
  const rows = groups.flatMap((group) => group.items);
  $("#finishedList").classList.toggle("list-mode", state.viewModes.finished === "list");
  $("#finishedList").innerHTML = sectorSummary(rows, "Total entregue") + (
    groups.map((group) => orderGroupCard(group, true)).join("")
    || `<div class="card">Nenhum item finalizado ainda.</div>`
  );
}

async function openDetail(id) {
  state.current = state.tenders.find((tender) => Number(tender.id) === Number(id)) || await api(`/api/tenders/${id}`);
  showView("detail");
  const t = state.current;
  $("#detail").innerHTML = `
    <div class="detail-top">
      <div>
        <h2>Pregão Eletrônico Nº ${t.pregão}</h2>
        <p>UASG ${t.uasg} - ${t.órgão}</p>
        <div class="meta">${statusTag(t.status)}<span class="tag">${t.plataforma || "ComprasNet"}</span><span class="tag">${tenderValueLabel(t)}</span><span class="tag">${tenderMinimumLabel(t)}</span><span class="tag">${brDateTime(t.data_limite)}</span></div>
      </div>
      <div class="actions">
        <button onclick="showView('dashboard')">Voltar</button>
        <button onclick="editTender(${t.id})">Editar licitação</button>
        <button onclick='openUpload(${t.id}, "", "Proposta")'>Propostas</button>
        <button onclick='openUpload(${t.id}, "", "Edital")'>Edital</button>
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
  const lotSummary = lot ? `<span class="tag">Total mínimo do lote ${money(lotMinimumTotal(items))}</span>` : "";
  return `
    <section class="item-group" data-lot="${lot || ""}">
      <header>
        <div>
          <h3>${title}</h3>
          <p>${lot ? "Itens vinculados a um mesmo lote da licitação." : "Itens independentes, sem composição de lote."}</p>
          ${lotSummary}
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
      <footer class="item-group-footer">
        <button data-lot="${escapeAttr(lot || "")}" onclick="${lot ? "addLotItemFromButton(this)" : "addBlankItem()"}">+ Item</button>
      </footer>
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
        <td><div class="cell-main">${i.marca || "-"} · ${i.modelo || "-"}</div>${i.observação ? `<button type="button" class="obs-alert" data-observation="${escapeAttr(i.observação)}" onclick="editObservation(${i.id})">Observação</button>` : ""}</td>
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
      <td class="num"><input name="valor_unitário" value="${i.valor_unitário || ""}" ${alt ? "readonly" : ""} /></td>
      <td><input name="valor_sigiloso" type="checkbox" ${Number(i.valor_sigiloso || 0) ? "checked" : ""} /></td>
      <td class="num live-total">${Number(i.valor_sigiloso || 0) ? "Sigiloso" : money(total)}</td>
      <td class="num"><input name="valor_cadastro" value="${i.valor_cadastro || ""}" /></td>
      <td class="num"><input name="valor_mínimo" value="${i.valor_mínimo || ""}" /></td>
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
  if ((label === "item ganho" || label === "item em proposta") && !confirm(`Remover este ${label} da etapa atual? O item continuará cadastrado no pregão.`)) return;
  if (label === "item ganho" || label === "item em proposta") {
    await updateSingleItem(id, { status: "Em cadastro de preços" });
    return;
  }
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
  if (!isAlternative && !data.valor_sigiloso && numberValue(data.valor_unitário) <= 0) missing.push("Valor unitário");
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
      unit.required = !sigiloso?.checked;
    };
    qtd.addEventListener("input", update);
    unit.addEventListener("input", update);
    sigiloso?.addEventListener("change", update);
    $$("input, select", tr).forEach((field) => {
      if (field.dataset.enterSaveBound) return;
      field.dataset.enterSaveBound = "1";
      field.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        const saveButton = $(".inline-actions button", tr);
        if (!saveButton) return;
        event.preventDefault();
        saveItemRow(saveButton);
      });
    });
    update();
  });
}

async function applyBulk() {
  const ids = $$(".row-select").filter((box) => box.checked && box.value).map((box) => box.value);
  if (!ids.length) return alert("Selecione pelo menos um item já salvo.");
  const payload = { item_ids: ids, status: $("#bulkStatus").value, valor_ganho: $("#bulkWonValue").value };
  await api("/api/items/bulk", {
    method: "POST",
    body: JSON.stringify(payload),
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
  const item = flattenItems().find((candidate) => Number(candidate.id) === Number(id));
  if (!item) return;
  state.proposalItemId = id;
  $("#proposalItemLabel").textContent = `Item ${item.item || "-"} · ${item.marca || ""} ${item.modelo || ""}`;
  $("#proposalItemValue").value = item.valor_ganho || "";
  $("#proposalItemDialog").showModal();
}

async function submitProposalItem(event) {
  event.preventDefault();
  if (!state.proposalItemId) return;
  const value = $("#proposalItemValue").value.trim();
  if (numberValue(value) <= 0) return alert("Informe o valor pelo qual o item foi para proposta.");
  await updateSingleItem(state.proposalItemId, {
    status: "Proposta enviada",
    valor_ganho: value,
  });
  state.proposalItemId = null;
  $("#proposalItemDialog").close();
  alert("Item enviado para Itens em Proposta.");
}

async function editObservation(id) {
  if (!id) return alert("Salve o item antes de registrar observação.");
  const item = flattenItems().find((candidate) => Number(candidate.id) === Number(id));
  if (!item) return;
  state.observationItemId = id;
  $("#observationText").value = item.observação || "";
  $("#observationItemLabel").textContent = `Item ${item.item || "-"} - ${item.marca || ""} ${item.modelo || ""}`;
  $("#observationDialog").showModal();
}

async function saveObservation(event) {
  event.preventDefault();
  if (!state.observationItemId) return;
  await updateSingleItem(state.observationItemId, { observação: $("#observationText").value.trim() });
  state.observationItemId = null;
  $("#observationDialog").close();
  if (state.current) await openDetail(state.current.id);
}

function observationTooltip() {
  let tooltip = $("#obsTooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "obsTooltip";
    tooltip.className = "obs-tooltip";
    tooltip.setAttribute("role", "tooltip");
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

function positionObservationTooltip(event) {
  const tooltip = observationTooltip();
  const gap = 14;
  const rect = tooltip.getBoundingClientRect();
  let left = event.clientX + gap;
  let top = event.clientY + gap;
  if (left + rect.width > window.innerWidth - 12) left = event.clientX - rect.width - gap;
  if (top + rect.height > window.innerHeight - 12) top = event.clientY - rect.height - gap;
  tooltip.style.left = `${Math.max(12, left)}px`;
  tooltip.style.top = `${Math.max(12, top)}px`;
}

function setObservationTooltipText(text) {
  const tooltip = observationTooltip();
  const title = document.createElement("strong");
  title.textContent = "Observação";
  const body = document.createElement("p");
  body.textContent = text || "";
  tooltip.replaceChildren(title, body);
  return tooltip;
}

function bindObservationTooltip() {
  document.addEventListener("mouseover", (event) => {
    const target = event.target.closest(".obs-alert[data-observation]");
    if (!target) return;
    const tooltip = setObservationTooltipText(target.dataset.observation);
    tooltip.classList.add("visible");
    positionObservationTooltip(event);
  });
  document.addEventListener("mousemove", (event) => {
    if (!$("#obsTooltip")?.classList.contains("visible")) return;
    if (!event.target.closest(".obs-alert[data-observation]")) return;
    positionObservationTooltip(event);
  });
  document.addEventListener("mouseout", (event) => {
    if (!event.target.closest(".obs-alert[data-observation]")) return;
    observationTooltip().classList.remove("visible");
  });
  document.addEventListener("focusin", (event) => {
    const target = event.target.closest(".obs-alert[data-observation]");
    if (!target) return;
    const tooltip = setObservationTooltipText(target.dataset.observation);
    const rect = target.getBoundingClientRect();
    tooltip.classList.add("visible");
    tooltip.style.left = `${Math.min(window.innerWidth - 360, rect.left)}px`;
    tooltip.style.top = `${rect.bottom + 10}px`;
  });
  document.addEventListener("focusout", (event) => {
    if (!event.target.closest(".obs-alert[data-observation]")) return;
    observationTooltip().classList.remove("visible");
  });
}

async function finishOrder(orderId) {
  const item = flattenOrders().find((candidate) => Number(candidate.order_id) === Number(orderId));
  if (!item) return;
  await api("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      id: item.order_id,
      item_id: item.id,
      origem: item.origem_encomenda || "Empenho",
      órgão_solicitante: item.órgão_solicitante || "",
      qtd_empenhada: item.qtd_empenhada || item.qtd || "",
      prazo_entrega: item.prazo_entrega,
      ordem_fornecimento: item.ordem_fornecimento,
      endereço_entrega: item.endereço_entrega,
      nota_empenho: item.nota_empenho,
      status: "Entregue",
      observação: item.observação_encomenda || "",
    }),
  });
  await load();
}

async function togglePayment(orderId, paid) {
  const item = flattenOrders().find((candidate) => Number(candidate.order_id) === Number(orderId));
  if (!item) return;
  await api("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      id: item.order_id,
      item_id: item.id,
      origem: item.origem_encomenda || "Empenho",
      órgão_solicitante: item.órgão_solicitante || "",
      qtd_empenhada: item.qtd_empenhada || item.qtd || "",
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
        <label>Valor ganho <span class="money-input"><span>R$</span><input name="valor_ganho" required inputmode="decimal" placeholder="0,00" value="${item.valor_ganho || item.valor_unitário || ""}" /></span></label>
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

function updateWonSelection() {
  const selected = $$(".won-order-select:checked");
  const count = selected.length;
  if ($("#wonSelectionCount")) $("#wonSelectionCount").textContent = `${count} selecionado${count === 1 ? "" : "s"}`;
  if ($("#createBulkOrder")) $("#createBulkOrder").disabled = count === 0;
}

function openBulkOrder() {
  const ids = $$(".won-order-select:checked").map((box) => Number(box.value));
  if (!ids.length) return;
  const items = flattenItems().filter((item) => ids.includes(Number(item.id)));
  if (new Set(items.map((item) => Number(item.tender.id))).size > 1) {
    alert("Selecione apenas produtos do mesmo pregão para criar uma encomenda agrupada.");
    return;
  }
  state.orderItemIds = ids;
  fillForm($("#orderForm"), { status: "Pendente" });
  $("#singleOrderQuantity").hidden = true;
  $("#orderForm").elements.qtd_empenhada.required = false;
  $("#orderDialogSubtitle").textContent = `${items.length} produtos serão agrupados nesta encomenda.`;
  $("#orderItemsFields").innerHTML = items.map((item) => {
    const pending = pendingOrderQty(item);
    return `
      <label class="order-item-quantity">
        <span><strong>Item ${item.item || "-"}</strong><small>${item.marca || "-"} · ${item.modelo || item.referência || "-"}</small></span>
        <span>Qtd empenhada <input data-order-item="${item.id}" type="number" min="0.01" max="${pending}" step="0.01" value="${pending}" required /></span>
      </label>
    `;
  }).join("");
  $("#orderDialog").showModal();
}

function eligibleCaronaItems() {
  return flattenItems()
    .filter((item) => WIN_STATUSES.includes(item.status))
    .filter((item) => itemValue(item) > 0)
    .sort((a, b) => String(a.tender.pregão || "").localeCompare(String(b.tender.pregão || "")) || Number(a.item || 0) - Number(b.item || 0));
}

function openCaronaDialog() {
  const items = eligibleCaronaItems();
  if (!items.length) return alert("Nenhum item ganho com valor disponível para cadastrar uma Carona.");
  state.caronaItemIds = [];
  $("#caronaForm").reset();
  $("#caronaProductSearch").value = "";
  renderCaronaSearchResults();
  renderCaronaItems();
  $("#caronaDialog").showModal();
  $("#caronaProductSearch").focus();
}

function normalizedSearch(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function caronaSearchText(item) {
  return normalizedSearch([
    item.marca,
    item.modelo,
    item.referência,
    item.item,
    item.tender.pregão,
    item.tender.uasg,
    item.tender.órgão,
  ].join(" "));
}

function renderCaronaSearchResults() {
  const query = normalizedSearch($("#caronaProductSearch")?.value);
  const available = eligibleCaronaItems()
    .filter((item) => !state.caronaItemIds.includes(Number(item.id)));
  const matches = available.filter((item) => !query || caronaSearchText(item).includes(query));
  const visible = matches.slice(0, query ? 20 : 8);
  $("#caronaSearchCount").textContent = query
    ? `${matches.length} produto${matches.length === 1 ? "" : "s"} encontrado${matches.length === 1 ? "" : "s"}`
    : `${available.length} produtos disponíveis · mostrando os primeiros ${visible.length}`;
  $("#caronaSearchResults").innerHTML = visible.length ? visible.map((item) => `
    <button type="button" class="carona-search-result" onclick="addCaronaItem(${item.id})">
      <span class="carona-result-product">
        <strong>${item.marca || "-"} · ${item.modelo || item.referência || "-"}</strong>
        <small>Item ${item.item || "-"} · Pregão ${item.tender.pregão} · UASG ${item.tender.uasg}</small>
      </span>
      <span class="carona-result-value"><small>Valor unitário</small><strong>${money(itemValue(item))}</strong></span>
      <span class="carona-result-add">Adicionar</span>
    </button>
  `).join("") : `<div class="empty-selection">Nenhum produto encontrado com esse filtro.</div>`;
}

function addCaronaItem(itemId) {
  const id = Number(itemId);
  if (!id || state.caronaItemIds.includes(id)) return;
  state.caronaItemIds.push(id);
  $("#caronaProductSearch").value = "";
  renderCaronaSearchResults();
  renderCaronaItems();
}

function removeCaronaItem(id) {
  state.caronaItemIds = state.caronaItemIds.filter((itemId) => Number(itemId) !== Number(id));
  renderCaronaSearchResults();
  renderCaronaItems();
}

function renderCaronaItems() {
  const items = eligibleCaronaItems().filter((item) => state.caronaItemIds.includes(Number(item.id)));
  $("#caronaItemsFields").innerHTML = items.length ? items.map((item) => `
    <div class="carona-item-row">
      <div class="carona-selected-product">
        <small>Produto selecionado</small>
        <strong>${item.marca || "-"} · ${item.modelo || item.referência || "-"}</strong>
        <div class="carona-selected-meta">
          <span>Item ${item.item || "-"}</span>
          <span>Pregão ${item.tender.pregão}</span>
          <span>UASG ${item.tender.uasg}</span>
          <span>Unitário ${money(itemValue(item))}</span>
        </div>
      </div>
      <label>Quantidade <input data-carona-item="${item.id}" type="number" min="0.01" step="0.01" value="1" required /></label>
      <button type="button" class="danger" onclick="removeCaronaItem(${item.id})">Remover</button>
    </div>
  `).join("") : `<div class="empty-selection">Adicione um ou mais produtos ganhos para compor a Carona.</div>`;
}

async function saveCarona(event) {
  event.preventDefault();
  const itemInputs = $$("#caronaItemsFields [data-carona-item]");
  if (!itemInputs.length) return alert("Adicione pelo menos um produto à Carona.");
  const data = formData(event.target);
  data.origem = "Carona";
  data.status = "Pendente";
  data.items = itemInputs.map((input) => ({
    item_id: Number(input.dataset.caronaItem),
    qtd_empenhada: input.value,
  }));
  await api("/api/orders/bulk", { method: "POST", body: JSON.stringify(data) });
  state.caronaItemIds = [];
  $("#caronaDialog").close();
  await load();
  showView("orders");
}

function editOrder(itemId, orderId = null) {
  state.orderItemIds = [];
  const item = orderId
    ? flattenOrders().find((candidate) => Number(candidate.order_id) === Number(orderId))
    : flattenItems().find((candidate) => Number(candidate.id) === Number(itemId));
  if (!item) return;
  const canonical = flattenItems().find((candidate) => Number(candidate.id) === Number(itemId));
  const isCarona = item.origem_encomenda === "Carona";
  const available = pendingOrderQty(canonical) + (orderId ? numberValue(item.qtd_empenhada) : 0);
  fillForm($("#orderForm"), {
    id: orderId || "",
    item_id: item.id,
    origem: item.origem_encomenda || "Empenho",
    órgão_solicitante: item.órgão_solicitante || "",
    qtd_empenhada: orderId ? item.qtd_empenhada : available,
    prazo_entrega: item.prazo_entrega,
    ordem_fornecimento: item.ordem_fornecimento,
    endereço_entrega: item.endereço_entrega,
    nota_empenho: item.nota_empenho,
    status: item.status_encomenda || "Pendente",
    observação: item.observação_encomenda,
  });
  $("#singleOrderQuantity").hidden = false;
  $("#orderForm").elements.qtd_empenhada.required = true;
  if (isCarona) {
    $("#orderForm").elements.qtd_empenhada.removeAttribute("max");
  } else {
    $("#orderForm").elements.qtd_empenhada.max = available;
  }
  $("#orderItemsFields").innerHTML = "";
  $("#orderDialogSubtitle").textContent = orderId
    ? `Editando ${isCarona ? "a Carona" : "o empenho"} do item ${item.item || "-"}.`
    : `Saldo disponível do item ${item.item || "-"}: ${available}.`;
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
  const title = tipo === "Proposta" ? "Propostas geradas" : tipo === "Edital" ? "Editais anexados" : `${tipo}s anexados`;
  box.innerHTML = `
    <div class="upload-card">
      <strong>${title}</strong>
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
  $("#userForm").elements.senha.required = true;
  $("#userForm").elements.senha.placeholder = "Obrigatória para novo usuário";
}

function editUser(id) {
  const user = state.users.find((candidate) => Number(candidate.id) === Number(id));
  if (!user) return;
  fillForm($("#userForm"), { ...user, senha: "" });
  $("#userForm").elements.ativo.checked = Boolean(Number(user.ativo));
  $("#userForm").elements.senha.required = false;
  $("#userForm").elements.senha.placeholder = "Opcional ao editar";
}

async function saveUser(event) {
  event.preventDefault();
  const form = event.target;
  const data = formData(form);
  data.ativo = form.elements.ativo.checked ? 1 : 0;
  if (!data.id && !data.senha) return alert("Informe uma senha inicial para o novo usuário.");
  try {
    await api("/api/users", { method: "POST", body: JSON.stringify(data) });
    clearUserForm();
    await loadUsers();
    alert(data.id ? "Usuário atualizado com sucesso." : "Usuário criado com sucesso.");
  } catch (error) {
    alert(error.message);
  }
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
  const currentId = state.current?.id;
  state.tenders = await api("/api/state");
  if (currentId) {
    state.current = state.tenders.find((tender) => Number(tender.id) === Number(currentId)) || null;
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
    fillForm($("#tenderForm"), { status: "Futura licitação", plataforma: "ComprasNet" });
    $("#tenderDialog").showModal();
  });
  $$("[data-close]").forEach((btn) => btn.addEventListener("click", () => btn.closest("dialog").close()));
  $("#futureSearch").addEventListener("input", renderFuture);
  $("#futurePlatform").addEventListener("change", renderFuture);
  $("#pastSearch").addEventListener("input", renderPast);
  $("#pastPlatform").addEventListener("change", renderPast);
  $("#pastYear").addEventListener("input", renderPast);
  $("#pastMonth").addEventListener("input", renderPast);
  $("#pastDate").addEventListener("change", renderPast);
  $("#wonSearch").addEventListener("input", renderWon);
  $("#wonMinValue").addEventListener("input", renderWon);
  $("#wonSort").addEventListener("change", renderWon);
  $("#wonStatusFilter").addEventListener("change", renderWon);
  $("#proposalSearch").addEventListener("input", renderProposalItems);
  $("#proposalMinValue").addEventListener("input", renderProposalItems);
  $("#orderSearch").addEventListener("input", renderOrders);
  $("#orderMinValue").addEventListener("input", renderOrders);
  $("#orderSort").addEventListener("change", renderOrders);
  $("#finishedSearch").addEventListener("input", renderFinished);
  $("#finishedMinValue").addEventListener("input", renderFinished);
  $("#finishedSort").addEventListener("change", renderFinished);
  $("#finishedPayment").addEventListener("change", renderFinished);
  $$(".view-toggle button").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.closest(".view-toggle").dataset.target;
      state.viewModes[target] = button.dataset.mode;
      renderAll();
    });
  });

  $("#tenderForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const saved = await api("/api/tenders", { method: "POST", body: JSON.stringify(formData(event.target)) });
    $("#tenderDialog").close();
    await load();
    await openDetail(saved.id);
  });
  $("#orderForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(event.target);
    if (state.orderItemIds.length) {
      data.items = $$("#orderItemsFields [data-order-item]").map((input) => ({
        item_id: Number(input.dataset.orderItem),
        qtd_empenhada: input.value,
      }));
      delete data.id;
      delete data.item_id;
      delete data.qtd_empenhada;
      await api("/api/orders/bulk", { method: "POST", body: JSON.stringify(data) });
    } else {
      await api("/api/orders", { method: "POST", body: JSON.stringify(data) });
    }
    state.orderItemIds = [];
    $("#orderDialog").close();
    await load();
    if (state.current) await openDetail(state.current.id);
  });
  $("#caronaForm").addEventListener("submit", saveCarona);
  $("#caronaProductSearch").addEventListener("input", renderCaronaSearchResults);
  $("#caronaProductSearch").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    $("#caronaSearchResults .carona-search-result")?.click();
  });
  $("#uploadForm").addEventListener("submit", uploadFile);
  $("#userForm").addEventListener("submit", saveUser);
  $("#observationForm").addEventListener("submit", saveObservation);
  bindObservationTooltip();
  $("#uploadForm").elements.tipo.addEventListener("change", (event) => {
    if (!state.uploadContext) return;
    state.uploadContext.tipo = event.target.value;
    renderUploadExisting();
  });
  $("#proposalLinksForm").addEventListener("submit", submitProposalLinks);
  $("#proposalItemForm").addEventListener("submit", submitProposalItem);
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
