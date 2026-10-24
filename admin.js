// ===================================================================
// Super Care staff dashboard (admin.js)
// ===================================================================

// ---------------------------------------------------------------------------
// Staff dashboard for Super Care Dry Cleaners.
// Lets staff view all orders, update status / amount / payment, archive
// delivered orders, and see customer details and pickup location.
// ---------------------------------------------------------------------------

// I connect to my Supabase project. The publishable key is meant to be public,
// my row-level security rules are what keep the data safe.
const SUPABASE_URL = "https://ydcawwkjybtnhicwfqxk.supabase.co";
const SUPABASE_KEY = "sb_publishable_v3aYAOeHqStdF7gnl3QE0w_p5LPkKgt";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- Configuration ----------

// Login page used when staff log out manually
const LOGIN_PAGE = "login.html";

// Login page used when a logged-out visitor opens the dashboard.
// The ?next=admin.html part tells login.js to send staff back here after login.
// Kept separate from LOGIN_PAGE on purpose: after a manual logout we do NOT want
// the next person who logs in on this device (e.g. a customer) to be sent to
// the staff page.
const LOGIN_RETURN_PAGE = "login.html?next=admin.html";

// Private storage bucket holding the customers' item photos.
// Photos are only reachable through signed links that expire after one hour.
const PHOTO_BUCKET = "request-photos";
const PHOTO_LINK_SECONDS = 3600;

// Profile columns read for each customer.
// If the profiles table uses different column names, this is the only line to change.
const PROFILE_COLUMNS = "id, full_name, phone, email";

// Customers are fetched in small groups so the request URL never gets too long
const PROFILE_CHUNK_SIZE = 100;

// Statuses staff can pick, in the order the work happens
const STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "picked_up", label: "Picked up" },
  { value: "washing", label: "Cleaning" },
  { value: "ready", label: "Ready for delivery" },
  { value: "delivered", label: "Delivered" },
];

// ---------- DOM references ----------

// Grab every element needed from admin.html once, at the top
const adminMessage = document.getElementById("admin-message");
const adminTools = document.getElementById("admin-tools");
const adminList = document.getElementById("admin-list");
const summary = document.getElementById("summary");
const searchInput = document.getElementById("search");
const logoutButton = document.getElementById("logout-btn");
const toast = document.getElementById("toast");

// ---------- Page state ----------

// In-memory state: the orders, their signed photo links, and the current view
let orders = [];
let photoUrls = {};
let activeFilter = "all";
let searchText = "";
let toastTimer = null;
let reloadTimer = null;

// ---------- Full-size photo viewer ----------

// Build the photo viewer once and reuse it for every photo
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

// Also close the viewer when the dark area around the photo is clicked
lightbox.addEventListener("click", function (event) {
  if (event.target === lightbox) lightbox.close();
});

// Called when staff tap a thumbnail
function openPhoto(url) {
  lightboxImage.src = url;
  lightbox.showModal();
}

// ---------- Log out confirmation pop-up ----------

// Ask before logging out so an accidental tap doesn't sign staff out
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

// Clicking the dark area counts as "Stay logged in"
logoutDialog.addEventListener("click", function (event) {
  if (event.target === logoutDialog) logoutDialog.close();
});

// ---------- Generic confirmation pop-up ----------

// One reusable pop-up for "are you sure?" questions,
// e.g. before removing an order from the dashboard
const confirmDialog = document.createElement("dialog");
confirmDialog.className = "logout-dialog";

const confirmTitle = document.createElement("h3");
confirmTitle.className = "logout-dialog-title";

const confirmText = document.createElement("p");
confirmText.className = "logout-dialog-text";

const confirmNoButton = document.createElement("button");
confirmNoButton.type = "button";
confirmNoButton.className = "logout-stay";
confirmNoButton.textContent = "Cancel";

const confirmYesButton = document.createElement("button");
confirmYesButton.type = "button";
confirmYesButton.className = "logout-confirm";

const confirmActions = document.createElement("div");
confirmActions.className = "logout-dialog-actions";
confirmActions.append(confirmNoButton, confirmYesButton);

