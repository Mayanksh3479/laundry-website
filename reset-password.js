const SUPABASE_URL = "https://ydcawwkjybtnhicwfqxk.supabase.co";
const SUPABASE_KEY = "sb_publishable_v3aYAOeHqStdF7gnl3QE0w_p5LPkKgt";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const statusText = document.getElementById("reset-status");
const resetForm = document.getElementById("reset-form");
const newPassword = document.getElementById("new-password");
const confirmPassword = document.getElementById("confirm-new-password");
const message = document.getElementById("reset-message");
const submitButton = document.getElementById("reset-submit");

const EXPIRED_TEXT =
  "This reset link is not valid or has expired. Please request a new one from the login page.";

function showMessage(text, isSuccess) {
  message.textContent = text;
  message.className = "auth-message " + (isSuccess ? "success" : "error");
  message.hidden = false;
}

// The same rule as the hint under the password box
function passwordProblem(password) {
  if (password.length < 6) return "Your password must be at least 6 characters.";
  if (!/[A-Z]/.test(password)) return "Add at least one capital letter.";
  if (!/[a-z]/.test(password)) return "Add at least one small letter.";
  if (!/[0-9]/.test(password)) return "Add at least one number.";
  return null;
}

// "Show password" / "Hide password" buttons
document.querySelectorAll(".toggle-pass").forEach(function (button) {
  button.addEventListener("click", function () {
    const input = button.parentElement.querySelector("input");
    const showing = input.type === "password";

    input.type = showing ? "text" : "password";
    button.textContent = showing ? "Hide password" : "Show password";
  });
});

// 1. Is this page open from a real reset link?
let recoveryReady = false;
const linkParams = new URLSearchParams(window.location.hash.slice(1));

if (linkParams.get("error")) {
  // Supabase puts an error in the address when the link is expired or already used
  statusText.textContent = EXPIRED_TEXT;
} else {
  // The Supabase library reads the link and tells us with a PASSWORD_RECOVERY event
  db.auth.onAuthStateChange(function (event) {
    if (event === "PASSWORD_RECOVERY") {
      recoveryReady = true;
      statusText.hidden = true;
      resetForm.hidden = false;
    }
  });

  // If nothing happened after a few seconds, the link is missing or broken
  setTimeout(function () {
    if (!recoveryReady) statusText.textContent = EXPIRED_TEXT;
  }, 4000);
}

// 2. Save the new password
resetForm.addEventListener("submit", async function (event) {
  event.preventDefault();
  message.hidden = true;

  const problem = passwordProblem(newPassword.value);
  if (problem) {
    showMessage(problem, false);
    return;
  }

  if (newPassword.value !== confirmPassword.value) {
    showMessage("The two passwords do not match.", false);
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Saving...";

  const { error } = await db.auth.updateUser({ password: newPassword.value });

  if (error) {
    showMessage(error.message, false);
    submitButton.disabled = false;
    submitButton.textContent = "Save new password";
    return;
  }

  showMessage("Password updated. Taking you to the login page...", true);

  // Sign out so the customer logs in again with the new password
  await db.auth.signOut();

  setTimeout(function () {
    window.location.href = "login.html";
  }, 2000);
});