

// ---------------------------------------------------------------------------
// login.js
// Handles login, sign-up and "forgot password" for the customer auth page.
// ---------------------------------------------------------------------------

// I connect to my Supabase project. The publishable key is meant to be public,
// my row-level security rules are what keep the data safe.

const SUPABASE_URL = "https://ydcawwkjybtnhicwfqxk.supabase.co";
const SUPABASE_KEY = "sb_publishable_v3aYAOeHqStdF7gnl3QE0w_p5LPkKgt";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Default page to open after a successful login (used when no valid ?next= is given)
const HOME_PAGE = "index.html";

// Pages a user is allowed to be sent back to after logging in.
// Keep this as a strict allow-list so nobody can craft a link like
// login.html?next=https://evil.com and redirect users to another site (open redirect).
const ALLOWED_PAGES = ["index.html", "orders.html", "admin.html"];

// Link where the password-reset email sends the customer
const RESET_PAGE_URL = "https://mayanksh3479.github.io/laundry-website/reset-password.html";

/**
 * Decide where to send the user after login / sign-up.
 * Reads the ?next= value from the URL (e.g. login.html?next=admin.html).
 * Returns that page only if it is in ALLOWED_PAGES, otherwise falls back to HOME_PAGE.
 */
function nextPage() {
  const next = new URLSearchParams(window.location.search).get("next");
  return ALLOWED_PAGES.includes(next) ? next : HOME_PAGE;
}

// --- DOM references --------------------------------------------------------
const form = document.getElementById("auth-form");
const tabLogin = document.getElementById("tab-login");
const tabSignup = document.getElementById("tab-signup");
const signupFields = document.getElementById("signup-fields");
const confirmField = document.getElementById("confirm-field");
const passwordHint = document.getElementById("password-hint");
const submitButton = document.getElementById("auth-submit");
const forgotButton = document.getElementById("forgot-password");
const messageBox = document.getElementById("auth-message");
const nameInput = document.getElementById("full-name");
const phoneInput = document.getElementById("phone");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const confirmInput = document.getElementById("confirm-password");

// Current form mode: "login" or "signup"
let mode = "login";

// Already logged in? Skip this page and go straight to the destination.
db.auth.getSession().then(function ({ data }) {
  if (data.session) window.location.replace(nextPage());
});

// --- Message helpers -------------------------------------------------------

// Show a success or error message above the form
function showMessage(text, isError) {
  messageBox.textContent = text;
  messageBox.className = "auth-message " + (isError ? "error" : "success");
  messageBox.hidden = false;
}

// Hide and empty the message box
function clearMessage() {
  messageBox.hidden = true;
  messageBox.textContent = "";
}

// --- Password show / hide --------------------------------------------------

// Show / Hide buttons next to the password fields
document.querySelectorAll(".toggle-pass").forEach(function (button) {
  button.addEventListener("click", function () {
    const input = button.parentElement.querySelector("input");
    const showing = input.type === "text";

    // Flip between plain text and masked, and keep the label accessible
    input.type = showing ? "password" : "text";
    button.textContent = showing ? "Show password" : "Hide password";
    button.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  });
});

// Clear both password boxes and put the toggles back to "hidden"
function resetPasswordFields() {
  passwordInput.value = "";
  confirmInput.value = "";

  document.querySelectorAll(".toggle-pass").forEach(function (button) {
    button.parentElement.querySelector("input").type = "password";
    button.textContent = "Show password";
    button.setAttribute("aria-label", "Show password");
  });
}

// --- Login / sign-up tabs --------------------------------------------------

// Switch the form between login and sign-up layouts
function setMode(newMode) {
  mode = newMode;
  const isSignup = mode === "signup";

  // Highlight the active tab (and tell screen readers which is selected)
  tabLogin.classList.toggle("active", !isSignup);
  tabSignup.classList.toggle("active", isSignup);
  tabLogin.setAttribute("aria-selected", String(!isSignup));
  tabSignup.setAttribute("aria-selected", String(isSignup));

  // Sign-up needs extra fields; "forgot password" only makes sense on login
  signupFields.hidden = !isSignup;
  confirmField.hidden = !isSignup;
  passwordHint.hidden = !isSignup;
  forgotButton.hidden = isSignup;
  submitButton.textContent = isSignup ? "Create account" : "Log in";
  passwordInput.autocomplete = isSignup ? "new-password" : "current-password";

  // Don't carry a typed password or an old message across tabs
  resetPasswordFields();
  clearMessage();
}

tabLogin.addEventListener("click", function () {
  setMode("login");
});
tabSignup.addEventListener("click", function () {
  setMode("signup");
});

// --- Error handling --------------------------------------------------------

