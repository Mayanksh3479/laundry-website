const SUPABASE_URL = "https://ydcawwkjybtnhicwfqxk.supabase.co";
const SUPABASE_KEY = "sb_publishable_v3aYAOeHqStdF7gnl3QE0w_p5LPkKgt";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

console.log("Supabase connected", db);
const form = document.getElementById("pickup-form");

form.addEventListener("submit", function (event) {
  event.preventDefault();

  const name = document.getElementById("name").value;
  const delivery = document.getElementById("delivery").value;

  console.log("Name:", name);
  console.log("Delivery time:", delivery);
});