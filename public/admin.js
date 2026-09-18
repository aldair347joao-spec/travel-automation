"use strict";

/*
 * Travel Automation
 * Administrative Panel
 *
 * IMPORTANT:
 * - VFS password is never persisted in frontend state.
 * - VFS credentials are never read back from the API.
 * - All permission enforcement remains server-side.
 * - This page only consumes /api/admin endpoints.
 */

const AdminApp = (() => {

    const state = {
        applications: [],
        filteredApplications: [],
        selectedApplicationId: null,
        selectedApplication: null,
        loadingApplications: false,
        loadingDetails: false,
        currentAction: null,
        refreshTimer: null
    };

    const $ = selector =>
        document.querySelector(selector);

    const $$ = selector =>
        Array.from(
            document.querySelectorAll(selector)
        );

    /* =========================
       UTILITIES
    ========================= */

    function escapeHtml(value) {

        if (
            value === null ||
            value === undefined
        ) {
            return "";
        }

        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function formatDate(value) {

        if (!value) {
            return "—";
        }

        const date = new Date(value);

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
                dateStyle: "medium",
                timeStyle: "short"
            }
        ).format(date);
    }

    function formatDateOnly(value) {

        if (!value) {
            return "—";
        }

        const date = new Date(value);

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
                dateStyle: "medium"
            }
        ).format(date);
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

        const numericAmount =
            Number(amount);

        if (
            !Number.isFinite(
                numericAmount
            )
        ) {
            return `${amount} ${currency || ""}`.trim();
        }

        try {

            return new Intl.NumberFormat(
                "pt-AO",
                {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }
            ).format(numericAmount) +
                (
                    currency
                        ? ` ${currency}`
                        : ""
                );

        } catch {

            return `${numericAmount.toFixed(2)} ${currency || ""}`.trim();
        }
    }

    function firstLetter(value) {

        if (!value) {
            return "A";
        }

        return String(value)
            .trim()
            .charAt(0)
            .toUpperCase() || "A";
    }

    function normalizeArray(value) {

        if (Array.isArray(value)) {
            return value;
        }

        if (
            typeof value === "string" &&
            value.trim()
        ) {
            return value
                .split(",")
                .map(item =>
                    item.trim()
                )
                .filter(Boolean);
        }

        return [];
    }

    function getClient(application) {

        if (!application) {
            return {};
        }

        if (
            application.client &&
            typeof application.client === "object"
        ) {
            return application.client;
        }

        if (
            Array.isArray(
                application.clients
            ) &&
            application.clients.length
        ) {
            return application.clients[0];
        }

        if (
            Array.isArray(
                application.applicants
            ) &&
            application.applicants.length
        ) {
            return application.applicants[0];
        }

        return {};
    }

    function getAdminControl(application) {

        return (
            application?.admin ||
            application?.adminControl ||
            {}
        );
    }

    function getApplicationStatus(application) {

        return (
            application?.admin?.status ||
            application?.adminControl?.status ||
            application?.adminStatus ||
            application?.workflowState ||
            application?.status ||
            "UNKNOWN"
        );
    }

    function getWorkflowState(application) {

        return (
            application?.workflowState ||
            application?.workflow?.state ||
            application?.status ||
            "—"
        );
    }

    function getPayment(application) {

        return (
            application?.result ||
            application?.payment ||
            {}
        );
    }

    function getBot1(application) {

        return (
            application?.bot1 ||
            application?.bot1Status ||
            "idle"
        );
    }

    function getBot2(application) {

        return (
            application?.bot2 ||
            application?.bot2Status ||
            "idle"
        );
    }

    function getVfsStatus(application) {

        if (
            application?.vfs?.authenticated === true ||
            application?.vfsStatus === "authenticated" ||
            application?.admin?.vfsStatus === "authenticated"
        ) {
            return "AUTENTICADO";
        }

        if (
            application?.vfs?.status
        ) {
            return application.vfs.status;
        }

        if (
            application?.admin?.credentialsConfigured === true ||
            application?.adminControl?.vfsCredentials?.configured === true
        ) {
            return "CREDENCIAIS CONFIGURADAS";
        }

        return "NÃO CONFIGURADO";
    }

    /* =========================
       STATUS
    ========================= */

    function labelStatus(status) {

        const map = {

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

            IDENTITY_PREPARATION:
                "Preparação da identidade",

            IDENTITY_READY:
                "Identidade pronta",

            PREFERENCES_PENDING:
                "Preferências pendentes",

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

            FACIAL_PROCESSING:
                "Processamento facial",

            FACIAL_POSITION_REQUESTED:
                "Posição facial solicitada",

            FACIAL_VERIFICATION_COMPLETED:
                "Facial concluído",

            OTP_REQUIRED:
                "OTP solicitado",

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
            map[status] ||
            String(
                status || "—"
            )
        );
    }

    function statusClass(status) {

        switch (
            String(status || "")
                .toUpperCase()
        ) {

            case "PENDING_REVIEW":
            case "PAYMENT_PENDING":
            case "WAITING":
            case "WAITING_FOR_SLOT":

                return "status-pending";

            case "READY_FOR_AUTOMATION":
            case "VFS_AUTHENTICATED":
            case "SLOT_FOUND":

                return "status-ready";

            case "AUTOMATION_ACTIVE":
            case "RUNNING":
            case "COMPLETED":
            case "PAYMENT_CONFIRMED":

                return "status-active";

            case "PAUSED":
            case "ERROR":
            case "CANCELLED":
            case "PAYMENT_EXPIRED":

                return "status-paused";

            default:

                return "status-cancelled";
        }
    }

    function botClass(status) {

        const normalized =
            String(status || "")
                .toLowerCase();

        if (
            normalized.includes("running") ||
            normalized.includes("monitoring") ||
            normalized.includes("active") ||
            normalized.includes("completed")
        ) {
            return "bot-running";
        }

        if (
            normalized.includes("waiting") ||
            normalized.includes("starting") ||
            normalized.includes("slot")
        ) {
            return "bot-waiting";
        }

        if (
            normalized.includes("error") ||
            normalized.includes("requires")
        ) {
            return "bot-error";
        }

        return "";
    }

    /* =========================
       CSRF
    ========================= */

    function getCookie(name) {

        const prefix =
            `${name}=`;

        const parts =
            document.cookie
                .split(";")
                .map(
                    value =>
                        value.trim()
                );

        const match =
            parts.find(
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

    function getCsrfHeaders() {

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

    /* =========================
       API
    ========================= */

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

            "Accept":
                "application/json",

            ...(options.body
                ? {
                    "Content-Type":
                        "application/json"
                }
                : {}),

            ...(
                method !== "GET" &&
                method !== "HEAD" &&
                method !== "OPTIONS"
                    ? getCsrfHeaders()
                    : {}
            ),

            ...(options.headers || {})
        };

        const requestOptions = {

            ...options,

            credentials:
                "include",

            headers
        };

        const response =
            await fetch(
                path,
                requestOptions
            );

        let data = null;

        try {

            data =
                await response.json();

        } catch {

            data = null;
        }

        if (
            response.status === 401
        ) {

            handleUnauthorized();

            const error =
                new Error(
                    data?.message ||
                    data?.error ||
                    "Sessão administrativa expirada."
                );

            error.status = 401;

            throw error;
        }

        if (
            response.status === 403
        ) {

            const error =
                new Error(
                    data?.message ||
                    data?.error ||
                    "Não tem permissão para esta operação."
                );

            error.status = 403;
            error.data = data;

            throw error;
        }

        if (!response.ok) {

            const error =
                new Error(
                    data?.message ||
                    data?.error ||
                    `Erro HTTP ${response.status}`
                );

            error.status =
                response.status;

            error.data = data;

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
                window.location.href = "/";
            },
            1000
        );
    }

    /* =========================
       CONNECTION
    ========================= */

    function setConnectionStatus(
        type,
        text
    ) {

        const element =
            $("#connectionStatus");

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

        element.innerHTML = `
            <i></i>
            ${escapeHtml(text)}
        `;
    }

    function showToast(
        title,
        message,
        type = "success"
    ) {

        const container =
            $("#toastContainer");

        if (!container) {
            return;
        }

        const toast =
            document.createElement(
                "div"
            );

        toast.className =
            `toast ${type}`;

        toast.innerHTML = `
            <strong>
                ${escapeHtml(title)}
            </strong>

            <span>
                ${escapeHtml(message)}
            </span>
        `;

        container.appendChild(
            toast
        );

        setTimeout(
            () => toast.remove(),
            4500
        );
    }

    function updateTimestamp() {

        const element =
            $("#lastUpdated");

        if (!element) {
            return;
        }

        element.textContent =
            `Última atualização — ${new Intl.DateTimeFormat(
                "pt-PT",
                {
                    timeStyle: "short"
                }
            ).format(new Date())}`;
    }

    /* =========================
       STATS
    ========================= */

    async function loadStats() {

        const data =
            await api(
                "/api/admin/stats"
            );

        const stats =
            data?.stats ||
            data?.data ||
            data ||
            {};

        if ($("#statTotal")) {

            $("#statTotal").textContent =
                stats.total ??
                stats.totalApplications ??
                0;
        }

        if ($("#statPending")) {

            $("#statPending").textContent =
                stats.pendingAdmin ??
                stats.pendingReview ??
                stats.pending ??
                0;
        }

        if ($("#statActive")) {

            $("#statActive").textContent =
                stats.automationActive ??
                stats.active ??
                0;
        }

        if ($("#statPayment")) {

            $("#statPayment").textContent =
                stats.paymentPending ??
                stats.pendingPayment ??
                0;
        }
    }

    /* =========================
       APPLICATIONS
    ========================= */

    async function loadApplications() {

        state.loadingApplications =
            true;

        renderApplicationsLoading();

        try {

            const data =
                await api(
                    "/api/admin/applications"
                );

            const applications =
                data?.applications ||
                data?.items ||
                data?.data ||
                [];

            state.applications =
                Array.isArray(
                    applications
                )
                    ? applications
                    : [];

            applyFilters();

            setConnectionStatus(
                "online",
                "Sistema online"
            );

            updateTimestamp();

        } finally {

            state.loadingApplications =
                false;
        }
    }

    function renderApplicationsLoading() {

        const container =
            $("#applicationsList");

        if (!container) {
            return;
        }

        container.innerHTML = `
            <div class="loading-state">
                <div class="loading-spinner"></div>

                <span>
                    A carregar processos...
                </span>
            </div>
        `;
    }

    function applyFilters() {

        const search =
            (
                $("#applicationSearch")?.value ||
                ""
            )
                .trim()
                .toLowerCase();

        const status =
            $("#statusFilter")?.value ||
            "all";

        state.filteredApplications =
            state.applications.filter(
                application => {

                    const client =
                        getClient(
                            application
                        );

                    const searchable = [

                        application?._id,
                        application?.id,
                        application?.applicationId,

                        client?.name,
                        client?.fullName,
                        client?.email,
                        client?.phone,
                        client?.passportNumber,

                        application?.passportNumber,
                        application?.visaCenter,
                        application?.visaType

                    ]
                        .filter(Boolean)
                        .join(" ")
                        .toLowerCase();

                    if (
                        search &&
                        !searchable.includes(
                            search
                        )
                    ) {
                        return false;
                    }

                    if (
                        status !== "all"
                    ) {

                        return (
                            String(
                                getApplicationStatus(
                                    application
                                )
                            ).toUpperCase() ===
                            String(status)
                                .toUpperCase()
                        );
                    }

                    return true;
                }
            );

        if (
            $("#applicationCount")
        ) {

            $("#applicationCount")
                .textContent =
                state.filteredApplications.length;
        }

        renderApplications();
    }

    function renderApplications() {

        const container =
            $("#applicationsList");

        if (!container) {
            return;
        }

        if (
            !state.filteredApplications.length
        ) {

            container.innerHTML = `
                <div class="empty-list">
                    <span>
                        Nenhum processo encontrado.
                    </span>
                </div>
            `;

            return;
        }

        container.innerHTML =
            state.filteredApplications
                .map(
                    renderApplicationRow
                )
                .join("");

        $$(".application-row")
            .forEach(row => {

                row.addEventListener(
                    "click",
                    () => {

                        const id =
                            row.dataset
                                .applicationId;

                        if (id) {
                            selectApplication(
                                id
                            );
                        }
                    }
                );

            });
    }

    function renderApplicationRow(
        application
    ) {

        const client =
            getClient(
                application
            );

        const id =
            application?._id ||
            application?.id ||
            application?.applicationId;

        const name =
            client?.name ||
            client?.fullName ||
            application?.name ||
            "Cliente sem nome";

        const email =
            client?.email ||
            application?.email ||
            "Sem email";

        const passport =
            client?.passportNumber ||
            application?.passportNumber ||
            "Passaporte —";

        const center =
            application?.visaCenter ||
            "Centro VFS —";

        const visa =
            application?.visaType ||
            "Visto —";

        const status =
            getApplicationStatus(
                application
            );

        const selected =
            state.selectedApplicationId &&
            String(
                state.selectedApplicationId
            ) === String(id);

        return `
            <button
                type="button"
                class="application-row ${selected ? "selected" : ""}"
                data-application-id="${escapeHtml(id)}"
            >

                <div class="application-client">

                    <div class="application-avatar">
                        ${escapeHtml(
                            firstLetter(name)
                        )}
                    </div>

                    <div class="application-client-copy">

                        <strong>
                            ${escapeHtml(name)}
                        </strong>

                        <span>
                            ${escapeHtml(email)}
                        </span>

                    </div>

                </div>

                <div class="application-column">

                    <span>
                        Passaporte
                    </span>

                    <strong>
                        ${escapeHtml(passport)}
                    </strong>

                </div>

                <div class="application-column">

                    <span>
                        Centro
                    </span>

                    <strong>
                        ${escapeHtml(center)}
                    </strong>

                </div>

                <div class="application-column">

                    <span>
                        Visto
                    </span>

                    <strong>
                        ${escapeHtml(visa)}
                    </strong>

                </div>

                <div class="application-status">

                    <span
                        class="status-pill ${statusClass(status)}"
                    >
                        ${escapeHtml(
                            labelStatus(status)
                        )}
                    </span>

                </div>

            </button>
        `;
    }

    /* =========================
       SELECT APPLICATION
    ========================= */

    async function selectApplication(
        applicationId
    ) {

        if (!applicationId) {
            return;
        }

        state.selectedApplicationId =
            applicationId;

        state.loadingDetails =
            true;

        try {

            const data =
                await api(
                    `/api/admin/applications/${encodeURIComponent(
                        applicationId
                    )}`
                );

            const application =
                data?.application ||
                data?.data ||
                data;

            if (!application) {
                throw new Error(
                    "Processo não encontrado."
                );
            }

            state.selectedApplication =
                application;

            renderApplicationDetails(
                application
            );

            renderApplications();

        } catch (error) {

            console.error(
                "[ADMIN] select application:",
                error
            );

            showToast(
                "Erro",
                error.message ||
                    "Não foi possível carregar o processo.",
                "error"
            );

        } finally {

            state.loadingDetails =
                false;
        }
    }

    function renderApplicationDetails(
        application
    ) {

        renderClient(
            application
        );

        renderWorkflow(
            application
        );

        renderBots(
            application
        );

        renderVfs(
            application
        );

        renderApplicationData(
            application
        );

        renderPassport(
            application
        );

        renderIdentity(
            application
        );

        renderPayment(
            application
        );

        renderError(
            application
        );

        renderCredentials(
            application
        );

        renderAutomationControls(
            application
        );
    }

    /* =========================
       CLIENT
    ========================= */

    function renderClient(
        application
    ) {

        const client =
            getClient(
                application
            );

        const name =
            client?.name ||
            client?.fullName ||
            application?.name ||
            "—";

        const email =
            client?.email ||
            application?.email ||
            "—";

        const phone =
            client?.phone ||
            client?.mobile ||
            "—";

        const passport =
            client?.passportNumber ||
            application?.passportNumber ||
            "—";

        if ($("#detailClientName")) {

            $("#detailClientName")
                .textContent =
                name;
        }

        if ($("#detailClientEmail")) {

            $("#detailClientEmail")
                .textContent =
                email;
        }

        if ($("#detailClientPhone")) {

            $("#detailClientPhone")
                .textContent =
                phone;
        }

        if ($("#detailClientPassport")) {

            $("#detailClientPassport")
                .textContent =
                passport;
        }

        if ($("#detailClientAvatar")) {

            $("#detailClientAvatar")
                .textContent =
                firstLetter(name);
        }
    }

    /* =========================
       WORKFLOW
    ========================= */

    function renderWorkflow(
        application
    ) {

        const workflowState =
            getWorkflowState(
                application
            );

        const adminStatus =
            getApplicationStatus(
                application
            );

        if ($("#detailWorkflowState")) {

            $("#detailWorkflowState")
                .textContent =
                labelStatus(
                    workflowState
                );
        }

        if ($("#detailAdminStatus")) {

            $("#detailAdminStatus")
                .textContent =
                labelStatus(
                    adminStatus
                );
        }

        if ($("#detailStatusPill")) {

            const element =
                $("#detailStatusPill");

            element.textContent =
                labelStatus(
                    adminStatus
                );

            element.className =
                `status-pill ${statusClass(
                    adminStatus
                )}`;
        }

        if (
            $("#detailCreatedAt")
        ) {

            $("#detailCreatedAt")
                .textContent =
                formatDate(
                    application?.createdAt
                );
        }

        if (
            $("#detailUpdatedAt")
        ) {

            $("#detailUpdatedAt")
                .textContent =
                formatDate(
                    application?.updatedAt
                );
        }
    }

    /* =========================
       BOTS
    ========================= */

    function renderBots(
        application
    ) {

        const bot1 =
            getBot1(
                application
            );

        const bot2 =
            getBot2(
                application
            );

        const bot1Status =
            typeof bot1 === "object"
                ? (
                    bot1?.status ||
                    "idle"
                )
                : bot1;

        const bot2Status =
            typeof bot2 === "object"
                ? (
                    bot2?.status ||
                    "idle"
                )
                : bot2;

        if ($("#detailBot1Status")) {

            $("#detailBot1Status")
                .textContent =
                labelStatus(
                    bot1Status
                );

            $("#detailBot1Status")
                .className =
                `bot-status ${botClass(
                    bot1Status
                )}`;
        }

        if ($("#detailBot2Status")) {

            $("#detailBot2Status")
                .textContent =
                labelStatus(
                    bot2Status
                );

            $("#detailBot2Status")
                .className =
                `bot-status ${botClass(
                    bot2Status
                )}`;
        }

        if ($("#detailRadarStatus")) {

            const radarEnabled =
                application?.radar?.enabled === true;

            const monitoring =
                application?.bot2?.monitoring === true;

            $("#detailRadarStatus")
                .textContent =
                radarEnabled &&
                monitoring
                    ? "Radar ativo"
                    : "Radar parado";
        }
    }

    /* =========================
       VFS
    ========================= */

    function renderVfs(
        application
    ) {

        const status =
            getVfsStatus(
                application
            );

        if ($("#detailVfsStatus")) {

            $("#detailVfsStatus")
                .textContent =
                status;
        }

        if ($("#detailVfsStatusPill")) {

            $("#detailVfsStatusPill")
                .textContent =
                status;
        }

        const admin =
            getAdminControl(
                application
            );

        const configured =
            admin?.credentialsConfigured === true ||
            admin?.vfsCredentials?.configured === true ||
            application?.vfsCredentialsConfigured === true;

        if ($("#vfsCredentialsStatus")) {

            $("#vfsCredentialsStatus")
                .textContent =
                configured
                    ? "Configuradas"
                    : "Não configuradas";
        }

        /*
         * IMPORTANT:
         * Never populate vfsEmail from server data.
         *
         * The backend intentionally returns only
         * credentialsConfigured, never the encrypted
         * email/password values.
         */

        if ($("#vfsEmail")) {

            $("#vfsEmail").value =
                "";
        }

        if ($("#vfsPassword")) {

            $("#vfsPassword").value =
                "";
        }
    }

    /* =========================
       APPLICATION DATA
    ========================= */

    function renderApplicationData(
        application
    ) {

        const preferredDates =
            application?.preferredDates ||
            {};

        const weekdays =
            normalizeArray(
                application?.preferredWeekdays
            );

        const values = {

            visaType:
                application?.visaType,

            visaCenter:
                application?.visaCenter,

            travelPurpose:
                application?.travelPurpose,

            serviceType:
                application?.serviceType,

            appointmentMode:
                application?.appointmentMode,

            preferredStart:
                preferredDates?.start,

            preferredEnd:
                preferredDates?.end,

            preferredTime:
                application?.preferredTime,

            weekdays:
                weekdays.join(", ")

        };

        const fields = {

            "#detailVisaType":
                values.visaType,

            "#detailVisaCenter":
                values.visaCenter,

            "#detailTravelPurpose":
                values.travelPurpose,

            "#detailServiceType":
                values.serviceType,

            "#detailAppointmentMode":
                values.appointmentMode,

            "#detailPreferredStart":
                formatDateOnly(
                    values.preferredStart
                ),

            "#detailPreferredEnd":
                formatDateOnly(
                    values.preferredEnd
                ),

            "#detailPreferredTime":
                values.preferredTime,

            "#detailPreferredWeekdays":
                values.weekdays
        };

        Object.entries(
            fields
        ).forEach(
            ([selector, value]) => {

                const element =
                    $(selector);

                if (!element) {
                    return;
                }

                element.textContent =
                    value ||
                    "—";
            }
        );

        if (
            $("#detailTravelDate")
        ) {

            $("#detailTravelDate")
                .textContent =
                formatDateOnly(
                    application?.travelDate
                );
        }
    }

    /* =========================
       PASSPORT
    ========================= */

    function renderPassport(
        application
    ) {

        const passport =
            application?.passport ||
            application?.client?.passport ||
            {};

        const number =
            passport?.number ||
            passport?.passportNumber ||
            application?.passportNumber ||
            getClient(
                application
            )?.passportNumber ||
            "—";

        const name =
            passport?.fullName ||
            passport?.name ||
            "—";

        const nationality =
            passport?.nationality ||
            "—";

        const expiry =
            passport?.expiryDate ||
            passport?.expirationDate;

        if (
            $("#detailPassportNumber")
        ) {

            $("#detailPassportNumber")
                .textContent =
                number;
        }

        if (
            $("#detailPassportName")
        ) {

            $("#detailPassportName")
                .textContent =
                name;
        }

        if (
            $("#detailPassportNationality")
        ) {

            $("#detailPassportNationality")
                .textContent =
                nationality;
        }

        if (
            $("#detailPassportExpiry")
        ) {

            $("#detailPassportExpiry")
                .textContent =
                formatDateOnly(
                    expiry
                );
        }

        const verified =
            application?.passportVerified === true ||
            application?.passport?.verified === true ||
            application?.client?.passportVerified === true;

        if (
            $("#detailPassportStatus")
        ) {

            $("#detailPassportStatus")
                .textContent =
                verified
                    ? "Validado"
                    : "Não validado";
        }
    }

    /* =========================
       IDENTITY
    ========================= */

    function renderIdentity(
        application
    ) {

        const identity =
            application?.identity ||
            {};

        const positions =
            normalizeArray(
                identity?.positions ||
                application?.facialPositions
            );

        const count =
            positions.length;

        const verified =
            identity?.verified === true ||
            application?.identityVerified === true ||
            application?.facialVerified === true;

        if (
            $("#detailIdentityStatus")
        ) {

            $("#detailIdentityStatus")
                .textContent =
                verified
                    ? "Identidade preparada"
                    : "Identidade não concluída";
        }

        if (
            $("#detailFacialPositions")
        ) {

            $("#detailFacialPositions")
                .textContent =
                `${count} posições registadas`;
        }

        if (
            $("#detailFacialCount")
        ) {

            $("#detailFacialCount")
                .textContent =
                count;
        }

        if (
            $("#detailFacialVerification")
        ) {

            $("#detailFacialVerification")
                .textContent =
                verified
                    ? "Pronta"
                    : "Pendente";
        }
    }

    /* =========================
       PAYMENT
    ========================= */

    function renderPayment(
        application
    ) {

        const payment =
            getPayment(
                application
            );

        const reference =
            payment?.reference ||
            payment?.referenceNumber ||
            application?.reference ||
            application?.referenceNumber ||
            "—";

        const entity =
            payment?.entity ||
            payment?.entityNumber ||
            application?.entity ||
            application?.entityNumber ||
            "—";

        const amount =
            payment?.amount ??
            application?.paymentAmount;

        const currency =
            payment?.currency ||
            application?.paymentCurrency ||
            "AOA";

        const deadline =
            payment?.deadline ||
            payment?.paymentDeadline ||
            application?.paymentDeadline;

        const transaction =
            payment?.transactionId ||
            application?.transactionId ||
            "—";

        const status =
            payment?.status ||
            application?.paymentStatus ||
            (
                application?.workflowState ===
                "PAYMENT_CONFIRMED"
                    ? "confirmed"
                    : application?.workflowState ===
                        "PAYMENT_PENDING"
                        ? "pending"
                        : "—"
            );

        if (
            $("#detailPaymentReference")
        ) {

            $("#detailPaymentReference")
                .textContent =
                reference;
        }

        if (
            $("#detailPaymentEntity")
        ) {

            $("#detailPaymentEntity")
                .textContent =
                entity;
        }

        if (
            $("#detailPaymentAmount")
        ) {

            $("#detailPaymentAmount")
                .textContent =
                formatMoney(
                    amount,
                    currency
                );
        }

        if (
            $("#detailPaymentCurrency")
        ) {

            $("#detailPaymentCurrency")
                .textContent =
                currency;
        }

        if (
            $("#detailPaymentDeadline")
        ) {

            $("#detailPaymentDeadline")
                .textContent =
                formatDate(
                    deadline
                );
        }

        if (
            $("#detailPaymentTransaction")
        ) {

            $("#detailPaymentTransaction")
                .textContent =
                transaction;
        }

        const statusElement =
            $("#detailPaymentStatus");

        if (statusElement) {

            statusElement.textContent =
                labelPaymentStatus(
                    status
                );

            statusElement.className =
                `payment-status ${paymentClass(
                    status
                )}`;
        }

        const confirmationUrl =
            payment?.confirmationUrl ||
            application?.confirmationUrl;

        const confirmationBox =
            $("#confirmationBox");

        const confirmationLink =
            $("#confirmationLink");

        if (
            confirmationUrl &&
            confirmationBox &&
            confirmationLink
        ) {

            confirmationLink.href =
                confirmationUrl;

            confirmationBox.classList.remove(
                "hidden"
            );

        } else if (
            confirmationBox &&
            confirmationLink
        ) {

            confirmationLink.href =
                "#";

            confirmationBox.classList.add(
                "hidden"
            );
        }
    }

    function labelPaymentStatus(
        status
    ) {

        const normalized =
            String(
                status || ""
            ).toLowerCase();

        const map = {

            pending:
                "Pagamento pendente",

            payment_pending:
                "Pagamento pendente",

            confirmed:
                "Pagamento confirmado",

            payment_confirmed:
                "Pagamento confirmado",

            expired:
                "Pagamento expirado",

            payment_expired:
                "Pagamento expirado",

            failed:
                "Pagamento falhou",

            paid:
                "Pago"
        };

        return (
            map[normalized] ||
            labelStatus(status)
        );
    }

    function paymentClass(
        status
    ) {

        const normalized =
            String(
                status || ""
            ).toLowerCase();

        if (
            normalized.includes(
                "confirm"
            ) ||
            normalized === "paid"
        ) {
            return "payment-confirmed";
        }

        if (
            normalized.includes(
                "expired"
            ) ||
            normalized.includes(
                "failed"
            )
        ) {
            return "payment-expired";
        }

        if (
            normalized.includes(
                "pending"
            )
        ) {
            return "payment-pending";
        }

        return "";
    }

    /* =========================
       ERROR
    ========================= */

    function renderError(
        application
    ) {

        const error =
            application?.error ||
            {};

        const code =
            error?.code ||
            application?.errorCode;

        const message =
            error?.message ||
            application?.errorMessage;

        const at =
            error?.at ||
            application?.errorAt;

        const card =
            $("#errorCard");

        if (!card) {
            return;
        }

        if (
            !code &&
            !message
        ) {

            card.classList.add(
                "hidden"
            );

            return;
        }

        card.classList.remove(
            "hidden"
        );

        if (
            $("#detailErrorCode")
        ) {

            $("#detailErrorCode")
                .textContent =
                code ||
                "ERROR";
        }

        if (
            $("#detailErrorMessage")
        ) {

            $("#detailErrorMessage")
                .textContent =
                message ||
                "Erro não especificado.";
        }

        if (
            $("#detailErrorAt")
        ) {

            $("#detailErrorAt")
                .textContent =
                formatDate(
                    at
                );
        }
    }

    /* =========================
       CREDENTIALS
    ========================= */

    function renderCredentials(
        application
    ) {

        const admin =
            getAdminControl(
                application
            );

        const configured =
            admin?.credentialsConfigured === true ||
            admin?.vfsCredentials?.configured === true ||
            application?.vfsCredentialsConfigured === true;

        const configuredAt =
            admin?.credentialsConfiguredAt ||
            admin?.vfsCredentials?.configuredAt;

        if (
            $("#credentialsStatus")
        ) {

            $("#credentialsStatus")
                .textContent =
                configured
                    ? "Configuradas"
                    : "Não configuradas";
        }

        if (
            $("#credentialsConfiguredAt")
        ) {

            $("#credentialsConfiguredAt")
                .textContent =
                formatDate(
                    configuredAt
                );
        }

        /*
         * SECURITY:
         * The backend never sends the VFS email/password back.
         * Therefore the fields are intentionally blank.
         */

        if (
            $("#vfsEmail")
        ) {

            $("#vfsEmail").value =
                "";
        }

        if (
            $("#vfsPassword")
        ) {

            $("#vfsPassword").value =
                "";
        }
    }

    /* =========================
       AUTOMATION CONTROLS
    ========================= */

    function renderAutomationControls(
        application
    ) {

        const control =
            getAdminControl(
                application
            );

        const status =
            control?.status ||
            getApplicationStatus(
                application
            );

        const released =
            control?.released === true ||
            control?.release?.enabled === true ||
            status ===
                "READY_FOR_AUTOMATION" ||
            status ===
                "AUTOMATION_ACTIVE";

        const configured =
            control?.credentialsConfigured === true ||
            control?.vfsCredentials?.configured === true ||
            application?.vfsCredentialsConfigured === true;

        const active =
            status ===
                "AUTOMATION_ACTIVE";

        const paused =
            status ===
                "PAUSED";

        const releaseButton =
            $("#releaseButton");

        const pauseButton =
            $("#pauseButton");

        if (releaseButton) {

            releaseButton.disabled =
                !configured ||
                released ||
                active;

            releaseButton.textContent =
                released ||
                active
                    ? "AUTOMAÇÃO LIBERADA"
                    : "LIBERAR PARA AUTOMAÇÃO";
        }

        if (pauseButton) {

            pauseButton.disabled =
                !released &&
                !active;

            if (paused) {

                pauseButton.textContent =
                    "AUTOMAÇÃO PAUSADA";

            } else {

                pauseButton.textContent =
                    "PAUSAR AUTOMAÇÃO";
            }
        }

        if (
            $("#automationStatus")
        ) {

            $("#automationStatus")
                .textContent =
                labelStatus(
                    status
                );
        }

        if (
            $("#automationCredentials")
        ) {

            $("#automationCredentials")
                .textContent =
                configured
                    ? "Credenciais VFS configuradas"
                    : "Credenciais VFS pendentes";
        }

        if (
            $("#automationReleasedAt")
        ) {

            $("#automationReleasedAt")
                .textContent =
                formatDate(
                    control?.releasedAt ||
                    control?.release?.releasedAt
                );
        }
    }

    /* =========================
       SAVE CREDENTIALS
    ========================= */

    async function saveCredentials(
        event
    ) {

        event.preventDefault();

        const applicationId =
            state.selectedApplicationId;

        if (!applicationId) {

            showToast(
                "Nenhum processo",
                "Selecione primeiro um processo.",
                "error"
            );

            return;
        }

        const email =
            $("#vfsEmail")?.value
                .trim() || "";

        const password =
            $("#vfsPassword")?.value ||
            "";

        if (!email) {

            showToast(
                "Email obrigatório",
                "Informe o email utilizado no VFS.",
                "error"
            );

            return;
        }

        if (!password) {

            showToast(
                "Password obrigatória",
                "Informe a password VFS.",
                "error"
            );

            return;
        }

        const button =
            $("#saveCredentialsButton");

        const originalText =
            button?.textContent ||
            "Guardar";

        if (button) {

            button.disabled =
                true;

            button.textContent =
                "A guardar...";
        }

        try {

            await api(
                `/api/admin/applications/${encodeURIComponent(
                    applicationId
                )}/vfs-credentials`,
                {
                    method: "POST",

                    body:
                        JSON.stringify({
                            email,
                            password
                        })
                }
            );

            showToast(
                "Credenciais guardadas",
                "As credenciais VFS foram encriptadas e associadas ao processo."
            );

            /*
             * Immediately remove the password from
             * the browser after successful submission.
             */

            if (
                $("#vfsPassword")
            ) {

                $("#vfsPassword")
                    .value =
                    "";
            }

            if (
                $("#vfsEmail")
            ) {

                $("#vfsEmail")
                    .value =
                    "";
            }

            await selectApplication(
                applicationId
            );

        } catch (error) {

            console.error(
                "[ADMIN] save credentials:",
                error
            );

            showToast(
                "Erro ao guardar",
                error.message ||
                    "Não foi possível guardar as credenciais.",
                "error"
            );

        } finally {

            if (button) {

                button.disabled =
                    false;

                button.textContent =
                    originalText;
            }
        }
    }

    /* =========================
       CONFIRMATION MODAL
    ========================= */

    function openConfirmation({
        title,
        message,
        confirmText,
        danger = false,
        action
    }) {

        state.currentAction =
            action;

        if (
            $("#modalTitle")
        ) {

            $("#modalTitle")
                .textContent =
                title;
        }

        if (
            $("#modalMessage")
        ) {

            $("#modalMessage")
                .textContent =
                message;
        }

        if (
            $("#modalConfirm")
        ) {

            $("#modalConfirm")
                .textContent =
                confirmText;

            $("#modalConfirm")
                .className =
                `btn ${
                    danger
                        ? "btn-danger"
                        : "btn-primary"
                }`;
        }

        if (
            $("#confirmModal")
        ) {

            $("#confirmModal")
                .classList
                .remove(
                    "hidden"
                );
        }
    }

    function closeConfirmation() {

        state.currentAction =
            null;

        if (
            $("#confirmModal")
        ) {

            $("#confirmModal")
                .classList
                .add(
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
            $("#modalConfirm");

        if (button) {
            button.disabled =
                true;
        }

        try {

            await action();

        } finally {

            if (button) {

                button.disabled =
                    false;
            }

            closeConfirmation();
        }
    }

    /* =========================
       RELEASE
    ========================= */

    async function releaseApplication() {

        const applicationId =
            state.selectedApplicationId;

        if (!applicationId) {
            return;
        }

        try {

            await api(
                `/api/admin/applications/${encodeURIComponent(
                    applicationId
                )}/release`,
                {
                    method: "POST",
                    body:
                        JSON.stringify({})
                }
            );

            showToast(
                "Automação liberada",
                "O processo foi autorizado para o Bot 1 e Bot 2."
            );

            await refreshAll(
                applicationId
            );

        } catch (error) {

            console.error(
                "[ADMIN] release:",
                error
            );

            showToast(
                "Não foi possível liberar",
                error.message ||
                    "Não foi possível liberar o processo.",
                "error"
            );
        }
    }

    /* =========================
       PAUSE
    ========================= */

    async function pauseApplication() {

        const applicationId =
            state.selectedApplicationId;

        if (!applicationId) {
            return;
        }

        try {

            await api(
                `/api/admin/applications/${encodeURIComponent(
                    applicationId
                )}/pause`,
                {
                    method: "POST",
                    body:
                        JSON.stringify({})
                }
            );

            showToast(
                "Automação pausada",
                "O processo foi colocado em pausa."
            );

            await refreshAll(
                applicationId
            );

        } catch (error) {

            console.error(
                "[ADMIN] pause:",
                error
            );

            showToast(
                "Não foi possível pausar",
                error.message ||
                    "Não foi possível pausar o processo.",
                "error"
            );
        }
    }

    /* =========================
       EVENTS
    ========================= */

    function bindEvents() {

        $("#refreshButton")
            ?.addEventListener(
                "click",
                () =>
                    refreshAll()
            );

        $("#applicationSearch")
            ?.addEventListener(
                "input",
                applyFilters
            );

        $("#statusFilter")
            ?.addEventListener(
                "change",
                applyFilters
            );

        $("#clearFiltersButton")
            ?.addEventListener(
                "click",
                () => {

                    if (
                        $("#applicationSearch")
                    ) {

                        $("#applicationSearch")
                            .value =
                            "";
                    }

                    if (
                        $("#statusFilter")
                    ) {

                        $("#statusFilter")
                            .value =
                            "all";
                    }

                    applyFilters();
                }
            );

        $("#credentialsForm")
            ?.addEventListener(
                "submit",
                saveCredentials
            );

        $("#togglePassword")
            ?.addEventListener(
                "click",
                () => {

                    const input =
                        $("#vfsPassword");

                    const button =
                        $("#togglePassword");

                    if (
                        !input ||
                        !button
                    ) {
                        return;
                    }

                    if (
                        input.type ===
                        "password"
                    ) {

                        input.type =
                            "text";

                        button.textContent =
                            "Ocultar";

                    } else {

                        input.type =
                            "password";

                        button.textContent =
                            "Mostrar";
                    }
                }
            );

        $("#releaseButton")
            ?.addEventListener(
                "click",
                () => {

                    openConfirmation({

                        title:
                            "Liberar para automação?",

                        message:
                            "Depois desta ação, o processo poderá ser iniciado pelos mecanismos de automação. Confirme apenas se os dados e as credenciais VFS estão corretos.",

                        confirmText:
                            "Liberar",

                        action:
                            releaseApplication
                    });
                }
            );

        $("#pauseButton")
            ?.addEventListener(
                "click",
                () => {

                    openConfirmation({

                        title:
                            "Pausar automação?",

                        message:
                            "O processo será colocado em pausa e os mecanismos de automação deixarão de avançar este processo.",

                        confirmText:
                            "Pausar",

                        danger:
                            true,

                        action:
                            pauseApplication
                    });
                }
            );

        $("#modalCancel")
            ?.addEventListener(
                "click",
                closeConfirmation
            );

        $("#modalConfirm")
            ?.addEventListener(
                "click",
                confirmCurrentAction
            );

        $("#confirmModal")
            ?.addEventListener(
                "click",
                event => {

                    if (
                        event.target ===
                        $("#confirmModal")
                    ) {

                        closeConfirmation();
                    }
                }
            );

        $("#logoutButton")
            ?.addEventListener(
                "click",
                logout
            );

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

                        $$(".sidebar-item")
                            .forEach(
                                item =>
                                    item.classList
                                        .remove(
                                            "active"
                                        )
                            );

                        button.classList
                            .add(
                                "active"
                            );
                    }
                );
            }
        );

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

    /* =========================
       LOGOUT
    ========================= */

    async function logout() {

        try {

            await api(
                "/api/auth/logout",
                {
                    method: "POST"
                }
            );

        } catch (error) {

            /*
             * Even if logout endpoint fails,
             * redirect the administrator.
             */

            console.warn(
                "[ADMIN] logout:",
                error
            );
        }

        window.location.href =
            "/";
    }

    /* =========================
       REFRESH
    ========================= */

    async function refreshAll(
        preserveApplicationId = null
    ) {

        try {

            await Promise.all([
                loadStats(),
                loadApplications()
            ]);

            const id =
                preserveApplicationId ||
                state.selectedApplicationId;

            if (!id) {
                return;
            }

            const exists =
                state.applications.some(
                    item =>
                        String(
                            item?._id ||
                            item?.id ||
                            item?.applicationId
                        ) ===
                        String(id)
                );

            if (exists) {

                await selectApplication(
                    id
                );
            }

        } catch (error) {

            console.error(
                "[ADMIN] refresh error:",
                error
            );

            if (
                error?.status !== 401 &&
                error?.status !== 403
            ) {

                setConnectionStatus(
                    "offline",
                    "Erro de ligação"
                );

                showToast(
                    "Erro",
                    error.message ||
                        "Não foi possível atualizar o painel.",
                    "error"
                );
            }
        }
    }

    /* =========================
       ADMIN IDENTITY
    ========================= */

    async function loadAdminIdentity() {

        try {

            const response =
                await fetch(
                    "/api/me",
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

            const name =
                user?.name ||
                user?.email ||
                "Administrador";

            const role =
                user?.role ||
                "admin";

            if ($("#adminName")) {

                $("#adminName")
                    .textContent =
                    name;
            }

            if ($("#adminRole")) {

                $("#adminRole")
                    .textContent =
                    String(role)
                        .toUpperCase();
            }

            if ($("#adminAvatar")) {

                $("#adminAvatar")
                    .textContent =
                    firstLetter(
                        name
                    );
            }

        } catch (error) {

            /*
             * /api/admin remains the
             * authoritative permission check.
             */

            console.debug(
                "[ADMIN] identity unavailable:",
                error
            );
        }
    }

    /* =========================
       INIT
    ========================= */

    async function init() {

        bindEvents();

        await loadAdminIdentity();

        await refreshAll();

        state.refreshTimer =
            setInterval(
                () =>
                    refreshAll(
                        state.selectedApplicationId
                    ),
                30000
            );
    }

    return {
        init
    };

})();

document.addEventListener(
    "DOMContentLoaded",
    () =>
        AdminApp.init()
);
