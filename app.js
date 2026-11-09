"use strict";

/* ============================================================
   Shan & Company - Inventory & Sales (single-page app)

   How it works (the same idea as your small SPA example, grown up):

     state  --->  page function (returns an HTML string)  --->  #app

   1. All data lives in ONE object: `state`.
   2. Each page is a function that turns `state` into HTML text.
   3. render() puts that text into #app, then puts the keyboard focus back.
   4. Clicks, typing and submits are caught by ONE listener each on #app
      (event delegation), so nothing needs re-attaching after a re-render.
   5. The URL hash (#/products) says which page to draw, so the Back button,
      Refresh and shared links work.

   Data format and localStorage keys are the same as the older version of
   this app, so existing products and sales load as they are.
   ============================================================ */

const STORAGE_KEYS = {
  products: "smart_inventory_products_v1",
  sales: "smart_inventory_sales_v1",
};

const DISCOUNT_THRESHOLD = 10000; // PKR: discount applies at or above this subtotal
const DISCOUNT_PERCENT = 10;
const TAX_PERCENT = 5;
const MAX_PRICE = 10000000; // PKR, keeps numbers exact and displayable
const MAX_QTY = 100000;
const CONFIRM_MS = 3000; // time to press "Sure?" a second time
const NOTICE_MS = 5000;

const app = document.getElementById("app");
const noticeEl = document.getElementById("notice");
const warningEl = document.getElementById("storage-warning");

/* ------------------------- State ------------------------- */

function emptyForm() {
  return { name: "", category: "", purchase: "", selling: "", quantity: "", min: "" };
}

const state = {
  products: [],
  sales: [],
  cart: [], // [{ productId, quantity }]
  route: "dashboard",
  focus: null, // key of the element to focus after the next render
  ui: {
    search: "",
    category: "",
    sort: "",
    formOpen: false,
    editingId: null,
    formId: "",
    form: emptyForm(),
    formError: "",
    formWarning: "", // soft warning (below-cost price, duplicate name) shown before "Save anyway"
    warnKey: "", // the exact form values the user has already been warned about
    deleteId: null, // product waiting for a second "Sure?" click
    saleSearch: "",
    saleDate: "",
    checkoutError: "",
  },
};

/* ------------------------- Small helpers ------------------------- */

// Every value that goes into HTML text or an attribute passes through here.
function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// Money is calculated in whole paisa (integers). Float maths gives
// 0.034999... for 0.035 and loses a paisa now and then.
function toPaisa(pkr) {
  return Math.round(Number(pkr) * 100);
}

function percentOf(paisa, percent) {
  return Math.floor((paisa * percent + 50) / 100); // rounds half up
}

function formatPKR(value) {
  const n = round2(Number(value) || 0);
  const [intPart, decPart] = Math.abs(n).toFixed(2).split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return "PKR " + (n < 0 ? "-" : "") + withCommas + "." + decPart;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/* ------------------------- Storage ------------------------- */

let storageOk = (() => {
  try {
    const probe = "__probe__" + Date.now();
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
})();

function showStorageWarning() {
  warningEl.textContent =
    "Storage is unavailable in this browser, so changes will be lost when you refresh or close this page.";
}

function sanitizeProduct(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = String(raw.id || "").trim();
  const name = String(raw.name || "").trim();
  const category = String(raw.category || "").trim();
  const purchasePrice = Number(raw.purchasePrice);
  const sellingPrice = Number(raw.sellingPrice);
  const quantity = Number(raw.quantity);
  const minStock = Number(raw.minStock);
  if (!id || !name || !category) return null;
  if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) return null;
  if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) return null;
  if (!Number.isInteger(quantity) || quantity < 0) return null;
  if (!Number.isInteger(minStock) || minStock < 0) return null;
  return {
    id: id,
    name: name,
    category: category,
    purchasePrice: round2(purchasePrice),
    sellingPrice: round2(sellingPrice),
    quantity: quantity,
    minStock: minStock,
  };
}

function sanitizeSale(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = String(raw.id || "").trim();
  const date = raw.timestamp ? new Date(raw.timestamp) : null;
  if (!id || !date || isNaN(date.getTime())) return null;
  const total = Number(raw.total);
  if (!Number.isFinite(total)) return null;
  const items = [];
  for (const item of Array.isArray(raw.items) ? raw.items : []) {
    if (!item || typeof item !== "object") continue;
    const productId = String(item.productId || "").trim();
    const quantity = Number(item.quantity);
    const price = Number(item.price);
    if (!productId || !Number.isInteger(quantity) || quantity <= 0) continue;
    if (!Number.isFinite(price) || price <= 0) continue;
    // The name is stored in the sale so history still reads well after a product is deleted.
    const name = String(item.name || "").trim() || productId;
    items.push({ productId: productId, name: name, quantity: quantity, price: round2(price) });
  }
  return {
    id: id,
    timestamp: date.toISOString(),
    items: items,
    subtotal: round2(Number(raw.subtotal) || 0),
    discount: round2(Number(raw.discount) || 0),
    tax: round2(Number(raw.tax) || 0),
    total: round2(total),
  };
}

