(() => {
"use strict";

const ADMIN_ROLES = [
"owner",
"admin",
"operator",
"viewer"
];

const CLIENT_ROLE = "client";

const form = document.getElementById("loginForm");
const emailInput = document.getElementById("loginEmail");
const passwordInput = document.getElementById("loginPassword");
const errorBox = document.getElementById("loginError");
const loginButton = document.getElementById("loginButton");
const loginButtonText = document.getElementById("loginButtonText");
const loginButtonArrow = document.getElementById("loginButtonArrow");

if (!form) {
return;
}

function showError(message) {
if (!errorBox) {
return;
}

errorBox.textContent =
  message ||
  "Não foi possível iniciar a sessão.";

errorBox.classList.remove("hidden");

}

function clearError() {
if (!errorBox) {
return;
}

errorBox.textContent = "";
errorBox.classList.add("hidden");

}

function setLoading(loading) {
if (!loginButton) {
return;
}

loginButton.disabled = loading;
loginButton.setAttribute(
  "aria-busy",
  loading ? "true" : "false"
);

if (loginButtonText) {
  loginButtonText.textContent = loading
    ? "A iniciar sessão..."
    : "Entrar na plataforma";
}

if (loginButtonArrow) {
  loginButtonArrow.textContent = loading
    ? "…"
    : "→";
}

}

function redirectByRole(role) {
if (ADMIN_ROLES.includes(role)) {
window.location.replace("/admin");
return;
}

if (role === CLIENT_ROLE) {
  window.location.replace("/");
  return;
}

showError(
  "A sua conta não possui um perfil de acesso válido."
);

setLoading(false);

}

async function getCurrentUser() {
try {
const response = await fetch(
"/api/auth/me",
{
method: "GET",
credentials: "include",
headers: {
Accept: "application/json"
},
cache: "no-store"
}
);

  if (!response.ok) {
    return null;
  }

  const data = await response.json();

  if (
    !data ||
    data.success !== true ||
    !data.user
  ) {
    return null;
  }

  return data.user;
} catch (error) {
  return null;
}

}

async function checkExistingSession() {
const user = await getCurrentUser();

if (!user || !user.role) {
  return;
}

redirectByRole(user.role);

}

async function handleLogin(event) {
event.preventDefault();

clearError();

const email =
  String(emailInput?.value || "")
    .trim()
    .toLowerCase();

const password =
  String(passwordInput?.value || "");

if (!email) {
  showError(
    "Introduza o seu e-mail."
  );

  emailInput?.focus();
  return;
}

if (!password) {
  showError(
    "Introduza a sua palavra-passe."
  );

  passwordInput?.focus();
  return;
}

setLoading(true);

try {
  const response = await fetch(
    "/api/auth/login",
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        email,
        password
      })
    }
  );

  let data = null;

  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (
    !response.ok ||
    !data ||
    data.success !== true
  ) {
    const message =
      data?.error ||
      data?.message ||
      "E-mail ou palavra-passe inválidos.";

    showError(message);
    setLoading(false);
    return;
  }

  const role =
    data.user?.role;

  if (!role) {
    showError(
      "A sessão foi iniciada, mas a conta não possui um perfil de acesso."
    );

    setLoading(false);
    return;
  }

  redirectByRole(role);
} catch (error) {
  showError(
    "Não foi possível contactar a plataforma. Verifique a sua ligação e tente novamente."
  );

  setLoading(false);
}

}

form.addEventListener(
"submit",
handleLogin
);

if (emailInput) {
emailInput.addEventListener(
"input",
clearError
);
}

if (passwordInput) {
passwordInput.addEventListener(
"input",
clearError
);
}

checkExistingSession();
})();
