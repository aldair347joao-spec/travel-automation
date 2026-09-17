"use strict";

/*
 * Travel Automation
 * Administrative Panel
 *
 * IMPORTANT:
 * - VFS password is never persisted in frontend state.
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

    const $ = (selector) => document.querySelector(selector);

    const $$ = (selector) => Array.from(
        document.querySelectorAll(selector)
    );

    function escapeHtml(value) {
        if (value === null || value === undefined) {
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

        if (Number.isNaN(date.getTime())) {
            return String(value);
        }

        return new Intl.DateTimeFormat("pt-PT", {
            dateStyle: "medium",
            timeStyle: "short"
        }).format(date);
    }

    function formatDateOnly(value) {
        if (!value) {
            return "—";
        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return String(value);
        }

        return new Intl.DateTimeFormat("pt-PT", {
            dateStyle: "medium"
        }).format(date);
    }

    function formatMoney(amount, currency) {
        if (
            amount === null ||
            amount === undefined ||
            amount === ""
        ) {
            return "—";
        }

        const numericAmount = Number(amount);

        if (!Number.isFinite(numericAmount)) {
            return `${amount} ${currency || ""}`.trim();
        }

        try {
            return new Intl.NumberFormat("pt-AO", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(numericAmount) +
                (currency ? ` ${currency}` : "");
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

    function getClient(application) {
        if (!application) {
            return {};
        }

        if (application.client && typeof application.client === "object") {
            return application.client;
        }

        if (
            application.clients &&
            Array.isArray(application.clients) &&
            application.clients.length
        ) {
            return application.clients[0];
        }

        if (
            application.applicants &&
            Array.isArray(application.applicants) &&
            application.applicants.length
        ) {
            return application.applicants[0];
        }

        return {};
    }

    function getApplicationStatus(application) {
        return (
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
            application?.vfsStatus === "authenticated"
        ) {
            return "AUTENTICADO";
        }

        if (
            application?.vfs?.status
        ) {
            return application.vfs.status;
        }

        if (
            application?.adminControl?.vfsCredentials?.configured
        ) {
            return "CREDENCIAIS CONFIGURADAS";
        }

        return "NÃO CONFIGURADO";
    }

    function normalizeArray(value) {
        if (Array.isArray(value)) {
            return value;
        }

        if (typeof value === "string" && value.trim()) {
            return value
                .split(",")
                .map(item => item.trim())
                .filter(Boolean);
        }

        return [];
    }

    function labelStatus(status) {
        const map = {
            PENDING_REVIEW: "Aguardando administração",
            READY_FOR_AUTOMATION: "Pronto para automação",
            AUTOMATION_ACTIVE: "Automação ativa",
            PAUSED: "Pausado",
            COMPLETED: "Concluído",
            CANCELLED: "Cancelado",

            CREATED: "Criado",
            PASSPORT_PENDING: "Passaporte pendente",
            PASSPORT_VERIFIED: "Passaporte verificado",
            IDENTITY_PREPARATION: "Preparação da identidade",
            IDENTITY_READY: "Identidade pronta",
            PREFERENCES_PENDING: "Preferências pendentes",
            READY_FOR_AUTOMATION: "Pronto para automação",
            VFS_SESSION: "Sessão VFS",
            VFS_AUTHENTICATING: "Autenticação VFS",
            VFS_AUTHENTICATED: "VFS autenticado",
            RADAR_ACTIVE: "Radar ativo",
            SLOT_FOUND: "Vaga encontrada",
            SLOT_LOCKED: "Vaga bloqueada",
            SLOT_REVALIDATED: "Vaga revalidada",
            BOOKING: "Agendamento",
            DOCUMENT_UPLOAD: "Envio de documentos",
            PASSPORT_UPLOAD_REQUIRED: "Passaporte solicitado",
            PASSPORT_UPLOADING: "A enviar passaporte",
            PASSPORT_UPLOADED: "Passaporte enviado",
            FACIAL_SESSION_STARTING: "A iniciar facial",
            FACIAL_LIVENESS_REQUIRED: "Liveness solicitado",
            FACIAL_PROCESSING: "Processamento facial",
            FACIAL_POSITION_REQUESTED: "Posição facial solicitada",
            FACIAL_VERIFICATION_COMPLETED: "Facial concluído",
            OTP_REQUIRED: "OTP solicitado",
            OTP_RECEIVED: "OTP recebido",
            OTP_SUBMITTING: "A validar OTP",
            OTP_VERIFIED: "OTP verificado",
            REVIEW: "Revisão",
            APPOINTMENT_BOOKED: "Agendamento concluído",
            PAYMENT_PENDING: "Pagamento pendente",
            PAYMENT_CONFIRMED: "Pagamento confirmado",
            PAYMENT_EXPIRED: "Pagamento expirado",
            COMPLETED: "Concluído",
            ERROR: "Erro",
            CANCELLED: "Cancelado",

            idle: "Inativo",
            starting: "A iniciar",
            running: "Em execução",
            waiting: "A aguardar",
            continuing: "A continuar",
            monitoring: "A monitorizar",
            slot_found: "Vaga encontrada",
            cooldown: "Cooldown",
            stopped: "Parado",
            error: "Erro",
            requires_user: "Requer ação"
        };

        return map[status] || String(status || "—");
    }

    function statusClass(status) {
        switch (String(status || "").toUpperCase()) {
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
        const normalized = String(status || "").toLowerCase();

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

    async function api(path, options = {}) {

        const requestOptions = {
            credentials: "include",
            headers: {
                "Accept": "application/json",
                ...(options.body
                    ? { "Content-Type": "application/json" }
                    : {}),
                ...(options.headers || {})
            },
            ...options
        };

        const response = await fetch(path, requestOptions);

        let data = null;

        try {
            data = await response.json();
        } catch {
            data = null;
        }

        if (response.status === 401) {
            handleUnauthorized();
            throw new Error(
                data?.message ||
                "Sessão administrativa expirada."
            );
        }

        if (response.status === 403) {
            throw new Error(
                data?.message ||
                "Não tem permissão para esta operação."
            );
        }

        if (!response.ok) {
            const error = new Error(
                data?.message ||
                data?.error ||
                `Erro HTTP ${response.status}`
            );

            error.status = response.status;
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

        setTimeout(() => {
            window.location.href = "/";
        }, 1000);
    }

    function setConnectionStatus(type, text) {

        const element = $("#connectionStatus");

        if (!element) {
            return;
        }

        element.classList.remove(
            "checking",
            "online",
            "offline"
        );

        element.classList.add(type);

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

        const container = $("#toastContainer");

        if (!container) {
            return;
        }

        const toast = document.createElement("div");

        toast.className = `toast ${type}`;

        toast.innerHTML = `
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(message)}</span>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 4500);
    }

    function updateTimestamp() {
        const element = $("#lastUpdated");

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

        const data = await api("/api/admin/stats");

        const stats =
            data?.stats ||
            data?.data ||
            data ||
            {};

        $("#statTotal").textContent =
            stats.total ??
            stats.totalApplications ??
            0;

        $("#statPending").textContent =
            stats.pendingReview ??
            stats.pending ??
            0;

        $("#statActive").textContent =
            stats.automationActive ??
            stats.active ??
            0;

        $("#statPayment").textContent =
            stats.paymentPending ??
            stats.pendingPayment ??
            0;
    }

    /* =========================
       APPLICATIONS
    ========================= */

    async function loadApplications() {

        state.loadingApplications = true;

        renderApplicationsLoading();

        try {

            const data = await api(
                "/api/admin/applications"
            );

            const applications =
                data?.applications ||
                data?.items ||
                data?.data ||
                [];

            state.applications = Array.isArray(applications)
                ? applications
                : [];

            applyFilters();

            setConnectionStatus(
                "online",
                "Sistema online"
            );

            updateTimestamp();

        } finally {

            state.loadingApplications = false;
        }
    }

    function renderApplicationsLoading() {

        const container = $("#applicationsList");

        if (!container) {
            return;
        }

        container.innerHTML = `
            <div class="loading-state">
                <div class="loading-spinner"></div>
                <span>A carregar processos...</span>
            </div>
        `;
    }

    function applyFilters() {

        const search = (
            $("#applicationSearch")?.value ||
            ""
        )
            .trim()
            .toLowerCase();

        const status =
            $("#statusFilter")?.value ||
            "all";

        state.filteredApplications =
            state.applications.filter(application => {

                const client = getClient(application);

                const searchable = [
                    application?._id,
                    application?.id,
                    application?.applicationId,
                    client?.name,
                    client?.fullName,
                    client?.email,
                    client?.phone,
                    client?.passportNumber,
                    application?.passportNumber
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();

                if (
                    search &&
                    !searchable.includes(search)
                ) {
                    return false;
                }

                if (status !== "all") {
                    return (
                        String(
                            getApplicationStatus(application)
                        ).toUpperCase() === status
                    );
                }

                return true;
            });

        $("#applicationCount").textContent =
            state.filteredApplications.length;

        renderApplications();
    }

    function renderApplications() {

        const container = $("#applicationsList");

        if (!container) {
            return;
        }

        if (!state.filteredApplications.length) {

            container.innerHTML = `
                <div class="empty-list">
                    <span>Nenhum processo encontrado.</span>
                </div>
            `;

            return;
        }

        container.innerHTML =
            state.filteredApplications
                .map(renderApplicationRow)
                .join("");

        $$(".application-row").forEach(row => {

            row.addEventListener("click", () => {

                const id = row.dataset.applicationId;

                if (id) {
                    selectApplication(id);
                }

            });

        });
    }

    function renderApplicationRow(application) {

        const client = getClient(application);

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
            getApplicationStatus(application);

        const selected =
            state.selectedApplicationId &&
            String(state.selectedApplicationId) === String(id);

        return `
            <button
                type="button"
                class="application-row ${selected ? "selected" : ""}"
                data-application-id="${escapeHtml(id)}"
            >

                <div class="application-client">

                    <div class="application-avatar">
                        ${escapeHtml(firstLetter(name))}
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
                    <span>Passaporte</span>
                    <strong>
                        ${escapeHtml(passport)}
                    </strong>
                </div>

                <div class="application-column">
                    <span>Centro</span>
                    <strong>
                        ${escapeHtml(center)}
                    </strong>
                </div>

                <div class="application-column">
                    <span>Visto</span>
                    <strong>
                        ${escapeHtml(visa)}
                    </strong>
                </div>

                <div>
                    <span class="status-badge ${statusClass(status)}">
                        ${escapeHtml(labelStatus(status))}
                    </span>
                </div>

                <span class="row-arrow">›</span>

            </button>
        `;
    }

    /* =========================
       DETAILS
    ========================= */

    async function selectApplication(id) {

        if (!id) {
            return;
        }

        state.selectedApplicationId = id;

        renderApplications();

        $("#emptyDetails").classList.add("hidden");
        $("#detailsPanel").classList.remove("hidden");

        $("#selectedProcessId").textContent = id;

        try {

            const data = await api(
                `/api/admin/applications/${encodeURIComponent(id)}`
            );

            const application =
                data?.application ||
                data?.data ||
                data;

            state.selectedApplication = application;

            renderDetails(application);

            document
                .getElementById("detailsSection")
                ?.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });

        } catch (error) {

            showToast(
                "Erro",
                error.message,
                "error"
            );

        }
    }

    function renderDetails(application) {

        if (!application) {
            return;
        }

        const client = getClient(application);

        const name =
            client?.name ||
            client?.fullName ||
            application?.name ||
            "Cliente";

        $("#detailClientName").textContent = name;

        $("#detailClientFullName").textContent =
            client?.fullName ||
            client?.name ||
            "—";

        $("#detailClientEmail").textContent =
            client?.email ||
            "—";

        $("#detailClientPhone").textContent =
            client?.phone ||
            client?.mobile ||
            "—";

        $("#detailApplicationId").textContent =
            application?._id ||
            application?.id ||
            application?.applicationId ||
            "—";

        $("#detailClientAvatar").textContent =
            firstLetter(name);

        renderAdminStatus(application);
        renderWorkflow(application);
        renderBots(application);
        renderApplicationData(application);
        renderPassport(application);
        renderIdentity(application);
        renderCredentials(application);
        renderAutomationControls(application);
        renderPayment(application);
        renderError(application);

        $("#adminNotes").value =
            application?.adminControl?.notes ||
            application?.adminNotes ||
            "";
    }

    function renderAdminStatus(application) {

        const status = getApplicationStatus(application);

        const element = $("#detailAdminStatus");

        element.textContent =
            labelStatus(status);

        element.className =
            `status-badge ${statusClass(status)}`;
    }

    function renderWorkflow(application) {

        const workflow = application?.workflow || {};

        const stateName =
            getWorkflowState(application);

        $("#detailWorkflowStatus").textContent =
            labelStatus(stateName);

        $("#detailLegacyStatus").textContent =
            `Estado legado: ${labelStatus(
                application?.status
            )}`;

        $("#detailPreviousState").textContent =
            labelStatus(
                workflow?.previousState ||
                "—"
            );

        $("#detailStateChangedAt").textContent =
            formatDate(
                workflow?.stateChangedAt ||
                application?.stateChangedAt
            );
    }

    function renderBots(application) {

        const bot1 =
            application?.bot1?.status ||
            application?.bot1Status ||
            application?.bot1 ||
            "idle";

        const bot2 =
            application?.bot2?.status ||
            application?.bot2Status ||
            application?.bot2 ||
            "idle";

        const vfs =
            getVfsStatus(application);

        const bot1Element =
            $("#detailBot1Status");

        const bot2Element =
            $("#detailBot2Status");

        const vfsElement =
            $("#detailVfsStatus");

        bot1Element.textContent =
            labelStatus(bot1);

        bot1Element.className =
            `bot-badge ${botClass(bot1)}`;

        bot2Element.textContent =
            labelStatus(bot2);

        bot2Element.className =
            `bot-badge ${botClass(bot2)}`;

        vfsElement.textContent =
            labelStatus(vfs);

        vfsElement.className =
            `bot-badge ${botClass(vfs)}`;
    }

    function renderApplicationData(application) {

        $("#detailVisaType").textContent =
            application?.visaType ||
            "—";

        $("#detailVisaCenter").textContent =
            application?.visaCenter ||
            "—";

        $("#detailServiceType").textContent =
            application?.serviceType ||
            "—";

        $("#detailAppointmentMode").textContent =
            application?.appointmentMode ||
            application?.bookingMode ||
            "—";

        const dates =
            application?.preferredDates ||
            {};

        $("#detailDateStart").textContent =
            formatDateOnly(
                dates?.start ||
                application?.preferredDateStart
            );

        $("#detailDateEnd").textContent =
            formatDateOnly(
                dates?.end ||
                application?.preferredDateEnd
            );

        $("#detailPreferredTime").textContent =
            application?.preferredTime ||
            "Qualquer horário";

        const weekdays =
            normalizeArray(
                application?.preferredWeekdays
            );

        $("#detailPreferredWeekdays").textContent =
            weekdays.length
                ? weekdays.join(", ")
                : "Qualquer dia";
    }

    function renderPassport(application) {

        const client = getClient(application);

        const passport =
            application?.passport ||
            client?.passport ||
            {};

        const passportNumber =
            passport?.number ||
            client?.passportNumber ||
            application?.passportNumber ||
            "Não informado";

        const passportName =
            passport?.fullName ||
            passport?.name ||
            client?.fullName ||
            client?.name ||
            "—";

        $("#detailPassportNumber").textContent =
            passportNumber;

        $("#detailPassportName").textContent =
            passportName;

        let verified =
            application?.passportVerified === true ||
            passport?.verified === true ||
            application?.workflowState === "PASSPORT_VERIFIED";

        const statusElement =
            $("#detailPassportStatus");

        statusElement.textContent =
            verified
                ? "Verificado"
                : "Estado não confirmado";

        statusElement.className =
            `status-badge ${
                verified
                    ? "status-active"
                    : "status-pending"
            }`;
    }

    function renderIdentity(application) {

        const client = getClient(application);

        const positions =
            client?.facialPositions ||
            client?.facePositions ||
            application?.facialPositions ||
            application?.facePositions ||
            [];

        const count =
            Array.isArray(positions)
                ? positions.length
                : Number(
                    application?.facialPositionCount ||
                    0
                );

        const safeCount =
            Math.min(Math.max(count, 0), 10);

        $("#detailFaceCount").textContent =
            safeCount;

        $("#identityProgressBar").style.width =
            `${safeCount * 10}%`;

        const status =
            application?.facialVerificationStatus ||
            application?.identityStatus ||
            (
                safeCount === 10
                    ? "READY"
                    : "PENDING"
            );

        const statusElement =
            $("#detailIdentityStatus");

        statusElement.textContent =
            status === "READY"
                ? "Pronta"
                : labelStatus(status);

        statusElement.className =
            `status-badge ${
                status === "READY"
                    ? "status-active"
                    : "status-pending"
            }`;
    }

    function renderCredentials(application) {

        const configured =
            application?.adminControl?.vfsCredentials?.configured === true ||
            application?.vfsCredentialsConfigured === true;

        const element =
            $("#credentialsStatus");

        element.textContent =
            configured
                ? "Configuradas"
                : "Não configuradas";

        element.className =
            `credentials-status ${
                configured
                    ? "credentials-ready"
                    : "credentials-pending"
            }`;

        /*
         * We deliberately DO NOT fill the password field.
         * The backend never returns the encrypted/decrypted password.
         */

        $("#vfsEmail").value =
            application?.adminControl?.vfsCredentials?.email ||
            application?.vfsEmail ||
            "";

        $("#vfsPassword").value = "";
    }

    function renderAutomationControls(application) {

        const control =
            application?.adminControl ||
            {};

        const status =
            control?.status ||
            getApplicationStatus(application);

        const released =
            control?.release?.enabled === true ||
            status === "READY_FOR_AUTOMATION" ||
            status === "AUTOMATION_ACTIVE";

        const configured =
            control?.vfsCredentials?.configured === true ||
            application?.vfsCredentialsConfigured === true;

        const releaseButton =
            $("#releaseButton");

        const pauseButton =
            $("#pauseButton");

        const releaseStatus =
            $("#releaseStatus");

        const warning =
            $("#releaseWarning");

        const description =
            $("#releaseDescription");

        if (released) {

            releaseStatus.textContent =
                status === "AUTOMATION_ACTIVE"
                    ? "ATIVA"
                    : "LIBERADO";

            releaseStatus.className =
                "status-badge status-active";

            description.textContent =
                "Este processo está autorizado a avançar para a automação.";

            warning.classList.add("hidden");

            releaseButton.disabled = true;

            pauseButton.disabled =
                status === "PAUSED" ||
                status === "COMPLETED" ||
                status === "CANCELLED";

        } else {

            releaseStatus.textContent =
                "BLOQUEADO";

            releaseStatus.className =
                "status-badge status-pending";

            description.textContent =
                configured
                    ? "As credenciais estão configuradas. O administrador pode liberar o processo."
                    : "Configure primeiro as credenciais VFS.";

            warning.classList.remove("hidden");

            releaseButton.disabled =
                !configured;

            pauseButton.disabled = true;
        }

        if (status === "PAUSED") {

            releaseStatus.textContent =
                "PAUSADO";

            releaseStatus.className =
                "status-badge status-paused";

            description.textContent =
                "A automação deste processo está pausada.";

            warning.classList.remove("hidden");

            releaseButton.disabled =
                !configured;

            pauseButton.disabled = true;
        }
    }

    function renderPayment(application) {

        const payment = getPayment(application);

        const reference =
            payment?.reference ||
            payment?.referenceNumber ||
            payment?.paymentReference ||
            application?.reference ||
            "—";

        const entity =
            payment?.entity ||
            payment?.entityCode ||
            application?.entity ||
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
                application?.workflowState === "PAYMENT_CONFIRMED"
                    ? "confirmed"
                    : application?.workflowState === "PAYMENT_PENDING"
                        ? "pending"
                        : "—"
            );

        $("#detailPaymentReference").textContent =
            reference;

        $("#detailPaymentEntity").textContent =
            entity;

        $("#detailPaymentAmount").textContent =
            formatMoney(amount, currency);

        $("#detailPaymentCurrency").textContent =
            currency;

        $("#detailPaymentDeadline").textContent =
            formatDate(deadline);

        $("#detailPaymentTransaction").textContent =
            transaction;

        const statusElement =
            $("#detailPaymentStatus");

        statusElement.textContent =
            labelPaymentStatus(status);

        statusElement.className =
            `payment-status ${paymentClass(status)}`;

        const confirmationUrl =
            payment?.confirmationUrl ||
            application?.confirmationUrl;

        const confirmationBox =
            $("#confirmationBox");

        const confirmationLink =
            $("#confirmationLink");

        if (confirmationUrl) {

            confirmationLink.href =
                confirmationUrl;

            confirmationBox.classList.remove(
                "hidden"
            );

        } else {

            confirmationLink.href = "#";

            confirmationBox.classList.add(
                "hidden"
            );
        }
    }

    function labelPaymentStatus(status) {

        const normalized =
            String(status || "")
                .toLowerCase();

        const map = {
            pending: "Pagamento pendente",
            payment_pending: "Pagamento pendente",
            confirmed: "Pagamento confirmado",
            payment_confirmed: "Pagamento confirmado",
            expired: "Pagamento expirado",
            payment_expired: "Pagamento expirado",
            failed: "Pagamento falhou",
            paid: "Pago"
        };

        return map[normalized] ||
            labelStatus(status);
    }

    function paymentClass(status) {

        const normalized =
            String(status || "")
                .toLowerCase();

        if (
            normalized.includes("confirm") ||
            normalized === "paid"
        ) {
            return "payment-confirmed";
        }

        if (
            normalized.includes("expired") ||
            normalized.includes("failed")
        ) {
            return "payment-expired";
        }

        if (
            normalized.includes("pending")
        ) {
            return "payment-pending";
        }

        return "";
    }

    function renderError(application) {

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

        if (!code && !message) {
            card.classList.add("hidden");
            return;
        }

        card.classList.remove("hidden");

        $("#detailErrorCode").textContent =
            code || "ERROR";

        $("#detailErrorMessage").textContent =
            message || "Erro não especificado.";

        $("#detailErrorAt").textContent =
            formatDate(at);
    }

    /* =========================
       CREDENTIALS
    ========================= */

    async function saveCredentials(event) {

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
            $("#vfsEmail").value.trim();

        const password =
            $("#vfsPassword").value;

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
            button.textContent;

        button.disabled = true;
        button.textContent = "A guardar...";

        try {

            await api(
                `/api/admin/applications/${encodeURIComponent(
                    applicationId
                )}/vfs-credentials`,
                {
                    method: "POST",
                    body: JSON.stringify({
                        email,
                        password
                    })
                }
            );

            showToast(
                "Credenciais guardadas",
                "As credenciais VFS foram encriptadas e associadas ao processo."
            );

            $("#vfsPassword").value = "";

            await selectApplication(
                applicationId
            );

        } catch (error) {

            showToast(
                "Erro ao guardar",
                error.message,
                "error"
            );

        } finally {

            button.disabled = false;
            button.textContent = originalText;
        }
    }

    /* =========================
       RELEASE / PAUSE
    ========================= */

    function openConfirmation({
        title,
        message,
        confirmText,
        danger = false,
        action
    }) {

        state.currentAction = action;

        $("#modalTitle").textContent =
            title;

        $("#modalMessage").textContent =
            message;

        $("#modalConfirm").textContent =
            confirmText;

        $("#modalConfirm").className =
            `btn ${
                danger
                    ? "btn-danger"
                    : "btn-primary"
            }`;

        $("#confirmModal")
            .classList.remove("hidden");
    }

    function closeConfirmation() {

        state.currentAction = null;

        $("#confirmModal")
            .classList.add("hidden");
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

        button.disabled = true;

        try {

            await action();

        } finally {

            button.disabled = false;

            closeConfirmation();
        }
    }

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
                    body: JSON.stringify({})
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

            showToast(
                "Não foi possível liberar",
                error.message,
                "error"
            );

        }
    }

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
                    body: JSON.stringify({})
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

            showToast(
                "Não foi possível pausar",
                error.message,
                "error"
            );

        }
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

            if (id) {

                const exists =
                    state.applications.some(
                        item =>
                            String(
                                item?._id ||
                                item?.id ||
                                item?.applicationId
                            ) === String(id)
                    );

                if (exists) {
                    await selectApplication(id);
                }
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
       AUTH / ADMIN INFO
    ========================= */

    async function loadAdminIdentity() {

        /*
         * /api/me exists in the current authentication architecture.
         * If unavailable, the admin API itself remains the authority.
         */

        try {

            const response =
                await fetch(
                    "/api/me",
                    {
                        credentials: "include",
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

            $("#adminName").textContent =
                name;

            $("#adminRole").textContent =
                String(role).toUpperCase();

            $("#adminAvatar").textContent =
                firstLetter(name);

        } catch {
            /*
             * Do not block the dashboard.
             * /api/admin/* remains the authoritative permission check.
             */
        }
    }

    /* =========================
       EVENTS
    ========================= */

    function bindEvents() {

        $("#refreshButton")
            ?.addEventListener(
                "click",
                () => refreshAll()
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

                    $("#applicationSearch").value =
                        "";

                    $("#statusFilter").value =
                        "all";

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
                        input.type === "password"
                    ) {

                        input.type = "text";

                        button.textContent =
                            "Ocultar";

                    } else {

                        input.type = "password";

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

        $$("[data-scroll-target]")
            .forEach(button => {

                button.addEventListener(
                    "click",
                    () => {

                        const target =
                            document.getElementById(
                                button.dataset.scrollTarget
                            );

                        if (!target) {
                            return;
                        }

                        target.scrollIntoView({
                            behavior: "smooth",
                            block: "start"
                        });

                        $$(
                            ".sidebar-item"
                        ).forEach(item =>
                            item.classList.remove(
                                "active"
                            )
                        );

                        button.classList.add(
                            "active"
                        );
                    }
                );

            });

        window.addEventListener(
            "keydown",
            event => {

                if (
                    event.key === "Escape"
                ) {
                    closeConfirmation();
                }

            }
        );
    }

    async function logout() {

        try {

            /*
             * Current project authentication is cookie/JWT based.
             * Try the normal logout endpoint if available.
             */

            await fetch(
                "/api/auth/logout",
                {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        Accept:
                            "application/json"
                    }
                }
            );

        } catch {
            /*
             * Redirect even if the logout endpoint is unavailable.
             */
        }

        window.location.href = "/";
    }

    /* =========================
       INIT
    ========================= */

    async function init() {

        bindEvents();

        await loadAdminIdentity();

        await refreshAll();

        /*
         * Keep admin information reasonably fresh.
         * This does NOT start bots or alter applications.
         */
        state.refreshTimer =
            setInterval(
                () => refreshAll(
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
    () => AdminApp.init()
);