// Returns null when storage can't be READ (keep what is in memory),
// otherwise a clean list. Unreadable saved data is copied to "<key>_corrupt_backup" first.
function readList(key, sanitize, uniqueIds) {
  if (!storageOk) return null;
  let raw;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!Array.isArray(parsed)) {
    try {
      localStorage.setItem(key + "_corrupt_backup", raw);
    } catch {
      /* nothing more we can do */
    }
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const entry of parsed) {
    const clean = sanitize(entry);
    if (!clean) continue;
    if (uniqueIds) {
      if (seen.has(clean.id)) continue;
      seen.add(clean.id);
    }
    out.push(clean);
  }
  return out;
}

function writeList(key, list) {
  if (!storageOk) return false;
  try {
    localStorage.setItem(key, JSON.stringify(list));
    return true;
  } catch {
    storageOk = false;
    showStorageWarning();
    return false;
  }
}

function saveProducts() {
  return writeList(STORAGE_KEYS.products, state.products);
}

function saveSales() {
  return writeList(STORAGE_KEYS.sales, state.sales);
}

// Another tab may have changed the data. Always look at the newest copy before
// changing anything, so this tab never saves old data over newer data.
function refreshFromStorage() {
  const products = readList(STORAGE_KEYS.products, sanitizeProduct, true);
  const sales = readList(STORAGE_KEYS.sales, sanitizeSale, false);
  if (products) state.products = products;
  if (sales) state.sales = sales;
}

/* ------------------------- Business logic ------------------------- */

function getProduct(id) {
  return state.products.find((p) => p.id === id) || null;
}

