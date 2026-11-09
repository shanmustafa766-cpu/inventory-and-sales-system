
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./load-app");

const PRODUCTS_KEY = "smart_inventory_products_v1";
const SALES_KEY = "smart_inventory_sales_v1";

function product(overrides) {
  return Object.assign(
    { id: "PRD-001", name: "Wireless Mouse", category: "Electronics", purchasePrice: 1200, sellingPrice: 1800, quantity: 25, minStock: 5 },
    overrides
  );
}

/* ---------- money helpers ---------- */

test("toPaisa converts PKR to whole paisa", () => {
  const { sandbox } = loadApp();
  assert.equal(sandbox.toPaisa(1800), 180000);
  assert.equal(sandbox.toPaisa(0.07), 7);
  assert.equal(sandbox.toPaisa(19.99), 1999);
});

test("percentOf rounds half up to the nearest paisa", () => {
  const { sandbox } = loadApp();
  assert.equal(sandbox.percentOf(1200000, 10), 120000);
  assert.equal(sandbox.percentOf(5, 10), 1); // 0.5 paisa rounds up
  assert.equal(sandbox.percentOf(4, 10), 0); // 0.4 paisa rounds down
  assert.equal(sandbox.percentOf(1080000, 5), 54000);
});

test("formatPKR adds commas and two decimals", () => {
  const { sandbox } = loadApp();
  assert.equal(sandbox.formatPKR(12500), "PKR 12,500.00");
  assert.equal(sandbox.formatPKR(0), "PKR 0.00");
  assert.equal(sandbox.formatPKR(1234567.5), "PKR 1,234,567.50");
});

/* ---------- cart totals ---------- */

test("computeTotals: README example 12,000 -> 11,340", () => {
  const { sandbox, state } = loadApp();
  state.products = [product({ sellingPrice: 1200, quantity: 100 })];
  state.cart = [{ productId: "PRD-001", quantity: 10 }];
  const t = sandbox.computeTotals();
  assert.equal(t.subtotal, 12000);
  assert.equal(t.discount, 1200);
  assert.equal(t.discounted, 10800);
  assert.equal(t.tax, 540);
  assert.equal(t.grand, 11340);
});

test("computeTotals: discount boundary is 10,000 (9,999.99 gets none)", () => {
  const { sandbox, state } = loadApp();
  state.products = [product({ sellingPrice: 9999.99, quantity: 5 }), product({ id: "PRD-002", sellingPrice: 10000, quantity: 5 })];

  state.cart = [{ productId: "PRD-001", quantity: 1 }];
  let t = sandbox.computeTotals();
  assert.equal(t.discount, 0);
  assert.equal(t.tax, 500); // 5% of 9,999.99 = 499.9995 -> 500.00

  state.cart = [{ productId: "PRD-002", quantity: 1 }];
  t = sandbox.computeTotals();
  assert.equal(t.discount, 1000);
  assert.equal(t.discounted, 9000);
  assert.equal(t.tax, 450);
  assert.equal(t.grand, 9450);
});

test("computeTotals: empty cart gives all zeros", () => {
  const { sandbox } = loadApp();
  const t = sandbox.computeTotals();
  assert.deepEqual(JSON.parse(JSON.stringify(t)), { subtotal: 0, discount: 0, discounted: 0, tax: 0, grand: 0 });
});

/* ---------- validation of saved data ---------- */

test("sanitizeProduct accepts a good product and trims text", () => {
  const { sandbox } = loadApp();
  const clean = sandbox.sanitizeProduct(product({ name: "  Wireless Mouse  " }));
  assert.equal(clean.name, "Wireless Mouse");
  assert.equal(clean.sellingPrice, 1800);
});

test("sanitizeProduct rejects broken products", () => {
  const { sandbox } = loadApp();
  const bad = [
    null,
    "text",
    [],
    product({ id: "" }),
    product({ name: "  " }),
    product({ category: "" }),
    product({ purchasePrice: 0 }),
    product({ sellingPrice: -5 }),
    product({ quantity: 1.5 }),
    product({ quantity: -1 }),
    product({ minStock: -1 }),
    product({ minStock: "abc" }),
  ];
  for (const raw of bad) {
    assert.equal(sandbox.sanitizeProduct(raw), null, JSON.stringify(raw));
  }
});

