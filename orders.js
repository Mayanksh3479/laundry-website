

/* ==========================================================================
   orders.js  |  Super Care Dry Cleaners  |  "My Orders" page
   --------------------------------------------------------------------------
   What this file does:
     1. Checks the customer is logged in (Supabase auth).
     2. Loads their orders (pickup_requests + items + status history).
     3. Renders the summary card, "Total Amount Due" card and order cards.
     4. Lets the customer pick a payment method (Cash on delivery / UPI).
     5. Listens for live changes so staff updates show up without a refresh.

   Data notes:
     - Prices are NOT calculated here. The page only displays
       pickup_requests.total_amount, which staff must set.
     - An order counts as "priced" only when total_amount is greater than 0
       (see hasPrice). null and 0 both mean "price not decided yet".


   ========================================================================== */
// ---------------------------------------------------------------------
// Supabase connection
// ---------------------------------------------------------------------
const SUPABASE_URL = "https://ydcawwkjybtnhicwfqxk.supabase.co";
const SUPABASE_KEY = "sb_publishable_v3aYAOeHqStdF7gnl3QE0w_p5LPkKgt";

// --------------------------------------------------------------------------
// Supabase client
// --------------------------------------------------------------------------
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// --------------------------------------------------------------------------
// Page / storage settings
// --------------------------------------------------------------------------
const LOGIN_PAGE = "login.html";
const PICKUP_PAGE = "index.html#pickup";
const PHOTO_BUCKET = "request-photos"; // Supabase storage bucket for item photos
const PHOTO_LINK_SECONDS = 3600; // signed photo links stay valid for 1 hour
const REFRESH_DELAY = 900; // ms to wait before re-fetching after a live change

// --------------------------------------------------------------------------
// Payment settings
// --------------------------------------------------------------------------
// Put your real UPI ID here (e.g. "shopname@okhdfcbank").
// While it is still the placeholder, the "Pay online (UPI)" button stays hidden.
const UPI_ID = "78304095644@axl";
const UPI_NAME = "Super Care Dry Cleaners";
const UPI_ENABLED = UPI_ID.indexOf("@") > 0;
const PAYMENT_LABELS = { cod: "Cash on delivery", upi: "UPI" };

// --------------------------------------------------------------------------
// Order progress steps (order matters: this is the left-to-right timeline)
//   value      -> status stored in the database
//   label      -> text under the timeline dot
//   badge      -> text in the coloured badge on the card
//   activeText -> small text shown while this step is the current one
// --------------------------------------------------------------------------
const STEPS = [
  { value: "pending", label: "Pickup Scheduled", badge: "Pickup Scheduled", activeText: "" },
  { value: "picked_up", label: "Picked Up", badge: "Picked Up", activeText: "Collected" },
  { value: "washing", label: "Cleaning", badge: "In Cleaning", activeText: "In Progress" },
  { value: "ready", label: "Ready for Delivery", badge: "Ready for Delivery", activeText: "Ready now" },
  { value: "delivered", label: "Delivered", badge: "Delivered", activeText: "" },
];

// --------------------------------------------------------------------------
// Inline SVG icons used inside the order cards
// --------------------------------------------------------------------------
const ICONS = {
  calendar:
    '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="3"></rect><path d="M8 3v4M16 3v4M3.5 10h17M8 14h2M12 14h2M8 17h2"></path></svg>',
  shirt:
    '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3 3 6l2.5 4L8 9v12h8V9l2.5 1L21 6l-5-3c-.6 1.6-2 2.5-4 2.5S8.6 4.6 8 3z"></path></svg>',
  arrow:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>',
};

