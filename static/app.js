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
  exportIds: { won: [], proposal: [], orders: [], finished: [] },
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
const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");
const svgIcon = (id) => `<svg class="icon"><use href="#${id}"/></svg>`;

const TOAST_ICONS = { success: "i-check", error: "i-x", warn: "i-alert", info: "i-info" };

function toast(message, type = "warn", timeout) {
  const stack = $("#toastStack");
  if (!stack) return;
  const kind = TOAST_ICONS[type] ? type : "info";
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  el.innerHTML = `
    <span class="toast-icon">${svgIcon(TOAST_ICONS[kind])}</span>
    <div class="toast-body"></div>
    <button type="button" class="toast-close" aria-label="Fechar">×</button>
  `;
  $(".toast-body", el).textContent = String(message ?? "");
  const remove = () => {
    if (!el.isConnected) return;
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 180);
  };
  $(".toast-close", el).addEventListener("click", remove);
  stack.appendChild(el);
  while (stack.children.length > 4) stack.firstElementChild.remove();
  setTimeout(remove, timeout ?? (kind === "error" ? 7000 : 4500));
}

function openConfirm({ title = "Confirmar", message = "", confirmLabel = "Confirmar", danger = false, input = null }) {
  const dialog = $("#confirmDialog");
  if (!dialog) return Promise.resolve(input ? window.prompt(message) : window.confirm(message));
  const field = $("#confirmInput");
  dialog.classList.toggle("is-danger", danger);
  $(".confirm-icon", dialog).innerHTML = svgIcon(danger ? "i-trash" : input ? "i-edit" : "i-info");
  $("#confirmTitle").textContent = title;
  $("#confirmMessage").textContent = message;
  $("#confirmMessage").hidden = !message;
  $("#confirmInputLabel").hidden = !input;
  $("#confirmInputText").textContent = input?.label || "";
  field.value = input?.value || "";
  field.placeholder = input?.placeholder || "";
  field.required = Boolean(input);
  const ok = $("#confirmOk");
  ok.textContent = confirmLabel;
  ok.className = danger ? "danger-solid" : "primary";
  return new Promise((resolve) => {
    const finish = (value) => {
      $("#confirmForm").onsubmit = null;
      $("#confirmCancel").onclick = null;
      dialog.oncancel = null;
      if (dialog.open) dialog.close();
      resolve(value);
    };
    $("#confirmForm").onsubmit = (event) => {
      event.preventDefault();
      finish(input ? (field.value.trim() || null) : true);
    };
    $("#confirmCancel").onclick = () => finish(input ? null : false);
    dialog.oncancel = (event) => {
      event.preventDefault();
      finish(input ? null : false);
    };
    dialog.showModal();
    (input ? field : $("#confirmCancel")).focus();
  });
}

function confirmAction(message) {
  const isRemoval = /^Remover/i.test(message);
  return openConfirm({
    title: isRemoval ? "Remover da etapa atual?" : "Confirmar exclusão",
    message,
    confirmLabel: isRemoval ? "Remover" : "Apagar",
    danger: true,
  });
}

function promptDialog(title, label, value = "") {
  return openConfirm({ title, confirmLabel: "Continuar", input: { label, value } });
}

const VIEW_LABELS = {
  dashboard: "Painel",
  future: "Licitações futuras",
  past: "Licitações passadas",
  proposalItems: "Itens em proposta",
  won: "Itens ganhos",
  orders: "Encomendas",
  finished: "Finalizadas",
  users: "Usuários",
  detail: "Licitação",
};

function setCrumb(text) {
  const crumb = $("#crumbCurrent");
  if (crumb) crumb.textContent = text;
  document.title = text && text !== "Painel" ? `${text} · LicitaUM` : "LicitaUM";
}

function setBadge(name, value, alertState = false) {
  const badge = $(`.nav-badge[data-badge="${name}"]`);
  if (!badge) return;
  badge.textContent = value ? String(value) : "";
  badge.classList.toggle("alert", Boolean(alertState && value));
}

function updateNavBadges() {
  const now = appNow();
  const future = state.tenders.filter((t) => {
    const date = isoDate(t.data_limite);
    return date ? date >= now : t.status === "Futura licitação";
  }).length;
  const items = flattenItems();
  const proposal = items.filter((i) => i.status === "Proposta enviada").length;
  const won = items.filter((i) => WIN_STATUSES.includes(i.status) && pendingOrderQty(i) > 0).length;
  const openGroups = groupOrderRows(flattenOrders().filter((i) => i.status_encomenda !== "Entregue"));
  const lateGroups = openGroups.filter((group) => deliveryStatus(group.items[0]).cls === "late").length;
  setBadge("future", future);
  setBadge("proposalItems", proposal);
  setBadge("won", won);
  setBadge("orders", lateGroups || openGroups.length, lateGroups > 0);
  const ordersBadge = $('.nav-badge[data-badge="orders"]');
  if (ordersBadge) ordersBadge.title = lateGroups ? `${lateGroups} encomenda(s) atrasada(s)` : "";
}

function setSidebarOpen(open) {
  document.body.classList.toggle("sidebar-open", open);
}

function bindShell() {
  $("#sidebarToggle")?.addEventListener("click", () => {
    const collapsed = document.body.classList.toggle("sidebar-collapsed");
    localStorage.setItem("licitaum-sidebar", collapsed ? "collapsed" : "expanded");
    $("#sidebarToggle").title = collapsed ? "Expandir menu" : "Recolher menu";
    $("#sidebarToggle .nav-text").textContent = collapsed ? "Expandir menu" : "Recolher menu";
  });
  $("#mobileMenu")?.addEventListener("click", () => setSidebarOpen(!document.body.classList.contains("sidebar-open")));
  $("#sidebarBackdrop")?.addEventListener("click", () => setSidebarOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setSidebarOpen(false);
  });
}

const isoDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return new Date(value.getTime());
  const text = String(value).trim();
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  return new Date(text);
};
const validDate = (date) => date instanceof Date && !Number.isNaN(date.getTime());
const localDateKey = (value) => {
  const date = isoDate(value);
  return validDate(date)
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
    : "";
};
const brDate = (value) => {
  const date = isoDate(value);
  return validDate(date) ? date.toLocaleDateString("pt-BR") : "-";
};
const brDateTime = (value) => {
  const date = isoDate(value);
  return validDate(date) ? date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "-";
};

const appNow = () => {
  const browserNow = new Date();
  const serverToday = state.currentDate ? new Date(`${state.currentDate}T00:00:00`) : null;
  return serverToday && serverToday > browserNow ? serverToday : browserNow;
};