function nextNumber(ids) {
  let max = 0;
  for (const id of ids) {
    const n = parseInt(String(id).replace(/\D/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

function generateProductId() {
  // Ids of deleted products that are still in sales history are skipped too,
  // otherwise a new product would inherit the old product's sales.
  const ids = state.products.map((p) => p.id);
  for (const sale of state.sales) {
    for (const item of sale.items) ids.push(item.productId);
  }
  return "PRD-" + String(nextNumber(ids)).padStart(3, "0");
}

function generateSaleId() {
  return "SALE-" + String(nextNumber(state.sales.map((s) => s.id))).padStart(4, "0");
}

function stockStatus(p) {
  if (p.quantity <= 0) return "out";
  if (p.quantity <= p.minStock) return "low";
  return "ok";
}

function statusText(status) {
  return status === "out" ? "Out of Stock" : status === "low" ? "Low Stock" : "In Stock";
}

function inventoryValue() {
  let paisa = 0;
  for (const p of state.products) paisa += toPaisa(p.purchasePrice) * p.quantity;
  return paisa / 100;
}

function cartQty(productId) {
  const line = state.cart.find((l) => l.productId === productId);
  return line ? line.quantity : 0;
}

function computeTotals() {
  let subtotal = 0;
  for (const line of state.cart) {
    const p = getProduct(line.productId);
    if (p) subtotal += toPaisa(p.sellingPrice) * line.quantity;
  }
  const discount = subtotal >= toPaisa(DISCOUNT_THRESHOLD) ? percentOf(subtotal, DISCOUNT_PERCENT) : 0;
  const discounted = subtotal - discount;
  const tax = percentOf(discounted, TAX_PERCENT);
  return {
    subtotal: subtotal / 100,
    discount: discount / 100,
    discounted: discounted / 100,
    tax: tax / 100,
    grand: (discounted + tax) / 100,
  };
}

function pruneCart() {
  state.cart = state.cart
    .map((l) => {
      const p = getProduct(l.productId);
      return p ? { productId: l.productId, quantity: Math.min(l.quantity, p.quantity) } : null;
    })
    .filter((l) => l && l.quantity > 0);
}

function getTopSeller() {
  const units = new Map();
  const revenue = new Map();
  const names = new Map();
  for (const sale of state.sales) {
    for (const item of sale.items) {
      units.set(item.productId, (units.get(item.productId) || 0) + item.quantity);
      revenue.set(item.productId, (revenue.get(item.productId) || 0) + toPaisa(item.price) * item.quantity);
      names.set(item.productId, item.name);
    }
  }
  let best = null;
  for (const id of Array.from(units.keys()).sort()) {
    if (best === null || units.get(id) > units.get(best) || (units.get(id) === units.get(best) && revenue.get(id) > revenue.get(best))) {
      best = id;
    }
  }
  if (best === null) return null;
  const product = getProduct(best);
  return { name: product ? product.name : names.get(best), units: units.get(best), revenue: revenue.get(best) / 100 };
}

function saleDateKey(sale) {
  const d = new Date(sale.timestamp);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/* ------------------------- Pages: each one turns state into HTML ------------------------- */

function pageHeading(title, subtitle) {
  return (
    '<div class="page-heading">' +
    '<h2 id="page-title" tabindex="-1">' + esc(title) + "</h2>" +
    '<p class="muted">' + esc(subtitle) + "</p>" +
    "</div>"
  );
}

function statCard(icon, label, value, sub) {
  return (
    '<div class="stat-card">' +
    '<span class="stat-icon" aria-hidden="true">' + icon + "</span>" +
    '<span class="stat-label">' + esc(label) + "</span>" +
    '<span class="stat-value">' + esc(value) + "</span>" +
    '<span class="stat-sub">' + esc(sub) + "</span>" +
    "</div>"
  );
}

function renderDashboard() {
  let revenue = 0;
  for (const s of state.sales) revenue += toPaisa(s.total);
  const low = state.products.filter((p) => p.quantity <= p.minStock);
  const top = getTopSeller();

  const topHtml = top
    ? '<div class="top-seller-name">' + esc(top.name) + "</div>" +
      '<div class="stat-value">' + top.units + "</div>" +
      '<div class="top-seller-meta">units sold &middot; revenue ' + esc(formatPKR(top.revenue)) + "</div>"
    : '<p class="empty-state">No sales recorded yet. Complete a sale to see your top seller.</p>';

  const alertsHtml = low.length
    ? low
        .slice()
        .sort((a, b) => a.quantity - b.quantity)
        .map(
          (p) =>
            '<div class="low-stock-item">' +
            '<span class="low-stock-name">' + esc(p.name) + ' <span class="muted">(' + esc(p.id) + ")</span></span>" +
            '<span class="low-stock-qty">' + (p.quantity <= 0 ? "Out of stock" : "Low stock") +
            " &mdash; stock " + p.quantity + " / min " + p.minStock + "</span>" +
            "</div>"
        )
        .join("")
    : '<p class="empty-state">All products are above their minimum stock levels.</p>';

  return (
    "<section>" +
    pageHeading("Dashboard", "Overview of your shop performance, inventory and sales.") +
    '<div class="stats-grid">' +
    statCard("&#128230;", "Total Products", String(state.products.length), "products in catalog") +
    statCard("&#128176;", "Total Sales Revenue", formatPKR(revenue / 100), "from completed orders") +
    statCard("&#9989;", "Completed Orders", String(state.sales.length), "sales recorded") +
    statCard("&#9888;", "Low-Stock Products", String(low.length), "at or below minimum") +
    "</div>" +
    '<div class="dashboard-columns">' +
    '<div class="card"><h3 class="card-title">Top-Selling Product</h3><div class="top-seller">' + topHtml + "</div></div>" +
    '<div class="card"><h3 class="card-title">Low-Stock Alerts</h3><div class="low-stock-alerts">' + alertsHtml + "</div></div>" +
    "</div>" +
    "</section>"
  );
}

function productFormHtml(categories) {
  const ui = state.ui;
  const f = ui.form;
  const field = (id, label, type, value, extra) =>
    '<div class="form-field">' +
    '<label for="pf-' + id + '">' + label + ' <span class="required" aria-hidden="true">*</span></label>' +
    '<input type="' + type + '" id="pf-' + id + '" data-field="' + id + '" value="' + esc(value) + '"' + (extra || "") + ">" +
    "</div>";
  return (
    '<div class="card" id="product-form-container">' +
    '<h3 class="card-title">' + (ui.editingId ? "Edit Product" : "Add Product") + "</h3>" +
    '<form id="product-form" data-form="product" novalidate>' +
    '<div class="form-grid">' +
    '<div class="form-field"><label for="pf-id">Product ID</label>' +
    '<input type="text" id="pf-id" value="' + esc(ui.formId) + '" disabled>' +
    '<small class="field-hint">Unique identifier (made automatically).</small></div>' +
    field("name", "Product Name", "text", f.name, ' placeholder="Wireless Mouse" autocomplete="off"') +
    '<div class="form-field"><label for="pf-category">Category <span class="required" aria-hidden="true">*</span></label>' +
    '<input type="text" id="pf-category" data-field="category" value="' + esc(f.category) + '" placeholder="Electronics" list="category-list" autocomplete="off">' +
    '<datalist id="category-list">' + categories.map((c) => '<option value="' + esc(c) + '"></option>').join("") + "</datalist></div>" +
    field("purchase", "Purchase Price (PKR)", "number", f.purchase, ' min="0" step="0.01" placeholder="1200"') +
    field("selling", "Selling Price (PKR)", "number", f.selling, ' min="0" step="0.01" placeholder="1800"') +
    field("quantity", "Quantity", "number", f.quantity, ' min="0" step="1" placeholder="0"') +
    field("min", "Minimum Stock", "number", f.min, ' min="0" step="1" placeholder="5"') +
    "</div>" +
    (ui.formError ? '<p class="form-error" role="alert">' + esc(ui.formError) + "</p>" : "") +
    (ui.formWarning ? '<p class="form-warning" role="alert">' + esc(ui.formWarning) + "</p>" : "") +
    '<div class="form-actions">' +
    '<button type="submit" class="btn btn-primary" data-fk="save-product">' + (ui.formWarning ? "Save Anyway" : "Save Product") + "</button>" +
    '<button type="button" class="btn" data-action="cancel-form" data-fk="cancel-form">Cancel</button>' +
    "</div></form></div>"
  );
}

function renderProducts() {
  const ui = state.ui;
  const categories = Array.from(new Set(state.products.map((p) => p.category))).sort();
  const category = categories.includes(ui.category) ? ui.category : "";
  const search = ui.search.trim().toLowerCase();

  let list = state.products.slice();
  if (category) list = list.filter((p) => p.category === category);
  if (search) {
    list = list.filter(
      (p) => p.id.toLowerCase().includes(search) || p.name.toLowerCase().includes(search) || p.category.toLowerCase().includes(search)
    );
  }
  if (ui.sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
  else if (ui.sort === "sellingPrice") list.sort((a, b) => a.sellingPrice - b.sellingPrice);
  else if (ui.sort === "quantity") list.sort((a, b) => a.quantity - b.quantity);

  const rows = list
    .map((p) => {
      const status = stockStatus(p);
      const confirming = ui.deleteId === p.id;
      return (
        "<tr>" +
        "<td>" + esc(p.id) + "</td>" +
        "<td>" + esc(p.name) + "</td>" +
        "<td>" + esc(p.category) + "</td>" +
        '<td class="num">' + esc(formatPKR(p.purchasePrice)) + "</td>" +
        '<td class="num">' + esc(formatPKR(p.sellingPrice)) + "</td>" +
        '<td class="num">' + p.quantity + "</td>" +
        '<td class="num">' + p.minStock + "</td>" +
        '<td class="num">' + esc(formatPKR(toPaisa(p.purchasePrice) * p.quantity / 100)) + "</td>" +
        '<td><span class="badge ' + status + '">' + statusText(status) + "</span></td>" +
        '<td class="actions-cell">' +
        '<button type="button" class="btn btn-small" data-action="edit" data-id="' + esc(p.id) + '" data-fk="edit:' + esc(p.id) + '" aria-label="Edit ' + esc(p.name) + '">Edit</button> ' +
        '<button type="button" class="btn btn-danger btn-small" data-action="delete" data-id="' + esc(p.id) + '" data-fk="del:' + esc(p.id) + '" aria-label="' +
        (confirming ? "Click again to delete " : "Delete ") + esc(p.name) + '">' + (confirming ? "Sure?" : "Delete") + "</button>" +
        "</td></tr>"
      );
    })
    .join("");

  const emptyText = state.products.length === 0
    ? 'No products yet. Click "Add Product" to create your first product.'
    : "No products found.";

  return (
    "<section>" +
    pageHeading("Products", "Create, search, edit and delete your inventory products.") +
    '<div class="toolbar">' +
    '<input type="search" id="product-search" value="' + esc(ui.search) + '" placeholder="Search by name, ID or category..." aria-label="Search products">' +
    '<select id="product-category-filter" aria-label="Filter by category">' +
    '<option value="">All Categories</option>' +
    categories.map((c) => '<option value="' + esc(c) + '"' + (c === category ? " selected" : "") + ">" + esc(c) + "</option>").join("") +
    "</select>" +
    '<select id="product-sort" aria-label="Sort products">' +
    [["", "Sort: Default"], ["name", "Sort: Name"], ["sellingPrice", "Sort: Selling Price"], ["quantity", "Sort: Quantity"]]
      .map(([v, l]) => '<option value="' + v + '"' + (v === ui.sort ? " selected" : "") + ">" + l + "</option>")
      .join("") +
    "</select>" +
    '<button type="button" id="btn-open-product-form" class="btn btn-primary" data-action="open-form">+ Add Product</button>' +
    "</div>" +
    '<div class="card table-card"><div class="table-wrapper">' +
    '<table id="products-table" class="data-table"><caption class="visually-hidden">Products</caption>' +
    "<thead><tr>" +
    '<th scope="col">Product ID</th><th scope="col">Name</th><th scope="col">Category</th>' +
    '<th scope="col" class="num">Purchase Price</th><th scope="col" class="num">Selling Price</th>' +
    '<th scope="col" class="num">Quantity</th><th scope="col" class="num">Min Stock</th>' +
    '<th scope="col" class="num">Stock Value</th><th scope="col">Status</th><th scope="col" class="actions-col">Actions</th>' +
    '</tr></thead><tbody id="products-tbody">' +
    (rows || '<tr><td colspan="10" class="empty-cell">' + emptyText + "</td></tr>") +
    "</tbody></table></div></div>" +
    '<div class="card inventory-summary"><span>Total inventory cost value: <strong id="inventory-total-value">' + esc(formatPKR(inventoryValue())) + "</strong></span></div>" +
    (ui.formOpen ? productFormHtml(categories) : "") +
    "</section>"
  );
}

function renderSale() {
  const ui = state.ui;
  const sorted = state.products.slice().sort((a, b) => a.name.localeCompare(b.name));

  const listHtml = sorted.length
    ? sorted
        .map((p) => {
          const status = stockStatus(p);
          const inStock = p.quantity > 0;
          const full = !inStock || cartQty(p.id) >= p.quantity;
          return (
            '<div class="sale-product-item">' +
            '<div class="product-info"><div class="product-name">' + esc(p.name) + "</div>" +
            '<div class="product-meta">' + esc(p.category) + " &middot; Selling " + esc(formatPKR(p.sellingPrice)) +
            " &middot; Stock " + p.quantity + " (" + statusText(status) + ")</div></div>" +
            '<div class="product-actions"><button type="button" class="btn btn-small btn-primary" data-action="cart-add" data-id="' + esc(p.id) +
            '" data-fk="add:' + esc(p.id) + '"' + (full ? ' aria-disabled="true"' : "") +
            ' aria-label="' + (inStock ? "Add " + esc(p.name) + " to cart" : esc(p.name) + " is out of stock") + '">' +
            (inStock ? "Add to Cart" : "Out of Stock") + "</button></div></div>"
          );
        })
        .join("")
    : '<p class="empty-state">No products available. Add products from the Products page first.</p>';

  let cartHtml = '<p class="empty-state">Your cart is empty. Add products to start a sale.</p>';
  let summaryHtml = "";
  const lines = state.cart.filter((l) => getProduct(l.productId));
  if (lines.length) {
    cartHtml =
      '<div id="cart-lines">' +
      lines
        .map((l) => {
          const p = getProduct(l.productId);
          const lineTotal = toPaisa(p.sellingPrice) * l.quantity / 100;
          return (
            '<div class="cart-line"><div class="line-top"><span class="line-name">' + esc(p.name) + "</span>" +
            '<span class="line-total">' + esc(formatPKR(lineTotal)) + "</span></div>" +
            '<div class="line-controls"><span class="line-price">Unit: ' + esc(formatPKR(p.sellingPrice)) + "</span>" +
            '<span class="qty-stepper">' +
            '<button type="button" class="qty-btn" data-action="cart-qty" data-delta="-1" data-id="' + esc(p.id) + '" data-fk="dec:' + esc(p.id) + '" aria-label="Decrease quantity of ' + esc(p.name) + '">&minus;</button>' +
            '<span aria-label="Quantity">' + l.quantity + "</span>" +
            '<button type="button" class="qty-btn" data-action="cart-qty" data-delta="1" data-id="' + esc(p.id) + '" data-fk="inc:' + esc(p.id) + '" aria-label="Increase quantity of ' + esc(p.name) + '">+</button>' +
            "</span>" +
            '<button type="button" class="btn btn-small btn-danger" data-action="cart-remove" data-id="' + esc(p.id) + '" data-fk="rm:' + esc(p.id) + '" aria-label="Remove ' + esc(p.name) + ' from cart">Remove</button>' +
            "</div></div>"
          );
        })
        .join("") +
      "</div>";
    const t = computeTotals();
    const row = (label, value, cls) => '<div class="summary-row ' + (cls || "") + '"><span>' + label + "</span><span>" + esc(value) + "</span></div>";
    summaryHtml =
      '<div class="cart-summary">' +
      row("Subtotal", formatPKR(t.subtotal)) +
      row("Discount (" + DISCOUNT_PERCENT + "% at " + formatPKR(DISCOUNT_THRESHOLD).replace(".00", "") + " or more)", (t.discount > 0 ? "-" : "") + formatPKR(t.discount)) +
      row("Discounted Subtotal", formatPKR(t.discounted)) +
      row("Tax (" + TAX_PERCENT + "% of discounted subtotal)", formatPKR(t.tax)) +
      row("Grand Total", formatPKR(t.grand), "total-row") +
      '<button type="button" id="btn-checkout" class="btn btn-primary btn-block" data-action="checkout" data-fk="checkout">Checkout</button>' +
      (ui.checkoutError ? '<p class="form-error" role="alert">' + esc(ui.checkoutError) + "</p>" : "") +
      "</div>";
  }

  return (
    "<section>" +
    pageHeading("New Sale", "Add products to the cart and complete a checkout.") +
    '<div class="sale-columns">' +
    '<div class="card"><h3 class="card-title">Products</h3><div id="sale-products-list" class="sale-product-list">' + listHtml + "</div></div>" +
    '<div class="card"><h3 class="card-title">Shopping Cart</h3>' + cartHtml + summaryHtml + "</div>" +
    "</div></section>"
  );
}

function renderHistory() {
  const ui = state.ui;
  const search = ui.saleSearch.trim().toLowerCase();
  let list = state.sales.slice();
  if (ui.saleDate) list = list.filter((s) => saleDateKey(s) === ui.saleDate);
  if (search) list = list.filter((s) => s.id.toLowerCase().includes(search));

  const cards = list.length
    ? list
        .map((sale) => {
          const when = new Date(sale.timestamp).toLocaleString(undefined, {
            year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
          });
          const items = sale.items
            .map((i) => "<li><span>" + esc(i.name) + " &times; " + i.quantity + "</span><span>" + esc(formatPKR(toPaisa(i.price) * i.quantity / 100)) + "</span></li>")
            .join("");
          return (
            '<div class="sale-card"><div class="sale-card-header"><div>' +
            '<div class="sale-card-title">' + esc(sale.id) + "</div>" +
            '<div class="sale-card-meta">' + esc(when) + "</div></div>" +
            '<div class="sale-card-total">' + esc(formatPKR(sale.total)) + "</div></div>" +
            '<ul class="sale-card-items">' + items + "</ul></div>"
          );
        })
        .join("")
    : '<p class="empty-state">' + (state.sales.length ? "No sales found." : "No sales recorded yet.") + "</p>";

  return (
    "<section>" +
    pageHeading("Sales History", "Review completed sales and order details.") +
    '<div class="toolbar">' +
    '<input type="search" id="sales-search" value="' + esc(ui.saleSearch) + '" placeholder="Search by sale ID..." aria-label="Search sales by sale ID">' +
    '<input type="date" id="sales-date-filter" value="' + esc(ui.saleDate) + '" aria-label="Filter sales by date">' +
    '<button type="button" class="btn" data-action="clear-sales-filters" data-fk="clear-sales-filters">Clear Filters</button>' +
    "</div>" +
    '<div id="sales-list" class="sales-list">' + cards + "</div></section>"
  );
}

const ROUTES = {
  dashboard: { title: "Dashboard", page: renderDashboard },
  products: { title: "Products", page: renderProducts },
  sale: { title: "New Sale", page: renderSale },
  history: { title: "Sales History", page: renderHistory },
};

/* ------------------------- Rendering + keeping the keyboard focus ------------------------- */

function focusKey(el) {
  return el.getAttribute("data-fk") || el.id || null;
}

function findByKey(key) {
  for (const el of app.querySelectorAll("[data-fk], [id]")) {
    if (focusKey(el) === key) return el;
  }
  return null;
}

// Re-drawing replaces every element, which would normally drop the focus
// (and the cursor position while typing). So we remember it and put it back.
function render() {
  const active = document.activeElement;
  let key = null;
  let selection = null;
  if (active && app.contains(active)) {
    key = focusKey(active);
    try {
      if (active.selectionStart !== null && active.selectionStart !== undefined) {
        selection = [active.selectionStart, active.selectionEnd];
      }
    } catch {
      selection = null;
    }
  }

  app.innerHTML = ROUTES[state.route].page();

  document.title = ROUTES[state.route].title + " · Shan & Company";
  for (const link of document.querySelectorAll("#main-nav [data-view]")) {
    const on = link.getAttribute("data-view") === state.route;
    link.classList.toggle("active", on);
    if (on) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }

  const wanted = state.focus || key;
  state.focus = null;
  const el = wanted ? findByKey(wanted) : null;
  if (el) {
    el.focus();
    if (selection && !state.focus) {
      try {
        el.setSelectionRange(selection[0], selection[1]);
      } catch {
        /* not a text field */
      }
    }
  }
}

function notify(message) {
  noticeEl.textContent = message;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => {
    noticeEl.textContent = "";
  }, NOTICE_MS);
}

/* ------------------------- Routing (URL hash) ------------------------- */

function routeFromHash() {
  const match = /^#\/([a-z]+)/.exec(window.location.hash);
  return match && hasOwn(ROUTES, match[1]) ? match[1] : "dashboard";
}

function onRouteChange() {
  state.route = routeFromHash();
  // A wrong address such as #/nonsense is tidied up to the page we actually show.
  if (window.location.hash !== "#/" + state.route) {
    window.history.replaceState(null, "", "#/" + state.route);
  }
  state.ui.deleteId = null;
  state.ui.checkoutError = "";
  state.focus = "page-title"; // after going to a new page, keyboard and screen-reader users start at its heading
  render();
  window.scrollTo(0, 0);
}

/* ------------------------- Actions ------------------------- */

function openForm() {
  const ui = state.ui;
  ui.formOpen = true;
  ui.editingId = null;
  ui.formId = generateProductId();
  ui.form = emptyForm();
  ui.formError = "";
  ui.formWarning = "";
  ui.warnKey = "";
  state.focus = "pf-name";
  render();
}

function editProduct(id) {
  const p = getProduct(id);
  if (!p) return;
  const ui = state.ui;
  ui.formOpen = true;
  ui.editingId = p.id;
  ui.formId = p.id;
  ui.form = {
    name: p.name,
    category: p.category,
    purchase: String(p.purchasePrice),
    selling: String(p.sellingPrice),
    quantity: String(p.quantity),
    min: String(p.minStock),
  };
  ui.formError = "";
  ui.formWarning = "";
  ui.warnKey = "";
  state.focus = "pf-name";
  render();
}

function closeForm() {
  const ui = state.ui;
  ui.formOpen = false;
  ui.editingId = null;
  ui.form = emptyForm();
  ui.formError = "";
  ui.formWarning = "";
  ui.warnKey = "";
  state.focus = "btn-open-product-form";
  render();
}

function readFormFromDom() {
  const value = (name) => {
    const el = document.getElementById("pf-" + name);
    return el ? el.value : "";
  };
  return {
    name: value("name"),
    category: value("category"),
    purchase: value("purchase"),
    selling: value("selling"),
    quantity: value("quantity"),
    min: value("min"),
  };
}

function submitProduct() {
  refreshFromStorage();
  const ui = state.ui;
  ui.form = readFormFromDom(); // read the fields themselves, so autofill and pasted text are never missed
  const f = ui.form;

  const fail = (message) => {
    ui.formError = message;
    ui.formWarning = "";
    render();
  };

  const name = f.name.trim();
  const category = f.category.trim();
  const num = (text) => (text.trim() === "" ? NaN : Number(text));
  const purchasePrice = num(f.purchase);
  const sellingPrice = num(f.selling);
  const quantity = num(f.quantity);
  const minStock = num(f.min);

  if (!name) return fail("Product name is required.");
  if (!category) return fail("Category is required.");
  if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) return fail("Purchase price must be a positive number greater than zero.");
  if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) return fail("Selling price must be a positive number greater than zero.");
  if (purchasePrice > MAX_PRICE || sellingPrice > MAX_PRICE) return fail("Price cannot be more than " + formatPKR(MAX_PRICE) + ".");
  if (!Number.isInteger(quantity) || quantity < 0) return fail("Quantity must be a non-negative whole number.");
  if (quantity > MAX_QTY) return fail("Quantity cannot be more than " + MAX_QTY.toLocaleString("en-US") + ".");
  if (!Number.isInteger(minStock) || minStock < 0) return fail("Minimum stock must be a non-negative whole number.");

  const editingId = ui.editingId;
  if (editingId && !getProduct(editingId)) {
    closeForm();
    notify("That product no longer exists (it was deleted in another tab).");
    return;
  }

  // Soft warnings: the user can still save, but only after seeing them once.
  const warnings = [];
  if (sellingPrice < purchasePrice) {
    warnings.push("The selling price is lower than the purchase price, so every sale of this product will lose money.");
  }
  const duplicate = state.products.find(
    (p) => p.id !== editingId && p.category.toLowerCase() === category.toLowerCase() && p.name.toLowerCase() === name.toLowerCase()
  );
  if (duplicate) {
    warnings.push("A product named \"" + duplicate.name + "\" already exists in " + duplicate.category + " (" + duplicate.id + ").");
  }
  const warnKey = [editingId || "", name, category, purchasePrice, sellingPrice].join("|");
  if (warnings.length > 0 && ui.warnKey !== warnKey) {
    ui.warnKey = warnKey;
    ui.formError = "";
    ui.formWarning = warnings.join(" ") + " Press Save Anyway to continue, or change the values.";
    state.focus = "save-product";
    render();
    return;
  }

  const clean = {
    id: editingId || generateProductId(), // new products get a fresh id at save time, so two tabs can't clash
    name: name,
    category: category,
    purchasePrice: round2(purchasePrice),
    sellingPrice: round2(sellingPrice),
    quantity: quantity,
    minStock: minStock,
  };

  state.products = editingId
    ? state.products.map((p) => (p.id === editingId ? clean : p))
    : state.products.concat([clean]);
  saveProducts();
  pruneCart();
  notify((editingId ? "Updated " : "Added ") + clean.name + " (" + clean.id + ").");
  closeForm();
}

function deleteProduct(id) {
  const ui = state.ui;
  const p = getProduct(id);
  if (!p) return;

  // First click asks "Sure?", second click within 3 seconds deletes (no blocking confirm() box).
  if (ui.deleteId !== id) {
    ui.deleteId = id;
    clearTimeout(deleteProduct.timer);
    deleteProduct.timer = setTimeout(() => {
      ui.deleteId = null;
      if (state.route === "products") render();
    }, CONFIRM_MS);
    render();
    return;
  }

  clearTimeout(deleteProduct.timer);
  ui.deleteId = null;
  refreshFromStorage();
  state.products = state.products.filter((x) => x.id !== id);
  state.cart = state.cart.filter((l) => l.productId !== id);
  saveProducts();
  notify("Deleted " + p.name + ".");
  state.focus = "btn-open-product-form";
  render();
}

function cartAdd(id) {
  const p = getProduct(id);
  if (!p) return;
  const qty = cartQty(id);
  if (qty + 1 > p.quantity) return; // never more than the stock we have
  const line = state.cart.find((l) => l.productId === id);
  if (line) line.quantity = qty + 1;
  else state.cart.push({ productId: id, quantity: 1 });
  render();
}

function cartChange(id, delta) {
  const line = state.cart.find((l) => l.productId === id);
  const p = getProduct(id);
  if (!line || !p) return;
  const next = line.quantity + delta;
  if (next < 1) return cartRemove(id);
  line.quantity = Math.min(next, p.quantity);
  render();
}

function cartRemove(id) {
  state.cart = state.cart.filter((l) => l.productId !== id);
  state.focus = "add:" + id; // the cart line is gone, so move focus to the product's Add button
  render();
}

function checkout() {
  const ui = state.ui;
  ui.checkoutError = "";
  refreshFromStorage(); // check against the newest stock, not what this tab saw earlier

  const fail = (message) => {
    ui.checkoutError = message;
    render();
  };

  if (state.cart.length === 0) return fail("Your cart is empty. Add products before checking out.");

  const items = [];
  for (const line of state.cart) {
    const p = getProduct(line.productId);
    if (!p) return fail("A product in your cart no longer exists. Please remove it and try again.");
    if (!Number.isInteger(line.quantity) || line.quantity < 1) return fail("Your cart contains an invalid quantity.");
    if (line.quantity > p.quantity) {
      return fail("Not enough stock for " + p.name + ". Available: " + p.quantity + ". Requested: " + line.quantity + ".");
    }
    items.push({ productId: p.id, name: p.name, price: p.sellingPrice, quantity: line.quantity });
  }

  const t = computeTotals();
  const sale = {
    id: generateSaleId(),
    timestamp: new Date().toISOString(),
    items: items,
    subtotal: t.subtotal,
    discount: t.discount,
    tax: t.tax,
    total: t.grand,
  };

  // Keep the old data, so a failed save can be undone completely.
  const oldProducts = state.products;
  const oldSales = state.sales;
  const canSave = storageOk; // without storage the app runs in memory only (the warning is already shown)

  // Everything was checked above, so stock can't go below zero here.
  state.products = state.products.map((p) => {
    const item = items.find((i) => i.productId === p.id);
    return item ? { ...p, quantity: p.quantity - item.quantity } : p;
  });
  state.sales = [sale].concat(state.sales);

  if (canSave && !(saveProducts() && saveSales())) {
    // One of the two writes failed: put memory and storage back as they were.
    state.products = oldProducts;
    state.sales = oldSales;
    try {
      localStorage.setItem(STORAGE_KEYS.products, JSON.stringify(oldProducts));
      localStorage.setItem(STORAGE_KEYS.sales, JSON.stringify(oldSales));
    } catch {
      /* storage is not writable, so there is nothing newer in it to undo */
    }
    return fail("The sale could not be saved because browser storage is full or unavailable. Nothing was changed.");
  }
  state.cart = [];

  notify("Sale " + sale.id + " completed: " + formatPKR(sale.total) + ".");
  state.focus = "page-title";
  render();
}

function clearSalesFilters() {
  state.ui.saleSearch = "";
  state.ui.saleDate = "";
  state.focus = "sales-search";
  render();
}

/* ------------------------- Events: ONE listener per kind, on #app ------------------------- */

const ACTIONS = {
  "open-form": () => openForm(),
  "cancel-form": () => closeForm(),
  edit: (d) => editProduct(d.id),
  delete: (d) => deleteProduct(d.id),
  "cart-add": (d) => cartAdd(d.id),
  "cart-qty": (d) => cartChange(d.id, Number(d.delta)),
  "cart-remove": (d) => cartRemove(d.id),
  checkout: () => checkout(),
  "clear-sales-filters": () => clearSalesFilters(),
};

app.addEventListener("click", (event) => {
  const el = event.target.closest("[data-action]");
  if (!el || el.disabled || el.getAttribute("aria-disabled") === "true") return;
  if (hasOwn(ACTIONS, el.dataset.action)) ACTIONS[el.dataset.action](el.dataset);
});

app.addEventListener("submit", (event) => {
  if (event.target.getAttribute("data-form") === "product") {
    event.preventDefault();
    submitProduct();
  }
});

// Typing: keep form text in state (so it survives page changes); search boxes re-draw live.
app.addEventListener("input", (event) => {
  const t = event.target;
  const field = t.getAttribute("data-field");
  if (field) {
    state.ui.form[field] = t.value;
    state.ui.warnKey = ""; // the values changed, so a new warning check is needed
  } else if (t.id === "product-search") {
    state.ui.search = t.value;
    render();
  } else if (t.id === "sales-search") {
    state.ui.saleSearch = t.value;
    render();
  }
});

app.addEventListener("change", (event) => {
  const t = event.target;
  if (t.id === "product-category-filter") state.ui.category = t.value;
  else if (t.id === "product-sort") state.ui.sort = t.value;
  else if (t.id === "sales-date-filter") state.ui.saleDate = t.value;
  else return;
  render();
});

app.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.ui.formOpen && event.target.closest("#product-form")) closeForm();
});

// Another tab changed the data: load it and redraw.
window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEYS.products && event.key !== STORAGE_KEYS.sales) return;
  refreshFromStorage();
  pruneCart();
  render();
});

window.addEventListener("hashchange", onRouteChange);

/* ------------------------- Start ------------------------- */

function init() {
  if (!storageOk) showStorageWarning();
  state.products = readList(STORAGE_KEYS.products, sanitizeProduct, true) || [];
  state.sales = readList(STORAGE_KEYS.sales, sanitizeSale, false) || [];
  onRouteChange();
}

init();