// --------------------------------------------------------------------------
// DOM references (all ids come from orders.html)
// --------------------------------------------------------------------------
const ordersList = document.getElementById("orders-list");
const ordersMessage = document.getElementById("orders-message");
const summaryTitle = document.getElementById("summary-title");
const summarySub = document.getElementById("summary-sub");
const countActive = document.getElementById("count-active");
const countCompleted = document.getElementById("count-completed");
const searchInput = document.getElementById("order-search");
const filterSelect = document.getElementById("order-filter");
const accountMenu = document.getElementById("account-menu");
const accountEmail = document.getElementById("account-email");
const logoutButton = document.getElementById("logout-btn");
const dueCard = document.getElementById("due-card");
const dueAmount = document.getElementById("due-amount");
const dueSub = document.getElementById("due-sub");
const dueBreakdown = document.getElementById("due-breakdown");

// --------------------------------------------------------------------------
// App state
// --------------------------------------------------------------------------
let currentUserId = null; // set after we confirm the user is logged in
let allOrders = []; // every order for this customer
let photoUrls = {}; // map of storage path -> signed photo URL
let openOrders = new Set(); // ids of orders whose "View details" panel is open
let refreshTimer = null; // debounce timer for live refreshes

// ==========================================================================
// Photo lightbox (full-size photo popup)
// ==========================================================================
const lightbox = document.createElement("dialog");
lightbox.className = "photo-lightbox";

const lightboxClose = document.createElement("button");
lightboxClose.type = "button";
lightboxClose.className = "lightbox-close";
lightboxClose.textContent = "Close";

const lightboxImage = document.createElement("img");
lightboxImage.className = "lightbox-image";
lightboxImage.alt = "Selected photo";

lightbox.append(lightboxClose, lightboxImage);
document.body.appendChild(lightbox);

lightboxClose.addEventListener("click", function () {
  lightbox.close();
});

// Clicking the dark backdrop (outside the image) also closes it
lightbox.addEventListener("click", function (event) {
  if (event.target === lightbox) lightbox.close();
});

function openPhoto(url) {
  lightboxImage.src = url;
  lightbox.showModal();
}

// ==========================================================================
// Log out confirmation popup (asks first, in case of an accidental tap)
// ==========================================================================
const logoutDialog = document.createElement("dialog");
logoutDialog.className = "logout-dialog";

const logoutDialogTitle = document.createElement("h3");
logoutDialogTitle.className = "logout-dialog-title";
logoutDialogTitle.textContent = "Log out?";

const logoutDialogText = document.createElement("p");
logoutDialogText.className = "logout-dialog-text";
logoutDialogText.textContent = "Are you sure you want to log out of your account?";

const logoutStayButton = document.createElement("button");
logoutStayButton.type = "button";
logoutStayButton.className = "logout-stay";
logoutStayButton.textContent = "Stay logged in";

const logoutConfirmButton = document.createElement("button");
logoutConfirmButton.type = "button";
logoutConfirmButton.className = "logout-confirm";
logoutConfirmButton.textContent = "Yes, log out";

const logoutDialogActions = document.createElement("div");
logoutDialogActions.className = "logout-dialog-actions";
logoutDialogActions.append(logoutStayButton, logoutConfirmButton);

logoutDialog.append(logoutDialogTitle, logoutDialogText, logoutDialogActions);
document.body.appendChild(logoutDialog);

logoutStayButton.addEventListener("click", function () {
  logoutDialog.close();
});

logoutDialog.addEventListener("click", function (event) {
  if (event.target === logoutDialog) logoutDialog.close();
});

// ==========================================================================
// Small DOM helpers
// ==========================================================================

// Creates an element with an optional class and text.
// textContent is used (not innerHTML) so database values can never inject HTML.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Creates a <span> containing one of the SVG icons from ICONS
function icon(name, className) {
  const span = el("span", className);
  span.innerHTML = ICONS[name]; // safe: ICONS is our own constant, not user data
  return span;
}

// ==========================================================================
// Formatting helpers
// ==========================================================================