confirmDialog.append(confirmTitle, confirmText, confirmActions);
document.body.appendChild(confirmDialog);

confirmNoButton.addEventListener("click", function () {
  confirmDialog.close("no");
});

confirmYesButton.addEventListener("click", function () {
  confirmDialog.close("yes");
});

// Clicking the dark area counts as Cancel
confirmDialog.addEventListener("click", function (event) {
  if (event.target === confirmDialog) confirmDialog.close("no");
});

// Show the pop-up and wait for an answer.
// Resolves true only if staff press the confirm button;
// Esc or clicking outside resolves false.
function askConfirm(title, text, confirmLabel) {
  confirmTitle.textContent = title;
  confirmText.textContent = text;
  confirmYesButton.textContent = confirmLabel;

  // Reset so a previous answer can't leak into this one
  confirmDialog.returnValue = "";
  confirmDialog.showModal();

  return new Promise(function (resolve) {
    confirmDialog.addEventListener(
      "close",
      function () {
        resolve(confirmDialog.returnValue === "yes");
      },
      { once: true }
    );
  });
}

// ---------- Small helpers ----------

// Create an element with a class and some text in one line.
// Text is always set with textContent, so customer details can never inject HTML.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Show a short message at the bottom and hide it again after about 3 seconds
function showToast(text, isError) {
  toast.textContent = text;
  toast.className = "toast" + (isError ? " error" : "");
  toast.hidden = false;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    toast.hidden = true;
  }, 3200);
}

// Big message at the top of the page, e.g. "No orders have been placed yet"
function showMessage(text) {
  adminMessage.textContent = text;
  adminMessage.hidden = false;
}

// Format dates the Indian way, e.g. 18 Oct 2026
function formatDate(isoText) {
  if (!isoText) return "-";

  return new Date(isoText).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Same as formatDate, but with the time as well
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

// Short order code staff see, e.g. SC1001.
// Falls back to the first 8 characters of the id if there is no order number.
function shortId(order) {
  if (order.order_no !== null && order.order_no !== undefined) {
    return "SC" + (1000 + Number(order.order_no));
  }

  return order.id.slice(0, 8).toUpperCase();
}

// Turn a status value like "picked_up" into its label, "Picked up"
function statusLabel(value) {
  const found = STATUSES.find(function (status) {
    return status.value === value;
  });

  return found ? found.label : value;
}

// Split "Gents - Shirt" into the group (Gents) and the item name (Shirt)
function splitCategory(category) {
  const parts = String(category).split(" - ");

  if (parts.length > 1) {
    return { group: parts[0], name: parts.slice(1).join(" - ") };
  }

  return { group: "", name: category };
}

// ---------- Customer details and pickup location ----------

// Display a 10-digit phone number as "+91 9876543210"
function formatPhone(phone) {
  const digits = String(phone).replace(/\D/g, "");
  return digits.length === 10 ? "+91 " + digits : String(phone);
}

// Build the tap-to-call link. Customers type 10 digits at signup, so +91 is added.
function phoneHref(phone) {
  const digits = String(phone).replace(/\D/g, "");
  return "tel:" + (digits.length === 10 ? "+91" + digits : digits);
}

// An order only counts as having a location when both coordinates are real numbers
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

// Google Maps link that drops a pin on the customer's shared location
function mapsUrl(order) {
  return "https://www.google.com/maps?q=" + Number(order.latitude) + "," + Number(order.longitude);
}

// Grey placeholder text for a missing detail (e.g. older customers with no phone saved)
function missingText(text) {
  return el("span", "customer-missing", text);
}

// Build a link. External links open in a new tab and can't access this page.
function linkNode(text, href, newTab) {
  const link = el("a", "customer-link", text);
  link.href = href;

  if (newTab) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }

  return link;
}

// Build one labelled detail, e.g. "Phone" with the number underneath
function customerField(label, content) {
  const field = el("div", "customer-field");
  field.appendChild(el("span", "customer-label", label));

  const value = el("span", "customer-value");
  value.append(content);
  field.appendChild(value);

  return field;
}

