// =====================================================================
// admin.js: the staff dashboard (orders, status, payment, customer info)
// =====================================================================

// ---------------------------------------------------------------------
// Supabase connection
// ---------------------------------------------------------------------
const SUPABASE_URL = "https://ydcawwkjybtnhicwfqxk.supabase.co";
const SUPABASE_KEY = "sb_publishable_v3aYAOeHqStdF7gnl3QE0w_p5LPkKgt";

// I create one Supabase client and use it for everything on this page
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------
const LOGIN_PAGE = "login.html";
const PHOTO_BUCKET = "request-photos";
const PHOTO_LINK_SECONDS = 3600; // I make photo links valid for one hour

// If the GPS accuracy is worse than this (in metres), I warn staff
const LOW_ACCURACY_METRES = 100;

// If true, staff can only remove orders that are already "Delivered".
// I set it to false if I want the remove button on every order.
const REMOVE_ONLY_DELIVERED = true;

// The order statuses I let staff choose from, in the order they happen
const STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "picked_up", label: "Picked up" },
  { value: "washing", label: "Cleaning" },
  { value: "ready", label: "Ready for delivery" },
  { value: "delivered", label: "Delivered" },
];

// ---------------------------------------------------------------------
// Page elements
// ---------------------------------------------------------------------
const adminMessage = document.getElementById("admin-message");
const adminTools = document.getElementById("admin-tools");
const adminList = document.getElementById("admin-list");
const summary = document.getElementById("summary");
const searchInput = document.getElementById("search");
const logoutButton = document.getElementById("logout-btn");
const toast = document.getElementById("toast");

// ---------------------------------------------------------------------
// State I keep in memory
// ---------------------------------------------------------------------
let orders = []; // every order I have loaded
let photoUrls = {}; // storage path -> temporary signed link
let activeFilter = "all"; // which status card is selected
let searchText = ""; // what staff typed in the search box
let toastTimer = null;
let reloadTimer = null;

// ---------------------------------------------------------------------
// Photo lightbox (opens a photo full size)
// ---------------------------------------------------------------------
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

// I also close it when staff click the dark area outside the photo
lightbox.addEventListener("click", function (event) {
  if (event.target === lightbox) lightbox.close();
});

function openPhoto(url) {
  lightboxImage.src = url;
  lightbox.showModal();
}

// ---------------------------------------------------------------------
// Log out confirmation pop-up
// I ask first, in case of an accidental tap
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// "Remove from dashboard" confirmation pop-up
// I ask first, in case of an accidental tap.
// Removing only hides the order from this dashboard. The customer still
// sees it in My Orders, and the order and photos stay in the database.
// I reuse the log out pop-up's classes so both look the same.
// ---------------------------------------------------------------------
const removeDialog = document.createElement("dialog");
removeDialog.className = "logout-dialog";

const removeDialogTitle = document.createElement("h3");
removeDialogTitle.className = "logout-dialog-title";

const removeDialogText = document.createElement("p");
removeDialogText.className = "logout-dialog-text";

const removeKeepButton = document.createElement("button");
removeKeepButton.type = "button";
removeKeepButton.className = "logout-stay";
removeKeepButton.textContent = "Keep on dashboard";

const removeConfirmButton = document.createElement("button");
removeConfirmButton.type = "button";
removeConfirmButton.className = "logout-confirm";
removeConfirmButton.textContent = "Yes, remove";

const removeDialogActions = document.createElement("div");
removeDialogActions.className = "logout-dialog-actions";
removeDialogActions.append(removeKeepButton, removeConfirmButton);

removeDialog.append(removeDialogTitle, removeDialogText, removeDialogActions);
document.body.appendChild(removeDialog);

// I remember which order the pop-up is about
let orderToRemove = null;

removeKeepButton.addEventListener("click", function () {
  orderToRemove = null;
  removeDialog.close();
});

// I close it when staff click the dark area, unless a save is in progress
removeDialog.addEventListener("click", function (event) {
  if (event.target === removeDialog && !removeConfirmButton.disabled) {
    orderToRemove = null;
    removeDialog.close();
  }
});

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

// I create an element with an optional class name and text.
// I use textContent (never innerHTML) so customer text can't inject HTML.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// I show a small message at the bottom of the screen for a few seconds
function showToast(text, isError) {
  toast.textContent = text;
  toast.className = "toast" + (isError ? " error" : "");
  toast.hidden = false;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    toast.hidden = true;
  }, 3200);
}