// "2026-10-23T..." -> "23 Oct 2026"
function formatDay(isoText) {
  if (!isoText) return "";

  return new Date(isoText).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// "2026-10-23T..." -> "23 Oct 2026, 4:26 pm"
function formatDateTime(isoText) {
  if (!isoText) return "";

  return new Date(isoText).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// 1250 -> "₹1,250"
function formatMoney(value) {
  return "₹" + Number(value).toLocaleString("en-IN");
}

// ==========================================================================
// Order helpers
// ==========================================================================

// Customer-facing order number. order_no 7 -> "SC1007".
// Falls back to a short id if the order has no number yet.
function orderLabel(order) {
  if (order.order_no !== null && order.order_no !== undefined) {
    return "SC" + (1000 + Number(order.order_no));
  }

  return order.id.slice(0, 8).toUpperCase();
}

// Finds the STEPS entry that matches a status value
function getStep(status) {
  return STEPS.find(function (step) {
    return step.value === status;
  });
}

// Position of a status in the timeline (0 = first step, -1 = unknown status)
function stepIndex(status) {
  return STEPS.findIndex(function (step) {
    return step.value === status;
  });
}

function isDelivered(order) {
  return order.status === "delivered";
}

// An order is "priced" only once staff have set a real amount.
// FIX: total_amount = 0 used to count as priced, which produced a fake
// "₹0 unpaid order". Now null, undefined and 0 all mean "not priced yet".
function hasPrice(order) {
  return (
    order.total_amount !== null &&
    order.total_amount !== undefined &&
    Number(order.total_amount) > 0
  );
}

// Categories are stored as "Group - Name" (e.g. "Coat - Single").
// This splits them so we can show the group and the name separately.
function splitCategory(category) {
  const parts = String(category).split(" - ");

  if (parts.length > 1) {
    return { group: parts[0], name: parts.slice(1).join(" - ") };
  }

  return { group: "", name: category };
}

// Builds a { status: firstDateReached } map from the status history,
// used to show the date under each completed timeline step.
function statusDates(order) {
  const map = {};

  (order.order_status_history || []).forEach(function (entry) {
    // Keep the earliest date if a status appears more than once
    if (!map[entry.status] || entry.changed_at < map[entry.status]) {
      map[entry.status] = entry.changed_at;
    }
  });

  // Every order starts as "pending", so use its creation time as a fallback
  if (!map.pending) map.pending = order.created_at;

  return map;
}

// ==========================================================================
// Order card builders
// ==========================================================================

// Builds the 5-step progress timeline for an order
function buildSteps(order) {
  const current = stepIndex(order.status);
  const delivered = isDelivered(order);
  const dates = statusDates(order);
  const list = el("ol", "steps");

  STEPS.forEach(function (step, index) {
    const item = el("li", "step");

    // done = already passed, current = where the order is now, future = not yet
    let state = "future";
    if (index < current || (index === current && delivered)) state = "done";
    else if (index === current) state = "current";

    if (index <= current) item.classList.add("reached");
    item.classList.add(state);

    // Small text under the step name
    let sub = "Pending";

    if (state === "done") {
      sub = dates[step.value] ? formatDay(dates[step.value]) : "Completed";
    } else if (state === "current") {
      sub = index === 0 ? formatDay(dates.pending) : step.activeText;
    }

    item.append(
      el("span", "step-dot", state === "done" ? "✓" : ""),
      el("span", "step-name", step.label),
      el("span", "step-sub", sub)
    );

    list.appendChild(item);
  });

  return list;
}

// A clickable photo that opens the lightbox
function buildPhotoButton(url, className, altText) {
  const button = el("button", className);
  button.type = "button";
  button.setAttribute("aria-label", "View photo");

  const image = el("img");
  image.src = url;
  image.alt = altText;
  image.loading = "lazy";

  button.appendChild(image);

  button.addEventListener("click", function () {
    openPhoto(url);
  });

  return button;
}

// One row inside "View details": photo, name, group, quantity, extra photos
function buildItem(item) {
  const parts = splitCategory(item.category);

  // Turn stored photo paths into signed URLs (skip any that failed to sign)
  const urls = (item.photo_paths || [])
    .map(function (path) {
      return photoUrls[path];
    })
    .filter(Boolean);

  const row = el("div", "order-item");

  if (urls.length > 0) {
    row.appendChild(buildPhotoButton(urls[0], "item-photo", parts.name));
  } else {
    // No photo: show the first letter of the item name as a placeholder
    row.appendChild(el("div", "item-photo-empty", parts.name.charAt(0).toUpperCase()));
  }

  const details = el("div", "item-details");
  details.appendChild(el("div", "item-name", parts.name));

  if (parts.group) {
    details.appendChild(el("div", "item-group", parts.group));
  }

  details.appendChild(el("div", "item-qty", "Qty: " + item.quantity));

  // Any photos after the first are shown as small thumbnails
  if (urls.length > 1) {
    const extra = el("div", "item-extra");

    urls.slice(1).forEach(function (url, index) {
      extra.appendChild(buildPhotoButton(url, "item-thumb", parts.name + " photo " + (index + 2)));
    });

    details.appendChild(extra);
  }

  row.appendChild(details);
  return row;
}

// The collapsible "View details" panel (dates + every item)
function buildDetails(order) {
  const panel = el("div", "order-details");
  panel.hidden = !openOrders.has(order.id); // remember open panels across re-renders

  const meta = el("div", "details-meta");

  const placed = el("span");
  placed.append("Order placed: ", el("strong", "", formatDateTime(order.created_at)));

  const deliverBy = el("span");
  deliverBy.append("Deliver back by: ", el("strong", "", formatDateTime(order.delivery_time)));

  meta.append(placed, deliverBy);
  panel.appendChild(meta);

  (order.request_items || []).forEach(function (item) {
    panel.appendChild(buildItem(item));
  });

  return panel;
}

// Builds one full order card
function buildOrderCard(order) {
  const delivered = isDelivered(order);
  const step = getStep(order.status);
  const items = order.request_items || [];
  const dates = statusDates(order);

  // Total number of pieces across all items
  const pieces = items.reduce(function (sum, item) {
    return sum + Number(item.quantity || 0);
  }, 0);

  // Unique item names, e.g. "Single, Shirt"
  const names = Array.from(
    new Set(
      items.map(function (item) {
        return splitCategory(item.category).name;
      })
    )
  ).join(", ");

  const card = el("article", "order-card " + (delivered ? "is-delivered" : "is-active"));

  // ---- Top row: order number, booking date, status badge ----
  const top = el("div", "order-top");
  const titleBox = el("div");
  titleBox.append(
    el("h3", "order-title", "Order #" + orderLabel(order)),
    el("p", "order-booked", "Booked on " + formatDay(order.created_at))
  );
  top.append(titleBox, el("span", "badge badge-" + order.status, step ? step.badge : order.status));

  // ---- Bottom row: items | date | amount | button ----
  const bottom = el("div", "order-bottom");

  // Items cell
  const itemsCell = el("div", "bottom-cell cell-items");
  const itemsText = el("div", "cell-text");
  itemsText.append(
    el("div", "cell-title", pieces + (pieces === 1 ? " item" : " items")),
    el("div", "cell-sub names", names)
  );
  itemsCell.append(icon("shirt", "cell-icon"), itemsText);

  // Date cell (delivery date once delivered, otherwise the estimate)
  const dateCell = el("div", "bottom-cell cell-date");
  const dateText = el("div", "cell-text");
  dateText.append(
    el("div", "cell-sub", delivered ? "Delivered on" : "Estimated delivery"),
    el("div", "cell-title", formatDay(delivered ? dates.delivered || order.delivery_time : order.delivery_time))
  );
  dateCell.append(icon("calendar", "cell-icon"), dateText);

  // Amount cell: the price + payment pill, or a note if staff haven't priced it
  const amountCell = el("div", "bottom-cell cell-amount");
  if (hasPrice(order)) {
    const amountBox = el("div", "amount-box");
    amountBox.append(
      el("div", "amount", formatMoney(order.total_amount)),
      paymentPill(order)
    );
    amountCell.appendChild(amountBox);
  } else {
    amountCell.appendChild(el("div", "amount-note", "Price shared after cleaning"));
  }

  // "View details" button cell
  const buttonCell = el("div", "bottom-cell cell-button");
  const detailsButton = el("button", "details-btn" + (openOrders.has(order.id) ? " open" : ""));
  detailsButton.type = "button";

  const buttonLabel = el("span", "", openOrders.has(order.id) ? "Hide details" : "View details");
  detailsButton.append(buttonLabel, icon("arrow", "arrow-icon"));
  buttonCell.appendChild(detailsButton);

  bottom.append(itemsCell, dateCell, amountCell, buttonCell);

  const details = buildDetails(order);

  // Toggle the details panel and remember its state for the next render
  detailsButton.addEventListener("click", function () {
    details.hidden = !details.hidden;
    detailsButton.classList.toggle("open", !details.hidden);
    buttonLabel.textContent = details.hidden ? "View details" : "Hide details";

    if (details.hidden) openOrders.delete(order.id);
    else openOrders.add(order.id);
  });

  // Payment panel only exists for priced, unpaid orders
  const payPanel = buildPaymentPanel(order);

  card.append(top, buildSteps(order), bottom);
  if (payPanel) card.appendChild(payPanel);
  card.appendChild(details);
  return card;
}

// ==========================================================================
// Summary + "Total Amount Due" cards
// ==========================================================================

// Updates the "X active orders" heading and the In progress / Completed counts
function updateSummary() {
  const active = allOrders.filter(function (order) {
    return !isDelivered(order);
  }).length;

  const completed = allOrders.length - active;

  if (active === 0) {
    summaryTitle.textContent = "No active orders";
  } else {
    summaryTitle.textContent = active + (active === 1 ? " active order" : " active orders");
  }

  summarySub.textContent =
    allOrders.length === 0
      ? "Place your first pickup to get started."
      : "Keep track of every pickup and delivery.";

  countActive.textContent = String(active);
  countCompleted.textContent = String(completed);
}

// Money the customer still has to pay:
//   unpaid       = priced orders that are not marked as paid (these add to the total)
//   awaitingPrice = unpaid orders staff haven't priced yet (shown as a note only)
function updateDue() {
  const unpaid = allOrders.filter(function (order) {
    return !order.paid && hasPrice(order);
  });

  const awaitingPrice = allOrders.filter(function (order) {
    return !order.paid && !hasPrice(order);
  }).length;

  const total = unpaid.reduce(function (sum, order) {
    return sum + Number(order.total_amount);
  }, 0);

  // Hide the whole card if the customer has no orders at all
  dueCard.hidden = allOrders.length === 0;
  dueCard.classList.toggle("is-clear", unpaid.length === 0 && awaitingPrice === 0);
  dueAmount.textContent = formatMoney(total);

  // Sub-text, e.g. "1 unpaid order • 2 orders will be priced after cleaning"
  const parts = [];

  if (unpaid.length > 0) {
    parts.push(unpaid.length + (unpaid.length === 1 ? " unpaid order" : " unpaid orders"));
  }

  if (awaitingPrice > 0) {
    parts.push(
      awaitingPrice + (awaitingPrice === 1 ? " order" : " orders") + " will be priced after cleaning"
    );
  }

  dueSub.textContent = parts.length > 0 ? parts.join(" • ") : "You are all paid up. Thank you!";

  // Right-hand breakdown: one row per unpaid, priced order
  dueBreakdown.innerHTML = "";

  unpaid.forEach(function (order) {
    const row = el("div", "due-row");
    const method = PAYMENT_LABELS[order.payment_method];
    row.append(
      el("span", "", "Order #" + orderLabel(order) + (method ? " · " + method : "")),
      el("strong", "", formatMoney(order.total_amount))
    );
    dueBreakdown.appendChild(row);
  });
}

// ==========================================================================
// Payments
// ==========================================================================

// True on phones/tablets. UPI apps only exist there, so the upi:// link
// does nothing on a Windows/Mac computer.
function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// Builds the UPI deep link that opens Google Pay, Paytm, PhonePe or any UPI app
function upiLink(order) {
  return (
    "upi://pay?pa=" + UPI_ID +
    "&pn=" + encodeURIComponent(UPI_NAME) +
    "&am=" + Number(order.total_amount).toFixed(2) +
    "&cu=INR&tn=" + encodeURIComponent("Order " + orderLabel(order))
  );
}

// Small coloured label next to the price: Paid / Awaiting confirmation / Due
function paymentPill(order) {
  if (order.paid) {
    const how = PAYMENT_LABELS[order.payment_method];
    return el("span", "pay-pill pay-paid", how ? "Paid · " + how : "Paid");
  }

  if (order.payment_method === "upi" && order.upi_ref) {
    return el("span", "pay-pill pay-pending", "Awaiting confirmation");
  }

  return el("span", "pay-pill pay-due", "Due");
}

// Saves the customer's choice through a safe database function.
// Customers cannot edit orders directly (row-level security), so we call an RPC.
async function savePayment(order, method, ref) {
  const { error } = await db.rpc("set_payment_method", {
    p_order_id: order.id,
    p_method: method,
    p_ref: ref || null,
  });

  if (error) {
    console.log("Saving payment failed:", error.message);
    alert("Sorry, we could not save your payment choice. Please try again.");
    return false;
  }

  // Update the local copy so the UI changes instantly, then redraw
  order.payment_method = method;
  order.upi_ref = method === "upi" && ref ? ref : null;
  render();
  return true;
}

// A "Cash on delivery" / "Pay online (UPI)" choice button
function buildPayOption(order, method, symbol, label) {
  const button = el("button", "pay-option");
  button.type = "button";
  button.append(el("span", "pay-option-icon", symbol), el("span", "", label));

  button.addEventListener("click", function () {
    savePayment(order, method, null);
  });

  return button;
}

// "Choose another method" link: clears the saved method so options show again
function buildChangeLink(order) {
  const link = el("button", "pay-link", "Choose another method");
  link.type = "button";

  link.addEventListener("click", function () {
    savePayment(order, null, null);
  });

  return link;
}

// The payment box under an order card. It has four states:
//   1. no method chosen yet -> show the choices
//   2. cash on delivery     -> show a reminder
//   3. UPI + reference sent -> "payment submitted"
//   4. UPI, not paid yet    -> show UPI instructions and the reference form
function buildPaymentPanel(order) {
  // Nothing to pay if it's already paid or staff haven't set a price
  if (order.paid || !hasPrice(order)) return null;

  const panel = el("div", "pay-panel");
  const amount = formatMoney(order.total_amount);

  // State 1: no method chosen
  if (!order.payment_method) {
    panel.appendChild(el("p", "pay-title", "How would you like to pay " + amount + "?"));

    const options = el("div", "pay-options");
    options.appendChild(buildPayOption(order, "cod", "💵", "Cash on delivery"));

    // Only offer UPI once a real UPI ID has been configured
    if (UPI_ENABLED) {
      options.appendChild(buildPayOption(order, "upi", "📲", "Pay online (UPI)"));
    }

    panel.appendChild(options);
    return panel;
  }

  // State 2: cash on delivery
  if (order.payment_method === "cod") {
    panel.append(
      el("p", "pay-title", "Cash on delivery"),
      el("p", "pay-text", "Please keep " + amount + " ready. You pay when your clothes are delivered."),
      buildChangeLink(order)
    );
    return panel;
  }

  // State 3: UPI reference already submitted, waiting for staff to confirm
  if (order.upi_ref) {
    panel.append(
      el("p", "pay-title", "Payment submitted"),
      el("p", "pay-text", "Thank you! We will confirm your payment of " + amount + " shortly. Reference: " + order.upi_ref)
    );
    return panel;
  }

  // State 4: UPI chosen, customer still needs to pay
  panel.append(
    el("p", "pay-title", "Pay " + amount + " online with UPI"),
    el("p", "pay-text", "Pay to " + UPI_ID + " using Google Pay, Paytm, PhonePe or any UPI app. On a computer, copy the UPI ID and pay from your phone.")
  );

  const actions = el("div", "pay-actions");

  const openLink = el("a", "pay-upi-btn", "Open UPI app");
  openLink.href = upiLink(order);

  // On a computer there is no UPI app, so explain instead of doing nothing.
  // On a phone, if no UPI app opens, show help after a short wait.
  openLink.addEventListener("click", function (event) {
    if (!isMobileDevice()) {
      event.preventDefault();
      alert("UPI apps open only on a phone. Please copy the UPI ID and pay from your phone.");
      return;
    }

    // If an app opens, the browser page gets hidden. If not, show help.
    setTimeout(function () {
      if (!document.hidden) {
        alert("No UPI app found. Please install Google Pay, PhonePe or Paytm, or tap 'Copy UPI ID' and pay manually.");
      }
    }, 1500);
  });

  const copyButton = el("button", "pay-secondary", "Copy UPI ID");
  copyButton.type = "button";

  copyButton.addEventListener("click", function () {
    if (!navigator.clipboard) return; // older browsers: silently skip

    navigator.clipboard.writeText(UPI_ID).then(function () {
      copyButton.textContent = "Copied";
    });
  });

  actions.append(openLink, copyButton);

  // Reference (UTR) entry so staff can match the payment
  const refRow = el("div", "pay-ref-row");
  const refInput = el("input");
  refInput.type = "text";
  refInput.placeholder = "Transaction ID (UTR) after paying";
  refInput.maxLength = 40;
  refInput.autocomplete = "off";

  const doneButton = el("button", "pay-secondary", "I have paid");
  doneButton.type = "button";

  doneButton.addEventListener("click", function () {
    const ref = refInput.value.trim();

    // UTRs are 6-40 letters/digits; reject anything else before saving
    if (!/^[A-Za-z0-9]{6,40}$/.test(ref)) {
      alert("Please enter the transaction ID (UTR) from your payment app.");
      return;
    }

    savePayment(order, "upi", ref);
  });

  refRow.append(refInput, doneButton);

  panel.append(actions, refRow, buildChangeLink(order));
  return panel;
}

// ==========================================================================
// Rendering
// ==========================================================================

// Message shown when the list is empty (no orders, or no search match)
function buildEmptyState(text, showButton) {
  const box = el("div", "orders-empty");
  box.appendChild(el("div", "orders-empty-icon", "🧺"));
  box.appendChild(el("p", "orders-empty-text", text));

  if (showButton) {
    const link = el("a", "button-link", "Request a pickup");
    link.href = PICKUP_PAGE;
    box.appendChild(link);
  }

  return box;
}

// Redraws the whole page from allOrders. Called after every data change,
// filter change and search keystroke.
function render() {
  updateSummary();
  updateDue();
  ordersMessage.hidden = true;
  ordersList.innerHTML = "";

  // No orders at all -> friendly empty state with a "Request a pickup" button
  if (allOrders.length === 0) {
    ordersList.appendChild(buildEmptyState("No orders yet. Your orders will appear here.", true));
    return;
  }

  const filter = filterSelect.value;
  const query = searchInput.value.trim().toUpperCase().replace("#", "");

  // Apply the dropdown filter and the search box
  const visible = allOrders.filter(function (order) {
    if (filter === "active" && isDelivered(order)) return false;
    if (filter === "completed" && !isDelivered(order)) return false;
    return query === "" || orderLabel(order).includes(query);
  });

  if (visible.length === 0) {
    ordersList.appendChild(buildEmptyState("No orders match your search.", false));
    return;
  }

  visible.forEach(function (order) {
    ordersList.appendChild(buildOrderCard(order));
  });
}

// ==========================================================================
// Data loading
// ==========================================================================

// Turns private storage paths into temporary signed URLs the browser can load.
// Returns a { path: url } map. Failures are logged and ignored, so a photo
// problem never stops the orders from showing.
async function signPhotos(orders) {
  const paths = [];

  orders.forEach(function (order) {
    (order.request_items || []).forEach(function (item) {
      (item.photo_paths || []).forEach(function (path) {
        paths.push(path);
      });
    });
  });

  if (paths.length === 0) return {};

  const { data, error } = await db.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(paths, PHOTO_LINK_SECONDS);

  if (error || !data) {
    console.log("Photo links failed:", error ? error.message : "no data");
    return {};
  }

  const map = {};

  data.forEach(function (entry) {
    if (entry.signedUrl) map[entry.path] = entry.signedUrl;
  });

  return map;
}

// Fetches this customer's orders (with items and status history), newest first
async function loadData() {
  const { data, error } = await db
    .from("pickup_requests")
    .select(
      "id, order_no, status, created_at, delivery_time, total_amount, paid, payment_method, upi_ref, request_items(category, quantity, photo_paths), order_status_history(status, changed_at)"
    )
    .eq("user_id", currentUserId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  allOrders = data || [];
  photoUrls = await signPhotos(allOrders);
}

// Re-fetches and redraws. Used by live updates; errors are only logged so the
// screen keeps showing the last good data.
async function refreshOrders() {
  try {
    await loadData();
    render();
  } catch (error) {
    console.log("Refresh failed:", error.message);
  }
}

// Debounced refresh: several quick changes trigger only one reload
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshOrders, REFRESH_DELAY);
}

// Subscribes to live changes on this customer's orders so staff updates
// (status, price, paid) appear without refreshing the page
function watchOrders() {
  db.channel("my-orders")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "pickup_requests",
        filter: "user_id=eq." + currentUserId,
      },
      scheduleRefresh
    )
    .subscribe();
}

