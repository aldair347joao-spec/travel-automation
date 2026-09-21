"use strict";

const form =
    document.getElementById(
        "bootstrapForm"
    );

const button =
    document.getElementById(
        "submitButton"
    );

const message =
    document.getElementById(
        "message"
    );

function showMessage(
    text,
    type
) {
    if (!message) {
        return;
    }

    message.textContent =
        String(text || "");

    message.className =
        "message visible " +
        type;
}

function clearMessage() {
    if (!message) {
        return;
    }

    message.textContent = "";

    message.className =
        "message";
}

if (form) {
    form.addEventListener(
        "submit",
        async function (event) {

            event.preventDefault();

            clearMessage();

            const name =
                document
                    .getElementById("name")
                    ?.value
                    ?.trim() ||
                "";

            const email =
                document
                    .getElementById("email")
                    ?.value
                    ?.trim() ||
                "";

            const password =
                document
                    .getElementById("password")
                    ?.value ||
                "";

            const bootstrapToken =
                document
                    .getElementById(
                        "bootstrapToken"
                    )
                    ?.value
                    ?.trim() ||
                "";

            if (
                !name ||
                !email ||
                !password ||
                !bootstrapToken
            ) {
                showMessage(
                    "Preenche todos os campos.",
                    "error"
                );

                return;
            }

            if (password.length < 12) {
                showMessage(
                    "A palavra-passe precisa de ter pelo menos 12 caracteres.",
                    "error"
                );

                return;
            }

            button.disabled = true;

            button.textContent =
                "A criar administrador...";

            try {

                const response =
                    await fetch(
                        "/api/auth/bootstrap",
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json",

                                "x-bootstrap-token":
                                    bootstrapToken
                            },

                            credentials:
                                "same-origin",

                            body:
                                JSON.stringify({
                                    name,
                                    email,
                                    password
                                })
                        }
                    );

                let data = null;

                try {
                    data =
                        await response.json();
                } catch {
                    data = null;
                }

                if (!response.ok) {

                    throw new Error(
                        data?.error ||
                        data?.message ||
                        `Erro HTTP ${response.status}.`
                    );
                }

                showMessage(
                    "Administrador criado com sucesso. A tua conta é OWNER.",
                    "success"
                );

                form.reset();

                button.textContent =
                    "Administrador criado";

                setTimeout(
                    function () {
                        window.location.href =
                            "/";
                    },
                    2500
                );

            } catch (error) {

                console.error(
                    "[BOOTSTRAP]",
                    error
                );

                showMessage(
                    error?.message ||
                    "Não foi possível comunicar com o servidor.",
                    "error"
                );

                button.disabled = false;

                button.textContent =
                    "Criar administrador";
            }
        }
    );
}
