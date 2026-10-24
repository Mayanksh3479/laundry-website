// ===================================================================
// Super Care staff dashboard (admin.js)
// ===================================================================

// I connect to my Supabase project. The publishable key is meant to be public,
// my row-level security rules are what keep the data safe.
const SUPABASE_URL = "https://ydcawwkjybtnhicwfqxk.supabase.co";
const SUPABASE_KEY = "sb_publishable_v3aYAOeHqStdF7gnl3QE0w_p5LPkKgt";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// If someone is not signed in, I send them to this page
const LOGIN_PAGE = "login.html";

// This is the private bucket with the customers' item photos.
// I make each photo link valid for one hour.
const PHOTO_BUCKET = "request-photos";
const PHOTO_LINK_SECONDS = 3600;

// These are the profile columns I read for each customer.
// If my profiles table uses different column names, this is the only line I change.
const PROFILE_COLUMNS = "id, full_name, phone, email";

// I ask for customers in small groups so the request address never gets too long
const PROFILE_CHUNK_SIZE = 100;

// The statuses staff can pick, in the order the work happens
const STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "picked_up", label: "Picked up" },
  { value: "washing", label: "Cleaning" },
  { value: "ready", label: "Ready for delivery" },
  { value: "delivered", label: "Delivered" },
];

// I grab every element I need from admin.html once, here at the top
const adminMessage = document.getElementById("admin-message");
const adminTools = document.getElementById("admin-tools");
const adminList = document.getElementById("admin-list");
const summary = document.getElementById("summary");
const searchInput = document.getElementById("search");
const logoutButton = document.getElementById("logout-btn");
const toast = document.getElementById("toast");

// This is the page's memory: the orders, their photo links, and what staff are looking at
let orders = [];
let photoUrls = {};
let activeFilter = "all";
let searchText = "";
let toastTimer = null;
let reloadTimer = null;

// ---------- Full-size photo viewer ----------

// I build the photo viewer once and reuse it for every photo
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

// I also close the viewer when someone clicks the dark area around the photo
lightbox.addEventListener("click", function (event) {
  if (event.target === lightbox) lightbox.close();
});

// I call this when staff tap a thumbnail
function openPhoto(url) {
  lightboxImage.src = url;
  lightbox.showModal();
}

// ---------- Log out confirmation pop-up ----------

// I ask before logging out so an accidental tap doesn't sign staff out
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

// ---------- Confirmation pop-up ----------

// I use this one pop-up to ask "are you sure?" before removing an order from the dashboard
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

// I show the pop-up and wait. I answer true only if staff press the confirm button.
// Pressing Esc or clicking outside answers false.
function askConfirm(title, text, confirmLabel) {
  confirmTitle.textContent = title;
  confirmText.textContent = text;
  confirmYesButton.textContent = confirmLabel;

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

// I use this to create an element with a class and some text in one line.
// I always set text with textContent, so customer details can never inject HTML.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// I show a short message at the bottom and hide it again after about 3 seconds
function showToast(text, isError) {
  toast.textContent = text;
  toast.className = "toast" + (isError ? " error" : "");
  toast.hidden = false;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    toast.hidden = true;
  }, 3200);
}

// I use this for the big message at the top, like "No orders have been placed yet"
function showMessage(text) {
  adminMessage.textContent = text;
  adminMessage.hidden = false;
}