// ==========================================================================
// Event listeners
// ==========================================================================

// Account button (desktop nav, avatar and mobile bottom bar) toggles the menu
document.querySelectorAll("[data-account-toggle]").forEach(function (button) {
  button.addEventListener("click", function () {
    accountMenu.hidden = !accountMenu.hidden;
  });
});

// Clicking anywhere else closes the account menu
document.addEventListener("click", function (event) {
  if (accountMenu.hidden) return;
  if (event.target.closest("[data-account-toggle]") || event.target.closest("#account-menu")) return;
  accountMenu.hidden = true;
});

// "In progress" / "Completed" rows in the summary card act as quick filters
document.querySelectorAll("[data-filter]").forEach(function (button) {
  button.addEventListener("click", function () {
    filterSelect.value = button.dataset.filter;
    render();
  });
});

filterSelect.addEventListener("change", render);
searchInput.addEventListener("input", render);

// "Log out" in the account menu opens the confirmation popup
logoutButton.addEventListener("click", function () {
  accountMenu.hidden = true;
  logoutDialog.showModal();
});

// Confirming signs out, then sends the user to the login page
logoutConfirmButton.addEventListener("click", async function () {
  logoutConfirmButton.disabled = true; // prevent double clicks

  try {
    await db.auth.signOut();
  } catch (error) {
    console.log("Sign out failed:", error.message);
  }

  window.location.href = LOGIN_PAGE;
});

// ==========================================================================
// Start-up
// ==========================================================================
async function start() {
  // Not logged in -> go to the login page (replace so Back doesn't loop here)
  const { data: sessionData } = await db.auth.getSession();

  if (!sessionData.session) {
    window.location.replace(LOGIN_PAGE);
    return;
  }

  currentUserId = sessionData.session.user.id;
  accountEmail.textContent = sessionData.session.user.email || "";

  // First load: if it fails, tell the customer instead of showing a blank page
  try {
    await loadData();
  } catch (error) {
    console.log("Loading orders failed:", error.message);
    ordersMessage.textContent = "Sorry, we could not load your orders. Please refresh the page.";
    ordersMessage.hidden = false;
    return;
  }

  render();
  watchOrders(); // start listening for live updates
}

// Catch-all so an unexpected error never leaves a silent blank page
start().catch(function (error) {
  console.log("Orders page failed:", error.message);
  ordersMessage.textContent = "Sorry, something went wrong. Please refresh the page.";
  ordersMessage.hidden = false;
});