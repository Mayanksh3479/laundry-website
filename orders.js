const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const LOGIN_PAGE = "login.html";
const HOME_PAGE = "index.html";
const PHOTO_BUCKET = "request-photos";
const PHOTO_LINK_SECONDS = 3600;

const ordersList = document.getElementById("orders-list");
const ordersMessage = document.getElementById("orders-message");
const logoutButton = document.getElementById("logout-btn");

const STATUS_STEPS = [
  {
    value: "pending",
    label: "Order placed",
    headline: "Order received",
    text: "We will collect your clothes at the scheduled time.",
  },
  {
    value: "picked_up",
    label: "Picked up",
    headline: "Clothes picked up",
    text: "Your items have reached our shop.",
  },
  {
    value: "washing",
    label: "Cleaning",
    headline: "Cleaning in progress",
    text: "Your clothes are being cleaned with care.",
  },
  {
    value: "ready",
    label: "Ready",
    headline: "Ready for delivery",
    text: "Your clothes are clean and on their way back to you.",
  },
  {
    value: "delivered",
    label: "Delivered",
    headline: "Delivered",
    text: "This order is complete. Thank you for choosing Super Care!",
  },
];

let allOrders = [];
let photoUrls = {};
let activeFilter = "all";
let filterBar = null;

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

function getStep(status) {
  return STATUS_STEPS.find(function (step) {
    return step.value === status;
  });
}

function stepIndex(status) {
  return STATUS_STEPS.findIndex(function (step) {
    return step.value === status;
  });
}

function splitCategory(category) {
  const parts = String(category).split(" - ");

  if (parts.length > 1) {
    return { group: parts[0], name: parts.slice(1).join(" - ") };
  }

  return { group: "", name: category };
}

function isDelivered(order) {
  return order.status === "delivered";
}

function headerBlock(label, value) {
  const block = el("div", "order-head-block");
  block.append(el("span", "order-head-label", label), el("span", "order-head-value", value));
  return block;
}

function buildTracker(status) {
  const current = stepIndex(status);
  const tracker = el("ol", "tracker");

  STATUS_STEPS.forEach(function (step, index) {
    const item = el("li", "", step.label);

    if (index < current || (index === current && step.value === "delivered")) {
      item.className = "done";
    } else if (index === current) {
      item.className = "current";
    }

    tracker.appendChild(item);
  });

  return tracker;
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

function buildItem(item, order) {
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

  const step = getStep(order.status);
  const side = el("div", "item-side");
  side.appendChild(
    el(
      "span",
      "status-pill " + (isDelivered(order) ? "pill-delivered" : "pill-active"),
      step ? step.headline : order.status
    )
  );
  side.appendChild(el("div", "item-side-text", "Deliver by " + formatDateTime(order.delivery_time)));

  row.append(details, side);
  return row;
}

function buildOrderCard(order) {
  const step = getStep(order.status);
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
  idBlock.append(
    el("span", "order-head-label", "Order #"),
    el("span", "order-head-value", order.id.slice(0, 8).toUpperCase())
  );
  head.appendChild(idBlock);

  const body = el("div", "order-body");

  const statusBox = el("div", "order-status");
  statusBox.appendChild(
    el(
      "h3",
      "order-headline " + (isDelivered(order) ? "is-delivered" : "is-active"),
      step ? step.headline : order.status
    )
  );

  if (step) {
    statusBox.appendChild(el("p", "order-subtext", step.text));
  }

  body.append(statusBox, buildTracker(order.status));

  const itemsBox = el("div", "order-items");
  itemsBox.appendChild(el("h4", "order-items-title", "Items in this order"));

  items.forEach(function (item) {
    itemsBox.appendChild(buildItem(item, order));
  });

  body.appendChild(itemsBox);

  card.append(head, body);
  return card;
}

function countFor(filter) {
  return allOrders.filter(function (order) {
    if (filter === "delivered") return isDelivered(order);
    if (filter === "active") return !isDelivered(order);
    return true;
  }).length;
}

function buildFilterBar() {
  const bar = el("div", "order-filters");

  [
    { key: "all", label: "All orders" },
    { key: "active", label: "In progress" },
    { key: "delivered", label: "Delivered" },
  ].forEach(function (filter) {
    const button = el("button", "filter-pill", filter.label + " (" + countFor(filter.key) + ")");
    button.type = "button";

    if (filter.key === activeFilter) button.classList.add("active");

    button.addEventListener("click", function () {
      activeFilter = filter.key;
      render();
    });

    bar.appendChild(button);
  });

  return bar;
}

function buildEmptyState(text, showButton) {
  const box = el("div", "orders-empty");
  box.appendChild(el("div", "orders-empty-icon", "🧺"));
  box.appendChild(el("p", "orders-empty-text", text));

  if (showButton) {
    const link = el("a", "button-link", "Request a pickup");
    link.href = HOME_PAGE;
    box.appendChild(link);
  }

  return box;
}

function render() {
  ordersMessage.hidden = true;
  ordersList.innerHTML = "";

  if (filterBar) filterBar.remove();
  filterBar = buildFilterBar();
  ordersList.before(filterBar);

  const visible = allOrders.filter(function (order) {
    if (activeFilter === "delivered") return isDelivered(order);
    if (activeFilter === "active") return !isDelivered(order);
    return true;
  });

  if (visible.length === 0) {
    ordersList.appendChild(buildEmptyState("No orders in this list.", false));
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

async function loadOrders() {
  const { data: sessionData } = await db.auth.getSession();

  if (!sessionData.session) {
    window.location.replace(LOGIN_PAGE);
    return;
  }

  const userId = sessionData.session.user.id;

  const { data, error } = await db
    .from("pickup_requests")
    .select("id, status, created_at, delivery_time, request_items(category, quantity, photo_paths)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.log("Loading orders failed:", error.message);
    ordersMessage.textContent = "Sorry, we could not load your orders. Please refresh the page.";
    ordersMessage.hidden = false;
    return;
  }

  if (!data || data.length === 0) {
    ordersMessage.hidden = true;
    ordersList.innerHTML = "";
    ordersList.appendChild(buildEmptyState("No orders yet. Your orders will appear here.", true));
    return;
  }

  allOrders = data;
  photoUrls = await signPhotos(data);
  render();
}

logoutButton.addEventListener("click", async function () {
  await db.auth.signOut();
  window.location.href = LOGIN_PAGE;
});

loadOrders().catch(function (error) {
  console.log("Orders page failed:", error.message);
  ordersMessage.textContent = "Sorry, something went wrong. Please refresh the page.";
  ordersMessage.hidden = false;
});