const countdownLabel = (value) => {
  const target = isoDate(value);
  if (!validDate(target)) return "-";
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
  if (!validDate(due)) {
    return { cls: "missing", label: "Sem prazo", detail: "Defina a data limite de entrega" };
  }
  const now = appNow();
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const currentDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((dueDay - currentDay) / 86400000);
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
  return validDate(date) ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` : "";
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

function searchButton(item) {
  return `<button type="button" class="search-btn" data-marca="${escapeAttr(item.marca || "")}" data-modelo="${escapeAttr(item.modelo || item.referência || "")}" aria-haspopup="menu" onclick="openSearchMenu(this)">${svgIcon("i-search")}Pesquisar</button>`;
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

  const next = future[0];
  const lateCount = groupOrderRows(orders.filter((i) => isoDate(i.prazo_entrega) && isoDate(i.prazo_entrega) < now)).length;
  const greeting = now.getHours() < 12 ? "Bom dia" : now.getHours() < 18 ? "Boa tarde" : "Boa noite";
  const firstName = String(state.account?.nome || "").trim().split(/\s+/)[0];

  $("#dashboard").innerHTML = `
    <div class="section-head dashboard-head">
      <div>
        <h2>${greeting}${firstName ? `, ${escapeHtml(firstName)}` : ""}</h2>
        <p>${capitalize(now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }))} · ${future.length ? `${future.length} licitaç${future.length === 1 ? "ão" : "ões"} pela frente` : "nenhuma licitação agendada"}${lateCount ? ` · <b class="text-bad">${lateCount} encomenda${lateCount === 1 ? "" : "s"} atrasada${lateCount === 1 ? "" : "s"}</b>` : ""}</p>
      </div>
    </div>

    <div class="dash-top">
      ${next ? `
        <article class="next-tender" onclick="openDetail(${next.id})" role="button" tabindex="0" onkeydown="if(event.key==='Enter')openDetail(${next.id})">
          <div class="next-tender-label">${svgIcon("i-calendar")}Próxima licitação</div>
          <div class="next-tender-countdown countdown" data-deadline="${next.data_limite}">${countdownLabel(next.data_limite)}</div>
          <div class="next-tender-when">${capitalize(isoDate(next.data_limite).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }))} às ${isoDate(next.data_limite).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
          <div class="next-tender-title">
            <strong>Pregão ${escapeHtml(next.pregão)}</strong>
            <span>${escapeHtml(next.órgão || "")}</span>
          </div>
          <div class="meta">
            <span class="tag">${selectedTenderItems(next).length} itens</span>
            <span class="tag ${pricesComplete(next) ? "ok" : "warn"}">${pricesComplete(next) ? "Preços completos" : "Preços pendentes"}</span>
          </div>
        </article>
      ` : `
        <article class="next-tender empty">
          <div class="next-tender-label">${svgIcon("i-calendar")}Próxima licitação</div>
          <strong>Nenhuma licitação agendada</strong>
          <p>Cadastre a próxima disputa para acompanhar a contagem regressiva aqui.</p>
          <button type="button" class="primary" onclick="event.stopPropagation(); document.getElementById('newTender').click()">${svgIcon("i-plus")}Nova licitação</button>
        </article>
      `}
      <section class="financial-overview">
        <header>
          <div><small>Resumo financeiro</small><strong>${capitalize(monthLabel(selectedMonth))}</strong></div>
          <label>Período
            <select id="dashboardMonth">
              <option value="" ${selectedMonth === "" ? "selected" : ""}>Todos os meses</option>
              ${monthOptions.map((option) => `<option value="${option}" ${selectedMonth === option ? "selected" : ""}>${capitalize(monthLabel(option))}</option>`).join("")}
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

    <section class="dash-section">
      <header class="dash-section-head">
        <div><h3>Funil do processo</h3><p>Onde estão os itens e as encomendas agora, do cadastro ao pagamento.</p></div>
      </header>
      ${pipelineStrip(activeItems, allOrders)}
    </section>

    <div class="dash-split">
      <section class="dash-card">
        ${monthlyChart(activeItems, now, state.dashboardMonth || "")}
      </section>
      <section class="dash-card">
        <header class="dash-section-head">
          <div><h3>Agenda</h3><p>Próximas licitações por data.</p></div>
          <button type="button" class="link-btn" onclick="showView('future')">Ver todas</button>
        </header>
        <div class="agenda">
          ${future.slice(0, 6).map(agendaRow).join("") || `<div class="mini-empty">${svgIcon("i-calendar")}Nenhuma licitação futura com data cadastrada.</div>`}
        </div>
      </section>
    </div>

    <div class="dash-split even">
      <section>
        <header class="dash-section-head">
          <div><h3>Encomendas atrasadas ${riskyOrders.length ? `<span class="tab-count bad">${riskyOrders.length}</span>` : ""}</h3></div>
        </header>
        <div class="alert-stack">
          ${riskyOrders.map(orderAlert).join("") || `<div class="mini-empty ok">${svgIcon("i-check-circle")}Nenhuma encomenda atrasada.</div>`}
        </div>
      </section>
      <section>
        <header class="dash-section-head">
          <div><h3>Próximas a vencer</h3></div>
          <button type="button" class="link-btn" onclick="showView('orders')">Ver encomendas</button>
        </header>
        <div class="alert-stack">
          ${upcomingOrders.map(orderAlert).join("") || `<div class="mini-empty ok">${svgIcon("i-check-circle")}Nenhuma encomenda próxima do vencimento.</div>`}
        </div>
      </section>
    </div>
  `;
  $("#dashboardMonth")?.addEventListener("change", (event) => {
    state.dashboardMonth = event.target.value || null;
    renderDashboard();
  });
  bindChartHover();
  updateCountdowns();
}

function capitalize(text = "") {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

const compactMoney = (value) => `R$ ${Number(value || 0).toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 })}`;

function pipelineStrip(activeItems, allOrders) {
  const cadastro = activeItems.filter((i) => i.status === "Em cadastro de preços");
  const proposta = activeItems.filter((i) => i.status === "Proposta enviada");
  const ganhos = activeItems.filter((i) => WIN_STATUSES.includes(i.status) && pendingOrderQty(i) > 0);
  const abertas = allOrders.filter((o) => o.status_encomenda !== "Entregue");
  const aReceber = allOrders.filter((o) => o.status_encomenda === "Entregue" && !Number(o.pagamento_recebido || 0));
  const pagas = allOrders.filter((o) => o.status_encomenda === "Entregue" && Number(o.pagamento_recebido || 0));
  const groups = (rows) => groupOrderRows(rows).length;
  const stages = [
    { label: "Em precificação", count: cadastro.length, unit: "itens", value: cadastro.reduce((s, i) => s + itemTotal(i), 0), go: "showView('future')" },
    { label: "Em proposta", count: proposta.length, unit: "itens", value: proposta.reduce((s, i) => s + itemBusinessTotal(i), 0), go: "showView('proposalItems')" },
    { label: "Ganhos sem empenho", count: ganhos.length, unit: "itens", value: ganhos.reduce((s, i) => s + pendingOrderQty(i) * itemValue(i), 0), go: "showView('won')" },
    { label: "Encomendas abertas", count: groups(abertas), unit: "encomendas", value: abertas.reduce((s, i) => s + itemBusinessTotal(i), 0), go: "showView('orders')" },
    { label: "A receber", count: groups(aReceber), unit: "entregues", value: aReceber.reduce((s, i) => s + itemBusinessTotal(i), 0), go: "goFinished('pending')", tone: aReceber.length ? "warn" : "" },
    { label: "Pago", count: groups(pagas), unit: "encomendas", value: pagas.reduce((s, i) => s + itemBusinessTotal(i), 0), go: "goFinished('paid')", tone: pagas.length ? "ok" : "" },
  ];
  return `
    <div class="pipeline">
      ${stages.map((stage, index) => `
        <button type="button" class="pipeline-step ${stage.tone || ""}" onclick="${stage.go}">
          <span class="pipeline-index">${index + 1}</span>
          <span class="pipeline-label">${stage.label}</span>
          <strong>${money(stage.value)}</strong>
          <small>${stage.count} ${stage.count === 1 ? ({ itens: "item", encomendas: "encomenda", entregues: "entregue" }[stage.unit] || stage.unit) : stage.unit}</small>
        </button>
      `).join("")}
    </div>
  `;
}

function goFinished(payment) {
  const select = $("#finishedPayment");
  if (select) select.value = payment;
  showView("finished");
}

function monthlyChart(activeItems, now, selectedMonth) {
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 11 + index, 1);
    return { key: monthKey(date), date, value: 0 };
  });
  const byKey = new Map(months.map((month) => [month.key, month]));
  activeItems
    .filter((item) => WIN_STATUSES.includes(item.status))
    .forEach((item) => {
      const bucket = byKey.get(monthKey(item.tender.data_limite || item.tender.created_at));
      if (bucket) bucket.value += itemBusinessTotal(item);
    });
  const max = Math.max(...months.map((month) => month.value), 0);
  const niceStep = (() => {
    if (!max) return 1;
    const raw = max / 3;
    const power = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 2.5, 5, 10].map((f) => f * power).find((step) => step >= raw);
  })();
  const top = niceStep * 3;
  const peak = months.reduce((best, month) => (month.value > best.value ? month : best), months[0]);
  const total = months.reduce((sum, month) => sum + month.value, 0);
  const monthShort = (date) => date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  return `
    <header class="dash-section-head">
      <div><h3>Valor ganho por mês</h3><p>Últimos 12 meses · ${money(total)} no período · clique em um mês para filtrar o resumo</p></div>
    </header>
    <div class="chart" role="img" aria-label="Gráfico de colunas do valor ganho por mês nos últimos 12 meses">
      <div class="chart-grid">
        ${[3, 2, 1, 0].map((step) => `<div class="chart-gridline"><span>${max ? compactMoney(niceStep * step) : step === 0 ? "R$ 0" : ""}</span></div>`).join("")}
      </div>
      <div class="chart-cols">
        ${months.map((month) => {
          const pct = top ? (month.value / top) * 100 : 0;
          const label = `${capitalize(month.date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }))}: ${money(month.value)}`;
          const dim = selectedMonth && selectedMonth !== month.key;
          return `
            <button type="button" class="chart-col ${dim ? "dim" : ""} ${selectedMonth === month.key ? "selected" : ""}" data-tip="${escapeAttr(label)}" aria-label="${escapeAttr(label)}" onclick="state.dashboardMonth = '${month.key}' === state.dashboardMonth ? null : '${month.key}'; renderDashboard()">
              <span class="chart-plot">
                ${month.value && month === peak ? `<span class="chart-peak" style="bottom:calc(${pct}% + 6px)">${compactMoney(month.value)}</span>` : ""}
                <span class="chart-bar" style="height:${month.value ? Math.max(pct, 1.5) : 0}%"></span>
              </span>
              <span class="chart-x">${monthShort(month.date)}${month.date.getMonth() === 0 || month === months[0] ? `<em>${String(month.date.getFullYear()).slice(2)}</em>` : ""}</span>
            </button>
          `;
        }).join("")}
      </div>
    </div>
    <details class="chart-table">
      <summary>Ver como tabela</summary>
      <table>
        <thead><tr><th>Mês</th><th class="num">Valor ganho</th></tr></thead>
        <tbody>${months.map((month) => `<tr><td>${capitalize(monthLabel(month.key))}</td><td class="num">${money(month.value)}</td></tr>`).join("")}</tbody>
      </table>
    </details>
  `;
}

function bindChartHover() {
  let tip = $("#chartTip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "chartTip";
    tip.className = "chart-tip";
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  const show = (col) => {
    tip.textContent = col.dataset.tip;
    tip.hidden = false;
    const bar = $(".chart-bar", col).getBoundingClientRect();
    const rect = col.getBoundingClientRect();
    const top = (bar.height ? bar.top : rect.bottom - 30) - tip.offsetHeight - 8;
    tip.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - tip.offsetWidth / 2, window.innerWidth - tip.offsetWidth - 8))}px`;
    tip.style.top = `${Math.max(8, top)}px`;
  };
  const hide = () => { tip.hidden = true; };
  $$("#dashboard .chart-col").forEach((col) => {
    col.addEventListener("mouseenter", () => show(col));
    col.addEventListener("focus", () => show(col));
    col.addEventListener("mouseleave", hide);
    col.addEventListener("blur", hide);
  });
}

