const SUPABASE_URL = "https://ydcawwkjybtnhicwfqxk.supabase.co";
const SUPABASE_KEY = "sb_publishable_v3aYAOeHqStdF7gnl3QE0w_p5LPkKgt";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const LOGIN_PAGE = "login.html";
const PHOTO_BUCKET = "request-photos";
const PHOTO_LINK_SECONDS = 3600;

const STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "picked_up", label: "Picked up" },
  { value: "washing", label: "Cleaning" },
  { value: "ready", label: "Ready for delivery" },
  { value: "delivered", label: "Delivered" },
];

const adminMessage = document.getElementById("admin-message");
const adminTools = document.getElementById("admin-tools");
const adminList = document.getElementById("admin-list");
const summary = document.getElementById("summary");
const searchInput = document.getElementById("search");
const logoutButton = document.getElementById("logout-btn");
const toast = document.getElementById("toast");

let orders = [];
let photoUrls = {};
let activeFilter = "all";
let searchText = "";
let toastTimer = null;
let reloadTimer = null;

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

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showToast(text, isError) {
  toast.textContent = text;
  toast.className = "toast" + (isError ? " error" : "");
  toast.hidden = false;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    toast.hidden = true;
  }, 3200);
}

function showMessage(text) {
  adminMessage.textContent = text;
  adminMessage.hidden = false;
}

