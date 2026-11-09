# Smart Inventory & Sales Management System

A browser-based inventory and sales application for a small shop (Shan & Company). It lets the shop manage products, process sales through a cart, monitor stock levels, and review past sales. It is built with HTML, CSS and vanilla JavaScript only, and all data is saved in the browser.

## Table of contents

1. [Tech stack](#tech-stack)
2. [How to open and run](#how-to-open-and-run)
3. [Project structure](#project-structure)
4. [Screens](#screens)
5. [Feature details](#feature-details)
6. [Business rules](#business-rules)
7. [Data storage](#data-storage)
8. [Expected user flow](#expected-user-flow)
9. [Assumptions](#assumptions)
10. [Limitations](#limitations)
11. [Automated tests](#automated-tests)

## Tech stack

| Part | Used |
|------|------|
| Structure | HTML5 |
| Styling | CSS3 |
| Logic | Vanilla JavaScript (ES6+) |
| Storage | Browser `localStorage` |

No frameworks, no libraries, no backend, no build tools. The app itself needs nothing but a browser. Node.js is used only to run the optional automated tests (see [Automated tests](#automated-tests)).

## How to open and run

1. Download or copy the project folder. It must contain `index.html`, `styles.css` and `app.js` together.
2. Double-click `index.html`, or right-click it and choose **Open with** your browser (Chrome, Edge, Firefox or Safari).
3. The app opens on the Dashboard. Use the menu to move between screens.

No installation or server is needed. To start fresh, clear the site data (localStorage) of the page in your browser's developer tools.

## Project structure

```
project-folder/
  index.html   page layout and the menu
  styles.css   styling (desktop and mobile)
  app.js       all the logic
  README.md    this file
  package.json only holds the "npm test" shortcut (no dependencies)
  tests/
    load-app.js   loads app.js inside a fake browser so Node can test it
    app.test.js   the automated tests
```

### How the code is organised

The app is a single-page application built around one idea:

```
state (data)  ->  page function (returns HTML)  ->  #app
```

- All data lives in one `state` object.
- Each screen is a function that turns `state` into HTML: `renderDashboard`, `renderProducts`, `renderSale`, `renderHistory`.
- `render()` draws the current screen. After any change to `state`, `render()` is called again.
- The screen is chosen by the URL hash (`#/dashboard`, `#/products`, `#/sale`, `#/history`), so the Back button, Refresh and shared links work.
- Clicks, typing and form submits are handled by one listener each on `#app`, and buttons say what they do with a `data-action` attribute.

## Screens

| Screen | What it is for |
|--------|----------------|
| **Dashboard** | Business overview: product count, revenue, orders, low-stock count, top seller, low-stock alerts |
| **Products** | Add, search, filter, sort, edit and delete products |
| **New Sale** | Pick products, manage the cart, and check out |
| **Sales History** | Review completed sales, search by sale ID, filter by date |

## Feature details

### Product management

- Each product has: unique product ID, name, category, purchase price, selling price, current quantity and minimum stock threshold.
- Product IDs are created automatically in the form `PRD-001`, `PRD-002`, and so on. The ID field is read-only, so **duplicate IDs cannot be entered**. The ID is generated again at the moment of saving, so two browser tabs cannot create the same ID.
- Products are shown in a table with stock value and a status badge: **In Stock**, **Low Stock** or **Out of Stock**.
- **Search** works on product ID, name and category.
- **Filter** by category with the dropdown. **Sort** by name, selling price or quantity.
- **Edit** opens the same form with the product's current values.
- **Delete** asks for confirmation: the first click changes the button to **Sure?**, and a second click within 3 seconds deletes the product. If you do nothing, the button goes back to normal.
- **Validation** messages are shown in the form:
  - name and category are required
  - purchase and selling price must be greater than zero
  - quantity and minimum stock must be whole numbers, zero or more
  - prices and quantity have upper limits (see Business rules)
- **Warnings** (the product can still be saved): if the selling price is lower than the purchase price, or a product with the same name (ignoring capital letters) already exists in the same category, the form shows a warning and the button changes to **Save Anyway**. Changing any value asks again.

### Sales and cart

- Every product on the New Sale screen has an **Add to Cart** button. It is disabled when the product is out of stock or the cart already holds all the available stock.
- In the cart you can increase, decrease or remove each item. Each line shows its unit price and line total. Decreasing below 1 removes the item.
- Cart quantity can never go above the available stock.
- The cart summary shows subtotal, discount, discounted subtotal, tax and grand total as separate lines.
- **Checkout** checks everything first (cart not empty, every product still exists, every quantity is valid and still in stock). Only if all checks pass does it create the sale and reduce the stock. If any check fails, an error is shown and **nothing is changed**, so a failed checkout never partly updates the inventory. The stock and the sale are also saved together: if saving either one fails (for example storage is full), both are rolled back, an error is shown, and no "Sale completed" message appears.
- A completed sale gets a unique ID (`SALE-0001`, `SALE-0002`, ...) and a timestamp.

### Inventory monitoring

- **Low stock**: a product is low when its quantity is less than or equal to its minimum stock.
- **Out of stock**: a product with quantity 0 is clearly marked **Out of Stock** in the products table, on the sale screen and in the dashboard alerts.
- Stock can never go below zero. Checkout refuses quantities above the available stock, and the cart is trimmed automatically if stock changes.
- **Total inventory cost value** is the sum of `purchase price x quantity` for all products, shown under the products table.

### Dashboard and sales history

- The dashboard shows total products, total sales revenue, completed orders and the low-stock product count.
- **Top-selling product** is the one with the most total units sold. If two products have the same units, the one with more revenue wins.
- **Low-stock alerts** list every product at or below its minimum, with the lowest stock first.
- Sales history lists each sale with its ID, date and time, items, quantities and final amount. You can search by sale ID and filter by date, and a **Clear Filters** button resets both.
- Helpful empty states are shown everywhere (no products, empty cart, no sales, no search results).

### Interface

- The layout is responsive and is meant to be usable on both desktop and mobile browsers.
- Buttons have accessible labels, the page heading receives focus after changing screens, and status messages are announced to screen readers.

## Business rules

| Rule | Value |
|------|-------|
| Discount | 10% when the subtotal is **PKR 10,000 or more** |
| Tax | 5% of the **discounted** subtotal |
| Grand total | discounted subtotal + tax |
| Low stock | quantity <= minimum stock |
| Out of stock | quantity = 0 |
| Maximum price | PKR 10,000,000 |
| Maximum quantity | 100,000 |
| Delete confirmation window | 3 seconds |

Example: subtotal PKR 12,000 -> discount PKR 1,200 -> discounted subtotal PKR 10,800 -> tax PKR 540 -> **grand total PKR 11,340**.

All money is calculated in paisa (whole numbers) and converted to PKR only for display, so rounding errors from decimal numbers do not appear. Percentages round half up to the nearest paisa.

### Example product

| Field | Value |
|-------|-------|
| Product ID | PRD-001 |
| Name | Wireless Mouse |
| Category | Electronics |
| Purchase Price | PKR 1,200 |
| Selling Price | PKR 1,800 |
| Quantity | 25 |
| Minimum Stock | 5 |

## Data storage

Products and completed sales are saved in the browser's `localStorage` under two keys:

- `smart_inventory_products_v1`
- `smart_inventory_sales_v1`

Saved data is restored when the page is refreshed or reopened in the same browser.

**Handling missing or invalid data:**

- If nothing is saved yet, the app starts with empty lists.
- Every saved entry is checked when loading. Entries with missing or wrong values are skipped, and duplicate product IDs are dropped.
- If the stored text is not valid data at all, a copy is first kept under `<key>_corrupt_backup`, and the app starts with an empty list instead of crashing.
- If localStorage is not available (for example some private modes), the app still works for the session and shows a warning that changes will be lost on refresh.
- If the app is open in two tabs, a change in one tab is loaded in the other, and important actions (save, delete, checkout) always load the newest data first.

## Expected user flow

1. Open `index.html` and look at the Dashboard (all values start at zero).
2. Go to **Products**, click **+ Add Product** and add a few products, for example the Wireless Mouse above. Check them in the table.
3. Go to **New Sale**, add several products to the cart and change quantities. Check the subtotal, discount, tax and grand total.
4. Click **Checkout**. A confirmation message appears with the sale ID.
5. Go back to **Products** and check that the stock quantities went down.
6. Open **Sales History** and find the completed order.
7. Refresh the browser. The products, stock and sales are all still there.

## Assumptions

- The shop works in one currency only, **PKR**.
- The discount is applied when the subtotal is **equal to or above** PKR 10,000, and tax is added **after** the discount.
- Purchase and selling prices can have up to two decimal places.
- Product IDs and sale IDs are made automatically by the app. The user does not type them, which is how duplicate IDs are prevented.
- A product's ID is never reused after deletion, even if its sales are still in the history.
- Sales store a copy of each product's name and price at the time of sale, so history stays correct if a product is later edited or deleted.
- Dates and times are shown in the browser's local time zone.
- A product whose quantity is 0 counts as low stock as well as out of stock, so it appears in the low-stock count and alerts.
- One browser is treated as one shop. Data is private to that browser and that device.

## Limitations

- **No backend or database.** Data is stored only in the browser's localStorage. It is not shared between browsers or devices, and it is lost if the browser's site data is cleared.
- **Storage size.** localStorage has a limit of a few megabytes, which is enough for a small shop but not for very large catalogues or years of sales.
- **The cart is not saved.** It lives in memory only, so an unfinished cart is empty after a refresh. Products and completed sales are saved.
- **No users or login.** Anyone who opens the app in that browser can change the data.
- **Sales cannot be edited, cancelled or refunded** after checkout.
- **Product edits do not change old sales.** Price changes apply only to future sales.
- **IDs restart if all data is cleared.** IDs use the highest existing number plus one, so after clearing all products and sales the numbering starts again from 001.
- **Discount, tax rate, thresholds and limits are constants in `app.js`.** There is no settings screen to change them.
- **Only the Dashboard figures and the history list show reports.** There are no charts or export options (CSV or PDF) and no receipt printing.
- **Search** in the products screen is a simple text match and does not tolerate spelling mistakes.

## Automated tests

The money, validation, ID, cart and checkout logic is covered by automated tests that use Node's built-in test runner (`node --test`). No packages need to be installed.

**How to run them** (needs Node.js 18 or newer):

```
node --test
```

or `npm test`. The tests do not open a browser. `tests/load-app.js` runs `app.js` inside a small fake browser (a fake `localStorage` and a fake page), so the real application code is tested, not a copy.

**What is tested (24 tests):**

- **Money**: `toPaisa`, `percentOf` (half-up rounding) and `formatPKR`.
- **Totals**: the README example (12,000 -> 11,340), the discount boundary (PKR 9,999.99 gets no discount, PKR 10,000 does), and an empty cart.
- **Saved-data checks**: `sanitizeProduct` and `sanitizeSale` accept good data and reject broken data; duplicate IDs are dropped; damaged JSON is backed up under `<key>_corrupt_backup`.
- **IDs**: `nextNumber`, product IDs never reuse a deleted product's ID found in sales history, and sale IDs are padded to four digits.
- **Stock and reports**: low-stock and out-of-stock status, inventory cost value, top-selling product (including the revenue tie-break) and the local-date key used by the sales date filter.
- **Cart**: quantity can never go above stock, decreasing below 1 removes the line, and the cart is trimmed when stock changes.
- **Checkout**: a good checkout reduces stock and records the sale; an empty cart or too much quantity changes nothing; and if saving the sale fails, stock, sales and the cart are all rolled back.

**What is not tested:** how the pages look and the clicks and typing in a real browser. The screens were checked by hand using the user flow above. The functions that only build HTML are also not tested one by one.