function agendaRow(t) {
  const date = isoDate(t.data_limite);
  const ready = pricesComplete(t);
  return `
    <button type="button" class="agenda-row" onclick="openDetail(${t.id})">
      <span class="agenda-date"><b>${String(date.getDate()).padStart(2, "0")}</b><small>${date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</small></span>
      <span class="agenda-info">
        <strong>Pregão ${escapeHtml(t.pregão)}</strong>
        <small>${escapeHtml(t.órgão || "")}</small>
      </span>
      <span class="agenda-side">
        <span class="countdown" data-deadline="${t.data_limite}">${countdownLabel(t.data_limite)}</span>
        <span class="tag ${ready ? "ok" : "warn"}">${ready ? "Preços ok" : "Preços pendentes"}</span>
      </span>
    </button>
  `;
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
  const delivery = deliveryStatus(item);
  const cls = delivery.cls === "late" ? "danger" : delivery.cls === "due" ? "warn" : "ok";
  const label = delivery.detail;
  const total = group.items.reduce((sum, current) => sum + itemBusinessTotal(current), 0);
  const hasObservation = group.items.some((current) => String(current.observação_encomenda || "").trim());
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
      <div class="meta">${isCarona ? `<span class="tag">Referência: Pregão ${item.tender.pregão}</span>` : ""}<span class="tag">UASG ${item.tender.uasg}</span><span class="tag">${group.items.length} produto${group.items.length === 1 ? "" : "s"}</span>${hasObservation ? `<span class="tag warn">Com observação</span>` : ""}</div>
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

function tenderCard(t, { upcoming = false } = {}) {
  const items = selectedTenderItems(t);
  const ready = pricesComplete(t);
  const platform = t.plataforma || "ComprasNet";
  const date = isoDate(t.data_limite);
  const hasDate = validDate(date);
  return `
    <article class="tender-row ${ready ? "tender-ready" : ""}" role="button" tabindex="0" onclick="openDetail(${t.id})" onkeydown="if(event.key==='Enter' && event.target===this)openDetail(${t.id})">
      <div class="date-badge ${hasDate ? "" : "no-date"}">
        ${hasDate ? `
          <b>${String(date.getDate()).padStart(2, "0")}</b>
          <small>${date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")} ${String(date.getFullYear()).slice(2)}</small>
          <span>${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
        ` : `<small>sem data</small>`}
      </div>
      <div class="tender-main">
        <div class="tender-title"><h3>Pregão Eletrônico Nº ${escapeHtml(t.pregão)}</h3>${statusTag(t.status)}</div>
        <p>UASG ${escapeHtml(t.uasg)} · ${escapeHtml(t.órgão || "")}</p>
        <div class="tender-meta">
          <span>${escapeHtml(platform)}</span>
          ${t.localidade ? `<span>${escapeHtml(t.localidade)}</span>` : ""}
          <span>${items.length} ${items.length === 1 ? "item" : "itens"}</span>
          <span class="tag ${ready ? "ok" : "warn"}">${ready ? "Preços completos" : "Preços pendentes"}</span>
          ${upcoming && hasDate && date > new Date() ? `<span class="tender-countdown">${svgIcon("i-calendar")}faltam <b class="countdown" data-deadline="${t.data_limite}">${countdownLabel(t.data_limite)}</b></span>` : ""}
        </div>
      </div>
      <div class="tender-values">
        <small>Valor total</small>
        <strong>${tenderValueLabel(t)}</strong>
        <small>Mínimo ${money(t.valor_minimo_total)}</small>
      </div>
      <button type="button" class="icon-btn row-menu-btn" title="Mais ações" aria-label="Mais ações" aria-haspopup="menu" onclick="event.stopPropagation(); openTenderMenu(this, ${t.id})">${svgIcon("i-more")}</button>
    </article>
  `;
}

function openTenderMenu(button, id) {
  const t = state.tenders.find((candidate) => Number(candidate.id) === Number(id));
  if (!t) return;
  openPopover(button, `
    <div class="menu-title">Pregão ${escapeHtml(t.pregão)}</div>
    <button type="button" class="menu-item" onclick="openDetail(${id})">${svgIcon("i-external")}Abrir licitação</button>
    <button type="button" class="menu-item" onclick="editTender(${id})">${svgIcon("i-edit")}Editar dados</button>
    <div class="menu-sep"></div>
    <button type="button" class="menu-item danger" onclick="deleteTender(${id})">${svgIcon("i-trash")}Apagar licitação</button>
  `);
}

function groupTendersByMonth(rows, options = {}) {
  if (!rows.length) return "";
  const groups = [];
  rows.forEach((t) => {
    const key = monthKey(t.data_limite) || "none";
    let group = groups.find((candidate) => candidate.key === key);
    if (!group) {
      group = { key, rows: [] };
      groups.push(group);
    }
    group.rows.push(t);
  });
  return groups.map((group) => `
    <div class="timeline-group">
      <h4 class="timeline-month">${group.key === "none" ? "Sem data definida" : capitalize(monthLabel(group.key))}<span class="tab-count">${group.rows.length}</span></h4>
      ${group.rows.map((t) => tenderCard(t, options)).join("")}
    </div>
  `).join("");
}

function setResultCount(selector, count, noun = ["licitação", "licitações"]) {
  const el = $(selector);
  if (el) el.textContent = `${count} ${count === 1 ? noun[0] : noun[1]}`;
}

function emptyList(message, hint = "") {
  return `<div class="tab-empty">${svgIcon("i-search")}<strong>${message}</strong>${hint ? `<p>${hint}</p>` : ""}</div>`;
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
  const filtered = Boolean(q || platform);
  setResultCount("#futureCount", rows.length);
  if ($("#futureClear")) $("#futureClear").hidden = !filtered;
  $("#futureList").innerHTML = groupTendersByMonth(rows, { upcoming: true }) || (filtered
    ? emptyList("Nenhuma licitação encontrada", "Tente outro termo ou limpe os filtros.")
    : `<div class="tab-empty">${svgIcon("i-calendar")}<strong>Nenhuma licitação futura</strong><p>Cadastre a próxima disputa para acompanhá-la aqui.</p><button type="button" class="primary" onclick="document.getElementById('newTender').click()">${svgIcon("i-plus")}Nova licitação</button></div>`);
}

function clearFutureFilters() {
  $("#futureSearch").value = "";
  $("#futurePlatform").value = "";
  renderFuture();
}

function clearPastFilters() {
  ["#pastSearch", "#pastPlatform", "#pastYear", "#pastMonth", "#pastDate"].forEach((selector) => { $(selector).value = ""; });
  renderPast();
}

function syncPastYearOptions() {
  const select = $("#pastYear");
  if (!select) return;
  const now = appNow();
  const years = [...new Set(state.tenders
    .map((t) => isoDate(t.data_limite))
    .filter((d) => validDate(d) && d < now)
    .map((d) => String(d.getFullYear())))].sort().reverse();
  const signature = years.join(",");
  if (select.dataset.years === signature) return;
  const current = select.value;
  select.innerHTML = `<option value="">Todos os anos</option>${years.map((year) => `<option value="${year}">${year}</option>`).join("")}`;
  select.value = years.includes(current) ? current : "";
  select.dataset.years = signature;
}

function renderPast() {
  syncPastYearOptions();
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
      if (exactDate && localDateKey(d) !== exactDate) return false;
      return true;
    })
    .sort((a, b) => isoDate(b.data_limite) - isoDate(a.data_limite));
  const filtered = Boolean(q || platform || year || month || exactDate);
  setResultCount("#pastCount", rows.length);
  if ($("#pastClear")) $("#pastClear").hidden = !filtered;
  $("#pastList").innerHTML = groupTendersByMonth(rows) || (filtered
    ? emptyList("Nenhuma licitação encontrada", "Tente outro termo ou limpe os filtros.")
    : emptyList("Nenhuma licitação passada ainda"));
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
  state.exportIds.won = rows.map((item) => Number(item.id));
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
  state.exportIds.proposal = rows.map((item) => Number(item.id));
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
    `${item.item || ""} ${item.marca || ""} ${item.modelo || ""} ${item.referência || ""} ${item.tender.pregão || ""} ${item.tender.uasg || ""} ${item.tender.órgão || ""} ${item.órgão_solicitante || ""} ${item.observação_encomenda || ""}`
  )).join(" ").toLowerCase();
  return (!q || haystack.includes(q)) && (!min || orderGroupTotal(group) >= min);
}

