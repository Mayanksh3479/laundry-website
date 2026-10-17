const SUPABASE_URL = "https://ydcawwkjybtnhicwfqxk.supabase.co";
const SUPABASE_KEY = "sb_publishable_v3aYAOeHqStdF7gnl3QE0w_p5LPkKgt";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const form = document.getElementById("pickup-form");
const addButton = document.getElementById("add-item");
const itemsContainer = document.getElementById("items");

// Turns typed text like "25/12/2026" and "6:30 PM" into a real Date.
// Returns null if the date or time is not valid.
function buildDeliveryDate(dateText, timeText) {
  const [day, month, year] = dateText.split("/").map(Number);

  const match = timeText.trim().match(/^(\d{1,2}):(\d{2})\s?(am|pm)$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour === 12) hour = 0;
  if (match[3].toLowerCase() === "pm") hour += 12;

  const date = new Date(year, month - 1, day, hour, minute);

  // Catches fake dates such as 31/02/2026
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

// "+ Add another item": copy the first row and empty the copy
addButton.addEventListener("click", function () {
  const firstRow = itemsContainer.querySelector(".item-row");
  const newRow = firstRow.cloneNode(true);

  newRow.querySelector('[name="item_category"]').value = "";
  newRow.querySelector('[name="item_quantity"]').value = "1";
  newRow.querySelector('[name="item_photo"]').value = "";

  itemsContainer.appendChild(newRow);
});

// "Remove this item": works for every row, old or new
itemsContainer.addEventListener("click", function (event) {
  if (event.target.classList.contains("remove-item")) {
    const rows = itemsContainer.querySelectorAll(".item-row");
    if (rows.length > 1) {
      event.target.closest(".item-row").remove();
    }
  }
});

// "Send Request"
form.addEventListener("submit", function (event) {
  event.preventDefault();

  // 1. Check the delivery date and time
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

  // 2. Read the list of real categories from the datalist in the HTML
  const validCategories = Array.from(
    document.querySelectorAll("#category-list option")
  ).map(function (option) {
    return option.value;
  });

  // 3. Collect and check every item row
  const items = [];
  const rows = document.querySelectorAll(".item-row");

  for (const row of rows) {
    const category = row.querySelector('[name="item_category"]').value.trim();
    const quantity = Number(row.querySelector('[name="item_quantity"]').value);
    const photos = row.querySelector('[name="item_photo"]').files;

    if (!validCategories.includes(category)) {
      alert("Please pick each category from the suggestion list.");
      return;
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
      alert("Quantity must be a whole number, at least 1.");
      return;
    }

    if (photos.length === 0 || photos.length > 5) {
      alert("Please add 1 to 5 photos for each item.");
      return;
    }

    items.push({ category: category, quantity: quantity, photos: photos });
  }

  // Nothing is saved yet. Next step: send these to Supabase.
  console.log("Delivery:", deliveryDate.toISOString());
  console.log("Items:", items);
});
