"use strict";

/*
 * ============================================================
 * TRAVEL AUTOMATION
 * FRONTEND FINAL WORKFLOW
 * ============================================================
 *
 * CLIENTE
 *   ↓
 * PASSAPORTE
 *   ↓
 * IDENTIDADE — 10 POSIÇÕES
 *   ↓
 * PREFERÊNCIAS
 *   ↓
 * CANDIDATURA
 *   ↓
 * AGUARDANDO ADMINISTRAÇÃO
 *   ↓
 * ADMIN LIBERA
 *   ↓
 * BOT 1 + BOT 2
 *   ↓
 * VAGA
 *   ↓
 * AGENDAMENTO
 *   ↓
 * PAGAMENTO
 *
 * REGRAS:
 * - Não envia credenciais VFS.
 * - Não chama /prepare pelo cliente.
 * - Não inicia Bot 1.
 * - Não inicia Bot 2.
 * - Não inicia radar.
 * - O backend é a autoridade.
 * - Mantém as 10 posições faciais existentes.
 * - Passaporte máximo: 2 MB.
 * ============================================================
 */

(() => {
    "use strict";

    const state = {
        applicationId: null,
        clientId: null,
        submitting: false,
        refreshTimer: null,
        observer: null,
        initialized: false
    };

    const $ = (id) =>
        document.getElementById(id);

    const $$ = (selector) =>
        Array.from(
            document.querySelectorAll(selector)
        );


    /* =========================================================
       HELPERS
    ========================================================= */

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }


    function getCookie(name) {
        const cookies = document.cookie
            ? document.cookie.split(";")
            : [];

        for (const cookie of cookies) {
            const parts = cookie.trim().split("=");

            const key = parts.shift();

            if (key === name) {
                return decodeURIComponent(
                    parts.join("=")
                );
            }
        }

        return null;
    }


    function getCsrfToken() {
        return (
            getCookie("csrf_token") ||
            getCookie("csrfToken") ||
            null
        );
    }


    function showToast(
        message,
        type = "info"
    ) {
        const container =
            $("toastContainer");

        if (!container) {
            console[type === "error"
                ? "error"
                : "log"](
                "[TRAVEL AUTOMATION]",
                message
            );

            return;
        }

        const toast =
            document.createElement("div");

        toast.className =
            `toast ${type}`;

        toast.textContent =
            message;

        container.appendChild(
            toast
        );

        window.setTimeout(() => {
            toast.style.opacity =
                "0";

            toast.style.transform =
                "translateY(8px)";

            window.setTimeout(
                () => toast.remove(),
                250
            );
        }, 4000);
    }


    function formatDate(value) {
        if (!value) {
            return "—";
        }

        const date =
            new Date(value);

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            return String(value);
        }

        return new Intl.DateTimeFormat(
            "pt-PT",
            {
                day: "2-digit",
                month: "2-digit",
                year: "numeric"
            }
        ).format(date);
    }


    function formatMoney(
        amount,
        currency = "EUR"
    ) {
        if (
            amount === null ||
            amount === undefined ||
            amount === ""
        ) {
            return "—";
        }

        const numeric =
            Number(amount);

        if (
            Number.isNaN(numeric)
        ) {
            return escapeHtml(
                String(amount)
            );
        }

        try {
            return new Intl.NumberFormat(
                "pt-PT",
                {
                    style: "currency",
                    currency:
                        currency || "EUR"
                }
            ).format(numeric);
        } catch {
            return `${numeric} ${
                currency || ""
            }`.trim();
        }
    }


    async function api(
        path,
        options = {}
    ) {
        const headers = {
            Accept:
                "application/json",
            ...(options.headers || {})
        };

        const method =
            String(
                options.method ||
                "GET"
            ).toUpperCase();

        if (
            options.body &&
            !(options.body instanceof FormData)
        ) {
            headers[
                "Content-Type"
            ] =
                "application/json";
        }

        const csrf =
            getCsrfToken();

        if (
            csrf &&
            method !== "GET"
        ) {
            headers[
                "x-csrf-token"
            ] = csrf;
        }

        const response =
            await fetch(
                path,
                {
                    ...options,
                    method,
                    credentials:
                        "include",
                    headers
                }
            );

        let data = null;

        const contentType =
            response.headers.get(
                "content-type"
            ) || "";

        if (
            contentType.includes(
                "application/json"
            )
        ) {
            try {
                data =
                    await response.json();
            } catch {
                data = null;
            }
        } else {
            try {
                const text =
                    await response.text();

                data = {
                    message: text
                };
            } catch {
                data = null;
            }
        }

        if (!response.ok) {
            const error =
                new Error(
                    data?.error ||
                    data?.message ||
                    `Erro HTTP ${response.status}`
                );

            error.status =
                response.status;

            error.data =
                data;

            throw error;
        }

        return data;
    }


    /* =========================================================
       APPLICATION STATE
    ========================================================= */

    function getAdminStatus(
        application
    ) {
        return (
            application?.admin ||
            application?.adminControl ||
            {}
        );
    }


    function getApplicationStatus(
        application
    ) {
        const admin =
            getAdminStatus(
                application
            );

        return (
            admin.status ||
            application?.workflowState ||
            application?.status ||
            "PENDING_REVIEW"
        );
    }


    function getPayment(
        application
    ) {
        return (
            application?.payment ||
            application?.result ||
            {}
        );
    }


    function normalizeStatus(
        value
    ) {
        return String(
            value || ""
        )
            .trim()
            .toUpperCase();
    }


    /* =========================================================
       WEEKDAYS
    ========================================================= */

    const WEEKDAYS = [
        {
            value: 1,
            short: "SEG",
            label: "Segunda-feira"
        },
        {
            value: 2,
            short: "TER",
            label: "Terça-feira"
        },
        {
            value: 3,
            short: "QUA",
            label: "Quarta-feira"
        },
        {
            value: 4,
            short: "QUI",
            label: "Quinta-feira"
        },
        {
            value: 5,
            short: "SEX",
            label: "Sexta-feira"
        },
        {
            value: 6,
            short: "SÁB",
            label: "Sábado"
        },
        {
            value: 0,
            short: "DOM",
            label: "Domingo"
        }
    ];


    /* =========================================================
       PREFERENCES
    ========================================================= */

    function ensurePreferenceFields() {
        const form =
            $("applicationForm");

        if (!form) {
            return;
        }

        if (
            $("frontendPreferenceBlock")
        ) {
            updatePreferenceSummary();
            return;
        }

        const block =
            document.createElement(
                "section"
            );

        block.id =
            "frontendPreferenceBlock";

        block.className =
            "frontend-final-preferences";

        block.innerHTML = `
            <div class="frontend-final-preferences-header">
                <span>04 · PREFERÊNCIAS</span>

                <strong>
                    Defina como pretende o agendamento
                </strong>

                <small>
                    O sistema utilizará estas preferências
                    para procurar vagas compatíveis.
                </small>
            </div>

            <div class="frontend-final-grid">

                <label class="frontend-field">
                    <span>Tipo de serviço</span>

                    <select id="frontendServiceType">
                        <option value="STANDARD">
                            Standard
                        </option>

                        <option value="EXPRESS">
                            Express
                        </option>
                    </select>
                </label>


                <label class="frontend-field">
                    <span>Modo de atendimento</span>

                    <select id="frontendAppointmentMode">
                        <option value="VFS_APPOINTMENT">
                            Atendimento VFS
                        </option>
                    </select>
                </label>

            </div>


            <div class="frontend-final-weekdays">

                <span>
                    Dias preferidos
                </span>

                <div class="frontend-final-weekday-grid">

                    ${WEEKDAYS.map(day => `
                        <label class="frontend-final-day">

                            <input
                                type="checkbox"
                                name="preferredWeekdays"
                                value="${day.value}"
                            >

                            <span>
                                ${escapeHtml(
                                    day.short
                                )}
                            </span>

                        </label>
                    `).join("")}

                </div>

            </div>


            <div
                id="frontendFinalPreferenceSummary"
                class="frontend-final-summary"
            ></div>
        `;

        form.appendChild(
            block
        );

        updatePreferenceSummary();
    }


    function getCheckedWeekdays() {
        return $$(
            'input[name="preferredWeekdays"]:checked'
        )
            .map(
                input =>
                    Number(
                        input.value
                    )
            )
            .filter(
                value =>
                    Number.isInteger(
                        value
                    )
            );
    }


    function getFinalPreferences() {
        return {
            visaType:
                $(
                    "applicationVisaType"
                )?.value
                    ?.trim()
                    .toUpperCase() ||
                "",

            visaCenter:
                $(
                    "applicationVisaCenter"
                )?.value
                    ?.trim() ||
                "",

            travelPurpose:
                $(
                    "applicationTravelPurpose"
                )?.value
                    ?.trim() ||
                "",

            serviceType:
                $(
                    "frontendServiceType"
                )?.value ||
                "STANDARD",

            appointmentMode:
                $(
                    "frontendAppointmentMode"
                )?.value ||
                "VFS_APPOINTMENT",

            preferredDates: {
                start:
                    $(
                        "preferredStartDate"
                    )?.value ||
                    null,

                end:
                    $(
                        "preferredEndDate"
                    )?.value ||
                    null
            },

            preferredTime:
                $(
                    "preferredTime"
                )?.value ||
                null,

            preferredWeekdays:
                getCheckedWeekdays()
        };
    }


    function updatePreferenceSummary() {
        const summary =
            $(
                "frontendFinalPreferenceSummary"
            );

        if (!summary) {
            return;
        }

        const preferences =
            getFinalPreferences();

        const weekdays =
            preferences
                .preferredWeekdays
                .map(
                    value =>
                        WEEKDAYS.find(
                            day =>
                                day.value ===
                                value
                        )
                )
                .filter(Boolean);

        const period =
            preferences
                .preferredDates
                .start &&
            preferences
                .preferredDates
                .end
                ? `${
                    preferences
                        .preferredDates
                        .start
                } → ${
                    preferences
                        .preferredDates
                        .end
                }`
                : "Não definido";

        summary.innerHTML = `
            <strong>
                Resumo da procura
            </strong>

            <span>
                Centro:
                ${escapeHtml(
                    preferences.visaCenter ||
                    "Não definido"
                )}
            </span>

            <span>
                Período:
                ${escapeHtml(period)}
            </span>

            <span>
                Horário:
                ${escapeHtml(
                    preferences.preferredTime ||
                    "Qualquer horário"
                )}
            </span>

            <span>
                Dias:
                ${escapeHtml(
                    weekdays.length
                        ? weekdays
                            .map(
                                day =>
                                    day.label
                            )
                            .join(", ")
                        : "Qualquer dia"
                )}
            </span>

            <span>
                Serviço:
                ${escapeHtml(
                    preferences.serviceType
                )}
            </span>
        `;
    }


    function validatePreferences(
        preferences
    ) {
        if (
            ![
                "SCHENGEN",
                "NACIONAL"
            ].includes(
                preferences.visaType
            )
        ) {
            return {
                valid: false,
                message:
                    "Selecione o tipo de visto."
            };
        }

        if (
            !preferences.visaCenter
        ) {
            return {
                valid: false,
                message:
                    "O centro VFS é obrigatório."
            };
        }

        if (
            !preferences
                .preferredDates
                .start ||
            !preferences
                .preferredDates
                .end
        ) {
            return {
                valid: false,
                message:
                    "Defina o período de datas."
            };
        }

        const start =
            new Date(
                `${preferences
                    .preferredDates
                    .start}T00:00:00`
            );

        const end =
            new Date(
                `${preferences
                    .preferredDates
                    .end}T23:59:59`
            );

        if (
            Number.isNaN(
                start.getTime()
            ) ||
            Number.isNaN(
                end.getTime()
            )
        ) {
            return {
                valid: false,
                message:
                    "As datas selecionadas não são válidas."
            };
        }

        if (
            end < start
        ) {
            return {
                valid: false,
                message:
                    "A data final não pode ser anterior à inicial."
            };
        }

        return {
            valid: true
        };
    }


    /* =========================================================
       CLIENT
    ========================================================= */

    function detectClientId() {
        const applicationForm = $("applicationForm");

const values = [
    state.clientId,
    applicationForm?.dataset?.clientId,
    $("applicationClient")?.value,
    $("identityClient")?.value,
    $("passportClientSelect")?.value
];

        const found =
            values.find(
                value =>
                    value &&
                    String(
                        value
                    ).trim()
            );

        if (found) {
            state.clientId =
                String(found).trim();
        }

        return state.clientId;
    }


    /* =========================================================
       ADMIN WAITING
    ========================================================= */

    function ensureAdminWaitingPanel() {
        const form =
            $("applicationForm");

        if (!form) {
            return;
        }

        if (
            $("frontendAdminWaiting")
        ) {
            return;
        }

        const panel =
            document.createElement(
                "section"
            );

        panel.id =
            "frontendAdminWaiting";

        panel.className =
            "frontend-final-admin-waiting";

        panel.hidden =
            true;

        panel.innerHTML = `
            <div
                id="frontendAdminWaitingIcon"
                class="frontend-final-status-icon"
            >
                ✓
            </div>

            <div class="frontend-final-status-copy">

                <span>
                    PROCESSO RECEBIDO
                </span>

                <strong id="frontendAdminWaitingTitle">
                    AGUARDANDO ADMINISTRAÇÃO
                </strong>

                <small id="frontendAdminWaitingText">
                    A candidatura foi recebida.
                    A administração precisa configurar
                    e liberar o processo antes de qualquer
                    automação VFS.
                </small>

                <div
                    id="frontendAdminWaitingMeta"
                    class="frontend-final-state-row"
                ></div>

            </div>

            <span
                id="frontendAdminWaitingBadge"
                class="frontend-final-status-badge pending"
            >
                AGUARDANDO
            </span>
        `;

        form.parentNode.insertBefore(
            panel,
            form.nextSibling
        );
    }


    function renderAdminStatus(
        application
    ) {
        ensureAdminWaitingPanel();

        const panel =
            $("frontendAdminWaiting");

        if (!panel) {
            return;
        }

        const admin =
            getAdminStatus(
                application
            );

        const status =
            normalizeStatus(
                admin.status ||
                application?.workflowState ||
                application?.status ||
                "PENDING_REVIEW"
            );

        const title =
            $("frontendAdminWaitingTitle");

        const text =
            $("frontendAdminWaitingText");

        const badge =
            $("frontendAdminWaitingBadge");

        const icon =
            $("frontendAdminWaitingIcon");

        const meta =
            $("frontendAdminWaitingMeta");

        panel.hidden =
            false;

        if (
            status ===
            "PENDING_REVIEW"
        ) {
            if (title) {
                title.textContent =
                    "AGUARDANDO ADMINISTRAÇÃO";
            }

            if (text) {
                text.textContent =
                    "Os seus dados foram recebidos. A administração irá verificar o processo, configurar os dados necessários e decidir quando liberá-lo para automação.";
            }

            if (badge) {
                badge.textContent =
                    "AGUARDANDO";
                badge.className =
                    "frontend-final-status-badge pending";
            }

            if (icon) {
                icon.textContent =
                    "✓";
                icon.className =
                    "frontend-final-status-icon";
            }

            if (meta) {
                meta.innerHTML = `
                    <strong>
                        Nenhuma automação está ativa.
                    </strong>
                    <span>
                        O processo permanece protegido até a liberação administrativa.
                    </span>
                `;
            }

            disableApplicationForm();

            return;
        }


        if (
            status ===
            "READY_FOR_AUTOMATION"
        ) {
            if (title) {
                title.textContent =
                    "PROCESSO LIBERADO";
            }

            if (text) {
                text.textContent =
                    "A administração liberou o processo. A partir deste ponto, o servidor poderá iniciar a automação conforme as regras do processo.";
            }

            if (badge) {
                badge.textContent =
                    "LIBERADO";
                badge.className =
                    "frontend-final-status-badge active";
            }

            if (icon) {
                icon.textContent =
                    "✓";
                icon.className =
                    "frontend-final-status-icon success";
            }

            if (meta) {
                meta.innerHTML = `
                    <strong>
                        Automação autorizada pelo servidor.
                    </strong>
                `;
            }

            disableApplicationForm();

            return;
        }


        if (
            status ===
            "AUTOMATION_ACTIVE"
        ) {
            if (title) {
                title.textContent =
                    "AUTOMAÇÃO EM EXECUÇÃO";
            }

            if (text) {
                text.textContent =
                    "O processo foi liberado e os serviços de automação estão a ser executados pelo backend.";
            }

            if (badge) {
                badge.textContent =
                    "ATIVO";
                badge.className =
                    "frontend-final-status-badge active";
            }

            if (icon) {
                icon.textContent =
                    "●";
                icon.className =
                    "frontend-final-status-icon success";
            }

            if (meta) {
                meta.innerHTML = `
                    <strong>
                        Bot 1 e Bot 2 controlados pelo servidor.
                    </strong>
                `;
            }

            disableApplicationForm();

            return;
        }


        if (
            status ===
            "PAUSED"
        ) {
            if (title) {
                title.textContent =
                    "PROCESSO PAUSADO";
            }

            if (text) {
                text.textContent =
                    "A administração colocou o processo em pausa.";
            }

            if (badge) {
                badge.textContent =
                    "PAUSADO";
                badge.className =
                    "frontend-final-status-badge pending";
            }

            if (meta) {
                meta.innerHTML = `
                    <strong>
                        Nenhuma nova automação será iniciada.
                    </strong>
                `;
            }

            disableApplicationForm();

            return;
        }


        if (
            status ===
            "COMPLETED"
        ) {
            if (title) {
                title.textContent =
                    "PROCESSO CONCLUÍDO";
            }

            if (text) {
                text.textContent =
                    "O processo foi concluído.";
            }

            if (badge) {
                badge.textContent =
                    "CONCLUÍDO";
                badge.className =
                    "frontend-final-status-badge active";
            }

            if (icon) {
                icon.textContent =
                    "✓";
                icon.className =
                    "frontend-final-status-icon success";
            }

            if (meta) {
                meta.innerHTML = `
                    <strong>
                        Processo encerrado pelo servidor.
                    </strong>
                `;
            }

            disableApplicationForm();

            return;
        }
    }


    function disableApplicationForm() {
    // O formulário da candidatura deve permanecer disponível.
    // A candidatura só deve ser bloqueada durante o envio
    // através do estado state.submitting.
    return;
}
    /* =========================================================
       PAYMENT
    ========================================================= */

    function ensurePaymentPanel() {
        const mount =
            $("verificationSection");

        if (!mount) {
            return;
        }

        if (
            $("frontendPaymentPanel")
        ) {
            return;
        }

        const panel =
            document.createElement(
                "section"
            );

        panel.id =
            "frontendPaymentPanel";

        panel.className =
            "frontend-final-payment";

        panel.hidden =
            true;

        panel.innerHTML = `
            <div class="frontend-final-payment-header">

                <div>
                    <span>
                        PAGAMENTO
                    </span>

                    <strong>
                        Dados do pagamento
                    </strong>
                </div>

                <div
                    id="frontendPaymentStatusIcon"
                    class="frontend-final-payment-status pending"
                >
                    €
                </div>

            </div>

            <div
                id="frontendPaymentGrid"
                class="frontend-final-payment-grid"
            ></div>

            <p
                id="frontendPaymentText"
            ></p>

            <a
                id="frontendPaymentConfirmation"
                class="frontend-final-confirmation-link"
                href="#"
                target="_blank"
                rel="noopener noreferrer"
                hidden
            >
                Abrir confirmação
                →
            </a>
        `;

        mount.appendChild(
            panel
        );
    }


    function renderPayment(
        application
    ) {
        ensurePaymentPanel();

        const panel =
            $("frontendPaymentPanel");

        if (!panel) {
            return;
        }

        const payment =
            getPayment(
                application
            );

        const reference =
            payment.reference ||
            payment.referenceNumber ||
            payment.referenceNo ||
            null;

        const entity =
            payment.entity ||
            payment.entityNumber ||
            null;

        const amount =
            payment.amount ??
            payment.paymentAmount ??
            null;

        const currency =
            payment.currency ||
            payment.paymentCurrency ||
            null;

        const deadline =
            payment.deadline ||
            payment.paymentDeadline ||
            null;

        const status =
            normalizeStatus(
                payment.status ||
                payment.paymentStatus ||
                ""
            );

        const transactionId =
            payment.transactionId ||
            payment.transactionID ||
            null;

        const confirmationUrl =
            payment.confirmationUrl ||
            payment.confirmationURL ||
            null;

        const hasPayment =
            Boolean(
                reference ||
                entity ||
                amount !== null ||
                deadline ||
                transactionId ||
                status
            );

        if (!hasPayment) {
            panel.hidden =
                true;

            return;
        }

        panel.hidden =
            false;

        const grid =
            $("frontendPaymentGrid");

        if (grid) {
            grid.innerHTML = `
                <div>
                    <span>REFERÊNCIA</span>
                    <strong>
                        ${escapeHtml(
                            reference || "—"
                        )}
                    </strong>
                </div>

                <div>
                    <span>ENTIDADE</span>
                    <strong>
                        ${escapeHtml(
                            entity || "—"
                        )}
                    </strong>
                </div>

                <div>
                    <span>VALOR</span>
                    <strong>
                        ${escapeHtml(
                            amount !== null
                                ? formatMoney(
                                    amount,
                                    currency
                                )
                                : "—"
                        )}
                    </strong>
                </div>

                <div>
                    <span>PRAZO</span>
                    <strong>
                        ${escapeHtml(
                            deadline
                                ? formatDate(
                                    deadline
                                )
                                : "—"
                        )}
                    </strong>
                </div>

                <div>
                    <span>ESTADO</span>
                    <strong>
                        ${escapeHtml(
                            formatPaymentStatus(
                                status
                            )
                        )}
                    </strong>
                </div>

                <div>
                    <span>TRANSAÇÃO</span>
                    <strong>
                        ${escapeHtml(
                            transactionId ||
                            "—"
                        )}
                    </strong>
                </div>
            `;
        }

        const statusIcon =
            $("frontendPaymentStatusIcon");

        if (statusIcon) {
            if (
                status ===
                "PAYMENT_CONFIRMED"
            ) {
                statusIcon.textContent =
                    "✓";

                statusIcon.className =
                    "frontend-final-payment-status confirmed";
            } else {
                statusIcon.textContent =
                    "€";

                statusIcon.className =
                    "frontend-final-payment-status pending";
            }
        }

        const text =
            $("frontendPaymentText");

        if (text) {
            if (
                status ===
                "PAYMENT_CONFIRMED"
            ) {
                text.textContent =
                    "O pagamento foi confirmado pelo backend.";
            } else {
                text.textContent =
                    "Pagamento pendente. Utilize os dados apresentados para concluir o pagamento dentro do prazo indicado.";
            }
        }

        const confirmation =
            $("frontendPaymentConfirmation");

        if (
            confirmation &&
            confirmationUrl
        ) {
            confirmation.href =
                confirmationUrl;

            confirmation.hidden =
                false;
        } else if (
            confirmation
        ) {
            confirmation.hidden =
                true;
        }
    }


    function formatPaymentStatus(
        status
    ) {
        const map = {
            PAYMENT_PENDING:
                "Pagamento pendente",

            PAYMENT_CONFIRMED:
                "Pagamento confirmado",

            PENDING:
                "Pendente",

            CONFIRMED:
                "Confirmado",

            FAILED:
                "Falhou",

            EXPIRED:
                "Expirado",

            COMPLETED:
                "Concluído"
        };

        return (
            map[status] ||
            status ||
            "Pendente"
        );
    }


    /* =========================================================
       BOT / WORKFLOW STATE
    ========================================================= */

    function renderBotStates(
        application
    ) {
        const bot1 =
            application?.bot1 ||
            {};

        const bot2 =
            application?.bot2 ||
            {};

        const workflow =
            application?.workflowState ||
            application?.status ||
            "—";

        if ($("bot1State")) {
            $("bot1State").textContent =
                formatBotState(
                    bot1.status
                );
        }

        if ($("bot2State")) {
            $("bot2State").textContent =
                formatBotState(
                    bot2.status
                );
        }

        if ($("supervisorState")) {
            $("supervisorState").textContent =
                formatWorkflowState(
                    workflow
                );
        }

        if ($("bot1LastAction")) {
            $("bot1LastAction").textContent =
                formatBotState(
                    bot1.status
                );
        }

        if ($("bot2LastAction")) {
            $("bot2LastAction").textContent =
                formatBotState(
                    bot2.status
                );
        }
    }


    function formatBotState(
        status
    ) {
        const map = {
            idle:
                "Aguardando administração",

            starting:
                "A iniciar",

            running:
                "Em execução",

            waiting:
                "A aguardar",

            continuing:
                "A continuar",

            completed:
                "Concluído",

            requires_user:
                "Requer atenção",

            error:
                "Erro",

            monitoring:
                "A monitorizar",

            slot_found:
                "Vaga encontrada",

            cooldown:
                "A aguardar nova ronda",

            stopped:
                "Parado"
        };

        return (
            map[status] ||
            status ||
            "Aguardando"
        );
    }


    function formatWorkflowState(
        state
    ) {
        const map = {
            CREATED:
                "Criado",

            READY_FOR_AUTOMATION:
                "Pronto para automação",

            VFS_SESSION:
                "Sessão VFS",

            VFS_AUTHENTICATING:
                "Autenticação VFS",

            VFS_AUTHENTICATED:
                "VFS autenticado",

            RADAR_ACTIVE:
                "Radar ativo",

            SLOT_FOUND:
                "Vaga encontrada",

            SLOT_LOCKED:
                "Vaga bloqueada",

            SLOT_REVALIDATED:
                "Vaga revalidada",

            BOOKING:
                "Agendamento",

            DOCUMENT_UPLOAD:
                "Documentos",

            PASSPORT_UPLOADING:
                "Passaporte",

            PASSPORT_UPLOADED:
                "Passaporte enviado",

            FACIAL_POSITION_REQUESTED:
                "Verificação facial",

            FACIAL_VERIFICATION_COMPLETED:
                "Facial concluído",

            OTP_REQUIRED:
                "OTP solicitado",

            OTP_VERIFIED:
                "OTP validado",

            REVIEW:
                "Revisão",

            APPOINTMENT_BOOKED:
                "Agendamento concluído",

            PAYMENT_PENDING:
                "Pagamento pendente",

            PAYMENT_CONFIRMED:
                "Pagamento confirmado",

            COMPLETED:
                "Concluído",

            ERROR:
                "Erro"
        };

        return (
            map[state] ||
            state ||
            "Aguardando"
        );
    }


    /* =========================================================
       APPLICATION
    ========================================================= */

    async function submitApplication(event) {
    if (event) {
        event.preventDefault();

        if (typeof event.stopPropagation === "function") {
            event.stopPropagation();
        }

        if (typeof event.stopImmediatePropagation === "function") {
            event.stopImmediatePropagation();
        }
    }

    if (state.submitting) {
        return;
    }

    const form = $("applicationForm");
    const button = $("applicationSubmitButton");

    if (!form) {
        showToast(
            "Formulário da candidatura não encontrado.",
            "error"
        );
        return;
    }

    ensurePreferenceFields();

    const clientId = detectClientId();

    if (!clientId) {
        showToast(
            "Selecione o cliente antes de enviar a candidatura.",
            "error"
        );
        return;
    }

    const preferences = getFinalPreferences();

    const validation =
        validatePreferences(preferences);

    if (!validation.valid) {
        showToast(
            validation.message,
            "error"
        );
        return;
    }

    state.clientId = clientId;

    form.dataset.clientId =
        String(clientId);

    state.submitting = true;

    form.dataset.applicationSubmitting =
        "true";

    const originalButtonText =
        button
            ? button.innerHTML
            : "";

    if (button) {
        button.disabled = true;

        button.dataset.originalText =
            originalButtonText;

        button.innerHTML = `
            <span>Enviando candidatura...</span>
        `;
    }

    try {
        const idempotencyKey =
            `application-${clientId}-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 10)}`;

        /*
         * IMPORTANTE:
         * api() já devolve o JSON da resposta.
         * Portanto NÃO usamos response.ok nem response.json().
         */
        const data = await api(
            "/api/applications",
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json",

                    "Idempotency-Key":
                        idempotencyKey
                },

                body: JSON.stringify({
                    clientId,

                    visaType:
                        preferences.visaType,

                    visaCenter:
                        preferences.visaCenter,

                    travelPurpose:
                        preferences.travelPurpose,

                    serviceType:
                        preferences.serviceType,

                    appointmentMode:
                        preferences.appointmentMode,

                    preferredDates: {
                        start:
                            preferences
                                .preferredDates
                                .start,

                        end:
                            preferences
                                .preferredDates
                                .end
                    },

                    preferredTime:
                        preferences.preferredTime,

                    preferredWeekdays:
                        preferences
                            .preferredWeekdays
                })
            }
        );

        const application =
            data?.application ||
            data?.data?.application ||
            null;

        if (!application) {
            throw new Error(
                "A candidatura foi processada, mas o servidor não devolveu os dados da candidatura."
            );
        }

        state.applicationId =
            application._id ||
            application.id ||
            null;

        state.clientId =
            application.client?._id ||
            application.client?.id ||
            application.clientId ||
            clientId;

        form.dataset.clientId =
            String(state.clientId);

        document.body.dataset.applicationSubmitted =
            "true";

        updateApplicationInterface(
            application
        );

        showToast(
            "Candidatura enviada com sucesso para a Administração.",
            "success"
        );

        const waitingPanel =
            $("frontendAdminWaiting");

        if (waitingPanel) {
            window.setTimeout(() => {
                waitingPanel.scrollIntoView({
                    behavior: "smooth",
                    block: "center"
                });
            }, 120);
        }

    } catch (error) {
        console.error(
            "[TRAVEL AUTOMATION] Erro ao enviar candidatura:",
            error
        );

        /*
         * Se a API respondeu com erro, tentamos descobrir
         * se a candidatura já foi criada antes de informar
         * definitivamente o colaborador.
         */
        try {
            const recoveryData =
                await api(
                    "/api/applications",
                    {
                        method: "GET"
                    }
                );

            const applications =
                Array.isArray(
                    recoveryData?.applications
                )
                    ? recoveryData.applications
                    : Array.isArray(
                        recoveryData
                    )
                        ? recoveryData
                        : [];

            const recoveredApplication =
                applications.find(
                    application => {
                        const recoveredClientId =
                            application?.client?._id ||
                            application?.client?.id ||
                            application?.clientId;

                        return (
                            recoveredClientId &&
                            String(
                                recoveredClientId
                            ) ===
                            String(clientId)
                        );
                    }
                );

            if (recoveredApplication) {
                state.applicationId =
                    recoveredApplication._id ||
                    recoveredApplication.id ||
                    null;

                state.clientId =
                    recoveredApplication.client?._id ||
                    recoveredApplication.client?.id ||
                    recoveredApplication.clientId ||
                    clientId;

                form.dataset.clientId =
                    String(state.clientId);

                document.body.dataset.applicationSubmitted =
                    "true";

                updateApplicationInterface(
                    recoveredApplication
                );

                showToast(
                    "A candidatura já foi recebida pela Administração.",
                    "success"
                );

                return;
            }

        } catch (recoveryError) {
            console.warn(
                "[TRAVEL AUTOMATION] Não foi possível recuperar a candidatura:",
                recoveryError
            );
        }

        showToast(
            error?.message ||
            "Não foi possível enviar a candidatura. Tente novamente.",
            "error"
        );

   } finally {
        state.submitting = false;

        delete form.dataset.applicationSubmitting;

        if (button) {
            button.disabled = false;

            if (
                button.dataset.originalText
            ) {
                button.innerHTML =
                    button.dataset.originalText;
            } else {
                button.innerHTML = `
                    Enviar candidatura
                    <span>→</span>
                `;
            }

            delete button.dataset.originalText;
        }
    }
} 
    function scrollToAdminPanel() {
        window.setTimeout(
            () => {
                $("frontendAdminWaiting")
                    ?.scrollIntoView({
                        behavior:
                            "smooth",
                        block:
                            "center"
                    });
            },
            120
        );
    }


    /* =========================================================
       OLD PREPARE CONTROLS
    ========================================================= */

    function neutralizePrepareButtons() {
        const selectors = [
            '[data-action="prepare"]',
            "#prepareApplicationButton",
            "#prepareButton",
            ".prepare-application-button"
        ];

        selectors.forEach(
            selector => {
                $$(selector).forEach(
                    button => {
                        if (
                            button.dataset
                                .frontendFinalBound ===
                            "true"
                        ) {
                            return;
                        }

                        button.dataset
                            .frontendFinalBound =
                            "true";

                        button.textContent =
                            "Aguardar administração";

                        button.classList.add(
                            "admin-gated"
                        );

                        button.addEventListener(
                            "click",
                            event => {
                                event.preventDefault();
                                event.stopPropagation();

                                if (
                                    typeof event.stopImmediatePropagation ===
                                    "function"
                                ) {
                                    event.stopImmediatePropagation();
                                }

                                showToast(
                                    "A administração precisa liberar este processo antes da automação.",
                                    "info"
                                );
                            },
                            true
                        );
                    }
                );
            }
        );
    }


    /* =========================================================
       PASSPORT
    ========================================================= */

    function bindPassportLimit() {
        const input =
            $("passportFile");

        if (!input) {
            return;
        }

        const limit =
            2 * 1024 * 1024;

        const limitLabel =
            document.querySelector(
                ".passport-upload-limit"
            );

        if (limitLabel) {
            limitLabel.textContent =
                "MÁX. 2 MB";
        }

        if (
            input.dataset
                .frontendFinalPassportBound ===
            "true"
        ) {
            return;
        }

        input.dataset
            .frontendFinalPassportBound =
            "true";

        input.addEventListener(
            "change",
            event => {
                const file =
                    event.target.files?.[0];

                if (!file) {
                    return;
                }

                if (
                    file.size >
                    limit
                ) {
                    event.target.value =
                        "";

                    if ($(
                        "passportFileStatus"
                    )) {
                        $("passportFileStatus")
                            .textContent =
                            "O ficheiro ultrapassa o limite de 2 MB.";
                    }

                    showToast(
                        "O passaporte não pode ultrapassar 2 MB.",
                        "error"
                    );

                    return;
                }

                if ($(
                    "passportFileStatus"
                )) {
                    $("passportFileStatus")
                        .textContent =
                        `${file.name} · ${(
                            file.size /
                            1024 /
                            1024
                        ).toFixed(2)} MB`;
                }
            },
            true
        );
    }


    /* =========================================================
       APPLICATION REFRESH
    ========================================================= */

    async function refreshApplication() {
        if (
            !state.applicationId
        ) {
            return;
        }

        try {
            const data =
                await api(
                    `/api/applications/${encodeURIComponent(
                        state.applicationId
                    )}`
                );

            const application =
                data?.application ||
                data;

            if (!application) {
                return;
            }

            updateApplicationInterface(
                application
            );

        } catch (error) {
            console.warn(
                "[TRAVEL AUTOMATION] application refresh",
                error
            );
        }
    }


    async function restoreLatestApplication() {
    try {
        const data =
            await api(
                "/api/applications"
            );

        const applications =
            Array.isArray(
                data?.applications
            )
                ? data.applications
                : Array.isArray(data)
                    ? data
                    : [];

        if (
            !applications.length
        ) {
            return;
        }

        /*
         * Primeiro tentamos descobrir o cliente atualmente
         * selecionado no formulário.
         */
        const currentClientId =
            detectClientId();

        let application = null;

        /*
         * Se já existe um cliente selecionado,
         * recuperamos somente uma candidatura desse cliente.
         */
        if (currentClientId) {
            application =
                applications.find(
                    item => {
                        const applicationClientId =
                            item?.client?._id ||
                            item?.client?.id ||
                            item?.clientId;

                        return (
                            applicationClientId &&
                            String(
                                applicationClientId
                            ) ===
                            String(
                                currentClientId
                            )
                        );
                    }
                );
        }

        /*
         * Se ainda não há cliente selecionado,
         * NÃO carregamos automaticamente a candidatura
         * de outro cliente.
         */
        if (!application) {
            state.applicationId =
                null;

            document.body.dataset.applicationSubmitted =
                "false";

            return;
        }

        state.applicationId =
            application?._id ||
            application?.id ||
            null;

        const client =
            application?.client;

        if (
            client &&
            typeof client ===
                "object"
        ) {
            state.clientId =
                client._id ||
                client.id ||
                state.clientId;
        }

        document.body.dataset.applicationSubmitted =
            state.applicationId
                ? "true"
                : "false";

        updateApplicationInterface(
            application
        );

    } catch (error) {
        console.warn(
            "[TRAVEL AUTOMATION] restore",
            error
        );
    }
}
    function updateApplicationInterface(
        application
    ) {
        if (!application) {
            return;
        }

        state.applicationId =
            application._id ||
            application.id ||
            state.applicationId;
        document.body.dataset.applicationSubmitted =
        state.applicationId
            ? "true"
            : "false";

        renderAdminStatus(
            application
        );

        renderBotStates(
            application
        );

        renderPayment(
            application
        );

        updatePipeline(
            application
        );
    }


    function updatePipeline(
        application
    ) {
        const status =
            normalizeStatus(
                getApplicationStatus(
                    application
                )
            );

        const items =
            $$(".pipeline-item");

        if (!items.length) {
            return;
        }

        items.forEach(
            item => {
                item.classList.remove(
                    "active",
                    "completed",
                    "locked"
                );
            }
        );

        if (
            status ===
            "PENDING_REVIEW"
        ) {
            items[0]?.classList.add(
                "completed"
            );

            items[1]?.classList.add(
                "completed"
            );

            items[2]?.classList.add(
                "active"
            );

            items[3]?.classList.add(
                "locked"
            );

            return;
        }

        if (
            status ===
            "READY_FOR_AUTOMATION" ||
            status ===
            "AUTOMATION_ACTIVE"
        ) {
            items[0]?.classList.add(
                "completed"
            );

            items[1]?.classList.add(
                "completed"
            );

            items[2]?.classList.add(
                "completed"
            );

            items[3]?.classList.add(
                "active"
            );

            return;
        }

        if (
            status ===
            "COMPLETED"
        ) {
            items.forEach(
                item =>
                    item.classList.add(
                        "completed"
                    )
            );

            return;
        }

        items[0]?.classList.add(
            "active"
        );
    }


    /* =========================================================
       FORM BINDING
    ========================================================= */