// Show the map link, plus how accurate the phone reported the location to be
function locationContent(order) {
  if (!hasLocation(order)) return missingText("Not shared");

  const wrap = el("span");
  wrap.appendChild(linkNode("Open in Google Maps", mapsUrl(order), true));

  const accuracy = Number(order.location_accuracy_m);

  if (order.location_accuracy_m !== null && order.location_accuracy_m !== undefined && Number.isFinite(accuracy)) {
    wrap.appendChild(el("small", "customer-hint", " (accurate to about " + Math.round(accuracy) + " m)"));
  }

  return wrap;
}

// Join the typed address parts into one readable line
function addressText(order) {
  const stateAndPin = [order.address_state, order.address_pincode].filter(Boolean).join(" - ");

  const line = [
    order.address_house,
    order.address_area,
    order.address_landmark ? "Near " + order.address_landmark : "",
    order.address_city,
    stateAndPin,
  ]
    .filter(Boolean)
    .join(", ");

  if (!line) return "";
  return (order.address_type ? order.address_type + ": " : "") + line;
}

// Show the typed address with a link that searches it on Google Maps
function addressContent(order) {
  const text = addressText(order);
  if (!text) return missingText("Not provided");

  const wrap = el("span");
  wrap.append(text + " ");
  wrap.appendChild(
    linkNode(
      "Open in Google Maps",
      "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(text),
      true
    )
  );
  return wrap;
}

// Build the "Customer" box at the top of every order card
function buildCustomerBox(order) {
  const customer = order.customer || {};

  const box = el("div", "customer-box");
  box.appendChild(el("h4", "customer-title", "Customer"));

  const grid = el("div", "customer-grid");

  grid.appendChild(customerField("Name", customer.full_name || missingText("Not provided")));

  grid.appendChild(
    customerField(
      "Phone",
      customer.phone
        ? linkNode(formatPhone(customer.phone), phoneHref(customer.phone), false)
        : missingText("Not provided")
    )
  );

  grid.appendChild(
    customerField(
      "Email",
      customer.email ? linkNode(customer.email, "mailto:" + customer.email, false) : missingText("Not provided")
    )
  );

  grid.appendChild(customerField("Pickup address", addressContent(order)));
  grid.appendChild(customerField("GPS pin", locationContent(order)));

  box.appendChild(grid);
  return box;
}

