const SUPABASE_URL = "https://ydcawwkjybtnhicwfqxk.supabase.co";
const SUPABASE_KEY = "sb_publishable_v3aYAOeHqStdF7gnl3QEOw_p5LPkKgt";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const form = document.getElementById("pickup-form");
const addButton = document.getElementById("add-item");
const itemsContainer = document.getElementById("items");
const dateInput = document.getElementById("delivery-date");
const timeInput = document.getElementById("delivery-time");
const loginNotice = document.getElementById("login-notice");
const loginLink = document.getElementById("login-link");
const logoutButton = document.getElementById("logout-btn");

let currentUser = null;

// Shows the form to logged-in customers and a login message to everyone else
function updateLoginUI() {
  const loggedIn = currentUser !== null;

  form.hidden = !loggedIn;
  loginNotice.hidden = loggedIn;
  loginLink.hidden = loggedIn;
  logoutButton.hidden = !loggedIn;
}

db.auth.getSession().then(function ({ data }) {
  currentUser = data.session ? data.session.user : null;
  updateLoginUI();
});

db.auth.onAuthStateChange(function (event, session) {
  currentUser = session ? session.user : null;
  updateLoginUI();
});

logoutButton.addEventListener("click", async function () {
  await db.auth.signOut();
});

if (!timeInput) {
  console.error(
    'No element with id="delivery-time" was found. Check the id of the time field in index.html.'
  );
}

const MAX_QUANTITY = 3;

// Delivery hours (24-hour clock) and the gap between choices in the time dropdown
const OPEN_HOUR = 9;
const CLOSE_HOUR = 20;
const TIME_STEP_MINUTES = 30;

// Photos are shrunk in the browser before they are uploaded
const PHOTO_BUCKET = "request-photos";
const MAX_PHOTO_SIDE = 1600;
const PHOTO_QUALITY = 0.8;
let nextPhotoInputId = 1;

// Every real category, read once from the datalist in the HTML
const validCategories = Array.from(
  document.querySelectorAll("#category-list option")
).map(function (option) {
  return option.value;
});

// Reads a date typed as DD/MM/YYYY.
// Returns { day, month, year }, or null if it is not a real date.
function parseDate(dateText) {
  const match = dateText.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  // Catches fake dates such as 31/02/2026
  const check = new Date(year, month - 1, day);
  if (
    check.getFullYear() !== year ||
    check.getMonth() !== month - 1 ||
    check.getDate() !== day
  ) {
    return null;
  }

  return { day, month, year };
}

// Reads a time such as "6:30 PM", "6 PM", "09:00" or "18".
// Returns { hour, minute } in 24-hour form, or null if it is not a valid time.
function parseTime(timeText) {
  const match = timeText
    .trim()
    .match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)?$/i);

  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const period = match[3] ? match[3].toLowerCase() : null;

  if (minute > 59) return null;

  if (period) {
    // 12-hour clock: the hour must be 1 to 12
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = 0;
    if (period === "pm") hour += 12;
  } else if (hour > 23) {
    // 24-hour clock: the hour must be 0 to 23
    return null;
  }

  return { hour, minute };
}

// Fills the time dropdown with 9:00 AM, 9:30 AM ... 8:00 PM
function fillTimeOptions() {
  timeInput.innerHTML = '<option value="">Select a time</option>';

  for (
    let total = OPEN_HOUR * 60;
    total <= CLOSE_HOUR * 60;
    total += TIME_STEP_MINUTES
  ) {
    const hour24 = Math.floor(total / 60);
    const minute = total % 60;
    const period = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    const label = `${hour12}:${String(minute).padStart(2, "0")} ${period}`;

    const option = document.createElement("option");
    option.value = label;
    option.textContent = label;
    timeInput.appendChild(option);
  }
}

// Only a dropdown needs filling. A typed time box works as it is.
if (timeInput && timeInput.tagName === "SELECT") {
  fillTimeOptions();
}

