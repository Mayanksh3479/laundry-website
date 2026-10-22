const SUPABASE_URL = "https://ydcawwkjybtnhicwfqxk.supabase.co";
const SUPABASE_KEY = "sb_publishable_v3aYAOeHqStdF7gnl3QE0w_p5LPkKgt";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const LOGIN_PAGE = "login.html";
const PICKUP_PAGE = "index.html#pickup";
const PHOTO_BUCKET = "request-photos";
const PHOTO_LINK_SECONDS = 3600;
const REFRESH_DELAY = 900;

const STEPS = [
  { value: "pending", label: "Pickup Scheduled", badge: "Pickup Scheduled", activeText: "" },
  { value: "picked_up", label: "Picked Up", badge: "Picked Up", activeText: "Collected" },
  { value: "washing", label: "Cleaning", badge: "In Cleaning", activeText: "In Progress" },
  { value: "ready", label: "Ready for Delivery", badge: "Ready for Delivery", activeText: "Ready now" },
  { value: "delivered", label: "Delivered", badge: "Delivered", activeText: "" },
];

const ICONS = {
  calendar:
    '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="3"></rect><path d="M8 3v4M16 3v4M3.5 10h17M8 14h2M12 14h2M8 17h2"></path></svg>',
  shirt:
    '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3 3 6l2.5 4L8 9v12h8V9l2.5 1L21 6l-5-3c-.6 1.6-2 2.5-4 2.5S8.6 4.6 8 3z"></path></svg>',
  arrow:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>',
};

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

let currentUserId = null;
let allOrders = [];
let photoUrls = {};
let openOrders = new Set();
let refreshTimer = null;

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

lightbox.addEventListener("click", function (event) {
  if (event.target === lightbox) lightbox.close();
});

function openPhoto(url) {
  lightboxImage.src = url;
  lightbox.showModal();
}

// Log out confirmation pop-up (asks first, in case of an accidental tap)
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

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name, className) {
  const span = el("span", className);
  span.innerHTML = ICONS[name];
  return span;
}

