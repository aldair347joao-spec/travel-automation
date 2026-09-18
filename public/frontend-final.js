"use strict";

/*
 * ============================================================
 * TRAVEL AUTOMATION
 * FRONTEND FINAL WORKFLOW
 * ============================================================
 *
 * FLUXO:
 *
 * PASSAPORTE
 *    ↓
 * IDENTIDADE — 10 POSIÇÕES
 *    ↓
 * PREFERÊNCIAS
 *    ↓
 * ENVIO DA CANDIDATURA
 *    ↓
 * AGUARDANDO ADMINISTRAÇÃO
 *    ↓
 * ADMIN LIBERA
 *    ↓
 * BOT 1 + BOT 2
 *    ↓
 * VAGA
 *    ↓
 * AGENDAMENTO
 *    ↓
 * PAGAMENTO
 *
 * IMPORTANTE:
 *
 * - Não altera IDs existentes.
 * - Não inicia automação VFS pelo cliente.
 * - Não envia credenciais VFS.
 * - Não chama /prepare depois da candidatura.
 * - O servidor continua sendo a autoridade.
 * - Mantém as 10 posições faciais existentes.
 * ============================================================
 */

(() => {
    "use strict";

    const state = {
        applicationId: null,
        clientId: null,
        submitting: false,
        refreshTimer: null,
        observer: null
    };

    const $ = (id) => document.getElementById(id);

    const $$ = (selector) =>
        Array.from(document.querySelectorAll(selector));


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
            toast.style.opacity = "0";
            toast.style.transform =
                "translateY(8px)";

            window.setTimeout(
                () => toast.remove(),
                250
            );
        }, 4000);
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

        if (options.body) {
            headers["Content-Type"] =
                "application/json";
        }

        const csrf =
            getCsrfToken();

        if (
            csrf &&
            String(
                options.method || "GET"
            ).toUpperCase() !== "GET"
        ) {
            headers["x-csrf-token"] =
                csrf;
        }

        const response =
            await fetch(
                path,
                {
                    ...options,
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
       APPLICATION STATUS
    ========================================================= */

    function getApplicationStatus(
        application
    ) {
        return (
            application?.admin?.status ||
            application?.workflowState ||
            application?.status ||
            "PENDING_REVIEW"
        );
    }


    function getAdminStatus(
        application
    ) {
        return (
            application?.admin ||
            application?.adminControl ||
            {}
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


    /* =========================================================
       WEEKDAYS
       Backend receives numeric JavaScript days:
       0 = Domingo
       1 = Segunda
       ...
       6 = Sábado
    ========================================================= */

    const WEEKDAYS = [
        {
            value: 1,
            label: "Segunda-feira"
        },
        {
            value: 2,
            label: "Terça-feira"
        },
        {
            value: 3,
            label: "Quarta-feira"
        },
        {
            value: 4,
            label: "Quinta-feira"
        },
        {
            value: 5,
            label: "Sexta-feira"
        },
        {
            value: 6,
            label: "Sábado"
        },
        {
            value: 0,
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
            return;
        }

        const block =
            document.createElement(
                "section"
            );

        block.id =
            "frontendPreferenceBlock";

        block.className =
            "frontend-preference-block";

        block.innerHTML = `
            <div class="frontend-preference-header">
                <span>03</span>

                <div>
                    <small>
                        PREFERÊNCIAS DA CANDIDATURA
                    </small>

                    <h3>
                        Defina quando e onde pretende o agendamento
                    </h3>

                    <p>
                        Estas preferências serão usadas pelo sistema
                        para procurar apenas vagas compatíveis.
                    </p>
                </div>
            </div>

            <div class="frontend-preference-grid">

                <label class="frontend-field">
                    <span>Tipo de serviço</span>

                    <select
                        id="frontendServiceType"
                    >
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

                    <select
                        id="frontendAppointmentMode"
                    >
                        <option value="VFS_APPOINTMENT">
                            Atendimento VFS
                        </option>
                    </select>
                </label>

                <div class="frontend-field frontend-field-full">
                    <span>Dias preferidos</span>

                    <div
                        class="frontend-weekdays"
                        id="frontendWeekdays"
                    >
                        ${WEEKDAYS.map(day => `
                            <label class="frontend-weekday">
                                <input
                                    type="checkbox"
                                    name="preferredWeekdays"
                                    value="${day.value}"
                                >

                                <span>
                                    ${escapeHtml(day.label)}
                                </span>
                            </label>
                        `).join("")}
                    </div>
                </div>

                <div
                    id="frontendFinalPreferenceSummary"
                    class="frontend-preference-summary"
                >
                    <strong>
                        Resumo das preferências
                    </strong>

                    <span>
                        Preencha os dados acima.
                    </span>
                </div>

            </div>
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
                Number.isInteger
            );
    }


    function getFinalPreferences() {
        const visaType =
            $(
                "applicationVisaType"
            )?.value
                ?.trim()
                .toUpperCase() ||
            "";

        const visaCenter =
            $(
                "applicationVisaCenter"
            )?.value
                ?.trim() ||
            "";

        const travelPurpose =
            $(
                "applicationTravelPurpose"
            )?.value
                ?.trim() ||
            "";

        const preferredStartDate =
            $(
                "preferredStartDate"
            )?.value ||
            null;

        const preferredEndDate =
            $(
                "preferredEndDate"
            )?.value ||
            null;

        const preferredTime =
            $(
                "preferredTime"
            )?.value ||
            "ANY";

        const serviceType =
            $(
                "frontendServiceType"
            )?.value ||
            "STANDARD";

        const appointmentMode =
            $(
                "frontendAppointmentMode"
            )?.value ||
            "VFS_APPOINTMENT";

        const preferredWeekdays =
            getCheckedWeekdays();

        return {
            visaType,

            visaCenter,

            travelPurpose,

            serviceType,

            appointmentMode,

            preferredDates: {
                start:
                    preferredStartDate,

                end:
                    preferredEndDate
            },

            preferredTime,

            preferredWeekdays
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
            preferences.preferredWeekdays
                .map(
                    value =>
                        WEEKDAYS.find(
                            day =>
                                day.value ===
                                value
                        )?.label
                )
                .filter(Boolean);

        const dateRange =
            preferences
                .preferredDates
                .start &&
            preferences
                .preferredDates
                .end
                ? `${preferences.preferredDates.start} → ${preferences.preferredDates.end}`
                : "Intervalo não definido";

        summary.innerHTML = `
            <strong>
                Resumo das preferências
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
                ${escapeHtml(
                    dateRange
                )}
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
                        ? weekdays.join(", ")
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


    function validateFinalPreferences(
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
                    "Selecione um tipo de visto válido."
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
                    "Defina o período de datas pretendido."
            };
        }

        const start =
            new Date(
                `${preferences.preferredDates.start}T00:00:00`
            );

        const end =
            new Date(
                `${preferences.preferredDates.end}T23:59:59`
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

        if (end < start) {
            return {
                valid: false,
                message:
                    "A data final não pode ser anterior à data inicial."
            };
        }

        return {
            valid: true
        };
    }


    /* =========================================================
       APPLICATION CLIENT
    ========================================================= */

    function getSelectedClientId() {
        return (
            state.clientId ||
            $("applicationClient")?.value ||
            $("identityClient")?.value ||
            $("passportClientSelect")?.value ||
            null
        );
    }


    function detectClientFromPage() {
        const candidates = [
            $("applicationClient")?.value,
            $("identityClient")?.value,
            $("passportClientSelect")?.value,
            state.clientId
        ];

        const found =
            candidates.find(
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
       ADMIN WAITING PANEL
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
            "frontend-admin-waiting";

        panel.hidden =
            true;

        panel.innerHTML = `
            <div class="frontend-admin-icon">
                ✓
            </div>

            <div>
                <span>
                    PROCESSO RECEBIDO
                </span>

                <h3 id="frontendAdminWaitingTitle">
                    AGUARDANDO ADMINISTRAÇÃO
                </h3>

                <p id="frontendAdminWaitingText">
                    Os seus dados foram recebidos.
                    Um administrador irá verificar o processo
                    antes de a automação ser liberada.
                </p>
            </div>

            <div
                id="frontendAdminWaitingMeta"
                class="frontend-admin-meta"
            ></div>
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
            String(
                admin.status ||
                getApplicationStatus(
                    application
                )
            ).toUpperCase();

        panel.hidden =
            false;

        const title =
            $("frontendAdminWaitingTitle");

        const text =
            $("frontendAdminWaitingText");

        const meta =
            $("frontendAdminWaitingMeta");

        if (
            status ===
            "READY_FOR_AUTOMATION"
        ) {
            if (title) {
                title.textContent =
                    "AUTOMAÇÃO LIBERADA";
            }

            if (text) {
                text.textContent =
                    "A administração verificou o processo e liberou a automação. O sistema continuará o fluxo automaticamente.";
            }

            panel.classList.add(
                "released"
            );
        } else if (
            status ===
            "AUTOMATION_ACTIVE"
        ) {
            if (title) {
                title.textContent =
                    "AUTOMAÇÃO EM EXECUÇÃO";
            }

            if (text) {
                text.textContent =
                    "O processo foi liberado e os bots estão a executar o fluxo de forma automática.";
            }

            panel.classList.add(
                "released"
            );
        } else if (
            status ===
            "PAUSED"
        ) {
            if (title) {
                title.textContent =
                    "AUTOMAÇÃO PAUSADA";
            }

            if (text) {
                text.textContent =
                    "A administração colocou temporariamente a automação em pausa.";
            }

            panel.classList.remove(
                "released"
            );
        } else {
            if (title) {
                title.textContent =
                    "AGUARDANDO ADMINISTRAÇÃO";
            }

            if (text) {
                text.textContent =
                    "Os seus dados foram recebidos. Um administrador irá verificar o processo antes de liberar a automação.";
            }

            panel.classList.remove(
                "released"
            );
        }

        if (meta) {
            meta.innerHTML = `
                <span>
                    Processo:
                    ${escapeHtml(
                        application._id ||
                        application.id ||
                        state.applicationId ||
                        "—"
                    )}
                </span>

                <span>
                    Estado:
                    ${escapeHtml(
                        status
                    )}
                </span>
            `;
        }
    }


    /* =========================================================
       PAYMENT PANEL
    ========================================================= */

    function ensurePaymentPanel() {
        const form =
            $("applicationForm");

        if (!form) {
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
            "frontend-payment-panel";

        panel.hidden =
            true;

        panel.innerHTML = `
            <div class="frontend-payment-header">
                <span>
                    PAGAMENTO
                </span>

                <h3>
                    Dados para pagamento
                </h3>

                <p>
                    O seu agendamento foi processado.
                    Consulte os dados abaixo para efetuar o pagamento.
                </p>
            </div>

            <div class="frontend-payment-grid">

                <div>
                    <small>
                        REFERÊNCIA
                    </small>

                    <strong id="frontendPaymentReference">
                        —
                    </strong>
                </div>

                <div>
                    <small>
                        ENTIDADE
                    </small>

                    <strong id="frontendPaymentEntity">
                        —
                    </strong>
                </div>

                <div>
                    <small>
                        VALOR
                    </small>

                    <strong id="frontendPaymentAmount">
                        —
                    </strong>
                </div>

                <div>
                    <small>
                        PRAZO
                    </small>

                    <strong id="frontendPaymentDeadline">
                        —
                    </strong>
                </div>

                <div>
                    <small>
                        ESTADO
                    </small>

                    <strong id="frontendPaymentStatus">
                        —
                    </strong>
                </div>

                <div>
                    <small>
                        TRANSAÇÃO
                    </small>

                    <strong id="frontendPaymentTransaction">
                        —
                    </strong>
                </div>

            </div>

            <a
                id="frontendPaymentConfirmation"
                href="#"
                target="_blank"
                rel="noopener noreferrer"
                hidden
            >
                Abrir confirmação
            </a>
        `;

        form.parentNode.insertBefore(
            panel,
            form.nextSibling
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
            payment.paymentReference ||
            null;

        const entity =
            payment.entity ||
            payment.paymentEntity ||
            null;

        const amount =
            payment.paymentAmount ??
            payment.amount ??
            null;

        const currency =
            payment.paymentCurrency ||
            payment.currency ||
            "";

        const deadline =
            payment.paymentDeadline ||
            payment.deadline ||
            null;

        const transaction =
            payment.transactionId ||
            payment.transactionID ||
            null;

        const status =
            payment.paymentStatus ||
            payment.status ||
            application?.paymentStatus ||
            null;

        if (
            !reference &&
            !entity &&
            amount === null &&
            !deadline &&
            !transaction &&
            !status
        ) {
            panel.hidden =
                true;

            return;
        }

        panel.hidden =
            false;

        const referenceElement =
            $("frontendPaymentReference");

        const entityElement =
            $("frontendPaymentEntity");

        const amountElement =
            $("frontendPaymentAmount");

        const deadlineElement =
            $("frontendPaymentDeadline");

        const statusElement =
            $("frontendPaymentStatus");

        const transactionElement =
            $("frontendPaymentTransaction");

        if (referenceElement) {
            referenceElement.textContent =
                reference || "—";
        }

        if (entityElement) {
            entityElement.textContent =
                entity || "—";
        }

        if (amountElement) {
            amountElement.textContent =
                amount !== null &&
                amount !== undefined
                    ? `${amount} ${currency}`.trim()
                    : "—";
        }

        if (deadlineElement) {
            deadlineElement.textContent =
                deadline
                    ? new Intl.DateTimeFormat(
                        "pt-PT",
                        {
                            dateStyle:
                                "medium",
                            timeStyle:
                                "short"
                        }
                    ).format(
                        new Date(
                            deadline
                        )
                    )
                    : "—";
        }

        if (statusElement) {
            statusElement.textContent =
                String(
                    status ||
                    "PENDENTE"
                ).toUpperCase();
        }

        if (transactionElement) {
            transactionElement.textContent =
                transaction ||
                "—";
        }

        const confirmation =
            $(
                "frontendPaymentConfirmation"
            );

        const confirmationUrl =
            payment.confirmationUrl ||
            payment.confirmationURL ||
            null;

        if (
            confirmation &&
            confirmationUrl
        ) {
            confirmation.href =
                confirmationUrl;

            confirmation.hidden =
                false;
        } else if (confirmation) {
            confirmation.hidden =
                true;
        }
    }


    /* =========================================================
       PIPELINE STATE
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

        const supervisor =
            application?.workflowState ||
            application?.status ||
            "—";

        const bot1State =
            $("bot1State");

        const bot2State =
            $("bot2State");

        const supervisorState =
            $("supervisorState");

        if (bot1State) {
            bot1State.textContent =
                formatBotState(
                    bot1.status ||
                    "idle"
                );
        }

        if (bot2State) {
            bot2State.textContent =
                formatBotState(
                    bot2.status ||
                    "idle"
                );
        }

        if (supervisorState) {
            supervisorState.textContent =
                formatWorkflowState(
                    supervisor
                );
        }
    }


    function formatBotState(
        status
    ) {
        const map = {
            idle:
                "Inativo",

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
            String(status || "—")
        );
    }


    function formatWorkflowState(
        state
    ) {
        const map = {
            CREATED:
                "Criado",

            READY_FOR_AUTOMATION:
                "Pronto",

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
            String(
                state || "—"
            )
        );
    }


    /* =========================================================
       CREATE APPLICATION
    ========================================================= */

    async function submitApplication(
        event
    ) {
        if (
            state.submitting
        ) {
            return;
        }

        event.preventDefault();

        event.stopPropagation();

        if (
            typeof event.stopImmediatePropagation ===
            "function"
        ) {
            event.stopImmediatePropagation();
        }

        ensurePreferenceFields();

        const clientId =
            detectClientFromPage();

        if (!clientId) {
            showToast(
                "Valide primeiro o passaporte e crie o perfil do viajante.",
                "error"
            );

            return;
        }

        const preferences =
            getFinalPreferences();

        const validation =
            validateFinalPreferences(
                preferences
            );

        if (!validation.valid) {
            showToast(
                validation.message,
                "error"
            );

            return;
        }

        state.submitting =
            true;

        const submitButton =
            event.submitter ||
            $("applicationSubmitButton") ||
            $(
                '#applicationForm button[type="submit"]'
            );

        if (submitButton) {
            submitButton.disabled =
                true;

            submitButton.dataset.originalText =
                submitButton.textContent;

            submitButton.textContent =
                "A enviar candidatura...";
        }

        try {
            const idempotencyKey =
                `TA-${clientId}-${Date.now()}-${Math.random()
                    .toString(36)
                    .slice(2, 10)}`;

            const data =
                await api(
                    "/api/applications",
                    {
                        method: "POST",

                        headers: {
                            "Idempotency-Key":
                                idempotencyKey
                        },

                        body:
                            JSON.stringify({
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

                                preferredDates:
                                    preferences.preferredDates,

                                preferredTime:
                                    preferences.preferredTime,

                                preferredWeekdays:
                                    preferences.preferredWeekdays
                            })
                    }
                );

            const application =
                data?.application ||
                null;

            if (!application) {
                throw new Error(
                    "A aplicação foi recebida mas o servidor não devolveu o processo."
                );
            }

            state.applicationId =
                application._id ||
                application.id;

            renderAdminStatus(
                application
            );

            renderBotStates(
                application
            );

            renderPayment(
                application
            );

            showToast(
                "Candidatura recebida. Aguarde a administração.",
                "success"
            );

            updateApplicationInterface(
                application
            );

        } catch (error) {
            console.error(
                "[TRAVEL AUTOMATION] Application submit error",
                error
            );

            showToast(
                error.message ||
                "Não foi possível enviar a candidatura.",
                "error"
            );

        } finally {
            state.submitting =
                false;

            if (submitButton) {
                submitButton.disabled =
                    false;

                if (
                    submitButton.dataset.originalText
                ) {
                    submitButton.textContent =
                        submitButton.dataset.originalText;
                }
            }
        }
    }


    /* =========================================================
       OLD PREPARE BUTTONS
    ========================================================= */

    function neutralizePrepareButtons() {
        const selectors = [
            '[data-action="prepare"]',
            "#prepareApplicationButton",
            "#prepareButton",
            ".prepare-application-button"
        ];

        for (
            const selector
            of selectors
        ) {
            $$(selector).forEach(
                button => {
                    if (
                        button.dataset.frontendFinalBound ===
                        "true"
                    ) {
                        return;
                    }

                    button.dataset.frontendFinalBound =
                        "true";

                    button.disabled =
                        false;

                    button.textContent =
                        "Aguardar administração";

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
                                "O processo só será liberado depois da verificação da administração.",
                                "info"
                            );
                        },
                        true
                    );
                }
            );
        }
    }


    /* =========================================================
       APPLICATION REFRESH
    ========================================================= */

    async function refreshApplication() {
        if (!state.applicationId) {
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
                null;

            if (!application) {
                return;
            }

            updateApplicationInterface(
                application
            );

        } catch (error) {
            console.warn(
                "[TRAVEL AUTOMATION] Application refresh failed",
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

        renderAdminStatus(
            application
        );

        renderBotStates(
            application
        );

        renderPayment(
            application
        );

        const status =
            getApplicationStatus(
                application
            );

        const form =
            $("applicationForm");

        if (
            [
                "PENDING_REVIEW",
                "READY_FOR_AUTOMATION",
                "AUTOMATION_ACTIVE",
                "PAUSED",
                "COMPLETED"
            ].includes(
                String(
                    status
                ).toUpperCase()
            )
        ) {
            if (
                String(
                    status
                ).toUpperCase() !==
                "PENDING_REVIEW"
            ) {
                disableFinalApplicationForm();
            }
        }
    }


    function disableFinalApplicationForm() {
        const form =
            $("applicationForm");

        if (!form) {
            return;
        }

        $$(
            "input, select, textarea, button"
        ).forEach(
            element => {
                if (
                    element.closest(
                        "#frontendAdminWaiting"
                    ) ||
                    element.closest(
                        "#frontendPaymentPanel"
                    )
                ) {
                    return;
                }

                element.disabled =
                    true;
            }
        );
    }


    /* =========================================================
       FORM BINDING
    ========================================================= */

    function bindApplicationForm() {
        const form =
            $("applicationForm");

        if (!form) {
            return;
        }

        ensurePreferenceFields();

        if (
            form.dataset.frontendFinalBound ===
            "true"
        ) {
            return;
        }

        form.dataset.frontendFinalBound =
            "true";

        /*
         * CAPTURE PHASE
         *
         * Isto impede que o app.js antigo
         * envie a candidatura e depois execute
         * /prepare.
         */
        form.addEventListener(
            "submit",
            submitApplication,
            true
        );

        form.addEventListener(
            "input",
            updatePreferenceSummary
        );

        form.addEventListener(
            "change",
            updatePreferenceSummary
        );
    }


    /* =========================================================
       PASSPORT BRIDGE
    ========================================================= */

    function bindPassportBridge() {
        const passportInput =
            $("passportFile");

        if (!passportInput) {
            return;
        }

        if (
            passportInput.dataset.frontendFinalBound ===
            "true"
        ) {
            return;
        }

        passportInput.dataset.frontendFinalBound =
            "true";

        passportInput.addEventListener(
            "change",
            event => {
                const file =
                    event.target.files?.[0];

                if (!file) {
                    return;
                }

                if (
                    file.size >
                    2 * 1024 * 1024
                ) {
                    event.target.value =
                        "";

                    showToast(
                        "O passaporte não pode ultrapassar 2 MB.",
                        "error"
                    );
                }
            },
            true
        );
    }


    /* =========================================================
       OBSERVER
    ========================================================= */

    function startObserver() {
        if (
            state.observer
        ) {
            return;
        }

        state.observer =
            new MutationObserver(
                () => {
                    ensurePreferenceFields();
                    ensureAdminWaitingPanel();
                    ensurePaymentPanel();
                    neutralizePrepareButtons();
                    bindApplicationForm();
                    bindPassportBridge();
                }
            );

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
        ensurePreferenceFields();

        ensureAdminWaitingPanel();

        ensurePaymentPanel();

        bindApplicationForm();

        bindPassportBridge();

        neutralizePrepareButtons();

        startObserver();

        /*
         * Procuramos automaticamente
         * uma aplicação criada anteriormente.
         */
        refreshExistingApplication();

        state.refreshTimer =
            window.setInterval(
                refreshApplication,
                15000
            );
    }


    async function refreshExistingApplication() {
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
                    : [];

            if (!applications.length) {
                return;
            }

            /*
             * Usamos a candidatura mais recente.
             */
            const application =
                applications[0];

            const id =
                application?._id ||
                application?.id;

            if (!id) {
                return;
            }

            state.applicationId =
                id;

            detectClientFromPage();

            updateApplicationInterface(
                application
            );

        } catch (error) {
            console.warn(
                "[TRAVEL AUTOMATION] Could not restore application",
                error
            );
        }
    }


    if (
        document.readyState ===
        "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            initialize
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