// I show a message in the big box at the top of the page
function showMessage(text) {
  adminMessage.textContent = text;
  adminMessage.hidden = false;
}

// I format a date like "22 Oct 2026"
function formatDate(isoText) {
  if (!isoText) return "-";

  return new Date(isoText).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// I format a date and time like "22 Oct 2026, 6:30 pm"
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

// I build the short order number staff see, like "SC1007"
function shortId(order) {
  if (order.order_no !== null && order.order_no !== undefined) {
    return "SC" + (1000 + Number(order.order_no));
  }

  return order.id.slice(0, 8).toUpperCase();
}

// I turn a status value like "picked_up" into its label "Picked up"
function statusLabel(value) {
  const found = STATUSES.find(function (status) {
    return status.value === value;
  });

  return found ? found.label : value;
}

// I split "Gents - Shirt" into { group: "Gents", name: "Shirt" }
function splitCategory(category) {
  const parts = String(category).split(" - ");

  if (parts.length > 1) {
    return { group: parts[0], name: parts.slice(1).join(" - ") };
  }

  return { group: "", name: category };
}

// I build one label + value block for the grey header of an order card
function headerBlock(label, value) {
  const block = el("div", "order-head-block");
  block.append(el("span", "order-head-label", label), el("span", "order-head-value", value));
  return block;
}

// I compare two amounts that may be a number, a numeric string or empty.
// An empty amount (null / undefined) only matches another empty amount.
function sameAmount(a, b) {
  const first = a === null || a === undefined ? null : Number(a);
  const second = b === null || b === undefined ? null : Number(b);
  return first === second;
}

// ---------------------------------------------------------------------
// Order items and photos
// ---------------------------------------------------------------------

// I build a clickable photo thumbnail that opens in the lightbox
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

// I build one item row: photo, name, group, quantity and extra photos
function buildItem(item) {
  const parts = splitCategory(item.category);

  // I turn the saved photo paths into signed links I can display
  const urls = (item.photo_paths || [])
    .map(function (path) {
      return photoUrls[path];
    })
    .filter(Boolean);

  const row = el("div", "order-item");

  // I show the first photo big, or a letter if there are no photos
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

  // I show any remaining photos as small thumbnails
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

// ---------------------------------------------------------------------
// Saving changes (status, amount, payment)
// ---------------------------------------------------------------------

// I save a new status. If it fails, I put the old one back.
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

  // If no row came back, nothing changed (for example, a permission problem)
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

// I save the order amount. An empty box saves as "no amount yet".
// Orders priced automatically from the rate list can't be changed here:
// the box is read-only, and the database refuses the change as a second safety net.
async function changeAmount(order, input) {
  // I stop early if the price is locked (the box should be read-only already)
  if (order.price_is_auto) {
    input.value = order.total_amount === null || order.total_amount === undefined ? "" : order.total_amount;
    showToast("This amount is set automatically from the rate list.", true);
    return;
  }

  const raw = input.value.trim();
  const value = raw === "" ? null : Number(raw);
  const previous =
    order.total_amount === null || order.total_amount === undefined ? "" : order.total_amount;

  // I reject negative numbers and anything that isn't a number
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

    // If the database refused because the price is automatic, I say so clearly
    const locked = error && String(error.message).toLowerCase().includes("rate list");
    showToast(
      locked
        ? "This amount is set automatically from the rate list."
        : "Could not save the amount. Please try again.",
      true
    );
    return;
  }

  order.total_amount = value;
  showToast("Amount saved for order #" + shortId(order));
}

// I save whether the order is paid or unpaid
async function changePaid(order, select) {
  const previous = order.paid ? "paid" : "unpaid";
  const next = select.value;

  if (next === previous) return;

  select.disabled = true;

  const { data, error } = await db
    .from("pickup_requests")
    .update({ paid: next === "paid" })
    .eq("id", order.id)
    .select("id");

  select.disabled = false;

  if (error || !data || data.length === 0) {
    console.log("Payment update failed:", error ? error.message : "no row changed");
    select.value = previous;
    showToast("Could not update the payment. Please try again.", true);
    return;
  }

  order.paid = next === "paid";
  showToast("Order #" + shortId(order) + " marked as " + next);
}

// ---------------------------------------------------------------------
// Removing an order from the dashboard
// ---------------------------------------------------------------------

// I open the confirmation pop-up for one order
function askRemove(order) {
  orderToRemove = order;

  removeDialogTitle.textContent = "Remove order " + shortId(order) + "?";

  let text = "This removes the order from your dashboard. The customer will still see it in My Orders.";

  // I add a warning if the order has not been paid yet
  if (!order.paid) {
    text += " This order is still marked Unpaid.";
  }

  removeDialogText.textContent = text;
  removeDialog.showModal();
}

// When staff confirm, I mark the order as hidden from staff and refresh the page.
// I do not delete anything: the order, its items and its photos all stay.
removeConfirmButton.addEventListener("click", async function () {
  const order = orderToRemove;
  if (!order) return;

  removeConfirmButton.disabled = true;
  removeKeepButton.disabled = true;

  const { data, error } = await db
    .from("pickup_requests")
    .update({ staff_hidden_at: new Date().toISOString() })
    .eq("id", order.id)
    .select("id");

  removeConfirmButton.disabled = false;
  removeKeepButton.disabled = false;
  removeDialog.close();
  orderToRemove = null;

  // If no row came back, nothing changed (for example, a permission problem)
  if (error || !data || data.length === 0) {
    console.log("Remove failed:", error ? error.message : "no row changed");
    showToast("Could not remove the order. Please try again.", true);
    return;
  }

  // I take the order off the page straight away
  orders = orders.filter(function (known) {
    return known.id !== order.id;
  });
  render();
  showToast("Order " + shortId(order) + " removed from the dashboard");
});

// ---------------------------------------------------------------------
// Customer details and location
// ---------------------------------------------------------------------

// I build one "Label: value" line. The value can be plain text or an element.
function detailLine(label, child) {
  const row = el("div", "customer-line");
  row.appendChild(el("span", "customer-label", label));

  if (typeof child === "string") {
    row.appendChild(el("span", "customer-value", child));
  } else {
    row.appendChild(child);
  }

  return row;
}

// I build a link. For links to other sites I open a new tab safely.
function linkNode(text, href, newTab) {
  const link = el("a", "customer-link", text);
  link.href = href;

  if (newTab) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }

  return link;
}