function orderObservationBlock(group) {
  const observations = new Map();
  group.items.forEach((item) => {
    const text = String(item.observação_encomenda || "").trim();
    if (!text) return;
    if (!observations.has(text)) observations.set(text, new Set());
    if (item.item) observations.get(text).add(String(item.item));
  });
  const entries = [...observations.entries()];
  if (!entries.length) return "";
  return `
    <div class="order-observation">
      <span class="order-observation-icon" aria-hidden="true">!</span>
      <div>
        <small>${entries.length === 1 ? "Observação da encomenda" : "Observações da encomenda"}</small>
        ${entries.map(([text, itemNumbers]) => `
          <p>${entries.length > 1 && itemNumbers.size ? `<strong>Item ${[...itemNumbers].join(", ")}: </strong>` : ""}${escapeHtml(text)}</p>
        `).join("")}
      </div>
    </div>
  `;
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
      ${orderObservationBlock(group)}
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
  state.exportIds.orders = rows.map((item) => Number(item.order_id));
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
  state.exportIds.finished = rows.map((item) => Number(item.order_id));
  $("#finishedList").classList.toggle("list-mode", state.viewModes.finished === "list");
  $("#finishedList").innerHTML = sectorSummary(rows, "Total entregue") + (
    groups.map((group) => orderGroupCard(group, true)).join("")
    || `<div class="card">Nenhum item finalizado ainda.</div>`
  );
}