// I show dates the Indian way, like 18 Oct 2026
function formatDate(isoText) {
  if (!isoText) return "-";

  return new Date(isoText).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Same as above, but with the time too
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

// I turn the order number into the short code staff see, like SC1001
function shortId(order) {
  if (order.order_no !== null && order.order_no !== undefined) {
    return "SC" + (1000 + Number(order.order_no));
  }

  return order.id.slice(0, 8).toUpperCase();
}

// I turn a status value like "picked_up" into its label, "Picked up"
function statusLabel(value) {
  const found = STATUSES.find(function (status) {
    return status.value === value;
  });

  return found ? found.label : value;
}

// I split "Gents - Shirt" into the group (Gents) and the item name (Shirt)
function splitCategory(category) {
  const parts = String(category).split(" - ");

  if (parts.length > 1) {
    return { group: parts[0], name: parts.slice(1).join(" - ") };
  }

  return { group: "", name: category };
}

// ---------- Customer details and pickup location ----------

// I show a phone number as +91 98765 43210 style text when it has 10 digits
function formatPhone(phone) {
  const digits = String(phone).replace(/\D/g, "");
  return digits.length === 10 ? "+91 " + digits : String(phone);
}

// I build the tap-to-call link. Customers type 10 digits at signup, so I add +91.
function phoneHref(phone) {
  const digits = String(phone).replace(/\D/g, "");
  return "tel:" + (digits.length === 10 ? "+91" + digits : digits);
}

// I only treat an order as having a location when both numbers are real numbers
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

// I build the Google Maps link that drops a pin on the customer's location
function mapsUrl(order) {
  return "https://www.google.com/maps?q=" + Number(order.latitude) + "," + Number(order.longitude);
}

// I use this grey text when a detail is missing, for example older customers with no phone saved
function missingText(text) {
  return el("span", "customer-missing", text);
}

// I make a link. External links open in a new tab and can't see my page.
function linkNode(text, href, newTab) {
  const link = el("a", "customer-link", text);
  link.href = href;

  if (newTab) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }

  return link;
}

// I build one labelled detail, like "Phone" with the number under it
function customerField(label, content) {
  const field = el("div", "customer-field");
  field.appendChild(el("span", "customer-label", label));

  const value = el("span", "customer-value");
  value.append(content);
  field.appendChild(value);

  return field;
}

// I show the map link, plus how accurate the phone said the location is
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

// I join the typed address parts into one readable line
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

// I show the typed address with a link that searches it on Google Maps
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

// I build the "Customer" box that sits at the top of every order card
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