// I keep only the digits of a phone number, and only the last 10 of them.
// This way "+91 98765 43210", "09876543210" and "9876543210" all dial correctly.
function phoneDigits(raw) {
  return String(raw || "")
    .replace(/\D/g, "")
    .slice(-10);
}

// I check that an order has a usable saved location
function hasLocation(order) {
  return (
    order.latitude !== null &&
    order.latitude !== undefined &&
    order.longitude !== null &&
    order.longitude !== undefined &&
    Number.isFinite(Number(order.latitude)) &&
    Number.isFinite(Number(order.longitude))
  );
}

// I join the saved address boxes into one readable line, like
// "12, Gali no. 12, Ashok Vatika (Near the park), Ghaziabad, Uttar Pradesh - 201005".
// I return an empty string for older orders that have no address.
function addressText(order) {
  if (!order.address_house && !order.address_area) return "";

  const area = order.address_landmark
    ? order.address_area + " (Near " + order.address_landmark + ")"
    : order.address_area;

  const cityLine = [order.address_city, order.address_state].filter(Boolean).join(", ");
  const pincode = order.address_pincode ? " - " + order.address_pincode : "";

  return [order.address_house, area, cityLine + pincode].filter(Boolean).join(", ");
}

// I build the "Show map" button and the box that holds the map.
// I only create the map when staff click, so a long list of orders
// doesn't load dozens of maps at once.
function buildMapToggle(lat, lng) {
  const wrap = el("div", "map-wrap");

  const button = el("button", "map-toggle", "Show map");
  button.type = "button";

  const frameBox = el("div", "map-frame");
  frameBox.hidden = true;

  button.addEventListener("click", function () {
    // Hiding the map again
    if (!frameBox.hidden) {
      frameBox.hidden = true;
      button.textContent = "Show map";
      return;
    }

    // I build the map the first time only. I use an OpenStreetMap embed
    // (no API key needed) with a pin on the exact spot.
    if (!frameBox.firstChild) {
      const spread = 0.003; // about 300 m around the pin
      const bbox = [lng - spread, lat - spread, lng + spread, lat + spread].join(",");

      const frame = el("iframe");
      frame.src =
        "https://www.openstreetmap.org/export/embed.html?bbox=" +
        bbox +
        "&layer=mapnik&marker=" +
        lat +
        "," +
        lng;
      frame.title = "Customer location map";
      frame.loading = "lazy";
      frame.referrerPolicy = "no-referrer";

      frameBox.appendChild(frame);
    }

    frameBox.hidden = false;
    button.textContent = "Hide map";
  });

  wrap.append(button, frameBox);
  return wrap;
}

