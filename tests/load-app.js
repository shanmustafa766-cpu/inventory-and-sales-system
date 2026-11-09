
"use strict";
// Loads app.js inside a fake browser (no real DOM), so its functions can be tested with node --test.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadApp(options = {}) {
  const store = Object.assign({}, options.storage || {});
  const control = { failKey: null }; // a localStorage key whose writes should fail

  const localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => {
      if (control.failKey && k === control.failKey) throw new Error("storage full");
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  };

  const elements = {};
  const makeElement = () => ({
    textContent: "",
    innerHTML: "",
    addEventListener() {},
    contains: () => false,
    querySelectorAll: () => [],
  });

  const sandbox = {
    localStorage,
    document: {
      getElementById: (id) => elements[id] || (elements[id] = makeElement()),
      querySelectorAll: () => [],
      activeElement: null,
      title: "",
    },
    window: {
      location: { hash: "#/dashboard" },
      history: { replaceState() {} },
      addEventListener() {},
      scrollTo() {},
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
    console,
  };
  vm.createContext(sandbox);

  const code = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  vm.runInContext(code, sandbox);

  // `const` values such as `state` are not properties of the sandbox, so we read them through eval.
  const run = (expression) => vm.runInContext(expression, sandbox);
  return { sandbox, store, control, run, state: run("state") };
}

module.exports = { loadApp };
