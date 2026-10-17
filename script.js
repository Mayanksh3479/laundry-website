const SUPABASE_URL = "https://ydcawwkjybtnhicwfqxk.supabase.co";
const SUPABASE_KEY = "sb_publishable_v3aYAOeHqStdF7gnl3QE0w_p5LPkKgt";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const form = document.getElementById("pickup-form");
const addButton = document.getElementById("add-item");
const itemsContainer = document.getElementById("items");

const MAX_QUANTITY = 3;
let nextPhotoInputId = 1;
// Delivery window (24-hour clock). Change these two numbers to change the slots.
const DELIVERY_START_HOUR = 9;   // first slot: 9:00 AM
const DELIVERY_END_HOUR = 20;    // last slot: 8:00 PM

const deliveryDateInput = document.getElementById("delivery-date");
const deliveryTimeSelect = document.getElementById("delivery-time");

function formatHour(hour) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:00 ${suffix}`;
}

for (let hour = DELIVERY_START_HOUR; hour <= DELIVERY_END_HOUR; hour++) {
  const option = document.createElement("option");
  option.value = String(hour);
  option.textContent = formatHour(hour);
  deliveryTimeSelect.appendChild(option);
}

document.getElementById("delivery-window").textContent =
  `We deliver between ${formatHour(DELIVERY_START_HOUR)} and ${formatHour(DELIVERY_END_HOUR)}.`;

// Every real category, read once from the datalist in the HTML
const validCategories = Array.from(
  document.querySelectorAll("#category-list option")
).map(function (option) {
  return option.value;
});

function buildDeliveryDate(dateText, timeText) {
  const [day, month, year] = dateText.split("/").map(Number);
  const match = timeText.trim().match(/^(\d{1,2}):(\d{2})\s?(am|pm)$/i);

  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour === 12) hour = 0;
  if (match[3].toLowerCase() === "pm") hour += 12;

  const date = new Date(year, month - 1, day, hour, minute);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
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

form.addEventListener("submit", function (event) {
  event.preventDefault();

  const dateText = document.getElementById("delivery-date").value;
  const timeText = document.getElementById("delivery-time").value;
  const deliveryDate = buildDeliveryDate(dateText, timeText);

  if (!deliveryDate) {
    alert("Please enter a real date and time.");
    return;
  }

  if (deliveryDate <= new Date()) {
    alert("The delivery time must be in the future.");
    return;
  }

  const minutes = deliveryDate.getHours() * 60 + deliveryDate.getMinutes();
  if (minutes < 9 * 60 || minutes > 20 * 60) {
    alert("We deliver between 9:00 AM and 8:00 PM.");
    return;
  }

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

  // Nothing is saved yet. Next step: send these to Supabase and upload the photos.
  console.log("Delivery:", deliveryDate.toISOString());
  console.log("Items:", items);
});