// I build the "Customer" box: name, email, phone and location
function buildCustomerBox(order) {
  const box = el("div", "customer-box");
  box.appendChild(el("h4", "order-items-title", "Customer"));

  // Name
  box.appendChild(detailLine("Name", order.customer_name || "-"));

  // Email: I make it clickable so staff can tap to write an email
  box.appendChild(
    detailLine(
      "Email",
      order.customer_email ? linkNode(order.customer_email, "mailto:" + order.customer_email) : "-"
    )
  );

  // Phone: I make it clickable so staff can tap to call.
  // I show the number as saved, and dial the last 10 digits with +91.
  const digits = phoneDigits(order.customer_phone);
  box.appendChild(
    detailLine(
      "Phone",
      order.customer_phone ? linkNode(order.customer_phone, "tel:+91" + digits) : "-"
    )
  );

  // Address: what the customer typed (or confirmed) in the pickup address form.
  // Older orders have no address, so I say so.
  const fullAddress = addressText(order);

  if (fullAddress) {
    const typePrefix = order.address_type ? order.address_type + ": " : "";
    box.appendChild(detailLine("Address", typePrefix + fullAddress));
  } else {
    box.appendChild(detailLine("Address", "Not provided"));
  }

  // Location: if the customer shared it, I show links, accuracy, time and a map
  if (hasLocation(order)) {
    const lat = Number(order.latitude);
    const lng = Number(order.longitude);

    const mapUrl = "https://www.google.com/maps?q=" + lat + "," + lng;
    const directionsUrl = "https://www.google.com/maps/dir/?api=1&destination=" + lat + "," + lng;

    // Two links side by side: open the pin, or get directions to it
    const links = el("span", "customer-value");
    links.append(
      linkNode("Open in Google Maps", mapUrl, true),
      document.createTextNode("  ·  "),
      linkNode("Directions", directionsUrl, true)
    );
    box.appendChild(detailLine("Location", links));

    // How accurate the GPS was, so staff know how far to trust the pin
    if (order.location_accuracy_m) {
      const metres = Math.round(order.location_accuracy_m);
      let accuracyText = "±" + metres + " m";

      if (metres > LOW_ACCURACY_METRES) {
        accuracyText += " · low accuracy, please confirm by phone";
      }

      box.appendChild(detailLine("Accuracy", accuracyText));
    }

    // When the customer's phone captured this position
    if (order.location_captured_at) {
      box.appendChild(detailLine("Captured", formatDateTime(order.location_captured_at)));
    }

    box.appendChild(buildMapToggle(lat, lng));
  } else if (fullAddress) {
    // No GPS pin, but there is an address: I let staff search it on Google Maps
    const searchUrl =
      "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(fullAddress);

    const links = el("span", "customer-value");
    links.append(
      linkNode("Search address in Google Maps", searchUrl, true),
      document.createTextNode("  (no GPS pin shared)")
    );
    box.appendChild(detailLine("Location", links));
  } else {
    box.appendChild(detailLine("Location", "Not shared"));
  }

  return box;
}