test("sanitizeSale keeps good items, skips bad ones and rejects a bad date", () => {
  const { sandbox } = loadApp();
  const sale = {
    id: "SALE-0001",
    timestamp: "2026-11-09T05:00:00.000Z",
    total: 100,
    items: [
      { productId: "PRD-001", name: "Mouse", quantity: 2, price: 50 },
      { productId: "PRD-002", name: "Bad", quantity: 0, price: 50 },
      { productId: "", name: "Bad", quantity: 1, price: 50 },
    ],
  };
  const clean = sandbox.sanitizeSale(sale);
  assert.equal(clean.items.length, 1);
  assert.equal(clean.items[0].name, "Mouse");
  assert.equal(sandbox.sanitizeSale(Object.assign({}, sale, { timestamp: "not a date" })), null);
  assert.equal(sandbox.sanitizeSale(Object.assign({}, sale, { total: "x" })), null);
});

/* ---------- ids ---------- */

test("nextNumber returns the biggest number plus one", () => {
  const { sandbox } = loadApp();
  assert.equal(sandbox.nextNumber([]), 1);
  assert.equal(sandbox.nextNumber(["PRD-001", "PRD-005", "PRD-002"]), 6);
});

test("generateProductId never reuses the id of a deleted product that is in sales history", () => {
  const { sandbox, state } = loadApp();
  state.products = [product({ id: "PRD-001" })];
  state.sales = [{ id: "SALE-0001", timestamp: "2026-11-09T05:00:00.000Z", total: 1, items: [{ productId: "PRD-003", name: "Old", quantity: 1, price: 1 }] }];
  assert.equal(sandbox.generateProductId(), "PRD-004");
});

test("generateSaleId pads to four digits", () => {
  const { sandbox, state } = loadApp();
  assert.equal(sandbox.generateSaleId(), "SALE-0001");
  state.sales = [{ id: "SALE-0009" }];
  assert.equal(sandbox.generateSaleId(), "SALE-0010");
});

/* ---------- stock and reports ---------- */

test("stockStatus: out, low and ok", () => {
  const { sandbox } = loadApp();
  assert.equal(sandbox.stockStatus(product({ quantity: 0 })), "out");
  assert.equal(sandbox.stockStatus(product({ quantity: 5, minStock: 5 })), "low");
  assert.equal(sandbox.stockStatus(product({ quantity: 6, minStock: 5 })), "ok");
});

test("inventoryValue is the sum of purchase price x quantity", () => {
  const { sandbox, state } = loadApp();
  state.products = [product({ purchasePrice: 1200, quantity: 25 }), product({ id: "PRD-002", purchasePrice: 0.1, quantity: 3 })];
  assert.equal(sandbox.inventoryValue(), 30000.3);
});

test("getTopSeller picks most units, and revenue breaks a tie", () => {
  const { sandbox, state } = loadApp();
  const sale = (id, items) => ({ id, timestamp: "2026-11-09T05:00:00.000Z", total: 1, items });
  state.sales = [
    sale("SALE-0001", [{ productId: "PRD-001", name: "A", quantity: 3, price: 10 }]),
    sale("SALE-0002", [{ productId: "PRD-002", name: "B", quantity: 3, price: 20 }]),
  ];
  assert.equal(sandbox.getTopSeller().name, "B"); // same units, more revenue
  state.sales.push(sale("SALE-0003", [{ productId: "PRD-001", name: "A", quantity: 1, price: 10 }]));
  assert.equal(sandbox.getTopSeller().name, "A"); // more units
  state.sales = [];
  assert.equal(sandbox.getTopSeller(), null);
});

test("saleDateKey uses the local date as YYYY-MM-DD", () => {
  const { sandbox } = loadApp();
  const timestamp = new Date(2026, 9, 21, 2, 30).toISOString(); // 21 Oct 2026, 02:30 local time
  assert.equal(sandbox.saleDateKey({ timestamp }), "2026-10-21");
});