// Shrinks a photo to at most MAX_PHOTO_SIDE pixels on its longest side
// and returns it as a JPEG file (usually a few hundred KB instead of several MB)
async function compressPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height));

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return new Promise(function (resolve, reject) {
    canvas.toBlob(
      function (blob) {
        if (blob) resolve(blob);
        else reject(new Error("Could not compress the photo"));
      },
      "image/jpeg",
      PHOTO_QUALITY
    );
  });
}

// Uploads every photo and returns the storage paths, one list per item,
// e.g. [["<id>/item1-photo1.jpg", "<id>/item1-photo2.jpg"], ["<id>/item2-photo1.jpg"]]
async function uploadPhotos(requestId, items) {
  const allPaths = [];

  for (let i = 0; i < items.length; i++) {
    const itemPaths = [];

    for (let j = 0; j < items[i].photos.length; j++) {
      const blob = await compressPhoto(items[i].photos[j]);
      const path = `${requestId}/item${i + 1}-photo${j + 1}.jpg`;

      const { error } = await db.storage
        .from(PHOTO_BUCKET)
        .upload(path, blob, { contentType: "image/jpeg" });

      if (error) throw error;
      itemPaths.push(path);
    }

    allPaths.push(itemPaths);
  }

  return allPaths;
}

// Frees the preview of one photo slot and hides it again
function clearPreview(previewButton) {
  const oldUrl = previewButton.dataset.previewUrl;

  if (oldUrl) URL.revokeObjectURL(oldUrl);
  delete previewButton.dataset.previewUrl;

  previewButton.querySelector("img").removeAttribute("src");
  previewButton.hidden = true;
}

// Text above a photo slot, e.g. "Item 2 (Gents - Shirt) — Photo 1"
function photoCaption(row, itemNumber, photoNumber) {
  const category = row.querySelector('[name="item_category"]').value.trim();
  const name = validCategories.includes(category) ? ` (${category})` : "";

  return `Item ${itemNumber}${name} — Photo ${photoNumber}`;
}

function createPhotoSlot(itemNumber, photoNumber) {
  const slot = document.createElement("div");
  slot.className = "photo-slot";

  const caption = document.createElement("div");
  caption.className = "photo-number";
  caption.textContent = `Item ${itemNumber} — Photo ${photoNumber}`;

  const inputId = `item-photo-${nextPhotoInputId++}`;

  const label = document.createElement("label");
  label.htmlFor = inputId;
  label.textContent = "Choose photo";

  const input = document.createElement("input");
  input.type = "file";
  input.id = inputId;
  input.name = "item_photo";
  input.accept = "image/*";
  input.required = true;

  // The thumbnail stays hidden until a photo is chosen
  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.className = "photo-preview";
  previewButton.hidden = true;

  const image = document.createElement("img");
  image.alt = `Preview for Item ${itemNumber}, Photo ${photoNumber}`;

  const hint = document.createElement("span");
  hint.textContent = "Click photo to enlarge";

  previewButton.append(image, hint);
  slot.append(caption, label, input, previewButton);

  return slot;
}

function updatePhotoSlots(row, itemNumber) {
  const quantityInput = row.querySelector('[name="item_quantity"]');
  const slots = row.querySelector(".photo-slots");
  const quantity = Number(quantityInput.value);

  quantityInput.min = "1";
  quantityInput.max = String(MAX_QUANTITY);

  let itemTitle = row.querySelector(".item-number");
  if (!itemTitle) {
    itemTitle = document.createElement("h3");
    itemTitle.className = "item-number";
    row.prepend(itemTitle);
  }
  itemTitle.textContent = `Item ${itemNumber}`;

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    return;
  }

  while (slots.children.length < quantity) {
    slots.appendChild(createPhotoSlot(itemNumber, slots.children.length + 1));
  }

  while (slots.children.length > quantity) {
    const lastSlot = slots.lastElementChild;
    clearPreview(lastSlot.querySelector(".photo-preview"));
    lastSlot.remove();
  }

  Array.from(slots.children).forEach(function (slot, index) {
    const photoNumber = index + 1;

    slot.querySelector(".photo-number").textContent = photoCaption(
      row,
      itemNumber,
      photoNumber
    );

    slot.querySelector(".photo-preview img").alt =
      `Preview for Item ${itemNumber}, Photo ${photoNumber}`;
  });
}