// ---------------------------------------------------------------------
// Building an order card
// ---------------------------------------------------------------------
function buildOrderCard(order) {
  const items = order.request_items || [];

  // I add up the quantity of every item to get the total pieces
  const totalPieces = items.reduce(function (sum, item) {
    return sum + Number(item.quantity || 0);
  }, 0);

  const card = el("article", "order-card");

  // ----- Grey header: dates, customer, pieces and order number -----
  const head = el("div", "order-head");
  head.append(
    headerBlock("Order placed", formatDate(order.created_at)),
    headerBlock("Customer", order.customer_name || "-"),
    headerBlock("Deliver back by", formatDateTime(order.delivery_time)),
    headerBlock("Pieces", String(totalPieces))
  );

  const idBlock = el("div", "order-head-block order-head-id");
  idBlock.append(el("span", "order-head-label", "Order #"), el("span", "order-head-value", shortId(order)));
  head.appendChild(idBlock);

  const body = el("div", "order-body");

  // ----- Controls row: status, amount, payment -----
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

  // Amount box
  // - Auto-priced order (every item has a fixed rate): the box is locked.
  //   The database fills it in and updates it when items are added or removed.
  // - Order with a range item (e.g. Sherwani, Saree): the box is open
  //   and staff type the price after inspecting the garment.
  const amountLabel = el("span", "admin-status-label amount-label", "Amount (₹)");
  const amountInput = el("input", "amount-input");
  amountInput.type = "number";
  amountInput.min = "0";
  amountInput.step = "1";
  amountInput.placeholder = "e.g. 280";
  amountInput.value =
    order.total_amount === null || order.total_amount === undefined ? "" : order.total_amount;

  if (order.price_is_auto) {
    amountInput.readOnly = true;
    amountInput.classList.add("amount-locked");
    amountInput.title = "Set automatically from the rate list";
  }

  amountInput.addEventListener("change", function () {
    changeAmount(order, amountInput);
  });

  // Paid / unpaid dropdown
  const paidLabel = el("span", "admin-status-label amount-label", "Payment");
  const paidSelect = el("select", "amount-input");

  [
    { value: "unpaid", label: "Unpaid" },
    { value: "paid", label: "Paid" },
  ].forEach(function (choice) {
    const option = el("option", "", choice.label);
    option.value = choice.value;
    paidSelect.appendChild(option);
  });

  paidSelect.value = order.paid ? "paid" : "unpaid";

  paidSelect.addEventListener("change", function () {
    changePaid(order, paidSelect);
  });

  statusRow.append(amountLabel, amountInput, paidLabel, paidSelect);

  // Small note under the controls so staff know why the amount is locked,
  // or that they need to price the order by hand
  if (order.price_is_auto) {
    statusRow.appendChild(el("span", "admin-status-label amount-label auto-price-note", "Auto-priced from rate list"));
  } else if (order.total_amount === null || order.total_amount === undefined) {
    statusRow.appendChild(el("span", "admin-status-label amount-label auto-price-note", "Enter the price after inspection"));
  }

  // Payment method text (and the UPI reference when there is one)
  const methodNames = { cod: "Cash on delivery", upi: "UPI" };
  let methodText = "Method: " + (methodNames[order.payment_method] || "not chosen yet");

  if (order.payment_method === "upi" && order.upi_ref) {
    methodText += " · Ref: " + order.upi_ref + (order.paid ? "" : " (check your UPI app, then mark Paid)");
  }

  statusRow.appendChild(el("span", "admin-status-label amount-label", methodText));
  body.appendChild(statusRow);

  // ----- Customer box: name, email, phone, location -----
  body.appendChild(buildCustomerBox(order));

  // ----- Items in this order -----
  const itemsBox = el("div", "order-items");
  itemsBox.appendChild(el("h4", "order-items-title", "Items in this order"));

  items.forEach(function (item) {
    itemsBox.appendChild(buildItem(item));
  });

  body.appendChild(itemsBox);

  // ----- Remove button: only for delivered orders (see REMOVE_ONLY_DELIVERED) -----
  if (!REMOVE_ONLY_DELIVERED || order.status === "delivered") {
    const actions = el("div", "order-actions");

    const removeButton = el("button", "delete-order-btn", "Remove from dashboard");
    removeButton.type = "button";

    removeButton.addEventListener("click", function () {
      askRemove(order);
    });

    actions.appendChild(removeButton);
    body.appendChild(actions);
  }

  card.append(head, body);
  return card;
}

// ---------------------------------------------------------------------
// Summary cards and the order list
// ---------------------------------------------------------------------

// I count how many orders match a status (or all of them)
function countFor(filter) {
  if (filter === "all") return orders.length;

  return orders.filter(function (order) {
    return order.status === filter;
  }).length;
}

// I build the row of status cards at the top (All, Pending, Picked up, ...)
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