function formatDate(isoText) {
  if (!isoText) return "-";

  return new Date(isoText).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(isoText) {
  if (!isoText) return "-";

  return new Date(isoText).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function shortId(order) {
  if (order.order_no !== null && order.order_no !== undefined) {
    return "SC" + (1000 + Number(order.order_no));
  }

  return order.id.slice(0, 8).toUpperCase();
}

function statusLabel(value) {
  const found = STATUSES.find(function (status) {
    return status.value === value;
  });

  return found ? found.label : value;
}

function splitCategory(category) {
  const parts = String(category).split(" - ");

  if (parts.length > 1) {
    return { group: parts[0], name: parts.slice(1).join(" - ") };
  }

  return { group: "", name: category };
}

function headerBlock(label, value) {
  const block = el("div", "order-head-block");
  block.append(el("span", "order-head-label", label), el("span", "order-head-value", value));
  return block;
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

async function changeStatus(order, select) {
  const previous = order.status;
  const next = select.value;

  if (next === previous) return;

  select.disabled = true;

  const { data, error } = await db
    .from("pickup_requests")
    .update({ status: next })
    .eq("id", order.id)
    .select("id");

  select.disabled = false;

  if (error || !data || data.length === 0) {
    console.log("Status update failed:", error ? error.message : "no row changed");
    select.value = previous;
    showToast("Could not update the status. Please try again.", true);
    return;
  }

  order.status = next;
  showToast("Order #" + shortId(order) + " is now " + statusLabel(next));
  render();
}

async function changeAmount(order, input) {
  const raw = input.value.trim();
  const value = raw === "" ? null : Number(raw);
  const previous =
    order.total_amount === null || order.total_amount === undefined ? "" : order.total_amount;

  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    input.value = previous;
    showToast("Enter a valid amount.", true);
    return;
  }

  input.disabled = true;

  const { data, error } = await db
    .from("pickup_requests")
    .update({ total_amount: value })
    .eq("id", order.id)
    .select("id");

  input.disabled = false;

  if (error || !data || data.length === 0) {
    console.log("Amount update failed:", error ? error.message : "no row changed");
    input.value = previous;
    showToast("Could not save the amount. Please try again.", true);
    return;
  }

  order.total_amount = value;
  showToast("Amount saved for order #" + shortId(order));
}

function buildOrderCard(order) {
  const items = order.request_items || [];
  const totalPieces = items.reduce(function (sum, item) {
    return sum + Number(item.quantity || 0);
  }, 0);

  const card = el("article", "order-card");

  const head = el("div", "order-head");
  head.append(
    headerBlock("Order placed", formatDate(order.created_at)),
    headerBlock("Deliver back by", formatDateTime(order.delivery_time)),
    headerBlock("Pieces", String(totalPieces))
  );

  const idBlock = el("div", "order-head-block order-head-id");
  idBlock.append(el("span", "order-head-label", "Order #"), el("span", "order-head-value", shortId(order)));
  head.appendChild(idBlock);

  const body = el("div", "order-body");

  const statusRow = el("div", "admin-status-row");
  statusRow.appendChild(el("span", "admin-status-label", "Order status"));

  const select = el("select", "status-select");
  select.dataset.status = order.status;

  STATUSES.forEach(function (status) {
    const option = el("option", "", status.label);
    option.value = status.value;
    if (status.value === order.status) option.selected = true;
    select.appendChild(option);
  });

  select.addEventListener("change", function () {
    changeStatus(order, select);
  });

  statusRow.appendChild(select);

  const amountLabel = el("span", "admin-status-label amount-label", "Amount (₹)");
  const amountInput = el("input", "amount-input");
  amountInput.type = "number";
  amountInput.min = "0";
  amountInput.step = "1";
  amountInput.placeholder = "e.g. 280";
  amountInput.value =
    order.total_amount === null || order.total_amount === undefined ? "" : order.total_amount;

  amountInput.addEventListener("change", function () {
    changeAmount(order, amountInput);
  });

  statusRow.append(amountLabel, amountInput);
  body.appendChild(statusRow);

  const itemsBox = el("div", "order-items");
  itemsBox.appendChild(el("h4", "order-items-title", "Items in this order"));

  items.forEach(function (item) {
    itemsBox.appendChild(buildItem(item));
  });

  body.appendChild(itemsBox);
  card.append(head, body);
  return card;
}

function countFor(filter) {
  if (filter === "all") return orders.length;

  return orders.filter(function (order) {
    return order.status === filter;
  }).length;
}

function buildSummary() {
  summary.innerHTML = "";

  [{ value: "all", label: "All orders" }].concat(STATUSES).forEach(function (entry) {
    const card = el("button", "stat-card");
    card.type = "button";

    if (entry.value === activeFilter) card.classList.add("active");

    card.append(el("span", "stat-count", String(countFor(entry.value))), el("span", "stat-label", entry.label));

    card.addEventListener("click", function () {
      activeFilter = entry.value;
      render();
    });

    summary.appendChild(card);
  });
}

function render() {
  adminTools.hidden = false;
  buildSummary();
  adminList.innerHTML = "";

  const query = searchText.trim().toUpperCase();

  const visible = orders.filter(function (order) {
    const statusMatch = activeFilter === "all" || order.status === activeFilter;
    const searchMatch = query === "" || shortId(order).includes(query);
    return statusMatch && searchMatch;
  });

  if (visible.length === 0) {
    const empty = el("div", "orders-empty");
    empty.appendChild(el("div", "orders-empty-icon", "🧺"));
    empty.appendChild(el("p", "orders-empty-text", "No orders match this view."));
    adminList.appendChild(empty);
    return;
  }

  visible.forEach(function (order) {
    adminList.appendChild(buildOrderCard(order));
  });
}

async function signPhotos(list) {
  const paths = [];

  list.forEach(function (order) {
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

async function fetchOrders() {
  const { data, error } = await db
    .from("pickup_requests")
    .select("id, order_no, status, created_at, delivery_time, total_amount, request_items(category, quantity, photo_paths)")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return data || [];
}

async function refreshOrders() {
  try {
    const data = await fetchOrders();
    const hadOrders = orders.length;

    photoUrls = await signPhotos(data);
    orders = data;
    render();

    if (data.length > hadOrders) showToast("A new order has arrived");
  } catch (error) {
    console.log("Refresh failed:", error.message);
  }
}

function scheduleRefresh() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(refreshOrders, 800);
}

function watchOrders() {
  db.channel("staff-orders")
    .on("postgres_changes", { event: "*", schema: "public", table: "pickup_requests" }, function (payload) {
      if (payload.eventType === "UPDATE") {
        const known = orders.find(function (order) {
          return order.id === payload.new.id;
        });

        if (known && known.status !== payload.new.status) {
          known.status = payload.new.status;
          render();
        }

        return;
      }

      scheduleRefresh();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "request_items" }, scheduleRefresh)
    .subscribe();
}

searchInput.addEventListener("input", function () {
  searchText = searchInput.value;
  render();
});

logoutButton.addEventListener("click", async function () {
  await db.auth.signOut();
  window.location.href = LOGIN_PAGE;
});

async function start() {
  const { data: sessionData } = await db.auth.getSession();

  if (!sessionData.session) {
    window.location.replace(LOGIN_PAGE);
    return;
  }

  const userId = sessionData.session.user.id;

  const { data: staffRow, error: staffError } = await db
    .from("staff_members")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (staffError || !staffRow) {
    showMessage("This page is only for staff accounts.");
    return;
  }

  orders = await fetchOrders();
  photoUrls = await signPhotos(orders);

  if (orders.length === 0) {
    adminTools.hidden = false;
    buildSummary();
    showMessage("No orders have been placed yet.");
    watchOrders();
    return;
  }

  render();
  watchOrders();
}

start().catch(function (error) {
  console.log("Dashboard failed:", error.message);
  showMessage("Sorry, something went wrong. Please refresh the page.");
});