// Turns Supabase errors into a clear reason the customer can act on
function friendlyError(error) {
  const code = (error.code || "").toLowerCase();
  const text = (error.message || "").toLowerCase();

  if (code === "invalid_credentials" || text.includes("invalid login")) {
    return "Email or password is incorrect.";
  }
  if (code === "email_not_confirmed" || text.includes("email not confirmed")) {
    return "Please confirm your email first. Check your inbox for the link.";
  }
  if (code === "user_already_exists" || text.includes("already registered")) {
    return "This email already has an account. Log in instead.";
  }
  if (code === "weak_password" || text.includes("password should")) {
    return "Password is too weak. Use at least 6 characters with a capital letter, a small letter and a number.";
  }
  if (code === "email_address_invalid" || text.includes("invalid email")) {
    return "This email address is not valid. Check it and try again.";
  }
  if (code === "signup_disabled" || text.includes("signups not allowed")) {
    return "New sign-ups are turned off right now. Please contact the shop.";
  }
  if (
    code === "over_request_rate_limit" ||
    code === "over_email_send_rate_limit" ||
    text.includes("rate limit")
  ) {
    return "Too many attempts. Please wait a few minutes and try again.";
  }
  if (text.includes("database error")) {
    return "Your details could not be saved. This mobile number or email may already be in use.";
  }
  if (text.includes("failed to fetch") || text.includes("network")) {
    return "Cannot reach the server. Check your internet connection and try again.";
  }

  // Anything else: show the real reason instead of a vague message
  return error.message
    ? "Could not continue: " + error.message
    : "Could not continue. Please try again.";
}

// --- Form submit (login + sign-up) ----------------------------------------

form.addEventListener("submit", async function (event) {
  // Stop the browser's default page reload; we handle submit ourselves
  event.preventDefault();
  clearMessage();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  // Client-side checks first, so we don't call the server with bad data
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    showMessage("Enter a valid email address.", true);
    return;
  }

  if (mode === "login" && password.length < 1) {
    showMessage("Enter your password.", true);
    return;
  }

  let fullName = "";
  let phone = "";

  if (mode === "signup") {
    fullName = nameInput.value.trim();
    // Keep digits only and drop a leading +91 / 91 country code
    phone = phoneInput.value.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");

    if (fullName.length < 2) {
      showMessage("Enter your full name.", true);
      return;
    }

    // Indian mobile numbers: 10 digits starting with 6-9
    if (!/^[6-9]\d{9}$/.test(phone)) {
      showMessage("Enter a valid 10-digit mobile number.", true);
      return;
    }

    // Password rule: 6+ chars with a lowercase, an uppercase and a digit
    if (
      password.length < 6 ||
      !/[a-z]/.test(password) ||
      !/[A-Z]/.test(password) ||
      !/\d/.test(password)
    ) {
      showMessage("Password needs at least 6 characters, with a capital letter, a small letter and a number.", true);
      return;
    }

    if (password !== confirmInput.value) {
      showMessage("Passwords do not match.", true);
      return;
    }
  }

  // Disable the button while waiting so the form can't be double-submitted
  const label = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = "Please wait...";

  try {
    if (mode === "login") {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;

      // Logged in: send the user back to the page they came from (or home)
      window.location.href = nextPage();
    } else {
      // Stop early if this mobile number already belongs to an account
      const { data: phoneTaken, error: phoneError } = await db.rpc("phone_exists", {
        p_phone: phone,
      });
      if (phoneError) throw phoneError;

      if (phoneTaken) {
        showMessage("This mobile number is already registered. Log in, or use a different number.", true);
        return;
      }

      // Create the account; name and phone are stored as user metadata
      const { data, error } = await db.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName, phone: phone } },
      });
      if (error) throw error;

      if (data.session) {
        // Email confirmation is switched off in Supabase: logged in right away
        window.location.href = nextPage();
      } else {
        // Email confirmation is on: ask the customer to confirm, then log in
        setMode("login");
        showMessage("Account created. Check your email to confirm it, then log in.", false);
      }
    }
  } catch (error) {
    console.log("Auth failed:", error.message);
    showMessage(friendlyError(error), true);
  } finally {
    // Always re-enable the button, whether the attempt worked or failed
    submitButton.disabled = false;
    if (submitButton.textContent === "Please wait...") submitButton.textContent = label;
  }
});

// --- Forgot password -------------------------------------------------------

forgotButton.addEventListener("click", async function () {
  clearMessage();
  const email = emailInput.value.trim();

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    showMessage("Type your email above, then press this button again.", true);
    return;
  }

  // The reset link in the email sends the customer to the reset page
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: RESET_PAGE_URL,
  });

  if (error) {
    showMessage(friendlyError(error), true);
  } else {
    // Same wording whether or not the email exists, so we don't leak which emails have accounts
    showMessage("If this email has an account, a reset link is on its way.", false);
  }
});