const DOC_TYPES = [
  ["Edital", "Edital e anexos do pregão"],
  ["Proposta", "Propostas geradas e enviadas"],
  ["Empenho", "Notas de empenho recebidas"],
  ["Ata", "Atas de registro de preços"],
  ["Contrato", "Contratos assinados"],
  ["Outro", "Demais documentos"],
];

function tenderOrderGroups(t) {
  const groups = groupOrderRows(flattenOrders().filter((order) => Number(order.tender.id) === Number(t.id)));
  const byDue = (a, b) => (isoDate(a.items[0].prazo_entrega) || new Date(8640000000000000)) - (isoDate(b.items[0].prazo_entrega) || new Date(8640000000000000));
  return {
    open: groups.filter((group) => group.items[0].status_encomenda !== "Entregue").sort(byDue),
    done: groups.filter((group) => group.items[0].status_encomenda === "Entregue").sort(byDue).reverse(),
  };
}

function detailStats(t) {
  const items = t.items || [];
  const active = items.filter((item) => Number(item.selecionado_cadastro ?? 1) !== 0);
  const priced = active.filter((item) => (
    numberValue(item.valor_cadastro) > 0 &&
    numberValue(item.valor_mínimo) > 0 &&
    (Number(item.valor_sigiloso || 0) || numberValue(item.valor_unitário) > 0)
  ));
  const orders = tenderOrderGroups(t);
  return { items, active, priced, orders, docs: t.attachments || [] };
}

function goBackFromDetail() {
  showView(state.returnView && state.returnView !== "detail" ? state.returnView : "dashboard");
}

function setDetailTab(tab) {
  state.detailTab = tab;
  closePopover();
  renderDetailBody();
}

async function openDetail(id) {
  if (state.view !== "detail") state.returnView = state.view;
  state.current = state.tenders.find((tender) => Number(tender.id) === Number(id)) || await api(`/api/tenders/${id}`);
  if (Number(state.detailTenderId) !== Number(state.current.id)) {
    state.detailTab = "items";
    state.detailTenderId = state.current.id;
  }
  showView("detail");
  const t = state.current;
  setCrumb(`Pregão ${t.pregão}`);
  const stats = detailStats(t);
  const deadline = isoDate(t.data_limite);
  const upcoming = validDate(deadline) && deadline > new Date();
  const pricedPct = stats.active.length ? Math.round((stats.priced.length / stats.active.length) * 100) : 0;
  const returnLabel = VIEW_LABELS[state.returnView] || "Painel";
  $("#detail").innerHTML = `
    <header class="detail-header">
      <div class="detail-heading">
        <button type="button" class="icon-btn back-btn" onclick="goBackFromDetail()" title="Voltar para ${escapeAttr(returnLabel)}" aria-label="Voltar">${svgIcon("i-arrow-left")}</button>
        <div>
          <div class="detail-eyebrow">${escapeHtml(t.plataforma || "ComprasNet")} · UASG ${escapeHtml(t.uasg)}${t.localidade ? ` · ${escapeHtml(t.localidade)}` : ""}</div>
          <h2>Pregão Eletrônico Nº ${escapeHtml(t.pregão)}</h2>
          <p>${escapeHtml(t.órgão || "")}</p>
        </div>
      </div>
      <div class="detail-actions">
        <div class="export-actions detail-export" aria-label="Exportar esta licitação">
          <span>Exportar</span>
          <button title="Exportar licitação completa para planilha" onclick="exportTender(this, ${t.id}, 'xlsx')">XLSX</button>
          <button title="Exportar licitação completa para PDF" onclick="exportTender(this, ${t.id}, 'pdf')">PDF</button>
        </div>
        <button type="button" onclick="editTender(${t.id})">${svgIcon("i-edit")}Editar licitação</button>
      </div>
    </header>
    <section class="detail-kpis">
      <div class="kpi"><span>Status</span><div>${statusTag(t.status)}</div></div>
      <div class="kpi">
        <span>Data limite</span>
        <strong>${brDateTime(t.data_limite)}</strong>
        ${upcoming ? `<small>faltam <b class="countdown" data-deadline="${t.data_limite}">${countdownLabel(t.data_limite)}</b></small>` : ""}
      </div>
      <div class="kpi"><span>Valor total</span><strong>${tenderValueLabel(t)}</strong></div>
      <div class="kpi"><span>Total mínimo</span><strong>${money(t.valor_minimo_total)}</strong></div>
      <div class="kpi">
        <span>Preços completos</span>
        <strong>${stats.priced.length}<em>/${stats.active.length}</em></strong>
        <div class="progress ${pricedPct === 100 ? "done" : ""}"><i style="width:${pricedPct}%"></i></div>
      </div>
    </section>
    ${t.observação ? `<div class="detail-note">${svgIcon("i-info")}<p>${escapeHtml(t.observação)}</p></div>` : ""}
    <nav class="detail-tabs" role="tablist">
      ${[
        ["items", "Itens", stats.items.length],
        ["docs", "Documentos", stats.docs.length],
        ["orders", "Encomendas", stats.orders.open.length + stats.orders.done.length],
      ].map(([key, label, count]) => `
        <button type="button" role="tab" data-tab="${key}" class="detail-tab ${state.detailTab === key ? "active" : ""}" aria-selected="${state.detailTab === key}" onclick="setDetailTab('${key}')">
          ${label}<span class="tab-count">${count}</span>
        </button>
      `).join("")}
    </nav>
    <div id="detailTabBody" class="detail-tab-body"></div>
  `;
  renderDetailBody();
}