// I check whether an order matches what staff typed in the search box.
// Staff can search by order number, customer name or phone number.
function matchesSearch(order, query) {
  if (query === "") return true;

  // Order number, like "sc1007"
  if (shortId(order).toLowerCase().includes(query)) return true;

  // Customer name
  if (String(order.customer_name || "").toLowerCase().includes(query)) return true;

  // Phone number: I compare digits only, so spaces and dashes don't matter
  const queryDigits = query.replace(/\D/g, "");
  if (queryDigits !== "" && String(order.customer_phone || "").replace(/\D/g, "").includes(queryDigits)) {
    return true;
  }

  return false;
}

// I redraw the whole page from the orders I have in memory
function render() {
  adminTools.hidden = false;
  buildSummary();
  adminList.innerHTML = "";

  const query = searchText.trim().toLowerCase();

  // I keep only the orders that match the selected status and the search box
  const visible = orders.filter(function (order) {
    const statusMatch = activeFilter === "all" || order.status === activeFilter;
    return statusMatch && matchesSearch(order, query);
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

// ---------------------------------------------------------------------
// Loading data from Supabase
// ---------------------------------------------------------------------

// I ask Supabase for temporary signed links for every photo.
// I return an object like { "<storage path>": "<link>" }.
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

// I load every order, newest first, with its items.
// I also ask for the customer details, location and price_is_auto
// (true when the database priced the order from the rate list).
async function fetchOrders() {
  const { data, error } = await db
    .from("pickup_requests")
    .select(
      "id, order_no, status, created_at, delivery_time, total_amount, price_is_auto, paid, payment_method, upi_ref, " +
        "customer_name, customer_email, customer_phone, " +
        "address_type, address_house, address_area, address_landmark, address_city, address_state, address_pincode, " +
        "latitude, longitude, location_accuracy_m, location_captured_at, " +
        "request_items(category, quantity, photo_paths)"
    )
    .is("staff_hidden_at", null) // I skip orders staff have removed from the dashboard
    .order("created_at", { ascending: false });

  if (error) throw error;

  return data || [];
}

// I reload everything and tell staff when a new order has arrived
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

// I wait a moment before reloading, so a burst of changes causes only one reload
function scheduleRefresh() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(refreshOrders, 800);
}

// I listen for live changes, so the dashboard updates without a page refresh
function watchOrders() {
  db.channel("staff-orders")
    .on("postgres_changes", { event: "*", schema: "public", table: "pickup_requests" }, function (payload) {
      // For a simple update, I patch the order I already have in memory
      if (payload.eventType === "UPDATE") {
        // If someone removed this order from the dashboard, I drop it here too
        if (payload.new.staff_hidden_at) {
          orders = orders.filter(function (order) {
            return order.id !== payload.new.id;
          });
          render();
          return;
        }

        const known = orders.find(function (order) {
          return order.id === payload.new.id;
        });

        if (known) {
          // I also watch the amount, paid flag and price_is_auto now, because the
          // database changes the amount by itself when the customer adds or removes items
          const changed =
            known.status !== payload.new.status ||
            known.payment_method !== payload.new.payment_method ||
            known.upi_ref !== payload.new.upi_ref ||
            !!known.paid !== !!payload.new.paid ||
            !!known.price_is_auto !== !!payload.new.price_is_auto ||
            !sameAmount(known.total_amount, payload.new.total_amount);

          known.status = payload.new.status;
          known.payment_method = payload.new.payment_method;
          known.upi_ref = payload.new.upi_ref;
          known.paid = payload.new.paid;
          known.price_is_auto = payload.new.price_is_auto;
          known.total_amount = payload.new.total_amount;

          if (changed) render();
        }

        return;
      }

      // For a new or deleted order, I reload the full list
      scheduleRefresh();
    })
    // New items arrive after the order itself, so I reload when they do too
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "request_items" }, scheduleRefresh)
    .subscribe();
}

// ---------------------------------------------------------------------
// Page events
// ---------------------------------------------------------------------

// I filter the list while staff type in the search box
searchInput.addEventListener("input", function () {
  searchText = searchInput.value;
  render();
});

logoutButton.addEventListener("click", function () {
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

// ---------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------
async function start() {
  // I send anyone who isn't logged in to the login page
  const { data: sessionData } = await db.auth.getSession();

  if (!sessionData.session) {
    window.location.replace(LOGIN_PAGE);
    return;
  }

  const userId = sessionData.session.user.id;

  // I only let people listed in staff_members use this page
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

  // If there are no orders yet, I still show the tools and keep listening for new ones
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