/* ---------- cart rules ---------- */

test("cartAdd never goes above the available stock", () => {
  const { sandbox, state } = loadApp();
  state.products = [product({ quantity: 2 })];
  sandbox.cartAdd("PRD-001");
  sandbox.cartAdd("PRD-001");
  sandbox.cartAdd("PRD-001");
  assert.equal(state.cart[0].quantity, 2);
});

test("cartChange below 1 removes the line", () => {
  const { sandbox, state } = loadApp();
  state.products = [product()];
  state.cart = [{ productId: "PRD-001", quantity: 1 }];
  sandbox.cartChange("PRD-001", -1);
  assert.equal(state.cart.length, 0);
});

test("pruneCart drops deleted products and trims to stock", () => {
  const { sandbox, state } = loadApp();
  state.products = [product({ quantity: 3 })];
  state.cart = [{ productId: "PRD-001", quantity: 9 }, { productId: "PRD-404", quantity: 1 }];
  sandbox.pruneCart();
  assert.deepEqual(JSON.parse(JSON.stringify(state.cart)), [{ productId: "PRD-001", quantity: 3 }]);
});

/* ---------- loading from storage ---------- */

test("loadList skips broken entries and duplicate ids", () => {
  const { sandbox } = loadApp({
    storage: { [PRODUCTS_KEY]: JSON.stringify([product(), product(), product({ id: "PRD-002", quantity: -1 })]) },
  });
  const list = sandbox.readList(PRODUCTS_KEY, sandbox.sanitizeProduct, true);
  assert.equal(list.length, 1);
});

test("damaged JSON is backed up and the app starts empty", () => {
  const { sandbox, store } = loadApp({ storage: { [PRODUCTS_KEY]: "{not json" } });
  assert.equal(sandbox.readList(PRODUCTS_KEY, sandbox.sanitizeProduct, true).length, 0);
  assert.equal(store[PRODUCTS_KEY + "_corrupt_backup"], "{not json");
});

/* ---------- checkout ---------- */

function appWithCart(quantity) {
  const app = loadApp({ storage: { [PRODUCTS_KEY]: JSON.stringify([product({ quantity: 5 })]) } });
  app.state.cart = [{ productId: "PRD-001", quantity }];
  return app;
}

test("checkout reduces stock, records the sale and empties the cart", () => {
  const app = appWithCart(2);
  app.sandbox.checkout();
  assert.equal(app.state.products[0].quantity, 3);
  assert.equal(app.state.sales.length, 1);
  assert.equal(app.state.sales[0].id, "SALE-0001");
  assert.equal(app.state.cart.length, 0);
  assert.equal(JSON.parse(app.store[PRODUCTS_KEY])[0].quantity, 3);
  assert.equal(JSON.parse(app.store[SALES_KEY]).length, 1);
});

test("checkout refuses an empty cart and too much quantity, and changes nothing", () => {
  const empty = appWithCart(1);
  empty.state.cart = [];
  empty.sandbox.checkout();
  assert.match(empty.state.ui.checkoutError, /empty/i);

  const tooMany = appWithCart(9);
  tooMany.sandbox.checkout();
  assert.match(tooMany.state.ui.checkoutError, /Not enough stock/);
  assert.equal(tooMany.state.products[0].quantity, 5);
  assert.equal(tooMany.state.sales.length, 0);
});

test("checkout rolls everything back when saving the sale fails", () => {
  const app = appWithCart(2);
  app.control.failKey = SALES_KEY; // the second write fails
  app.sandbox.checkout();
  assert.match(app.state.ui.checkoutError, /could not be saved/);
  assert.equal(app.state.products[0].quantity, 5); // stock restored in memory
  assert.equal(app.state.sales.length, 0);
  assert.equal(app.state.cart.length, 1); // cart is kept so the user can try again
  assert.equal(JSON.parse(app.store[PRODUCTS_KEY])[0].quantity, 5); // and in storage
});