// I join everything staff might search for into one lowercase line.
// That lets me search by order number, name, phone or email with the same box.
function searchableText(order) {
  const customer = order.customer || {};

  return [shortId(order), customer.full_name, customer.phone, customer.email]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

// ---------- Order card pieces ----------

// I build one grey block in the card header, like "Pieces" with its number
function headerBlock(label, value) {
  const block = el("div", "order-head-block");
  block.append(el("span", "order-head-label", label), el("span", "order-head-value", value));
  return block;
}

// I build a clickable photo thumbnail that opens the viewer
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

// I build one item row: first photo, name, group, quantity and any extra photos
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
    // No photo, so I show the first letter of the item instead
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

// ---------- Saving changes to Supabase ----------

// When staff change the status, I save it. If saving fails, I put the old value back.
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

  // An update that changes zero rows means my security rules blocked it, so I treat that as a failure too
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

// I save the amount when staff finish typing it. Empty means "not priced yet".
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

// I save Paid or Unpaid the same way I save the status
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

// I never delete an order. I only mark it "archived", so the payment record and
// photos stay safe and the customer can still see the order on their My Orders page.
async function changeArchived(order, archive, button) {
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

// The two small icons for the button. These are fixed pieces of my own markup,
// never text a customer typed, so it is safe to insert them as HTML.
const TRASH_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"></path></svg>';

const RESTORE_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"></path></svg>';

// I build the row with the Remove / Restore button
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

// I build one full order card: header, customer box, controls and items
function buildOrderCard(order) {
  const items = order.request_items || [];
  const totalPieces = items.reduce(function (sum, item) {
    return sum + Number(item.quantity || 0);
  }, 0);

  const card = el("article", "order-card");

  // The grey header strip with the dates, piece count and order number
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

  // I put the customer details first so staff see who and where before anything else
  body.appendChild(buildCustomerBox(order));

  // Status dropdown
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

  // Paid / Unpaid dropdown
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

  // I show how the customer chose to pay, and their UPI reference if they sent one
  const methodNames = { cod: "Cash on delivery", upi: "UPI" };
  let methodText = "Method: " + (methodNames[order.payment_method] || "not chosen yet");

  if (order.payment_method === "upi" && order.upi_ref) {
    methodText += " · Ref: " + order.upi_ref + (order.paid ? "" : " (check your UPI app, then mark Paid)");
  }

  statusRow.appendChild(el("span", "admin-status-label amount-label", methodText));
  body.appendChild(statusRow);

  // The list of items with their photos
  const itemsBox = el("div", "order-items");
  itemsBox.appendChild(el("h4", "order-items-title", "Items in this order"));

  items.forEach(function (item) {
    itemsBox.appendChild(buildItem(item));
  });

  body.appendChild(itemsBox);

  // Delivered orders can be removed from the dashboard, and archived ones can be restored.
  // I put this last so the button sits in the bottom-left corner of the card.
  if (order.archived === true) {
    body.appendChild(buildArchiveRow(order, false));
  } else if (order.status === "delivered") {
    body.appendChild(buildArchiveRow(order, true));
  }
  card.append(head, body);
  return card;
}

// ---------- Summary boxes and the order list ----------

// I count how many orders have a given status ("all" counts everything)
function countFor(filter) {
  if (filter === "archived") {
    return orders.filter(function (order) {
      return order.archived === true;
    }).length;
  }

  // Every other box only counts orders that are still on the dashboard
  const active = orders.filter(function (order) {
    return order.archived !== true;
  });

  if (filter === "all") return active.length;

  return active.filter(function (order) {
    return order.status === filter;
  }).length;
}

// I draw the row of count boxes at the top. Clicking one filters the list.
function buildSummary() {
  summary.innerHTML = "";

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

// I redraw the whole page from the data in memory. I call this after every change.
function render() {
  adminTools.hidden = false;
  buildSummary();
  adminList.innerHTML = "";

  // I drop a leading # so "#SC1001" and "SC1001" both work
  const query = searchText.trim().toLowerCase().replace("#", "");

  const visible = orders.filter(function (order) {
    // I keep archived orders out of every view except the Archived one
    const archivedMatch = activeFilter === "archived" ? order.archived === true : order.archived !== true;
    const statusMatch =
      activeFilter === "all" || activeFilter === "archived" || order.status === activeFilter;
    const searchMatch = query === "" || searchableText(order).includes(query);
    return archivedMatch && statusMatch && searchMatch;
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

// ---------- Loading data from Supabase ----------

// I ask Supabase for a one-hour link for every photo, in one request.
// The bucket is private, so photos only open through these signed links.
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

// I load the name, phone and email for every customer who has an order.
// I do this as a separate request so that if it ever fails, the orders still show.
async function fetchProfiles(list) {
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

// I load every order with its items and pickup location, then attach each customer's details
async function fetchOrders() {
  const { data, error } = await db
    .from("pickup_requests")
    .select(
      "id, user_id, order_no, status, created_at, delivery_time, total_amount, paid, payment_method, upi_ref, archived, address_type, address_house, address_area, address_landmark, address_city, address_state, address_pincode, latitude, longitude, location_accuracy_m, request_items(category, quantity, photo_paths)"
    )
    .order("created_at", { ascending: false });

  if (error) throw error;

  const list = data || [];
  const profiles = await fetchProfiles(list);

  list.forEach(function (order) {
    order.customer = profiles[order.user_id] || null;
  });

  return list;
}

// I reload everything quietly in the background, and tell staff if a new order arrived
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

// A new order can arrive as several quick changes, so I wait a moment and reload once
function scheduleRefresh() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(refreshOrders, 800);
}

// I listen for live changes so the dashboard updates without a page refresh
function watchOrders() {
  db.channel("staff-orders")
    .on("postgres_changes", { event: "*", schema: "public", table: "pickup_requests" }, function (payload) {
      if (payload.eventType === "UPDATE") {
        const known = orders.find(function (order) {
          return order.id === payload.new.id;
        });

        if (known) {
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

      // A new or deleted order means I reload the full list
      scheduleRefresh();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "request_items" }, scheduleRefresh)
    .subscribe();
}

// ---------- Page events ----------

// I filter the list as staff type in the search box
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

// ---------- Start ----------

// First I check the person is signed in AND is listed in staff_members.
// Only then do I load any orders.
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