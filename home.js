const PRICES = [
  { group: "Gents", name: "Pants", price: "₹70" },
  { group: "Gents", name: "Shirt", price: "₹70" },
  { group: "Gents", name: "T-Shirt", price: "₹70" },
  { group: "Gents", name: "Kurta Pajama", price: "₹150" },
  { group: "Gents", name: "Track Suit", price: "₹150" },
  { group: "Gents", name: "Gram Pajama", price: "₹120" },
  { group: "Gents", name: "Sports Shoes", price: "₹250-550" },
  { group: "Gents", name: "School Bag", price: "₹150-250" },
  { group: "Gents", name: "Office Bag", price: "₹200" },
  { group: "Gents", name: "Muffler", price: "₹70" },
  { group: "Gents", name: "Tie", price: "₹50" },
  { group: "Gents", name: "Cap", price: "₹70" },
  { group: "Gents", name: "Mask", price: "₹25" },
  { group: "Gents", name: "Lohi", price: "₹150" },

  { group: "Ladies", name: "Ladies Suit 3p", price: "₹200" },
  { group: "Ladies", name: "Suit Light", price: "₹100-150" },
  { group: "Ladies", name: "Suit (Light Work)", price: "₹150" },
  { group: "Ladies", name: "Suit Single", price: "₹100" },
  { group: "Ladies", name: "Lehanga Choli Dupatta", price: "₹350-550" },
  { group: "Ladies", name: "Lehanga Bridal", price: "₹750-1500" },
  { group: "Ladies", name: "Dupatta", price: "₹70-140" },
  { group: "Ladies", name: "Western Dress", price: "₹350-550" },
  { group: "Ladies", name: "Top Single", price: "₹70" },
  { group: "Ladies", name: "Top Party Wear", price: "₹150-250" },
  { group: "Ladies", name: "Dress Heavy", price: "₹350" },
  { group: "Ladies", name: "Ladies Jeans", price: "₹80" },
  { group: "Ladies", name: "Ladies Shawl", price: "₹120-150" },
  { group: "Ladies", name: "Pashmina Shawl", price: "₹250" },
  { group: "Ladies", name: "Stole", price: "₹90" },
  { group: "Ladies", name: "Saree", price: "₹150-280" },
  { group: "Ladies", name: "Blouse", price: "₹30-100" },
  { group: "Ladies", name: "Long Kurta Boolan", price: "₹120" },
  { group: "Ladies", name: "Jersey Half", price: "₹120" },
  { group: "Ladies", name: "Jersey Full", price: "₹250" },
  { group: "Ladies", name: "Coat Pant Ladies", price: "₹150" },
  { group: "Ladies", name: "Gown", price: "₹150" },
  { group: "Ladies", name: "Gown Heavy", price: "₹350" },
  { group: "Ladies", name: "Frock", price: "₹120-250" },
  { group: "Ladies", name: "Pullover & Cardigan", price: "₹150" },
];

const COLLAPSED_COUNT = 8;

const priceGrid = document.getElementById("price-grid");
const priceSearch = document.getElementById("price-search");
const priceCount = document.getElementById("price-count");
const priceEmpty = document.getElementById("price-empty");
const priceMore = document.getElementById("price-more");
const tabButtons = Array.from(document.querySelectorAll(".tab"));

let activeGroup = "All";
let expanded = false;

function formatPrice(price) {
  return price ? price.replace("-", "–") : null;
}

function buildPriceCard(item) {
  const card = document.createElement("div");
  card.className = "price-card";

  const name = document.createElement("span");
  name.className = "price-name";
  name.textContent = item.name;

  const group = document.createElement("span");
  group.className = "price-group";
  group.textContent = item.group;

  const value = document.createElement("span");
  const text = formatPrice(item.price);
  value.className = text ? "price-value" : "price-value ask";
  value.textContent = text || "Ask in store";

  card.append(name, group, value);
  return card;
}

function matchingPrices() {
  const query = priceSearch.value.trim().toLowerCase();

  return PRICES.filter(function (item) {
    const inGroup = activeGroup === "All" || item.group === activeGroup;
    const inSearch =
      query === "" ||
      item.name.toLowerCase().includes(query) ||
      item.group.toLowerCase().includes(query);

    return inGroup && inSearch;
  });
}

function renderPrices() {
  const matches = matchingPrices();
  const shown = expanded ? matches : matches.slice(0, COLLAPSED_COUNT);

  priceGrid.innerHTML = "";
  shown.forEach(function (item) {
    priceGrid.appendChild(buildPriceCard(item));
  });

  priceEmpty.hidden = matches.length !== 0;

  priceCount.textContent =
    matches.length === 0
      ? ""
      : "Showing " + shown.length + " of " + matches.length + " rates";

  priceMore.hidden = matches.length <= COLLAPSED_COUNT;
  priceMore.textContent = expanded
    ? "Show fewer"
    : "Show all " + matches.length + " rates";
}

priceSearch.addEventListener("input", function () {
  expanded = priceSearch.value.trim() !== "";
  renderPrices();
});

tabButtons.forEach(function (button) {
  button.addEventListener("click", function () {
    activeGroup = button.dataset.group;

    tabButtons.forEach(function (other) {
      const isActive = other === button;
      other.classList.toggle("active", isActive);
      other.setAttribute("aria-pressed", String(isActive));
    });

    renderPrices();
  });
});

priceMore.addEventListener("click", function () {
  expanded = !expanded;
  renderPrices();
});

renderPrices();

const navLinks = Array.from(document.querySelectorAll(".main-nav a"));

const sectionsByLink = navLinks
  .map(function (link) {
    return { link: link, section: document.querySelector(link.getAttribute("href")) };
  })
  .filter(function (entry) {
    return entry.section;
  });

function setActiveLink(activeEntry) {
  sectionsByLink.forEach(function (entry) {
    entry.link.classList.toggle("active", entry === activeEntry);
  });
}

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    function (observed) {
      observed.forEach(function (change) {
        if (!change.isIntersecting) return;

        const entry = sectionsByLink.find(function (item) {
          return item.section === change.target;
        });
        if (entry) setActiveLink(entry);
      });
    },
    { rootMargin: "-40% 0px -55% 0px" }
  );

  sectionsByLink.forEach(function (entry) {
    observer.observe(entry.section);
  });
}