function renderDetailBody() {
  const t = state.current;
  const body = $("#detailTabBody");
  if (!t || !body) return;
  $$(".detail-tab").forEach((tab) => {
    const active = tab.dataset.tab === state.detailTab;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  if (state.detailTab === "docs") {
    body.innerHTML = renderDocsTab(t);
  } else if (state.detailTab === "orders") {
    body.innerHTML = renderOrdersTab(t);
  } else {
    body.innerHTML = `
      <div class="items-toolbar">
        <label class="inline-check select-all"><input type="checkbox" id="selectAllItems" /> Selecionar todos</label>
        <span class="items-toolbar-hint">Marque os itens para gerar a proposta. Links e status entram apenas na etapa de proposta ou item ganho.</span>
        <div class="actions">
          <button type="button" onclick="addBlankItem()">${svgIcon("i-plus")}Item avulso</button>
          <button type="button" onclick="addLotItem()">${svgIcon("i-plus")}Item em lote</button>
        </div>
      </div>
      <div id="itemsGroups" class="items-groups">
        ${renderItemGroups(t.items)}
      </div>
    `;
    bindLiveTotals();
  }
  updateItemSelection();
}

function renderDocsTab(t) {
  const docs = t.attachments || [];
  const itemLabel = (doc) => {
    if (!doc.item_id) return "";
    const item = (t.items || []).find((candidate) => Number(candidate.id) === Number(doc.item_id));
    return item ? `Item ${escapeHtml(item.item || "-")}` : "Item";
  };
  return `
    <div class="docs-grid">
      ${DOC_TYPES.map(([tipo, description]) => {
        const files = docs.filter((doc) => (doc.tipo || "Outro") === tipo);
        return `
          <article class="doc-card ${files.length ? "has-files" : ""}">
            <header>
              <span class="doc-icon">${svgIcon("i-file")}</span>
              <div>
                <h3>${tipo === "Proposta" ? "Propostas" : tipo === "Outro" ? "Outros" : `${tipo}s`}</h3>
                <p>${description}</p>
              </div>
              <span class="tab-count">${files.length}</span>
            </header>
            <div class="doc-files">
              ${files.length ? files.map((doc) => `
                <div class="doc-file">
                  <a href="/attachments/${doc.id}/download" target="_blank" rel="noopener" title="${escapeAttr(doc.filename)}">${escapeHtml(doc.filename)}</a>
                  <small>${[itemLabel(doc), brDate(doc.uploaded_at)].filter(Boolean).join(" · ")}</small>
                  <button type="button" class="icon-btn" title="Apagar arquivo" aria-label="Apagar arquivo" onclick="deleteAttachment(${doc.id})">${svgIcon("i-trash")}</button>
                </div>
              `).join("") : `<div class="doc-empty">Nenhum arquivo anexado.</div>`}
            </div>
            <footer>
              <button type="button" onclick='openUpload(${t.id}, "", "${tipo}")'>${svgIcon("i-upload")}Anexar</button>
            </footer>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderOrdersTab(t) {
  const { open, done } = tenderOrderGroups(t);
  if (!open.length && !done.length) {
    return `<div class="tab-empty">${svgIcon("i-package")}<strong>Nenhuma encomenda nesta licitação</strong><p>Quando um item ganho receber empenho, a encomenda aparece aqui.</p></div>`;
  }
  return `
    ${open.length ? `<h3 class="tab-section-title">Em andamento <span class="tab-count">${open.length}</span></h3>
      <div class="order-board list-mode">${open.map((group) => orderGroupCard(group)).join("")}</div>` : ""}
    ${done.length ? `<h3 class="tab-section-title">Finalizadas <span class="tab-count">${done.length}</span></h3>
      <div class="order-board list-mode">${done.map((group) => orderGroupCard(group, true)).join("")}</div>` : ""}
  `;
}

function selectedItemBoxes() {
  return $$("#detail .proposal-item").filter((box) => box.checked && box.value);
}

function updateItemSelection() {
  const bar = $("#selectionBar");
  if (!bar) return;
  const boxes = $$("#detail .proposal-item").filter((box) => box.value);
  const checked = boxes.filter((box) => box.checked);
  const count = checked.length;
  const total = checked.reduce((sum, box) => {
    const item = state.current?.items.find((candidate) => Number(candidate.id) === Number(box.value));
    return sum + (item ? itemTotal(item) : 0);
  }, 0);
  bar.hidden = count === 0 || state.detailTab !== "items";
  $("#detail").classList.toggle("has-selection", !bar.hidden);
  $("#selectionCount").textContent = count;
  $("#selectionLabel").textContent = count === 1 ? "item selecionado" : "itens selecionados";
  $("#selectionTotal").textContent = count ? money(total) : "";
  $$("#detail .readonly-row").forEach((row) => row.classList.toggle("selected", Boolean($(".proposal-item", row)?.checked)));
  const all = $("#selectAllItems");
  if (all) {
    all.checked = boxes.length > 0 && count === boxes.length;
    all.indeterminate = count > 0 && count < boxes.length;
  }
}

function clearItemSelection() {
  $$("#detail .proposal-item").forEach((box) => { box.checked = false; });
  updateItemSelection();
}

function bindDetailInteractions() {
  const detail = $("#detail");
  detail.addEventListener("change", (event) => {
    if (event.target.id === "selectAllItems") {
      $$("#detail .proposal-item").filter((box) => box.value).forEach((box) => { box.checked = event.target.checked; });
      updateItemSelection();
    } else if (event.target.classList.contains("proposal-item")) {
      updateItemSelection();
    }
  });
  detail.addEventListener("click", (event) => {
    const row = event.target.closest("tr.readonly-row");
    if (!row || event.target.closest("button, a, input, label, select")) return;
    const box = $(".proposal-item", row);
    if (!box) return;
    box.checked = !box.checked;
    updateItemSelection();
  });
}

/* ---------- Menus flutuantes (ações da linha, pesquisa) ---------- */

function closePopover() {
  const pop = $("#popover");
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  pop.innerHTML = "";
  $$(".popover-open").forEach((el) => el.classList.remove("popover-open"));
}

function openPopover(anchor, html) {
  let pop = $("#popover");
  if (!pop) {
    pop = document.createElement("div");
    pop.id = "popover";
    pop.className = "popover";
    pop.setAttribute("role", "menu");
    pop.hidden = true;
    document.body.appendChild(pop);
    pop.addEventListener("click", (event) => {
      if (event.target.closest(".menu-item")) setTimeout(closePopover, 0);
    });
  }
  const wasOpenHere = !pop.hidden && anchor.classList.contains("popover-open");
  closePopover();
  if (wasOpenHere) return;
  pop.innerHTML = html;
  pop.hidden = false;
  anchor.classList.add("popover-open");
  const rect = anchor.getBoundingClientRect();
  const width = pop.offsetWidth;
  const height = pop.offsetHeight;
  let left = rect.left + width <= window.innerWidth - 8 ? rect.left : rect.right - width;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  let top = rect.bottom + 6;
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  $(".menu-item", pop)?.focus({ preventScroll: true });
}

function bindPopoverDismiss() {
  document.addEventListener("mousedown", (event) => {
    if (event.target.closest("#popover, .popover-open")) return;
    closePopover();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePopover();
  });
  window.addEventListener("resize", closePopover);
  document.addEventListener("scroll", (event) => {
    if (event.target.closest?.("#popover")) return;
    closePopover();
  }, true);
}

function openItemMenu(button, id) {
  const item = state.current?.items.find((candidate) => Number(candidate.id) === Number(id));
  if (!item) return;
  const inactive = Number(item.selecionado_cadastro ?? 1) === 0;
  openPopover(button, `
    <div class="menu-title">Item ${escapeHtml(item.item || "-")} · ${escapeHtml(item.marca || "")} ${escapeHtml(item.modelo || "")}</div>
    <button type="button" class="menu-item" onclick="editItemInline(${id})">${svgIcon("i-edit")}Editar item</button>
    <button type="button" class="menu-item" onclick="addAlternative(${id})">${svgIcon("i-plus")}Adicionar alternativa</button>
    <button type="button" class="menu-item" onclick="editObservation(${id})">${svgIcon("i-info")}${item.observação ? "Editar observação" : "Adicionar observação"}</button>
    <div class="menu-sep"></div>
    <button type="button" class="menu-item" onclick="toggleDispute(${id}, ${inactive ? 1 : 0})">${svgIcon(inactive ? "i-check" : "i-x")}${inactive ? "Reativar disputa" : "Não disputar este item"}</button>
    <button type="button" class="menu-item danger" onclick="deleteItem(${id})">${svgIcon("i-trash")}Apagar item</button>
  `);
}

function openSearchMenu(button) {
  const row = button.closest("tr");
  const marca = $('input[name="marca"]', row)?.value ?? button.dataset.marca ?? "";
  const modelo = $('input[name="modelo"]', row)?.value ?? button.dataset.modelo ?? "";
  const probe = { marca, modelo };
  if (!`${marca} ${modelo}`.trim()) return toast("Preencha marca e modelo para pesquisar.");
  const sites = [["ml", "Mercado Livre"], ["amazon", "Amazon"], ["google", "Google"], ["sweetwater", "Sweetwater"], ["bh", "B&H Photo"]];
  openPopover(button, `
    <div class="menu-title">Pesquisar “${escapeHtml(`${marca} ${modelo}`.trim())}”</div>
    ${sites.map(([key, label]) => `
      <a class="menu-item" href="${searchUrl(key, probe)}" target="_blank" rel="noopener noreferrer">${svgIcon("i-external")}${label}</a>
    `).join("")}
  `);
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
        <button data-lot="${escapeAttr(lot || "")}" onclick="${lot ? "addLotItemFromButton(this)" : "addBlankItem()"}">${svgIcon("i-plus")}Item</button>
      </header>
      <div class="sheet-wrap">
        <table>
          <thead>
            <tr>
              <th></th><th>Item</th><th>Produto</th><th>Cadastrar?</th><th class="num">Qtd</th><th class="num">Valor unit.</th><th>Sigiloso</th><th class="num">Total</th><th class="num">Cadastro</th><th class="num">Mínimo</th><th class="actions-head">Ações</th>
            </tr>
          </thead>
          <tbody>${items.map((item) => itemRow(item, lot)).join("")}</tbody>
        </table>
      </div>
      <footer class="item-group-footer">
        <button data-lot="${escapeAttr(lot || "")}" onclick="${lot ? "addLotItemFromButton(this)" : "addBlankItem()"}">${svgIcon("i-plus")}Adicionar item</button>
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
        <td><div class="cell-main">${i.marca || "-"} · ${i.modelo || "-"}</div><div class="cell-tags">${searchButton(i)}${i.status && i.status !== "Em cadastro de preços" ? statusTag(i.status) : ""}${i.observação ? `<button type="button" class="obs-alert" data-observation="${escapeAttr(i.observação)}" onclick="editObservation(${i.id})">Observação</button>` : ""}</div></td>
        <td>${inactive ? '<span class="tag bad">Não disputar</span>' : '<span class="tag ok">Cadastrar</span>'}</td>
        <td class="num">${i.qtd || 0}</td>
        <td class="num">${Number(i.valor_sigiloso || 0) ? "Sigiloso" : money(i.valor_unitário)}</td>
        <td>${Number(i.valor_sigiloso || 0) ? "Sim" : "Não"}</td>
        <td class="num"><strong>${inactive ? "Não soma" : itemTotalLabel(i)}</strong></td>
        <td class="num">${money(i.valor_cadastro)}</td>
        <td class="num">${money(i.valor_mínimo)}</td>
        <td class="inline-actions">
          <button type="button" class="icon-btn row-edit-btn" title="Editar item" aria-label="Editar item" onclick="editItemInline(${i.id})">${svgIcon("i-edit")}</button>
          <button type="button" class="primary" title="Enviar este item para Itens em proposta" onclick="markItemProposal(${i.id})">${svgIcon("i-send")}Item em proposta</button>
          <button type="button" class="icon-btn row-menu-btn" title="Mais ações" aria-label="Mais ações" aria-haspopup="menu" onclick="openItemMenu(this, ${i.id})">${svgIcon("i-more")}</button>
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
        <div class="cell-tags">${searchButton(i)}</div>
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
      <td class="inline-actions"><button type="button" class="primary" onclick="saveItemRow(this)">${svgIcon("i-check")}Salvar</button><button type="button" onclick="${i.id ? "cancelEdit()" : "cancelNewItem(this)"}">Cancelar</button><button type="button" class="icon-btn" title="Observação" aria-label="Observação" onclick="editObservation(${i.id || "null"})">${svgIcon("i-info")}</button></td>
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

async function addLotItem(existingLot = "") {
  const lot = existingLot || await promptDialog("Novo lote", "Número ou nome do lote:");
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
  if (!(await confirmAction(`Apagar o item ${item.item || ""} - ${item.marca || ""} ${item.modelo || ""}?`))) return;
  state.deletedItem = { ...item, id: "" };
  await fetch(`/api/items/${id}`, { method: "DELETE" });
  showUndoToast();
  await load();
  await openDetail(state.current.id);
}

async function deleteTender(id) {
  const tender = state.tenders.find((candidate) => Number(candidate.id) === Number(id));
  if (!tender) return;
  if (!(await confirmAction(`Apagar a licitação ${tender.pregão}? Todos os itens, encomendas e anexos vinculados serão removidos.`))) return;
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
  if ((label === "item ganho" || label === "item em proposta") && !(await confirmAction(`Remover este ${label} da etapa atual? O item continuará cadastrado no pregão.`))) return;
  if (label === "item ganho" || label === "item em proposta") {
    await updateSingleItem(id, { status: "Em cadastro de preços" });
    return;
  }
  if (!(await confirmAction(`Apagar este ${label}: item ${item.item || "-"} - ${item.marca || ""} ${item.modelo || ""}?`))) return;
  await fetch(`/api/items/${id}`, { method: "DELETE" });
  await load();
}

async function deleteOrder(orderId) {
  if (!orderId) return;
  if (!(await confirmAction("Apagar esta encomenda? O item ganho continuará cadastrado."))) return;
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
  if (missing.length) return toast(`Preencha os campos obrigatórios: ${missing.join(", ")}.`);
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
  if (!ids.length) return toast("Selecione pelo menos um item já salvo.");
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
  toast("Item enviado para Itens ganhos.", "success");
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
  if (numberValue(value) <= 0) return toast("Informe o valor pelo qual o item foi para proposta.");
  await updateSingleItem(state.proposalItemId, {
    status: "Proposta enviada",
    valor_ganho: value,
  });
  state.proposalItemId = null;
  $("#proposalItemDialog").close();
  toast("Item enviado para Itens em proposta.", "success");
}

async function editObservation(id) {
  if (!id) return toast("Salve o item antes de registrar observação.");
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
  if (!items.length) return toast("Selecione pelo menos um item salvo para gerar a proposta.");
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
  if (!ids.length) return toast("Selecione pelo menos um item salvo para gerar a proposta.");
  const response = await fetch(`/proposal/${state.current.id}?format=${format}&items=${ids.join(",")}`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    toast(data.error || "Não foi possível gerar a proposta.", "error");
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

async function downloadExport(button, url, options = {}) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Gerando...";
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Não foi possível gerar a exportação.");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : "LicitaUM-exportacao";
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function exportCurrentSector(button, sector, format) {
  const ids = state.exportIds[sector] || [];
  if (!ids.length) return toast("Não há registros no filtro atual para exportar.");
  return downloadExport(button, `/export/sector/${sector}?format=${format}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
}

function exportTender(button, tenderId, format) {
  return downloadExport(button, `/export/tender/${tenderId}?format=${format}`);
}

function showView(view) {
  const changed = state.view !== view;
  state.view = view;
  $$(".view").forEach((el) => el.classList.add("hidden"));
  $(`#${view}`).classList.remove("hidden");
  $$(".nav[data-view]").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
  setCrumb(VIEW_LABELS[view] || "");
  setSidebarOpen(false);
  closePopover();
  if (view !== "detail") {
    const bar = $("#selectionBar");
    if (bar) bar.hidden = true;
    $("#detail")?.classList.remove("has-selection");
  }
  if (changed) window.scrollTo({ top: 0 });
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
    toast("Selecione apenas produtos do mesmo pregão para criar uma encomenda agrupada.");
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
  if (!items.length) return toast("Nenhum item ganho com valor disponível para cadastrar uma Carona.");
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
  if (!itemInputs.length) return toast("Adicione pelo menos um produto à Carona.");
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
  if (!(await confirmAction("Apagar este arquivo?"))) return;
  await fetch(`/api/attachments/${id}`, { method: "DELETE" });
  await load();
  await renderUploadExisting();
  if (state.current) state.current = await api(`/api/tenders/${state.current.id}`);
  await refreshDetailDocs();
  toast("Arquivo apagado.", "success");
}

async function refreshDetailDocs() {
  if (state.view === "detail" && state.current && state.detailTab === "docs") await openDetail(state.current.id);
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
  if (!data.id && !data.senha) return toast("Informe uma senha inicial para o novo usuário.");
  try {
    await api("/api/users", { method: "POST", body: JSON.stringify(data) });
    clearUserForm();
    await loadUsers();
    toast(data.id ? "Usuário atualizado com sucesso." : "Usuário criado com sucesso.", "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function deleteUser(id) {
  const user = state.users.find((candidate) => Number(candidate.id) === Number(id));
  if (!user) return;
  if (!(await confirmAction(`Apagar o usuário ${user.nome}?`))) return;
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
  await refreshDetailDocs();
  toast(`Arquivo “${file.name}” anexado.`, "success");
}

async function submitProposalLinks(event) {
  event.preventDefault();
  const rows = $$(".proposal-link-row", $("#proposalLinksFields"));
  for (const row of rows) {
    const id = Number(row.dataset.id);
    const item = state.current.items.find((candidate) => Number(candidate.id) === id);
    const link = $('input[name="link"]', row).value.trim();
    const valorGanho = $('input[name="valor_ganho"]', row).value.trim();
    if (!link) return toast("Informe o link do fornecedor para todos os itens selecionados.");
    if (!valorGanho) return toast("Informe o valor ganho para todos os itens selecionados.");
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
  updateNavBadges();
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
    toast(error.message, "error");
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
  if (state.view === "detail" && state.current && state.detailTab === "orders") await openDetail(state.current.id);
}

async function boot() {
  const savedTheme = localStorage.getItem("licitaum-theme");
  if (savedTheme === "dark") document.body.classList.add("dark");
  if (savedTheme === "light") document.body.classList.remove("dark");
  updateThemeButton();
  bindShell();
  bindDetailInteractions();
  bindPopoverDismiss();
  if (document.body.classList.contains("sidebar-collapsed") && $("#sidebarToggle")) {
    $("#sidebarToggle").title = "Expandir menu";
    $("#sidebarToggle .nav-text").textContent = "Expandir menu";
  }
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

boot().catch((error) => toast(error.message, "error"));

function updateThemeButton() {
  const button = $("#themeToggle");
  if (!button) return;
  const dark = document.body.classList.contains("dark");
  button.title = dark ? "Usar tema claro" : "Usar tema escuro";
  button.setAttribute("aria-label", button.title);
}