function formatDay(isoText) {
  if (!isoText) return "";

  return new Date(isoText).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

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

function orderLabel(order) {
  if (order.order_no !== null && order.order_no !== undefined) {
    return "SC" + (1000 + Number(order.order_no));
  }

  return order.id.slice(0, 8).toUpperCase();
}

function getStep(status) {
  return STEPS.find(function (step) {
    return step.value === status;
  });
}

function stepIndex(status) {
  return STEPS.findIndex(function (step) {
    return step.value === status;
  });
}

function isDelivered(order) {
  return order.status === "delivered";
}

function splitCategory(category) {
  const parts = String(category).split(" - ");

  if (parts.length > 1) {
    return { group: parts[0], name: parts.slice(1).join(" - ") };
  }

  return { group: "", name: category };
}

function statusDates(order) {
  const map = {};

  (order.order_status_history || []).forEach(function (entry) {
    if (!map[entry.status] || entry.changed_at < map[entry.status]) {
      map[entry.status] = entry.changed_at;
    }
  });

  if (!map.pending) map.pending = order.created_at;

  return map;
}

function buildSteps(order) {
  const current = stepIndex(order.status);
  const delivered = isDelivered(order);
  const dates = statusDates(order);
  const list = el("ol", "steps");

  STEPS.forEach(function (step, index) {
    const item = el("li", "step");

    let state = "future";
    if (index < current || (index === current && delivered)) state = "done";
    else if (index === current) state = "current";

    if (index <= current) item.classList.add("reached");
    item.classList.add(state);

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

function buildItem(item) {
  const parts = splitCategory(item.category);
  const urls = (item.photo_paths || [])
    .map(function (path) {
      return photoUrls[path];
    })
    .filter(Boolean);

  const row = el("div", "order-item");

  if (urls.length > 0) {
    row.appendChild(buildPhotoButton(urls[0], "item-photo", parts.name));
  } else {
    row.appendChild(el("div", "item-photo-empty", parts.name.charAt(0).toUpperCase()));
  }

  const details = el("div", "item-details");
  details.appendChild(el("div", "item-name", parts.name));

  if (parts.group) {
    details.appendChild(el("div", "item-group", parts.group));
  }

  details.appendChild(el("div", "item-qty", "Qty: " + item.quantity));

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

function buildDetails(order) {
  const panel = el("div", "order-details");
  panel.hidden = !openOrders.has(order.id);

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

function buildOrderCard(order) {
  const delivered = isDelivered(order);
  const step = getStep(order.status);
  const items = order.request_items || [];
  const dates = statusDates(order);

  const pieces = items.reduce(function (sum, item) {
    return sum + Number(item.quantity || 0);
  }, 0);

  const names = Array.from(
    new Set(
      items.map(function (item) {
        return splitCategory(item.category).name;
      })
    )
  ).join(", ");

  const card = el("article", "order-card " + (delivered ? "is-delivered" : "is-active"));

  const top = el("div", "order-top");
  const titleBox = el("div");
  titleBox.append(
    el("h3", "order-title", "Order #" + orderLabel(order)),
    el("p", "order-booked", "Booked on " + formatDay(order.created_at))
  );
  top.append(titleBox, el("span", "badge badge-" + order.status, step ? step.badge : order.status));

  const bottom = el("div", "order-bottom");

  const itemsCell = el("div", "bottom-cell cell-items");
  const itemsText = el("div", "cell-text");
  itemsText.append(
    el("div", "cell-title", pieces + (pieces === 1 ? " item" : " items")),
    el("div", "cell-sub names", names)
  );
  itemsCell.append(icon("shirt", "cell-icon"), itemsText);

  const dateCell = el("div", "bottom-cell cell-date");
  const dateText = el("div", "cell-text");
  dateText.append(
    el("div", "cell-sub", delivered ? "Delivered on" : "Estimated delivery"),
    el("div", "cell-title", formatDay(delivered ? dates.delivered || order.delivery_time : order.delivery_time))
  );
  dateCell.append(icon("calendar", "cell-icon"), dateText);

  const amountCell = el("div", "bottom-cell cell-amount");
  if (order.total_amount !== null && order.total_amount !== undefined) {
    amountCell.appendChild(el("div", "amount", "₹" + Number(order.total_amount).toLocaleString("en-IN")));
  } else {
    amountCell.appendChild(el("div", "amount-note", "Price shared after cleaning"));
  }

  const buttonCell = el("div", "bottom-cell cell-button");
  const detailsButton = el("button", "details-btn" + (openOrders.has(order.id) ? " open" : ""));
  detailsButton.type = "button";

  const buttonLabel = el("span", "", openOrders.has(order.id) ? "Hide details" : "View details");
  detailsButton.append(buttonLabel, icon("arrow", "arrow-icon"));
  buttonCell.appendChild(detailsButton);

  bottom.append(itemsCell, dateCell, amountCell, buttonCell);

  const details = buildDetails(order);

  detailsButton.addEventListener("click", function () {
    details.hidden = !details.hidden;
    detailsButton.classList.toggle("open", !details.hidden);
    buttonLabel.textContent = details.hidden ? "View details" : "Hide details";

    if (details.hidden) openOrders.delete(order.id);
    else openOrders.add(order.id);
  });

  card.append(top, buildSteps(order), bottom, details);
  return card;
}

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

function render() {
  updateSummary();
  ordersMessage.hidden = true;
  ordersList.innerHTML = "";

  if (allOrders.length === 0) {
    ordersList.appendChild(buildEmptyState("No orders yet. Your orders will appear here.", true));
    return;
  }

  const filter = filterSelect.value;
  const query = searchInput.value.trim().toUpperCase().replace("#", "");

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

async function loadData() {
  const { data, error } = await db
    .from("pickup_requests")
    .select(
      "id, order_no, status, created_at, delivery_time, total_amount, request_items(category, quantity, photo_paths), order_status_history(status, changed_at)"
    )
    .eq("user_id", currentUserId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  allOrders = data || [];
  photoUrls = await signPhotos(allOrders);
}

async function refreshOrders() {
  try {
    await loadData();
    render();
  } catch (error) {
    console.log("Refresh failed:", error.message);
  }
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshOrders, REFRESH_DELAY);
}

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

document.querySelectorAll("[data-account-toggle]").forEach(function (button) {
  button.addEventListener("click", function () {
    accountMenu.hidden = !accountMenu.hidden;
  });
});

document.addEventListener("click", function (event) {
  if (accountMenu.hidden) return;
  if (event.target.closest("[data-account-toggle]") || event.target.closest("#account-menu")) return;
  accountMenu.hidden = true;
});

document.querySelectorAll("[data-filter]").forEach(function (button) {
  button.addEventListener("click", function () {
    filterSelect.value = button.dataset.filter;
    render();
  });
});

filterSelect.addEventListener("change", render);
searchInput.addEventListener("input", render);

logoutButton.addEventListener("click", function () {
  accountMenu.hidden = true;
  logoutDialog.showModal();
});

logoutConfirmButton.addEventListener("click", async function () {
  logoutConfirmButton.disabled = true;

  try {
    await db.auth.signOut();
  } catch (error) {
    console.log("Sign out failed:", error.message);
  }

  window.location.href = LOGIN_PAGE;
});

async function start() {
  const { data: sessionData } = await db.auth.getSession();

  if (!sessionData.session) {
    window.location.replace(LOGIN_PAGE);
    return;
  }

  currentUserId = sessionData.session.user.id;
  accountEmail.textContent = sessionData.session.user.email || "";

  try {
    await loadData();
  } catch (error) {
    console.log("Loading orders failed:", error.message);
    ordersMessage.textContent = "Sorry, we could not load your orders. Please refresh the page.";
    ordersMessage.hidden = false;
    return;
  }

  render();
  watchOrders();
}

start().catch(function (error) {
  console.log("Orders page failed:", error.message);
  ordersMessage.textContent = "Sorry, something went wrong. Please refresh the page.";
  ordersMessage.hidden = false;
});