function bindApplicationForm() {
    const form = $("applicationForm");

    if (!form) {
        return;
    }

    ensurePreferenceFields();

    const button = $("applicationSubmitButton");

    if (button) {
        button.type = "submit";
        button.dataset.frontendFinalSubmitButton = "true";
    }

    if (form.dataset.frontendFinalBound !== "true") {
        form.dataset.frontendFinalBound = "true";

        form.addEventListener(
            "submit",
            submitApplication,
            true
        );

        form.addEventListener(
            "input",
            () => {
                updatePreferenceSummary();
                detectClientId();
            }
        );

        form.addEventListener(
            "change",
            () => {
                updatePreferenceSummary();
                detectClientId();
            }
        );
    }

    detectClientId();

    /*
     * O resumo só precisa ser atualizado aqui quando
     * o formulário acaba de ser ligado.
     *
     * O MutationObserver não deve ficar a reconstruir
     * o resumo continuamente.
     */
    if (
        form.dataset.frontendFinalSummaryReady !==
        "true"
    ) {
        form.dataset.frontendFinalSummaryReady = "true";
        updatePreferenceSummary();
    }
}

    /* =========================================================
       OBSERVER
    ========================================================= */

    function startObserver() {
    if (state.observer) {
        return;
    }

    let observerScheduled = false;

    state.observer =
        new MutationObserver(() => {
            /*
             * As funções abaixo podem alterar o DOM.
             *
             * Não executamos novamente imediatamente dentro
             * da mesma sequência de mutações. Agendamos apenas
             * uma atualização por ciclo do navegador.
             */
            if (observerScheduled) {
                return;
            }

            observerScheduled = true;

            window.requestAnimationFrame(() => {
                observerScheduled = false;

                ensurePreferenceFields();
                ensureAdminWaitingPanel();
                ensurePaymentPanel();
                bindPassportLimit();
                neutralizePrepareButtons();
                bindApplicationForm();
            });
        });

    state.observer.observe(
        document.body,
        {
            childList: true,
            subtree: true
        }
    );
}

    /* =========================================================
       INITIALIZATION
    ========================================================= */

    function initialize() {
        if (
            state.initialized
        ) {
            return;
        }

        state.initialized =
            true;

        ensurePreferenceFields();

        ensureAdminWaitingPanel();

        ensurePaymentPanel();

        bindPassportLimit();

        bindApplicationForm();

        neutralizePrepareButtons();

        startObserver();

        restoreLatestApplication();

        state.refreshTimer =
            window.setInterval(
                refreshApplication,
                15000
            );
    }


    if (
        document.readyState ===
        "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            {
                once: true
            }
        );
    } else {
        initialize();
    }


    window.TravelAutomationFrontendFinal = {
        refresh:
            refreshApplication,

        getState() {
            return {
                ...state
            };
        }
    };

})();
