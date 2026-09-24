"use strict";

/*
 * ============================================================
 * TRAVEL AUTOMATION
 * ADMINISTRATIVE PANEL
 * ============================================================
 *
 * Regras:
 *
 * 1. Nunca armazenar password VFS no frontend.
 * 2. Nunca mostrar password VFS depois de guardar.
 * 3. Nunca confiar no frontend para liberar automação.
 * 4. Toda autorização real permanece no backend.
 * 5. O painel apenas controla o backend.
 * ============================================================
 */

const AdminApp = (() => {

    const state = {
        applications: [],
        filteredApplications: [],
        selectedApplicationId: null,
        selectedApplication: null,
        refreshTimer: null,
        currentAction: null,
        loadingApplications: false,
        loadingDetails: false,
        currentUser: null,
        currentUserRole: null,
    };


    /*
     * ========================================================
     * DOM
     * ========================================================
     */

    const $ = selector =>
        document.querySelector(
            selector
        );


    const $$ = selector =>
        Array.from(
            document.querySelectorAll(
                selector
            )
        );


    /*
     * ========================================================
     * UTILITIES
     * ========================================================
     */

    function escapeHtml(
        value
    ) {
        if (
            value === null ||
            value === undefined
        ) {
            return "";
        }

        return String(value)
            .replace(
                /&/g,
                "&amp;"
            )
            .replace(
                /</g,
                "&lt;"
            )
            .replace(
                />/g,
                "&gt;"
            )
            .replace(
                /"/g,
                "&quot;"
            )
            .replace(
                /'/g,
                "&#039;"
            );
    }


    function firstLetter(
        value
    ) {
        return (
            String(
                value ||
                "A"
            )
                .trim()
                .charAt(0)
                .toUpperCase() ||
            "A"
        );
    }


    function formatDate(
        value
    ) {
        if (!value) {
            return "—";
        }

        const date =
            new Date(
                value
            );

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            return String(
                value
            );
        }

        return new Intl.DateTimeFormat(
            "pt-PT",
            {
                dateStyle:
                    "medium",

                timeStyle:
                    "short"
            }
        ).format(
            date
        );
    }


    function formatDateOnly(
        value
    ) {
        if (!value) {
            return "—";
        }

        const date =
            new Date(
                value
            );

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            return String(
                value
            );
        }

        return new Intl.DateTimeFormat(
            "pt-PT",
            {
                dateStyle:
                    "medium"
            }
        ).format(
            date
        );
    }


    function formatMoney(
        amount,
        currency
    ) {
        if (
            amount === null ||
            amount === undefined ||
            amount === ""
        ) {
            return "—";
        }

        const number =
            Number(
                amount
            );

        if (
            !Number.isFinite(
                number
            )
        ) {
            return `${amount} ${
                currency || ""
            }`.trim();
        }

        return (
            new Intl.NumberFormat(
                "pt-AO",
                {
                    minimumFractionDigits:
                        2,

                    maximumFractionDigits:
                        2
                }
            ).format(
                number
            ) +
            (
                currency
                    ? ` ${currency}`
                    : ""
            )
        );
    }


    function normalizeArray(
        value
    ) {
        if (
            Array.isArray(
                value
            )
        ) {
            return value;
        }

        if (
            typeof value ===
                "string" &&
            value.trim()
        ) {
            return value
                .split(",")
                .map(
                    item =>
                        item.trim()
                )
                .filter(
                    Boolean
                );
        }

        return [];
    }


    function getClient(
        application
    ) {
        return (
            application?.client ||
            (
                Array.isArray(
                    application?.clients
                )
                    ? application.clients[0]
                    : null
            ) ||
            {}
        );
    }


    function getAdmin(
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


    function getWorkflowState(
        application
    ) {
        return (
            application?.workflowState ||
            application?.workflow?.state ||
            application?.status ||
            "—"
        );
    }


    function getBotStatus(
        bot
    ) {
        if (
            !bot
        ) {
            return "idle";
        }

        if (
            typeof bot ===
            "string"
        ) {
            return bot;
        }

        return (
            bot.status ||
            "idle"
        );
    }


    /*
     * ========================================================
     * STATUS
     * ========================================================
     */

    function statusLabel(
        status
    ) {
        const labels = {
            PENDING_REVIEW:
                "Aguardando administração",

            READY_FOR_AUTOMATION:
                "Pronto para automação",

            AUTOMATION_ACTIVE:
                "Automação ativa",

            PAUSED:
                "Pausado",

            COMPLETED:
                "Concluído",

            CANCELLED:
                "Cancelado",

            CREATED:
                "Criado",

            PASSPORT_PENDING:
                "Passaporte pendente",

            PASSPORT_VERIFIED:
                "Passaporte verificado",

            IDENTITY_READY:
                "Identidade pronta",

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
                "Envio de documentos",

            PASSPORT_UPLOAD_REQUIRED:
                "Passaporte solicitado",

            PASSPORT_UPLOADING:
                "A enviar passaporte",

            PASSPORT_UPLOADED:
                "Passaporte enviado",

            FACIAL_SESSION_STARTING:
                "A iniciar facial",

            FACIAL_LIVENESS_REQUIRED:
                "Liveness solicitado",

            FACIAL_LIVENESS_PROCESSING:
                "Processamento facial",

            FACIAL_POSITION_REQUESTED:
                "Posição facial solicitada",

            FACIAL_POSITION_RESOLVING:
                "A resolver posição facial",

            FACIAL_POSITION_SUBMITTING:
                "A enviar posição facial",

            FACIAL_VERIFICATION_COMPLETED:
                "Facial concluído",

            OTP_REQUIRED:
                "OTP solicitado",

            OTP_RECEIVING:
                "A receber OTP",

            OTP_RECEIVED:
                "OTP recebido",

            OTP_SUBMITTING:
                "A validar OTP",

            OTP_VERIFIED:
                "OTP verificado",

            REVIEW:
                "Revisão",

            APPOINTMENT_BOOKED:
                "Agendamento concluído",

            PAYMENT_PENDING:
                "Pagamento pendente",

            PAYMENT_CONFIRMED:
                "Pagamento confirmado",

            PAYMENT_EXPIRED:
                "Pagamento expirado",

            ERROR:
                "Erro",

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

            monitoring:
                "A monitorizar",

            slot_found:
                "Vaga encontrada",

            cooldown:
                "Cooldown",

            stopped:
                "Parado",

            error:
                "Erro",

            requires_user:
                "Requer ação"
        };

        return (
            labels[status] ||
            String(
                status ||
                "—"
            )
        );
    }


    function statusClass(
        status
    ) {
        const value =
            String(
                status ||
                ""
            ).toUpperCase();

        if (
            [
                "PENDING_REVIEW",
                "PAYMENT_PENDING",
                "WAITING",
                "WAITING_FOR_SLOT"
            ].includes(
                value
            )
        ) {
            return "status-pending";
        }

        if (
            [
                "READY_FOR_AUTOMATION",
                "VFS_AUTHENTICATED",
                "SLOT_FOUND"
            ].includes(
                value
            )
        ) {
            return "status-ready";
        }

        if (
            [
                "AUTOMATION_ACTIVE",
                "RUNNING",
                "COMPLETED",
                "PAYMENT_CONFIRMED"
            ].includes(
                value
            )
        ) {
            return "status-active";
        }

        if (
            [
                "PAUSED",
                "ERROR",
                "CANCELLED",
                "PAYMENT_EXPIRED"
            ].includes(
                value
            )
        ) {
            return "status-paused";
        }

        return "status-cancelled";
    }


    function botClass(
        status
    ) {
        const value =
            String(
                status ||
                ""
            ).toLowerCase();

        if (
            value.includes(
                "running"
            ) ||
            value.includes(
                "monitoring"
            ) ||
            value.includes(
                "active"
            ) ||
            value.includes(
                "completed"
            )
        ) {
            return "bot-running";
        }

        if (
            value.includes(
                "waiting"
            ) ||
            value.includes(
                "starting"
            ) ||
            value.includes(
                "slot"
            )
        ) {
            return "bot-waiting";
        }

        if (
            value.includes(
                "error"
            ) ||
            value.includes(
                "requires"
            )
        ) {
            return "bot-error";
        }

        return "";
    }


    /*
     * ========================================================
     * CSRF
     * ========================================================
     */

    function getCookie(
        name
    ) {
        const prefix =
            `${name}=`;

        const cookies =
            document.cookie
                .split(";")
                .map(
                    value =>
                        value.trim()
                );

        const match =
            cookies.find(
                value =>
                    value.startsWith(
                        prefix
                    )
            );

        if (!match) {
            return "";
        }

        try {
            return decodeURIComponent(
                match.slice(
                    prefix.length
                )
            );
        } catch {
            return match.slice(
                prefix.length
            );
        }
    }


    function csrfHeaders() {
        const token =
            getCookie(
                "csrf_token"
            );

        if (!token) {
            return {};
        }

        return {
            "x-csrf-token":
                token
        };
    }


    /*
     * ========================================================
     * API
     * ========================================================
     */

    async function api(
        path,
        options = {}
    ) {
        const method =
            String(
                options.method ||
                "GET"
            ).toUpperCase();

        const headers = {
            Accept:
                "application/json",

            ...(
                options.body
                    ? {
                        "Content-Type":
                            "application/json"
                    }
                    : {}
            ),

            ...(
                ![
                    "GET",
                    "HEAD",
                    "OPTIONS"
                ].includes(
                    method
                )
                    ? csrfHeaders()
                    : {}
            ),

            ...(options.headers ||
                {})
        };

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

        let data =
            null;

        try {
            data =
                await response.json();
        } catch {
            data =
                null;
        }

        if (
            response.status ===
            401
        ) {
            handleUnauthorized();

            const error =
                new Error(
                    data?.error ||
                    data?.message ||
                    "Sessão administrativa expirada."
                );

            error.status =
                401;

            throw error;
        }

        if (
            response.status ===
            403
        ) {
            const error =
                new Error(
                    data?.error ||
                    data?.message ||
                    "Operação não autorizada."
                );

            error.status =
                403;

            error.data =
                data;

            throw error;
        }

        if (
            !response.ok
        ) {
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


    function handleUnauthorized() {
        setConnectionStatus(
            "offline",
            "Sessão inválida"
        );

        setTimeout(
            () => {
                window.location.href =
                    "/";
            },
            1000
        );
    }


    /*
     * ========================================================
     * CONNECTION
     * ========================================================
     */

    function setConnectionStatus(
        type,
        text
    ) {
        const element =
            $(
                "#connectionStatus"
            );

        if (!element) {
            return;
        }

        element.classList.remove(
            "checking",
            "online",
            "offline"
        );

        element.classList.add(
            type
        );

        element.innerHTML =
            `
                <i></i>
                ${escapeHtml(
                    text
                )}
            `;
    }


    function updateTimestamp() {
        const element =
            $(
                "#lastUpdated"
            );

        if (!element) {
            return;
        }

        element.textContent =
            `Última atualização — ${new Intl.DateTimeFormat(
                "pt-PT",
                {
                    timeStyle:
                        "short"
                }
            ).format(
                new Date()
            )}`;
    }


    /*
     * ========================================================
     * TOAST
     * ========================================================
     */

    function showToast(
        title,
        message,
        type = "success"
    ) {
        const container =
            $(
                "#toastContainer"
            );

        if (!container) {
            return;
        }

        const toast =
            document.createElement(
                "div"
            );

        toast.className =
            `toast ${type}`;

        toast.innerHTML =
            `
                <strong>
                    ${escapeHtml(
                        title
                    )}
                </strong>

                <span>
                    ${escapeHtml(
                        message
                    )}
                </span>
            `;

        container.appendChild(
            toast
        );

        setTimeout(
            () => {
                toast.remove();
            },
            4500
        );
    }


    /*
     * ========================================================
     * STATS
     * ========================================================
     */

    async function loadStats() {
        const data =
            await api(
                "/api/admin/stats"
            );

        const stats =
            data?.stats ||
            {};

        if (
            $(
                "#statTotal"
            )
        ) {
            $(
                "#statTotal"
            ).textContent =
                stats.total ??
                0;
        }

        if (
            $(
                "#statPending"
            )
        ) {
            $(
                "#statPending"
            ).textContent =
                stats.pendingAdmin ??
                0;
        }

        if (
            $(
                "#statActive"
            )
        ) {
            $(
                "#statActive"
            ).textContent =
                stats.automationActive ??
                0;
        }

        if (
            $(
                "#statPayment"
            )
        ) {
            $(
                "#statPayment"
            ).textContent =
                stats.paymentPending ??
                0;
        }
    }


    /*
     * ========================================================
     * APPLICATION LIST
     * ========================================================
     */

    async function loadApplications() {
        state.loadingApplications =
            true;

        try {
            const data =
                await api(
                    "/api/admin/applications"
                );

            state.applications =
                Array.isArray(
                    data?.applications
                )
                    ? data.applications
                    : [];

            applyFilters();

            setConnectionStatus(
                "online",
                "Ligado"
            );

            updateTimestamp();

        } catch (
            error
        ) {
            console.error(
                "[ADMIN]",
                error
            );

            setConnectionStatus(
                "offline",
                "Erro de ligação"
            );

            renderApplicationsError(
                error.message
            );

            throw error;

        } finally {
            state.loadingApplications =
                false;
        }
    }


    function applyFilters() {
        const search =
            (
                $(
                    "#applicationSearch"
                )?.value ||
                ""
            )
                .trim()
                .toLowerCase();

        const status =
            $(
                "#statusFilter"
            )?.value ||
            "all";

        state.filteredApplications =
            state.applications.filter(
                application => {
                    const client =
                        getClient(
                            application
                        );

                    const payment =
                        getPayment(
                            application
                        );

                    const searchable =
                        [
                            application.id,
                            client.name,
                            client.email,
                            client.phone,
                            application.visaCenter,
                            application.visaType,
                            payment.reference,
                            payment.entity
                        ]
                            .filter(
                                Boolean
                            )
                            .join(
                                " "
                            )
                            .toLowerCase();

                    const matchesSearch =
                        !search ||
                        searchable.includes(
                            search
                        );

                    const applicationStatus =
                        getAdmin(
                            application
                        ).status ||
                        application.workflowState ||
                        application.status;

                    const matchesStatus =
                        status === "all" ||
                        applicationStatus ===
                            status;

                    return (
                        matchesSearch &&
                        matchesStatus
                    );
                }
            );

        renderApplications();
    }


    function renderApplicationsLoading() {
        const list =
            $(
                "#applicationsList"
            );

        if (!list) {
            return;
        }

        list.innerHTML =
            `
                <div class="loading-state">
                    <div class="loading-spinner"></div>
                    <span>A carregar processos...</span>
                </div>
            `;
    }


    function renderApplicationsError(
        message
    ) {
        const list =
            $(
                "#applicationsList"
            );

        if (!list) {
            return;
        }

        list.innerHTML =
            `
                <div class="loading-state">
                    <strong>
                        Não foi possível carregar os processos.
                    </strong>

                    <span>
                        ${escapeHtml(
                            message ||
                            "Erro desconhecido."
                        )}
                    </span>
                </div>
            `;
    }


    function renderApplications() {
        const list =
            $(
                "#applicationsList"
            );

        if (!list) {
            return;
        }

        const count =
            $(
                "#applicationCount"
            );

        if (count) {
            count.textContent =
                state.filteredApplications.length;
        }

        if (
            !state.filteredApplications.length
        ) {
            list.innerHTML =
                `
                    <div class="loading-state">
                        <strong>
                            Nenhum processo encontrado.
                        </strong>

                        <span>
                            Ajuste os filtros ou aguarde novos processos.
                        </span>
                    </div>
                `;

            return;
        }

        list.innerHTML =
            state.filteredApplications
                .map(
                    application =>
                        renderApplicationRow(
                            application
                        )
                )
                .join("");

        $$(
            "[data-application-id]"
        ).forEach(
            element => {
                element.addEventListener(
                    "click",
                    () => {
                        selectApplication(
                            element.dataset
                                .applicationId
                        );
                    }
                );
            }
        );
    }


    function renderApplicationRow(
        application
    ) {
        const client =
            getClient(
                application
            );

        const admin =
            getAdmin(
                application
            );

        const payment =
            getPayment(
                application
            );

        const status =
            admin.status ||
            application.workflowState ||
            application.status ||
            "UNKNOWN";

        const selected =
            String(
                state.selectedApplicationId ||
                ""
            ) ===
            String(
                application.id
            );

        const paymentStatus =
            payment.status ||
            "";

        return `
            <button
                type="button"
                class="application-row ${
                    selected
                        ? "selected"
                        : ""
                }"
                data-application-id="${
                    escapeHtml(
                        application.id
                    )
                }"
            >
                <div class="application-row-main">

                    <div class="application-avatar">
                        ${escapeHtml(
                            firstLetter(
                                client.name
                            )
                        )}
                    </div>

                    <div class="application-primary">

                        <strong>
                            ${escapeHtml(
                                client.name ||
                                "Cliente"
                            )}
                        </strong>

                        <span>
                            ${escapeHtml(
                                client.email ||
                                client.phone ||
                                "Sem contacto"
                            )}
                        </span>

                    </div>

                </div>

                <div class="application-row-meta">

                    <span
                        class="status-badge ${statusClass(
                            status
                        )}"
                    >
                        ${escapeHtml(
                            statusLabel(
                                status
                            )
                        )}
                    </span>

                    <span>
                        ${
                            paymentStatus
                                ? escapeHtml(
                                    statusLabel(
                                        paymentStatus
                                    )
                                )
                                : "Sem pagamento"
                        }
                    </span>

                    <small>
                        ${escapeHtml(
                            formatDate(
                                application.updatedAt ||
                                application.createdAt
                            )
                        )}
                    </small>

                </div>
            </button>
        `;
    }


    /*
     * ========================================================
     * SELECT APPLICATION
     * ========================================================
     */

    async function selectApplication(
        applicationId
    ) {
        state.selectedApplicationId =
            applicationId;

        updateSelectedId();

        try {
            state.loadingDetails =
                true;

            const data =
                await api(
                    `/api/admin/applications/${encodeURIComponent(
                        applicationId
                    )}`
                );

            state.selectedApplication =
                {
                    ...(data?.application ||
                        {}),
                    admin:
                        data?.admin ||
                        {},
                    payment:
                        data?.payment ||
                        data?.application
                            ?.payment ||
                        {}
                };

            renderDetails();

            const section =
                $(
                    "#detailsSection"
                );

            if (section) {
                section.scrollIntoView({
                    behavior:
                        "smooth",

                    block:
                        "start"
                });
            }

        } catch (
            error
        ) {
            console.error(
                "[ADMIN] detail",
                error
            );

            showToast(
                "Erro",
                error.message,
                "error"
            );

        } finally {
            state.loadingDetails =
                false;
        }
    }


    function updateSelectedId() {
        const element =
            $(
                "#selectedProcessId"
            );

        if (!element) {
            return;
        }

        element.textContent =
            state.selectedApplicationId
                ? String(
                    state.selectedApplicationId
                )
                : "Nenhum processo selecionado";
    }


    /*
     * ========================================================
     * DETAILS
     * ========================================================
     */

    function renderDetails() {
        const application =
            state.selectedApplication;

        if (!application) {
            showEmptyDetails();
            return;
        }

        const panel =
            $(
                "#detailsPanel"
            );

        const empty =
            $(
                "#emptyDetails"
            );

        if (panel) {
            panel.classList.remove(
                "hidden"
            );
        }

        if (empty) {
            empty.classList.add(
                "hidden"
            );
        }

        renderClientDetails(
            application
        );

        renderWorkflowDetails(
            application
        );

        renderApplicationData(
            application
        );

        renderPassportDetails(
            application
        );

        renderIdentityDetails(
            application
        );

        renderBotDetails(
            application
        );

        renderPaymentDetails(
            application
        );

        renderErrorDetails(
            application
        );

        renderCredentialsState(
            application
        );

        renderAutomationControls(
            application
        );

        renderNotes(
            application
        );
    }


    function showEmptyDetails() {
        const panel =
            $(
                "#detailsPanel"
            );

        const empty =
            $(
                "#emptyDetails"
            );

        if (panel) {
            panel.classList.add(
                "hidden"
            );
        }

        if (empty) {
            empty.classList.remove(
                "hidden"
            );
        }
    }


    function setText(
        selector,
        value
    ) {
        const element =
            $(selector);

        if (!element) {
            return;
        }

        element.textContent =
            value === null ||
            value === undefined ||
            value === ""
                ? "—"
                : String(
                    value
                );
    }


    function setBadge(
        selector,
        text,
        status
    ) {
        const element =
            $(selector);

        if (!element) {
            return;
        }

        element.textContent =
            text || "—";

        element.classList.remove(
            "status-pending",
            "status-ready",
            "status-active",
            "status-paused",
            "status-cancelled"
        );

        element.classList.add(
            statusClass(
                status
            )
        );
    }


    function renderClientDetails(
        application
    ) {
        const client =
            getClient(
                application
            );

        const name =
            client.name ||
            "Cliente";

        setText(
            "#detailClientName",
            name
        );

        setText(
            "#detailClientFullName",
            name
        );

        setText(
            "#detailClientEmail",
            client.email ||
            "—"
        );

        setText(
            "#detailClientPhone",
            client.phone ||
            "—"
        );

        setText(
            "#detailApplicationId",
            application.id
        );

        const avatar =
            $(
                "#detailClientAvatar"
            );

        if (avatar) {
            avatar.textContent =
                firstLetter(
                    name
                );
        }

        const admin =
            getAdmin(
                application
            );

        setBadge(
            "#detailAdminStatus",
            statusLabel(
                admin.status ||
                "PENDING_REVIEW"
            ),
            admin.status ||
            "PENDING_REVIEW"
        );
    }


    function renderWorkflowDetails(
        application
    ) {
        const stateValue =
            getWorkflowState(
                application
            );

        setText(
            "#detailWorkflowStatus",
            statusLabel(
                stateValue
            )
        );

        setText(
            "#detailLegacyStatus",
            statusLabel(
                application.status
            )
        );

        setText(
            "#detailPreviousState",
            application.workflow
                ?.previousState ||
            "—"
        );

        setText(
            "#detailStateChangedAt",
            formatDate(
                application.workflow
                    ?.stateChangedAt
            )
        );
    }


    function renderApplicationData(
        application
    ) {
        setText(
            "#detailVisaType",
            application.visaType
        );

        setText(
            "#detailVisaCenter",
            application.visaCenter
        );

        setText(
            "#detailServiceType",
            application.serviceType
        );

        setText(
            "#detailAppointmentMode",
            application.appointmentMode
        );

        setText(
            "#detailDateStart",
            application.preferredDates
                ?.start
                ? formatDateOnly(
                    application
                        .preferredDates
                        .start
                )
                : "—"
        );

        setText(
            "#detailDateEnd",
            application.preferredDates
                ?.end
                ? formatDateOnly(
                    application
                        .preferredDates
                        .end
                )
                : "—"
        );

        setText(
            "#detailPreferredTime",
            application.preferredTime
        );

        const weekdays =
            normalizeArray(
                application.preferredWeekdays
            );

        setText(
            "#detailPreferredWeekdays",
            weekdays.length
                ? weekdays.join(
                    ", "
                )
                : "Qualquer dia"
        );
    }


    /*
     * ========================================================
     * PASSPORT
     * ========================================================
     */

    function renderPassportDetails(
        application
    ) {
        const passport =
            application.passport ||
            {};

        const verified =
            Boolean(
                passport.verified
            );

        const status =
            passport.status ||
            (
                verified
                    ? "PASSPORT_VERIFIED"
                    : "PASSPORT_PENDING"
            );

        setBadge(
            "#detailPassportStatus",
            statusLabel(
                status
            ),
            status
        );

        setText(
            "#detailPassportNumber",
            passport.number ||
            "Número não disponível"
        );

        setText(
            "#detailPassportName",
            passport.name ||
            getClient(
                application
            ).name ||
            "—"
        );
    }


    /*
     * ========================================================
     * IDENTITY
     * ========================================================
     */

    function renderIdentityDetails(
    application
) {
    const identity =
        application?.identity ||
        {};

    const liveness =
        identity?.liveness ||
        null;

    const positions =
        Array.isArray(
            liveness?.positions
        )
            ? liveness.positions
            : [];

    const count =
        Number(
            liveness?.completedCount ??
            identity?.positionCount ??
            positions.length ??
            0
        );

    const verified =
        liveness?.verified === true ||
        identity?.verified === true;

    const status =
        liveness?.status ||
        identity?.status ||
        (
            verified
                ? "IDENTITY_READY"
                : "IDENTITY_PREPARATION"
        );

    /*
     * ========================================================
     * RESUMO PRINCIPAL
     * ========================================================
     */

    setText(
        "#detailFaceCount",
        count
    );

    setBadge(
        "#detailIdentityStatus",
        statusLabel(
            status
        ),
        status
    );


    /*
     * ========================================================
     * PROGRESSO
     * ========================================================
     */

    const progress =
        $(
            "#identityProgressBar"
        );

    if (progress) {
        const percentage =
            Math.min(
                100,
                (
                    count /
                    10
                ) *
                100
            );

        progress.style.width =
            `${percentage}%`;
    }


    /*
     * ========================================================
     * INFORMAÇÃO EXTRA DA SESSÃO DE LIVENESS
     * ========================================================
     *
     * O painel antigo não tinha elementos específicos
     * para estes dados.
     *
     * Por isso criamos dinamicamente um bloco dentro
     * do cartão de identidade, sem alterar o HTML existente.
     */

    const identityCard =
        document
            .querySelector(
                "#detailIdentityStatus"
            )
            ?.closest(
                ".detail-card"
            );

    if (!identityCard) {
        return;
    }


    let livenessPanel =
        identityCard.querySelector(
            ".admin-liveness-panel"
        );

    if (!livenessPanel) {
        livenessPanel =
            document.createElement(
                "div"
            );

        livenessPanel.className =
            "admin-liveness-panel";

        identityCard.appendChild(
            livenessPanel
        );
    }


    /*
     * ========================================================
     * SEM LIVENESS
     * ========================================================
     */

    if (!liveness) {
        livenessPanel.innerHTML =
            `
                <div class="admin-liveness-empty">
                    <strong>
                        Prova de vida ainda não disponível
                    </strong>

                    <span>
                        O processo ainda não possui uma sessão
                        de liveness registada.
                    </span>
                </div>
            `;

        return;
    }


    /*
     * ========================================================
     * DADOS DA SESSÃO
     * ========================================================
     */

    const score =
        Number(
            liveness.score
        );

    const scoreText =
        Number.isFinite(
            score
        )
            ? `${Math.round(
                score * 100
            )}%`
            : "—";

    const sessionStatus =
        liveness.status ||
        "not_started";

    const sessionStatusLabel =
        sessionStatus === "passed"
            ? "Liveness validado"
            : sessionStatus === "failed"
                ? "Liveness reprovado"
                : sessionStatus === "requires_user"
                    ? "Requer nova verificação"
                    : sessionStatus === "in_progress"
                        ? "Em processamento"
                        : "Não iniciado";


    /*
     * ========================================================
     * POSIÇÕES
     * ========================================================
     */

    const orderedPositions =
        [...positions]
            .sort(
                (a, b) =>
                    Number(
                        a?.position || 0
                    ) -
                    Number(
                        b?.position || 0
                    )
            );


    const positionItems =
        Array.from(
            {
                length: 10
            },
            (_, index) => {
                const expected =
                    index + 1;

                const position =
                    orderedPositions.find(
                        item =>
                            Number(
                                item?.position
                            ) ===
                            expected
                    );

                if (!position) {
                    return `
                        <div class="admin-liveness-position missing">
                            <span class="admin-liveness-position-number">
                                ${expected}
                            </span>

                            <div class="admin-liveness-position-info">
                                <strong>
                                    Posição ${expected}
                                </strong>

                                <span>
                                    Não registada
                                </span>
                            </div>

                            <span class="admin-liveness-position-state">
                                —
                            </span>
                        </div>
                    `;
                }

                const positionScore =
                    Number(
                        position.positionScore ??
                        position.score ??
                        0
                    );

                const positionScoreText =
                    Number.isFinite(
                        positionScore
                    )
                        ? `${Math.round(
                            positionScore * 100
                        )}%`
                        : "—";

                const positionVerified =
                    position.verified === true &&
                    position.faceDetected === true &&
                    position.singleFace === true;

                const smile =
                    position.smileDetected === true;

                const positionLabel =
                    position.label ||
                    `Posição ${expected}`;

                return `
                    <div class="admin-liveness-position ${
                        positionVerified
                            ? "verified"
                            : "failed"
                    }">

                        <span class="admin-liveness-position-number">
                            ${expected}
                        </span>

                        <div class="admin-liveness-position-info">

                            <strong>
                                ${escapeHtml(
                                    positionLabel
                                )}
                            </strong>

                            <span>
                                ${
                                    position.instruction
                                        ? escapeHtml(
                                            position.instruction
                                        )
                                        : positionVerified
                                            ? "Movimento validado"
                                            : "Movimento não validado"
                                }
                            </span>

                        </div>

                        <div class="admin-liveness-position-meta">

                            <span>
                                ${positionScoreText}
                            </span>

                            <span
                                class="${
                                    positionVerified
                                        ? "verified"
                                        : "failed"
                                }"
                            >
                                ${
                                    positionVerified
                                        ? "✓"
                                        : "!"
                                }
                            </span>

                            ${
                                smile
                                    ? `
                                        <span
                                            title="Sorriso detectado"
                                        >
                                            ☺
                                        </span>
                                    `
                                    : ""
                            }

                        </div>

                    </div>
                `;
            }
        )
        .join("");


    /*
     * ========================================================
     * RENDER
     * ========================================================
     */

    livenessPanel.innerHTML =
        `
            <div class="admin-liveness-header">

                <div>
                    <span class="section-kicker">
                        LIVENESS
                    </span>

                    <strong>
                        Prova de vida
                    </strong>
                </div>

                <span
                    class="admin-liveness-status ${
                        sessionStatus
                    }"
                >
                    ${escapeHtml(
                        sessionStatusLabel
                    )}
                </span>

            </div>


            <div class="admin-liveness-summary">

                <div>
                    <span>
                        Sessão
                    </span>

                    <strong>
                        ${escapeHtml(
                            liveness.sessionId ||
                            "—"
                        )}
                    </strong>
                </div>

                <div>
                    <span>
                        Score
                    </span>

                    <strong>
                        ${scoreText}
                    </strong>
                </div>

                <div>
                    <span>
                        Posições
                    </span>

                    <strong>
                        ${count}/10
                    </strong>
                </div>

                <div>
                    <span>
                        Verificado
                    </span>

                    <strong>
                        ${
                            liveness.verified === true
                                ? "SIM"
                                : "NÃO"
                        }
                    </strong>
                </div>

            </div>


            <div class="admin-liveness-times">

                <div>
                    <span>
                        Início
                    </span>

                    <strong>
                        ${formatDate(
                            liveness.startedAt
                        )}
                    </strong>
                </div>

                <div>
                    <span>
                        Conclusão
                    </span>

                    <strong>
                        ${formatDate(
                            liveness.completedAt
                        )}
                    </strong>
                </div>

            </div>


            <div class="admin-liveness-positions">

                <div class="admin-liveness-positions-title">
                    <span>
                        MOVIMENTOS DA SESSÃO
                    </span>

                    <strong>
                        ${positions.length}/10
                    </strong>
                </div>

                ${positionItems}

            </div>
        `;
}

    /*
     * ========================================================
     * BOTS / VFS
     * ========================================================
     */

    function renderBotDetails(
        application
    ) {
        const bot1 =
            getBotStatus(
                application.bot1
            );

        const bot2 =
            getBotStatus(
                application.bot2
            );

        const admin =
            getAdmin(
                application
            );

        let vfsStatus =
            "NÃO CONFIGURADO";

        if (
            application.vfsStatus
        ) {
            vfsStatus =
                application.vfsStatus;
        }

        if (
            application.vfs?.status
        ) {
            vfsStatus =
                application.vfs.status;
        }

        if (
            admin.vfsCredentials
                ?.configured
        ) {
            vfsStatus =
                "CREDENCIAIS CONFIGURADAS";
        }

        if (
            application.workflowState ===
            "VFS_AUTHENTICATED"
        ) {
            vfsStatus =
                "AUTENTICADO";
        }

        setText(
            "#detailBot1Status",
            statusLabel(
                bot1
            )
        );

        setText(
            "#detailBot2Status",
            statusLabel(
                bot2
            )
        );

        setText(
            "#detailVfsStatus",
            statusLabel(
                vfsStatus
            )
        );

        [
            [
                "#detailBot1Status",
                bot1
            ],
            [
                "#detailBot2Status",
                bot2
            ]
        ].forEach(
            ([selector, status]) => {
                const element =
                    $(selector);

                if (!element) {
                    return;
                }

                element.classList.remove(
                    "bot-running",
                    "bot-waiting",
                    "bot-error"
                );

                const className =
                    botClass(
                        status
                    );

                if (className) {
                    element.classList.add(
                        className
                    );
                }
            }
        );
    }


    /*
     * ========================================================
     * PAYMENT
     * ========================================================
     */

    function renderPaymentDetails(
        application
    ) {
        const payment =
            getPayment(
                application
            );

        const status =
            payment.status ||
            "—";

        setText(
            "#detailPaymentStatus",
            statusLabel(
                status
            )
        );

        setText(
            "#detailPaymentReference",
            payment.reference
        );

        setText(
            "#detailPaymentEntity",
            payment.entity
        );

        setText(
            "#detailPaymentAmount",
            formatMoney(
                payment.amount,
                payment.currency
            )
        );

        setText(
            "#detailPaymentCurrency",
            payment.currency
        );

        setText(
            "#detailPaymentDeadline",
            formatDate(
                payment.deadline
            )
        );

        setText(
            "#detailPaymentTransaction",
            payment.transactionId
        );

        const box =
            $(
                "#confirmationBox"
            );

        const link =
            $(
                "#confirmationLink"
            );

        if (
            payment.confirmationUrl
        ) {
            if (box) {
                box.classList.remove(
                    "hidden"
                );
            }

            if (link) {
                link.href =
                    payment.confirmationUrl;
            }
        } else if (box) {
            box.classList.add(
                "hidden"
            );
        }
    }


    /*
     * ========================================================
     * ERRORS
     * ========================================================
     */

    function renderErrorDetails(
        application
    ) {
        const error =
            application.error;

        const card =
            $(
                "#errorCard"
            );

        if (
            !error ||
            !(
                error.code ||
                error.message
            )
        ) {
            if (card) {
                card.classList.add(
                    "hidden"
                );
            }

            return;
        }

        if (card) {
            card.classList.remove(
                "hidden"
            );
        }

        setText(
            "#detailErrorCode",
            error.code
        );

        setText(
            "#detailErrorMessage",
            error.message
        );

        setText(
            "#detailErrorAt",
            formatDate(
                error.at
            )
        );
    }


    /*
     * ========================================================
     * CREDENTIALS
     * ========================================================
     */

    function renderCredentialsState(
        application
    ) {
        const admin =
            getAdmin(
                application
            );

        const configured =
            Boolean(
                admin
                    .vfsCredentials
                    ?.configured
            );

        const element =
            $(
                "#credentialsStatus"
            );

        if (element) {
            element.textContent =
                configured
                    ? "Configuradas"
                    : "Não configuradas";

            element.classList.toggle(
                "configured",
                configured
            );
        }

        /*
         * Por segurança, estes campos
         * nunca são preenchidos pelo backend.
         */

        const email =
            $(
                "#vfsEmail"
            );

        const password =
            $(
                "#vfsPassword"
            );

        if (email) {
            email.value =
                "";
        }

        if (password) {
            password.value =
                "";
        }
    }


    /*
     * ========================================================
     * AUTOMATION CONTROLS
     * ========================================================
     */

    function renderAutomationControls(
        application
    ) {
        const admin =
            getAdmin(
                application
            );

        const status =
            admin.status ||
            "PENDING_REVIEW";

        const released =
            Boolean(
                admin.release?.enabled
            );

        const configured =
            Boolean(
                admin
                    .vfsCredentials
                    ?.configured
            );
        const canManage =
    [
        "owner",
        "admin"
    ].includes(
        state.currentUserRole
    );

        const releaseButton =
            $(
                "#releaseButton"
            );

        const pauseButton =
            $(
                "#pauseButton"
            );

        const releaseStatus =
            $(
                "#releaseStatus"
            );

        const description =
            $(
                "#releaseDescription"
            );

        const warning =
            $(
                "#releaseWarning"
            );

        if (releaseStatus) {
            releaseStatus.textContent =
                released
                    ? "LIBERADO"
                    : statusLabel(
                        status
                    );

            releaseStatus.className =
                `status-badge ${
                    statusClass(
                        status
                    )
                }`;
        }

        if (description) {
            if (released) {
                description.textContent =
                    "Este processo foi liberado para os bots pelo administrador.";
            } else if (!configured) {
                description.textContent =
                    "Configure primeiro o email e a password VFS.";
            } else {
                description.textContent =
                    "As credenciais estão configuradas. A automação ainda aguarda a liberação.";
            }
        }

        if (warning) {
            warning.classList.toggle(
                "hidden",
                released
            );
        }

        if (releaseButton) {
    releaseButton.disabled =
        !canManage ||
        released ||
        !configured ||
        ![
            "PENDING_REVIEW",
            "PAUSED",
            "READY_FOR_AUTOMATION"
        ].includes(
            status
        );
}

        if (pauseButton) {
    pauseButton.disabled =
        !canManage ||
        !released;
}
    }


    /*
     * ========================================================
     * NOTES
     * ========================================================
     */

    function renderNotes(
        application
    ) {
        const textarea =
            $(
                "#adminNotes"
            );

        if (!textarea) {
            return;
        }

        const admin =
            getAdmin(
                application
            );

        textarea.value =
            admin.notes ||
            "";
    }


    /*
     * ========================================================
     * SAVE CREDENTIALS
     * ========================================================
     */

    async function saveCredentials(
        event
    ) {
        event.preventDefault();
        if (
    ![
        "owner",
        "admin"
    ].includes(
        state.currentUserRole
    )
) {
    showToast(
        "Permissão",
        "Apenas administradores podem configurar credenciais VFS.",
        "error"
    );

    return;
}

        const id =
            state.selectedApplicationId;

        if (!id) {
            showToast(
                "Processo",
                "Selecione primeiro um processo.",
                "error"
            );

            return;
        }

        const email =
            $(
                "#vfsEmail"
            )?.value.trim();

        const password =
            $(
                "#vfsPassword"
            )?.value || "";
        const phone =
    $(
        "#vfsPhone"
    )?.value.trim();

        if (!email) {
            showToast(
                "VFS",
                "Informe o email VFS.",
                "error"
            );

            return;
        }

        if (!password) {
            showToast(
                "VFS",
                "Informe a password VFS.",
                "error"
            );

            return;
        }
        if (!phone) {
    showToast(
        "VFS",
        "Informe o telefone VFS que poderá receber o OTP.",
        "error"
    );

    return;
}

        const button =
            $(
                "#saveCredentialsButton"
            );

        if (button) {
            button.disabled =
                true;

            button.dataset.originalText =
                button.textContent;

            button.textContent =
                "A guardar...";
        }

        try {
            await api(
                `/api/admin/applications/${encodeURIComponent(
                    id
                )}/vfs-credentials`,
                {
                    method:
                        "POST",

                    body:
    JSON.stringify({
        email,
        password,
        phone
    })
                }
            );

            /*
             * Nunca manter a password
             * na interface depois de guardar.
             */

            if (
                $(
                    "#vfsEmail"
                )
            ) {
                $(
                    "#vfsEmail"
                ).value =
                    "";
            }

            if (
                $(
                    "#vfsPassword"
                )
            ) {
                $(
                    "#vfsPassword"
                ).value =
                    "";
            }
            if (
    $(
        "#vfsPhone"
    )
) {
    $(
        "#vfsPhone"
    ).value =
        "";
}

            showToast(
                "Credenciais",
                "Credenciais VFS guardadas de forma segura.",
                "success"
            );

            await refreshAll(
                id
            );

        } catch (
            error
        ) {
            showToast(
                "Erro",
                error.message,
                "error"
            );

        } finally {
            if (button) {
                button.disabled =
                    false;

                button.textContent =
                    button.dataset.originalText ||
                    "Guardar credenciais";
            }
        }
    }


    /*
     * ========================================================
     * SAVE NOTES
     * ========================================================
     */

    async function saveNotes() {
        if (
    ![
        "owner",
        "admin"
    ].includes(
        state.currentUserRole
    )
) {
    showToast(
        "Permissão",
        "Apenas administradores podem configurar credenciais VFS.",
        "error"
    );

    return;
}
        const id =
            state.selectedApplicationId;

        if (!id) {
            return;
        }

        const textarea =
            $(
                "#adminNotes"
            );

        if (!textarea) {
            return;
        }

        const notes =
            textarea.value;

        try {
            const data =
                await api(
                    `/api/admin/applications/${encodeURIComponent(
                        id
                    )}/notes`,
                    {
                        method:
                            "PATCH",

                        body:
                            JSON.stringify({
                                notes
                            })
                    }
                );

            if (
                state.selectedApplication
            ) {
                state.selectedApplication.admin =
                    data?.admin ||
                    state.selectedApplication.admin ||
                    {};
            }

            showToast(
                "Observações",
                "Observações administrativas guardadas.",
                "success"
            );

        } catch (
            error
        ) {
            showToast(
                "Erro",
                error.message,
                "error"
            );
        }
    }


    /*
     * ========================================================
     * RELEASE
     * ========================================================
     */

    async function releaseApplication() {
        if (
    ![
        "owner",
        "admin"
    ].includes(
        state.currentUserRole
    )
) {
    showToast(
        "Permissão",
        "Apenas administradores podem configurar credenciais VFS.",
        "error"
    );

    return;
}
        const id =
            state.selectedApplicationId;

        if (!id) {
            return;
        }

        openConfirmation({
            title:
                "Liberar automação",

            message:
                "Depois desta ação, o processo poderá ser executado pelo Bot 1 e pelo Bot 2. Deseja continuar?",

            confirmText:
                "LIBERAR",

            type:
                "release",

            action:
                async () => {
                    await api(
                        `/api/admin/applications/${encodeURIComponent(
                            id
                        )}/release`,
                        {
                            method:
                                "POST"
                        }
                    );

                    showToast(
                        "Automação",
                        "Processo liberado para automação.",
                        "success"
                    );

                    await refreshAll(
                        id
                    );
                }
        });
    }


    /*
     * ========================================================
     * PAUSE
     * ========================================================
     */

    async function pauseApplication() {
       if (
    ![
        "owner",
        "admin"
    ].includes(
        state.currentUserRole
    )
) {
    showToast(
        "Permissão",
        "Apenas administradores podem configurar credenciais VFS.",
        "error"
    );

    return;
}
        const id =
            state.selectedApplicationId;

        if (!id) {
            return;
        }

        openConfirmation({
            title:
                "Pausar automação",

            message:
                "O Bot 1 e o Bot 2 deixarão de avançar neste processo. Deseja continuar?",

            confirmText:
                "PAUSAR",

            type:
                "pause",

            action:
                async () => {
                    await api(
                        `/api/admin/applications/${encodeURIComponent(
                            id
                        )}/pause`,
                        {
                            method:
                                "POST"
                        }
                    );

                    showToast(
                        "Automação",
                        "Automação pausada.",
                        "success"
                    );

                    await refreshAll(
                        id
                    );
                }
        });
    }


    /*
     * ========================================================
     * CONFIRMATION MODAL
     * ========================================================
     */

    function openConfirmation({
        title,
        message,
        confirmText,
        type,
        action
    }) {
        state.currentAction =
            action;

        const modal =
            $(
                "#confirmModal"
            );

        const titleElement =
            $(
                "#modalTitle"
            );

        const messageElement =
            $(
                "#modalMessage"
            );

        const confirmButton =
            $(
                "#modalConfirm"
            );

        const icon =
            $(
                "#modalIcon"
            );

        if (titleElement) {
            titleElement.textContent =
                title;
        }

        if (messageElement) {
            messageElement.textContent =
                message;
        }

        if (confirmButton) {
            confirmButton.textContent =
                confirmText ||
                "Confirmar";
        }

        if (icon) {
            icon.textContent =
                type ===
                    "pause"
                    ? "!"
                    : "✓";
        }

        if (modal) {
            modal.classList.remove(
                "hidden"
            );
        }
    }


    function closeConfirmation() {
        state.currentAction =
            null;

        const modal =
            $(
                "#confirmModal"
            );

        if (modal) {
            modal.classList.add(
                "hidden"
            );
        }
    }


    async function confirmCurrentAction() {
        const action =
            state.currentAction;

        if (!action) {
            closeConfirmation();
            return;
        }

        const button =
            $(
                "#modalConfirm"
            );

        if (button) {
            button.disabled =
                true;
        }

        try {
            await action();
        } catch (
            error
        ) {
            showToast(
                "Erro",
                error.message,
                "error"
            );
        } finally {
            if (button) {
                button.disabled =
                    false;
            }

            closeConfirmation();
        }
    }


    /*
     * ========================================================
     * ADMIN IDENTITY
     * ========================================================
     */
    function applyAdminPermissions() {
    const role =
        String(
            state.currentUserRole ||
            ""
        ).toLowerCase();

    const canManage =
        role === "owner" ||
        role === "admin";

    const credentialsForm =
        $(
            "#credentialsForm"
        );

    const saveCredentialsButton =
        $(
            "#saveCredentialsButton"
        );

    const releaseButton =
        $(
            "#releaseButton"
        );

    const pauseButton =
        $(
            "#pauseButton"
        );

    const notes =
        $(
            "#adminNotes"
        );

    if (credentialsForm) {
        credentialsForm.classList.toggle(
            "admin-readonly",
            !canManage
        );
    }

    if (saveCredentialsButton) {
        saveCredentialsButton.disabled =
            !canManage;
    }

    if (releaseButton) {
        releaseButton.dataset.permissionDenied =
            canManage
                ? "false"
                : "true";
    }

    if (pauseButton) {
        pauseButton.dataset.permissionDenied =
            canManage
                ? "false"
                : "true";
    }

    if (notes) {
        notes.readOnly =
            !canManage;

        notes.classList.toggle(
            "admin-readonly",
            !canManage
        );
    }
      const permissionNotice =
    $(
        "#permissionNotice"
    );

const permissionTitle =
    $(
        "#permissionTitle"
    );

const permissionDescription =
    $(
        "#permissionDescription"
    );

if (permissionNotice) {
    permissionNotice.hidden =
        canManage;

    document.body.classList.remove(
        "admin-owner",
        "admin-admin",
        "admin-operator",
        "admin-viewer"
    );

    document.body.classList.add(
        `admin-${role || "viewer"}`
    );
}

if (permissionTitle) {
    permissionTitle.textContent =
        canManage
            ? "Acesso administrativo"
            : "Acesso de consulta";
}

if (permissionDescription) {
    permissionDescription.textContent =
        canManage
            ? "Pode configurar e controlar a automação."
            : "As ações administrativas estão disponíveis apenas para administradores.";
}
    if (!canManage) {
        if (saveCredentialsButton) {
            saveCredentialsButton.title =
                "Apenas administradores podem configurar credenciais VFS.";
        }

        if (releaseButton) {
            releaseButton.title =
                "Apenas administradores podem liberar a automação.";
        }

        if (pauseButton) {
            pauseButton.title =
                "Apenas administradores podem pausar a automação.";
        }

        if (notes) {
            notes.title =
                "Apenas administradores podem alterar observações.";
        }
    }
}
    async function loadAdminIdentity() {
    try {
        const response =
            await fetch(
                "/api/auth/me",
                {
                    credentials:
                        "include",

                    headers: {
                        Accept:
                            "application/json"
                    }
                }
            );

        if (!response.ok) {
            return;
        }

        const data =
            await response.json();

        const user =
            data?.user ||
            data;

        if (!user) {
            return;
        }

        state.currentUser =
            user;

        state.currentUserRole =
            String(
                user.role ||
                "viewer"
            ).toLowerCase();

        const name =
            user.name ||
            user.email ||
            "Administrador";

        const role =
            user.role ||
            "viewer";

        setText(
            "#adminName",
            name
        );

        setText(
            "#adminRole",
            String(
                role
            ).toUpperCase()
        );

        setText(
            "#adminAvatar",
            firstLetter(
                name
            )
        );

        applyAdminPermissions();

    } catch (
        error
    ) {
        console.debug(
            "[ADMIN] identity",
            error
        );
    }
}

    /*
     * ========================================================
     * REFRESH
     * ========================================================
     */

    async function refreshAll(
        preserveId = null
    ) {
        const selectedId =
            preserveId ||
            state.selectedApplicationId;

        try {
            await Promise.all([
                loadStats(),
                loadApplications()
            ]);

            if (!selectedId) {
                return;
            }

            const exists =
                state.applications.some(
                    application =>
                        String(
                            application.id
                        ) ===
                        String(
                            selectedId
                        )
                );

            if (exists) {
                await selectApplication(
                    selectedId
                );
            } else {
                state.selectedApplicationId =
                    null;

                state.selectedApplication =
                    null;

                updateSelectedId();

                showEmptyDetails();
            }

        } catch (
            error
        ) {
            console.error(
                "[ADMIN] refresh",
                error
            );
        }
    }


    /*
     * ========================================================
     * LOGOUT
     * ========================================================
     */

    async function logout() {
        try {
            await api(
                "/api/auth/logout",
                {
                    method:
                        "POST"
                }
            );
        } catch (
            error
        ) {
            console.debug(
                "[ADMIN] logout",
                error
            );
        }

        window.location.href =
            "/";
    }


    /*
     * ========================================================
     * EVENTS
     * ========================================================
     */

    function bindEvents() {

        $(
            "#refreshButton"
        )?.addEventListener(
            "click",
            () => {
                refreshAll(
                    state.selectedApplicationId
                );
            }
        );


        $(
            "#applicationSearch"
        )?.addEventListener(
            "input",
            applyFilters
        );


        $(
            "#statusFilter"
        )?.addEventListener(
            "change",
            applyFilters
        );


        $(
            "#clearFiltersButton"
        )?.addEventListener(
            "click",
            () => {
                const search =
                    $(
                        "#applicationSearch"
                    );

                const filter =
                    $(
                        "#statusFilter"
                    );

                if (search) {
                    search.value =
                        "";
                }

                if (filter) {
                    filter.value =
                        "all";
                }

                applyFilters();
            }
        );


        $(
            "#credentialsForm"
        )?.addEventListener(
            "submit",
            saveCredentials
        );


        $(
            "#releaseButton"
        )?.addEventListener(
            "click",
            releaseApplication
        );


        $(
            "#pauseButton"
        )?.addEventListener(
            "click",
            pauseApplication
        );


        $(
            "#modalCancel"
        )?.addEventListener(
            "click",
            closeConfirmation
        );


        $(
            "#modalConfirm"
        )?.addEventListener(
            "click",
            confirmCurrentAction
        );


        $(
            "#confirmModal"
        )?.addEventListener(
            "click",
            event => {
                if (
                    event.target ===
                    $(
                        "#confirmModal"
                    )
                ) {
                    closeConfirmation();
                }
            }
        );


        $(
            "#togglePassword"
        )?.addEventListener(
            "click",
            () => {
                const input =
                    $(
                        "#vfsPassword"
                    );

                const button =
                    $(
                        "#togglePassword"
                    );

                if (!input) {
                    return;
                }

                const showing =
                    input.type ===
                    "text";

                input.type =
                    showing
                        ? "password"
                        : "text";

                if (button) {
                    button.textContent =
                        showing
                            ? "Mostrar"
                            : "Ocultar";
                }
            }
        );


        /*
         * Guardar observações quando
         * o administrador sai do campo.
         */

        $(
            "#adminNotes"
        )?.addEventListener(
            "blur",
            () => {
                saveNotes();
            }
        );


        /*
         * Ctrl/Cmd + Enter
         * também guarda observações.
         */

        $(
            "#adminNotes"
        )?.addEventListener(
            "keydown",
            event => {
                if (
                    (
                        event.ctrlKey ||
                        event.metaKey
                    ) &&
                    event.key ===
                    "Enter"
                ) {
                    event.preventDefault();

                    saveNotes();
                }
            }
        );


        $(
            "#logoutButton"
        )?.addEventListener(
            "click",
            logout
        );


        /*
         * Navegação da sidebar.
         */

        $$(
            "[data-scroll-target]"
        ).forEach(
            button => {
                button.addEventListener(
                    "click",
                    () => {
                        const target =
                            document.getElementById(
                                button.dataset
                                    .scrollTarget
                            );

                        if (!target) {
                            return;
                        }

                        target.scrollIntoView({
                            behavior:
                                "smooth",

                            block:
                                "start"
                        });

                        $$(
                            ".sidebar-item"
                        ).forEach(
                            item => {
                                item.classList.remove(
                                    "active"
                                );
                            }
                        );

                        button.classList.add(
                            "active"
                        );
                    }
                );
            }
        );


        /*
         * ESC fecha modal.
         */

        window.addEventListener(
            "keydown",
            event => {
                if (
                    event.key ===
                    "Escape"
                ) {
                    closeConfirmation();
                }
            }
        );
    }


    /*
     * ========================================================
     * INIT
     * ========================================================
     */

    async function init() {
        bindEvents();

        showEmptyDetails();

        await loadAdminIdentity();

        await refreshAll();

        state.refreshTimer =
            setInterval(
                () => {
                    refreshAll(
                        state.selectedApplicationId
                    );
                },
                30000
            );
    }


    return {
        init
    };

})();


document.addEventListener(
    "DOMContentLoaded",
    () => {
        AdminApp.init();
    }
);