// Join everything staff might search for into one lowercase string,
// so one search box covers order number, name, phone and email
function searchableText(order) {
  const customer = order.customer || {};

  return [shortId(order), customer.full_name, customer.phone, customer.email]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

// ---------- Order card pieces ----------

// Build one grey block in the card header, e.g. "Pieces" with its number
function headerBlock(label, value) {
  const block = el("div", "order-head-block");
  block.append(el("span", "order-head-label", label), el("span", "order-head-value", value));
  return block;
}

// Build a clickable photo thumbnail that opens the full-size viewer
function buildPhotoButton(url, className, altText) {
  const button = el("button", className);
  button.type = "button";
  button.setAttribute("aria-label", "View photo");

  const image = el("img");
  image.src = url;
  image.alt = altText;
  image.loading = "lazy"; // don't load photos until they scroll into view

  button.appendChild(image);

  button.addEventListener("click", function () {
    openPhoto(url);
  });

  return button;
}

// Build one item row: first photo, name, group, quantity and any extra photos
function buildItem(item) {
  const parts = splitCategory(item.category);

  // Convert stored photo paths into signed links (skip any that failed to sign)
  const urls = (item.photo_paths || [])
    .map(function (path) {
      return photoUrls[path];
    })
    .filter(Boolean);

  const row = el("div", "order-item");

  if (urls.length > 0) {
    row.appendChild(buildPhotoButton(urls[0], "item-photo", parts.name));
  } else {
    // No photo: show the first letter of the item name instead
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

// ---------- Saving changes to Supabase ----------

// Save a new status. If saving fails, restore the previous value in the dropdown.
async function changeStatus(order, select) {
  const previous = order.status;
  const next = select.value;

  if (next === previous) return;

  select.disabled = true; // block repeat changes while saving

  const { data, error } = await db
    .from("pickup_requests")
    .update({ status: next })
    .eq("id", order.id)
    .select("id");

  select.disabled = false;

  // An update that changes zero rows means a security rule (RLS) blocked it,
  // so treat that as a failure too
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

// Save the amount when staff finish typing it. An empty box means "not priced yet".
async function changeAmount(order, input) {
  const raw = input.value.trim();
  const value = raw === "" ? null : Number(raw);
  const previous =
    order.total_amount === null || order.total_amount === undefined ? "" : order.total_amount;

  // Reject anything that isn't a non-negative number
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

// Save Paid / Unpaid the same way the status is saved
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

// ---------- Removing delivered orders from the dashboard ----------

// Orders are never deleted, only flagged "archived". That keeps the payment
// record and photos safe, and the customer can still see the order on My Orders.
async function changeArchived(order, archive, button) {
  // Only ask for confirmation when removing; restoring is harmless
  if (archive) {
    const unpaidNote = order.paid ? "" : " It is still marked Unpaid.";

    const confirmed = await askConfirm(
      "Remove this order?",
      "Order #" + shortId(order) + " will move to the Archived tab. The customer can still see it." + unpaidNote,
      "Yes, remove"
    );

    if (!confirmed) return;
  }

  button.disabled = true;

  const { data, error } = await db
    .from("pickup_requests")
    .update({ archived: archive })
    .eq("id", order.id)
    .select("id");

  button.disabled = false;

  if (error || !data || data.length === 0) {
    console.log("Archive update failed:", error ? error.message : "no row changed");
    showToast("Could not update the order. Please try again.", true);
    return;
  }

  order.archived = archive;
  showToast("Order #" + shortId(order) + (archive ? " moved to Archived" : " restored to the dashboard"));
  render();
}

// Icons for the Remove / Restore button. These are fixed markup written here,
// never text a customer typed, so inserting them as HTML is safe.
const TRASH_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"></path></svg>';

const RESTORE_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"></path></svg>';

// Build the row with the Remove / Restore button
function buildArchiveRow(order, archive) {
  const row = el("div", "archive-row");

  const button = el("button", archive ? "archive-btn" : "archive-btn restore");
  button.type = "button";

  const buttonIcon = el("span", "archive-icon");
  buttonIcon.innerHTML = archive ? TRASH_ICON : RESTORE_ICON;

  button.append(buttonIcon, el("span", "", archive ? "Remove from dashboard" : "Restore to dashboard"));

  button.addEventListener("click", function () {
    changeArchived(order, archive, button);
  });

  row.append(
    button,
    el(
      "span",
      "archive-hint",
      archive ? "It moves to the Archived tab. The customer can still see it." : "This order is archived."
    )
  );

  return row;
}

// ---------- Building the order card ----------

// Build one full order card: header, customer box, controls and items
function buildOrderCard(order) {
  const items = order.request_items || [];
  const totalPieces = items.reduce(function (sum, item) {
    return sum + Number(item.quantity || 0);
  }, 0);

  const card = el("article", "order-card");

  // Grey header strip with the dates, piece count and order number
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

  // Customer details go first so staff see who and where before anything else
  body.appendChild(buildCustomerBox(order));

  // --- Status dropdown ---
  const statusRow = el("div", "admin-status-row");
  statusRow.appendChild(el("span", "admin-status-label", "Order status"));

  const select = el("select", "status-select");
  select.dataset.status = order.status; // lets CSS colour the dropdown by status

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

  // --- Amount box ---
  const amountLabel = el("span", "admin-status-label amount-label", "Amount (₹)");
  const amountInput = el("input", "amount-input");
  amountInput.type = "number";
  amountInput.min = "0";
  amountInput.step = "1";
  amountInput.placeholder = "e.g. 280";
  amountInput.value =
    order.total_amount === null || order.total_amount === undefined ? "" : order.total_amount;

  // "change" fires when the box loses focus after an edit, so we save once, not per keystroke
  amountInput.addEventListener("change", function () {
    changeAmount(order, amountInput);
  });

  // --- Paid / Unpaid dropdown ---
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

  // Show how the customer chose to pay, plus their UPI reference if they sent one
  const methodNames = { cod: "Cash on delivery", upi: "UPI" };
  let methodText = "Method: " + (methodNames[order.payment_method] || "not chosen yet");

  if (order.payment_method === "upi" && order.upi_ref) {
    methodText += " · Ref: " + order.upi_ref + (order.paid ? "" : " (check your UPI app, then mark Paid)");
  }

  statusRow.appendChild(el("span", "admin-status-label amount-label", methodText));
  body.appendChild(statusRow);

  // --- Items with their photos ---
  const itemsBox = el("div", "order-items");
  itemsBox.appendChild(el("h4", "order-items-title", "Items in this order"));

  items.forEach(function (item) {
    itemsBox.appendChild(buildItem(item));
  });

  body.appendChild(itemsBox);

  // Delivered orders can be removed from the dashboard; archived ones can be restored.
  // Added last so the button sits in the bottom-left corner of the card.
  if (order.archived === true) {
    body.appendChild(buildArchiveRow(order, false));
  } else if (order.status === "delivered") {
    body.appendChild(buildArchiveRow(order, true));
  }

  card.append(head, body);
  return card;
}

// ---------- Summary boxes and the order list ----------

// Count orders for a given filter ("all" = every active order)
function countFor(filter) {
  if (filter === "archived") {
    return orders.filter(function (order) {
      return order.archived === true;
    }).length;
  }

  // Every other box only counts orders still on the dashboard
  const active = orders.filter(function (order) {
    return order.archived !== true;
  });

  if (filter === "all") return active.length;

  return active.filter(function (order) {
    return order.status === filter;
  }).length;
}

// Draw the row of count boxes at the top. Clicking one filters the list below.
function buildSummary() {
  summary.innerHTML = "";

  // Order of boxes: All orders, each status, then Archived
  [{ value: "all", label: "All orders" }]
    .concat(STATUSES)
    .concat([{ value: "archived", label: "Archived" }])
    .forEach(function (entry) {
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

// Redraw the whole page from the data in memory. Called after every change.
function render() {
  adminTools.hidden = false;
  buildSummary();
  adminList.innerHTML = "";

  // Drop a leading # so "#SC1001" and "SC1001" both work
  const query = searchText.trim().toLowerCase().replace("#", "");

  const visible = orders.filter(function (order) {
    // Archived orders only appear in the Archived view
    const archivedMatch = activeFilter === "archived" ? order.archived === true : order.archived !== true;
    const statusMatch =
      activeFilter === "all" || activeFilter === "archived" || order.status === activeFilter;
    const searchMatch = query === "" || searchableText(order).includes(query);
    return archivedMatch && statusMatch && searchMatch;
  });

  // Nothing to show for this filter / search
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

// ---------- Loading data from Supabase ----------

// Request a one-hour signed link for every photo in a single call.
// The bucket is private, so photos only open through these links.
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

  // If signing fails, the dashboard still works; photos just won't show
  if (error || !data) {
    console.log("Photo links failed:", error ? error.message : "no data");
    return {};
  }

  // Build a lookup of storage path -> signed URL
  const map = {};

  data.forEach(function (entry) {
    if (entry.signedUrl) map[entry.path] = entry.signedUrl;
  });

  return map;
}

// Load name, phone and email for every customer who has an order.
// Done as a separate request so orders still show even if this ever fails.
async function fetchProfiles(list) {
  // Unique, non-empty customer ids
  const ids = Array.from(
    new Set(
      list
        .map(function (order) {
          return order.user_id;
        })
        .filter(Boolean)
    )
  );

  const map = {};

  // Fetch in chunks to keep the request URL short
  for (let start = 0; start < ids.length; start += PROFILE_CHUNK_SIZE) {
    const chunk = ids.slice(start, start + PROFILE_CHUNK_SIZE);

    const { data, error } = await db.from("profiles").select(PROFILE_COLUMNS).in("id", chunk);

    if (error) {
      console.log("Customer details failed:", error.message);
      return map;
    }

    (data || []).forEach(function (profile) {
      map[profile.id] = profile;
    });
  }

  return map;
}

// Load every order with its items and pickup location,
// then attach each customer's details
async function fetchOrders() {
  const { data, error } = await db
    .from("pickup_requests")
    .select(
      "id, user_id, order_no, status, created_at, delivery_time, total_amount, paid, payment_method, upi_ref, archived, address_type, address_house, address_area, address_landmark, address_city, address_state, address_pincode, latitude, longitude, location_accuracy_m, request_items(category, quantity, photo_paths)"
    )
    .order("created_at", { ascending: false }); // newest first

  if (error) throw error;

  const list = data || [];
  const profiles = await fetchProfiles(list);

  list.forEach(function (order) {
    order.customer = profiles[order.user_id] || null;
  });

  return list;
}

// Quietly reload everything in the background and tell staff if a new order arrived
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

// A new order can arrive as several quick database changes,
// so wait a moment and reload once (debounce)
function scheduleRefresh() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(refreshOrders, 800);
}

// Listen for live changes so the dashboard updates without a page refresh
function watchOrders() {
  db.channel("staff-orders")
    .on("postgres_changes", { event: "*", schema: "public", table: "pickup_requests" }, function (payload) {
      if (payload.eventType === "UPDATE") {
        const known = orders.find(function (order) {
          return order.id === payload.new.id;
        });

        if (known) {
          // Only re-render if something staff can see actually changed
          const changed =
            known.status !== payload.new.status ||
            known.payment_method !== payload.new.payment_method ||
            known.upi_ref !== payload.new.upi_ref ||
            known.archived !== payload.new.archived;

          known.status = payload.new.status;
          known.payment_method = payload.new.payment_method;
          known.upi_ref = payload.new.upi_ref;
          known.archived = payload.new.archived;

          if (changed) render();
        }

        return;
      }

      // A new or deleted order means reload the full list
      scheduleRefresh();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "request_items" }, scheduleRefresh)
    .subscribe();
}

// ---------- Page events ----------

// Filter the list as staff type in the search box
searchInput.addEventListener("input", function () {
  searchText = searchInput.value;
  render();
});

// Open the "Log out?" pop-up
logoutButton.addEventListener("click", function () {
  logoutDialog.showModal();
});

// Confirmed logout: sign out, then go to the plain login page.
// Intentionally uses LOGIN_PAGE (no ?next=) so the next person to log in
// on this device is not sent to the staff dashboard.
logoutConfirmButton.addEventListener("click", async function () {
  logoutConfirmButton.disabled = true;

  try {
    await db.auth.signOut();
  } catch (error) {
    console.log("Sign out failed:", error.message);
  }

  window.location.href = LOGIN_PAGE;
});

// ---------- Start ----------

// Startup order:
//   1. Check the visitor is signed in.
//   2. Check they are listed in staff_members.
//   3. Only then load any orders.
async function start() {
  const { data: sessionData } = await db.auth.getSession();

  // Not signed in: go to login and return here afterwards (?next=admin.html)
  if (!sessionData.session) {
    window.location.replace(LOGIN_RETURN_PAGE);
    return;
  }

  const userId = sessionData.session.user.id;

  // Signed in, but are they staff?
  const { data: staffRow, error: staffError } = await db
    .from("staff_members")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  // Customers (or a failed lookup) get a message and no order data
  if (staffError || !staffRow) {
    showMessage("This page is only for staff accounts.");
    return;
  }

  orders = await fetchOrders();
  photoUrls = await signPhotos(orders);

  // Staff with no orders yet: show the tools and an empty-state message
  if (orders.length === 0) {
    adminTools.hidden = false;
    buildSummary();
    showMessage("No orders have been placed yet.");
    watchOrders(); // still listen, so the first order appears live
    return;
  }

  render();
  watchOrders();
}

// Catch any unexpected startup error so staff see a message instead of a blank page
start().catch(function (error) {
  console.log("Dashboard failed:", error.message);
  showMessage("Sorry, something went wrong. Please refresh the page.");
});