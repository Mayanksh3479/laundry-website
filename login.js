const SUPABASE_URL = "https://ydcawwkjybtnhicwfqxk.supabase.co";
const SUPABASE_KEY = "sb_publishable_v3aYAOeHqStdF7gnl3QE0w_p5LPkKgt";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Where to go after a successful login
const HOME_PAGE = "index.html";
const RESET_PAGE_URL = "https://mayanksh3479.github.io/laundry-website/reset-password.html";

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

let mode = "login"; // "login" or "signup"

// Already logged in? Skip this page.
db.auth.getSession().then(function ({ data }) {
  if (data.session) window.location.replace(HOME_PAGE);
});

function showMessage(text, isError) {
  messageBox.textContent = text;
  messageBox.className = "auth-message " + (isError ? "error" : "success");
  messageBox.hidden = false;
}

function clearMessage() {
  messageBox.hidden = true;
  messageBox.textContent = "";
}

// Show / Hide buttons next to the password fields
document.querySelectorAll(".toggle-pass").forEach(function (button) {
  button.addEventListener("click", function () {
    const input = button.parentElement.querySelector("input");
    const showing = input.type === "text";

    input.type = showing ? "password" : "text";
    button.textContent = showing ? "Show password" : "Hide password";
    button.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  });
});

function resetPasswordFields() {
  passwordInput.value = "";
  confirmInput.value = "";

  document.querySelectorAll(".toggle-pass").forEach(function (button) {
    button.parentElement.querySelector("input").type = "password";
    button.textContent = "Show password";
    button.setAttribute("aria-label", "Show password");
  });
}

function setMode(newMode) {
  mode = newMode;
  const isSignup = mode === "signup";

  tabLogin.classList.toggle("active", !isSignup);
  tabSignup.classList.toggle("active", isSignup);
  tabLogin.setAttribute("aria-selected", String(!isSignup));
  tabSignup.setAttribute("aria-selected", String(isSignup));

  signupFields.hidden = !isSignup;
  confirmField.hidden = !isSignup;
  passwordHint.hidden = !isSignup;
  forgotButton.hidden = isSignup;
  submitButton.textContent = isSignup ? "Create account" : "Log in";
  passwordInput.autocomplete = isSignup ? "new-password" : "current-password";

  resetPasswordFields();
  clearMessage();
}

tabLogin.addEventListener("click", function () {
  setMode("login");
});
tabSignup.addEventListener("click", function () {
  setMode("signup");
});

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

form.addEventListener("submit", async function (event) {
  event.preventDefault();
  clearMessage();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

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
    phone = phoneInput.value.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");

    if (fullName.length < 2) {
      showMessage("Enter your full name.", true);
      return;
    }

    if (!/^[6-9]\d{9}$/.test(phone)) {
      showMessage("Enter a valid 10-digit mobile number.", true);
      return;
    }

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

  const label = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = "Please wait...";

  try {
    if (mode === "login") {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;

      window.location.href = HOME_PAGE;
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

      const { data, error } = await db.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName, phone: phone } },
      });
      if (error) throw error;

      if (data.session) {
        // Email confirmation is switched off in Supabase: logged in right away
        window.location.href = HOME_PAGE;
      } else {
        setMode("login");
        showMessage("Account created. Check your email to confirm it, then log in.", false);
      }
    }
  } catch (error) {
    console.log("Auth failed:", error.message);
    showMessage(friendlyError(error), true);
  } finally {
    submitButton.disabled = false;
    if (submitButton.textContent === "Please wait...") submitButton.textContent = label;
  }
});

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
    showMessage("If this email has an account, a reset link is on its way.", false);
  }
});