function updateAllPhotoSlots() {
  const rows = itemsContainer.querySelectorAll(".item-row");

  rows.forEach(function (row, index) {
    updatePhotoSlots(row, index + 1);
  });
}

// After a successful send: back to one empty row with one empty photo slot
function resetItemRows() {
  const rows = itemsContainer.querySelectorAll(".item-row");

  rows.forEach(function (row, index) {
    row.querySelectorAll(".photo-preview").forEach(clearPreview);
    if (index > 0) row.remove();
  });

  itemsContainer.querySelector(".photo-slots").innerHTML = "";
  updateAllPhotoSlots();
}

// Create a lightbox for viewing selected photos.
const lightbox = document.createElement("dialog");
lightbox.className = "photo-lightbox";
lightbox.style.border = "0";
lightbox.style.borderRadius = "8px";
lightbox.style.padding = "16px";
lightbox.style.maxWidth = "90vw";
lightbox.style.background = "#111";
lightbox.style.color = "#fff";

const lightboxClose = document.createElement("button");
lightboxClose.type = "button";
lightboxClose.textContent = "Close";
lightboxClose.style.display = "block";
lightboxClose.style.marginBottom = "12px";

const lightboxImage = document.createElement("img");
lightboxImage.alt = "Selected photo";
lightboxImage.style.display = "block";
lightboxImage.style.maxWidth = "85vw";
lightboxImage.style.maxHeight = "80vh";
lightboxImage.style.objectFit = "contain";

lightbox.append(lightboxClose, lightboxImage);
document.body.appendChild(lightbox);

lightboxClose.addEventListener("click", function () {
  lightbox.close();
});

lightbox.addEventListener("click", function (event) {
  if (event.target === lightbox) lightbox.close();
});

// Show a thumbnail after a photo is selected.
itemsContainer.addEventListener("change", function (event) {
  const input = event.target;
  if (input.name !== "item_photo") return;

  const slot = input.closest(".photo-slot");
  const previewButton = slot.querySelector(".photo-preview");

  // Start clean: this also handles the customer cancelling the file picker
  clearPreview(previewButton);

  const file = input.files[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    alert("Please select an image file.");
    input.value = "";
    return;
  }

  const previewUrl = URL.createObjectURL(file);
  previewButton.dataset.previewUrl = previewUrl;
  previewButton.querySelector("img").src = previewUrl;
  previewButton.hidden = false;
});

// Open the selected photo when its thumbnail is clicked.
itemsContainer.addEventListener("click", function (event) {
  const previewButton = event.target.closest(".photo-preview");
  if (!previewButton) return;

  lightboxImage.src = previewButton.dataset.previewUrl;
  lightbox.showModal();
});

updateAllPhotoSlots();

addButton.addEventListener("click", function () {
  const firstRow = itemsContainer.querySelector(".item-row");
  const newRow = firstRow.cloneNode(true);

  newRow.querySelector('[name="item_category"]').value = "";
  newRow.querySelector('[name="item_quantity"]').value = "1";
  newRow.querySelector(".photo-slots").innerHTML = "";

  itemsContainer.appendChild(newRow);
  updateAllPhotoSlots();
});

itemsContainer.addEventListener("click", function (event) {
  if (!event.target.classList.contains("remove-item")) return;

  const rows = itemsContainer.querySelectorAll(".item-row");

  if (rows.length > 1) {
    const row = event.target.closest(".item-row");

    // Free the memory used by this row's photo previews
    row.querySelectorAll(".photo-preview").forEach(function (previewButton) {
      clearPreview(previewButton);
    });

    row.remove();
    updateAllPhotoSlots();
  }
});

// Quantity or category changed -> refresh the photo slots and their captions
itemsContainer.addEventListener("input", function (event) {
  if (
    event.target.name === "item_quantity" ||
    event.target.name === "item_category"
  ) {
    updateAllPhotoSlots();
  }
});

// Adds the slashes automatically while the customer types the date
dateInput.addEventListener("input", function (event) {
  const raw = dateInput.value;
  const digits = raw.replace(/\D/g, "").slice(0, 8);

  const deleting = !!event.inputType && event.inputType.startsWith("delete");
  const keepSlash = !deleting || raw.endsWith("/");

  let formatted = digits.slice(0, 2);

  if (digits.length > 2 || (digits.length === 2 && keepSlash)) {
    formatted += "/" + digits.slice(2, 4);
  }

  if (digits.length > 4 || (digits.length === 4 && keepSlash)) {
    formatted += "/" + digits.slice(4, 8);
  }

  dateInput.value = formatted;
});

form.addEventListener("submit", async function (event) {
  event.preventDefault();

  // 0. Only logged-in customers can place a request
  const { data: sessionData } = await db.auth.getSession();
  if (!sessionData.session) {
    alert("Please log in to place a request.");
    window.location.href = "login.html";
    return;
  }

  // 1. Check the delivery date and time
  if (!timeInput) {
    alert("The time field is missing from the page.");
    return;
  }

  const dateParts = parseDate(dateInput.value);
  if (!dateParts) {
    alert("Please enter a real date, like 25/12/2026.");
    return;
  }

  const timeParts = parseTime(timeInput.value);
  if (!timeParts) {
    console.log("Could not read the time:", JSON.stringify(timeInput.value));
    alert("Please choose a delivery time, like 6:30 PM.");
    return;
  }

  const deliveryDate = new Date(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hour,
    timeParts.minute
  );

  if (deliveryDate <= new Date()) {
    alert("The delivery time must be in the future.");
    return;
  }

  const minutes = deliveryDate.getHours() * 60 + deliveryDate.getMinutes();
  if (minutes < OPEN_HOUR * 60 || minutes > CLOSE_HOUR * 60) {
    alert("We deliver between 9:00 AM and 8:00 PM.");
    return;
  }

  // 2. Collect and check every item row
  const items = [];
  const rows = document.querySelectorAll(".item-row");

  for (const row of rows) {
    const category = row.querySelector('[name="item_category"]').value.trim();
    const quantity = Number(row.querySelector('[name="item_quantity"]').value);

    if (!validCategories.includes(category)) {
      alert("Please pick each category from the suggestion list.");
      return;
    }

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      alert(`Quantity must be a whole number from 1 to ${MAX_QUANTITY}.`);
      return;
    }

    const photos = [];

    for (const input of row.querySelectorAll('[name="item_photo"]')) {
      if (input.files.length !== 1) {
        alert("Please add a photo for every piece.");
        return;
      }

      photos.push(input.files[0]);
    }

    if (photos.length !== quantity) {
      alert("The number of photos must match the quantity.");
      return;
    }

    items.push({ category, quantity, photos });
  }

  // 3. Upload the photos, then save the request and its items
  const submitButton = form.querySelector('button[type="submit"]');
  const submitLabel = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = "Sending...";

  // The browser makes the id itself, so photos and items can be attached to it
  const requestId = crypto.randomUUID();

  try {
    const photoPaths = await uploadPhotos(requestId, items);

    const { error: requestError } = await db.from("pickup_requests").insert({
      id: requestId,
      user_id: sessionData.session.user.id,
      delivery_time: deliveryDate.toISOString(),
    });
    if (requestError) throw requestError;

    const itemRows = items.map(function (item, index) {
      return {
        request_id: requestId,
        category: item.category,
        quantity: item.quantity,
        photo_paths: photoPaths[index],
      };
    });

    const { error: itemsError } = await db.from("request_items").insert(itemRows);
    if (itemsError) throw itemsError;

    alert("Request sent! We will contact you soon.");
    form.reset();
    resetItemRows();
  } catch (error) {
    console.log("Sending failed:", error.message);
    alert("Sorry, we could not send your request. Please try again.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = submitLabel;
  }
});