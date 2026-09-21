"use strict";

/*

* ============================================================
* TRAVEL AUTOMATION
* PEDIDOS DE ACESSO — ADMIN
* ============================================================
* 
* Este módulo é independente do admin.js principal.
* 
* Responsabilidades:
* 
* - carregar pedidos de acesso;
* - apresentar pedidos pendentes;
* - consultar estatísticas;
* - aprovar colaboradores;
* - rejeitar colaboradores;
* - apresentar a palavra-passe temporária após aprovação.
* 
* IMPORTANTE:
* 
* A autorização real permanece no backend.
* 
* O frontend nunca decide quem pode aprovar.
* ============================================================
  */

const AdminAccessRequests = (() => {

const state = {
    requests: [],
    stats: {
        total: 0,
        pending: 0,
        approved: 0,
        rejected: 0
    },
    filter: "pending",
    loading: false,
    currentUser: null,
    currentUserRole: null
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

    return String(
        value
    )
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
            "C"
        )
            .trim()
            .charAt(0)
            .toUpperCase() ||
        "C"
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
 * TOAST
 * ========================================================
 */

function toast(
    title,
    message,
    type = "success"
) {
    const container =
        $("#toastContainer");

    if (
        container &&
        typeof window.showToast ===
            "function"
    ) {
        try {
            window.showToast(
                title,
                message,
                type
            );

            return;
        } catch {}
    }

    if (!container) {
        return;
    }

    const element =
        document.createElement(
            "div"
        );

    element.className =
        `toast ${type}`;

    element.innerHTML = `
        <strong>
            ${escapeHtml(title)}
        </strong>

        <span>
            ${escapeHtml(message)}
        </span>
    `;

    container.appendChild(
        element
    );

    window.setTimeout(
        () => {
            element.remove();
        },
        4500
    );
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
        window.location.href =
            "/login";

        throw new Error(
            data?.error ||
            "Sessão expirada."
        );
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


/*
 * ========================================================
 * SESSION
 * ========================================================
 */

async function loadCurrentUser() {
    try {
        const data =
            await api(
                "/api/auth/me"
            );

        state.currentUser =
            data?.user ||
            null;

        state.currentUserRole =
            state.currentUser?.role ||
            null;

        document.body.classList.remove(
            "access-role-owner",
            "access-role-admin",
            "access-role-operator",
            "access-role-viewer"
        );

        if (
            state.currentUserRole
        ) {
            document.body.classList.add(
                `access-role-${state.currentUserRole}`
            );
        }

        updatePermissionState();

        return state.currentUser;
    } catch (
        error
    ) {
        console.error(
            "[ACCESS REQUESTS] Failed to load current user:",
            error
        );

        return null;
    }
}


function canReview() {
    return [
        "owner",
        "admin"
    ].includes(
        state.currentUserRole
    );
}


function canView() {
    return [
        "owner",
        "admin",
        "operator",
        "viewer"
    ].includes(
        state.currentUserRole
    );
}


function updatePermissionState() {
    const notice =
        $("#accessRequestPermission");

    if (!notice) {
        return;
    }

    const title =
        $("#accessRequestPermissionTitle");

    const description =
        $("#accessRequestPermissionDescription");

    if (
        canReview()
    ) {
        notice.classList.remove(
            "readonly"
        );

        if (title) {
            title.textContent =
                "Gestão administrativa";
        }

        if (description) {
            description.textContent =
                "Pode analisar, aprovar e rejeitar pedidos de acesso.";
        }

        return;
    }

    notice.classList.add(
        "readonly"
    );

    if (title) {
        title.textContent =
            "Acesso de consulta";
    }

    if (description) {
        description.textContent =
            "O seu perfil pode consultar pedidos, mas não aprová-los.";
    }
}


/*
 * ========================================================
 * STATS
 * ========================================================
 */

async function loadStats() {
    try {
        const data =
            await api(
                "/api/admin/access-requests/stats"
            );

        state.stats =
            data?.stats ||
            state.stats;

        renderStats();

    } catch (
        error
    ) {
        console.error(
            "[ACCESS REQUESTS] Failed to load stats:",
            error
        );
    }
}


function renderStats() {
    const total =
        $("#accessRequestsTotal");

    const pending =
        $("#accessRequestsPending");

    const approved =
        $("#accessRequestsApproved");

    const rejected =
        $("#accessRequestsRejected");

    if (total) {
        total.textContent =
            String(
                state.stats.total
            );
    }

    if (pending) {
        pending.textContent =
            String(
                state.stats.pending
            );
    }

    if (approved) {
        approved.textContent =
            String(
                state.stats.approved
            );
    }

    if (rejected) {
        rejected.textContent =
            String(
                state.stats.rejected
            );
    }

    const badge =
        $("#accessRequestsSidebarBadge");

    if (badge) {
        const pendingCount =
            Number(
                state.stats.pending
            ) || 0;

        badge.textContent =
            pendingCount > 99
                ? "99+"
                : String(
                    pendingCount
                );

        badge.hidden =
            pendingCount <= 0;
    }
}


/*
 * ========================================================
 * LOAD REQUESTS
 * ========================================================
 */

async function loadRequests() {
    if (
        state.loading
    ) {
        return;
    }

    state.loading =
        true;

    renderLoading();

    try {
        const query =
            new URLSearchParams();

        if (
            state.filter !==
            "all"
        ) {
            query.set(
                "status",
                state.filter
            );
        }

        query.set(
            "limit",
            "100"
        );

        const data =
            await api(
                `/api/admin/access-requests?${query.toString()}`
            );

        state.requests =
            Array.isArray(
                data?.requests
            )
                ? data.requests
                : [];

        renderRequests();

    } catch (
        error
    ) {
        console.error(
            "[ACCESS REQUESTS] Failed to load requests:",
            error
        );

        renderError(
            error.message ||
            "Não foi possível carregar os pedidos."
        );

    } finally {
        state.loading =
            false;
    }
}


function renderLoading() {
    const list =
        $("#accessRequestsList");

    if (!list) {
        return;
    }

    list.innerHTML = `
        <div class="access-request-loading">
            <div class="access-request-spinner"></div>

            <span>
                A carregar pedidos de acesso...
            </span>
        </div>
    `;
}


function renderError(
    message
) {
    const list =
        $("#accessRequestsList");

    if (!list) {
        return;
    }

    list.innerHTML = `
        <div class="access-request-empty access-request-error">
            <div class="access-request-empty-mark">
                !
            </div>

            <strong>
                Não foi possível carregar
            </strong>

            <span>
                ${escapeHtml(message)}
            </span>

            <button
                type="button"
                class="btn btn-secondary"
                id="accessRequestsRetryButton"
            >
                Tentar novamente
            </button>
        </div>
    `;

    const retry =
        $("#accessRequestsRetryButton");

    if (retry) {
        retry.addEventListener(
            "click",
            () => {
                loadAll();
            }
        );
    }
}


/*
 * ========================================================
 * REQUEST CARDS
 * ========================================================
 */

function renderRequests() {
    const list =
        $("#accessRequestsList");

    if (!list) {
        return;
    }

    if (
        !state.requests.length
    ) {
        list.innerHTML = `
            <div class="access-request-empty">
                <div class="access-request-empty-mark">
                    ✓
                </div>

                <strong>
                    Nenhum pedido encontrado
                </strong>

                <span>
                    ${
                        state.filter ===
                        "pending"
                            ? "Não existem pedidos de acesso pendentes neste momento."
                            : "Não existem pedidos neste estado."
                    }
                </span>
            </div>
        `;

        return;
    }

    list.innerHTML =
        state.requests
            .map(
                request =>
                    renderRequest(
                        request
                    )
            )
            .join("");

    bindRequestActions();
}


function renderRequest(
    request
) {
    const status =
        String(
            request.status ||
            ""
        ).toLowerCase();

    const statusLabel =
        {
            pending:
                "Pendente",

            approved:
                "Aprovado",

            rejected:
                "Rejeitado"
        }[
            status
        ] ||
        status;

    const statusClass =
        `access-status-${status}`;

    const reviewNote =
        request.reviewNote
            ? `
                <div class="access-request-review-note">
                    <span>Observação administrativa</span>

                    <p>
                        ${escapeHtml(
                            request.reviewNote
                        )}
                    </p>
                </div>
            `
            : "";

    const actionArea =
        status ===
            "pending" &&
        canReview()
            ? `
                <div class="access-request-actions">

                    <button
                        type="button"
                        class="btn btn-secondary access-reject-button"
                        data-request-id="${escapeHtml(
                            request.id
                        )}"
                    >
                        Rejeitar
                    </button>

                    <button
                        type="button"
                        class="btn btn-primary access-approve-button"
                        data-request-id="${escapeHtml(
                            request.id
                        )}"
                    >
                        Aprovar colaborador
                    </button>

                </div>
            `
            : "";

    const readOnlyLabel =
        status ===
            "pending" &&
        !canReview()
            ? `
                <div class="access-request-readonly">
                    Aguardando decisão de um administrador
                </div>
            `
            : "";

    return `
        <article
            class="access-request-card-admin"
            data-request-id="${escapeHtml(
                request.id
            )}"
        >

            <div class="access-request-card-head">

                <div class="access-request-person">

                    <div class="access-request-avatar">
                        ${escapeHtml(
                            firstLetter(
                                request.name
                            )
                        )}
                    </div>

                    <div>
                        <strong>
                            ${escapeHtml(
                                request.name
                            )}
                        </strong>

                        <span>
                            Pedido recebido
                            ·
                            ${escapeHtml(
                                formatDate(
                                    request.createdAt
                                )
                            )}
                        </span>
                    </div>

                </div>

                <span
                    class="access-request-status ${statusClass}"
                >
                    ${escapeHtml(
                        statusLabel
                    )}
                </span>

            </div>

            <div class="access-request-card-body">

                <div class="access-request-data">

                    <div class="access-request-data-item">
                        <span>Email</span>

                        <strong>
                            ${escapeHtml(
                                request.email
                            )}
                        </strong>
                    </div>

                    <div class="access-request-data-item">
                        <span>Telefone</span>

                        <strong>
                            ${escapeHtml(
                                request.phone ||
                                "Não informado"
                            )}
                        </strong>
                    </div>

                    <div class="access-request-data-item">
                        <span>Empresa / organização</span>

                        <strong>
                            ${escapeHtml(
                                request.company ||
                                "Não informado"
                            )}
                        </strong>
                    </div>

                </div>

                ${
                    request.reason
                        ? `
                            <div class="access-request-reason">
                                <span>Motivo do pedido</span>

                                <p>
                                    ${escapeHtml(
                                        request.reason
                                    )}
                                </p>
                            </div>
                        `
                        : ""
                }

                ${reviewNote}

            </div>

            ${
                status ===
                    "approved"
                    ? `
                        <div class="access-request-result approved">
                            <span>
                                Colaborador criado
                            </span>

                            ${
                                request.createdUserId
                                    ? `
                                        <code>
                                            ${escapeHtml(
                                                String(
                                                    request.createdUserId
                                                )
                                            )}
                                        </code>
                                    `
                                    : ""
                            }
                        </div>
                    `
                    : ""
            }

            ${actionArea}

            ${readOnlyLabel}

        </article>
    `;
}


/*
 * ========================================================
 * ACTIONS
 * ========================================================
 */

function bindRequestActions() {
    $$(".access-approve-button")
        .forEach(
            button => {
                button.addEventListener(
                    "click",
                    () => {
                        const id =
                            button.dataset.requestId;

                        approveRequest(
                            id,
                            button
                        );
                    }
                );
            }
        );

    $$(".access-reject-button")
        .forEach(
            button => {
                button.addEventListener(
                    "click",
                    () => {
                        const id =
                            button.dataset.requestId;

                        rejectRequest(
                            id,
                            button
                        );
                    }
                );
            }
        );
}


async function approveRequest(
    id,
    button
) {
    if (
        !canReview() ||
        !id
    ) {
        return;
    }

    const request =
        state.requests.find(
            item =>
                String(
                    item.id
                ) ===
                String(id)
        );

    if (!request) {
        return;
    }

    const confirmed =
        window.confirm(
            `Aprovar o acesso de ${request.name} e criar a conta de colaborador?`
        );

    if (!confirmed) {
        return;
    }

    const originalText =
        button.textContent;

    button.disabled =
        true;

    button.textContent =
        "A aprovar...";

    try {
        const data =
            await api(
                `/api/admin/access-requests/${encodeURIComponent(
                    id
                )}/approve`,
                {
                    method:
                        "POST",

                    body:
                        JSON.stringify({})
                }
            );

        showTemporaryPassword(
            data
        );

        toast(
            "Colaborador criado",
            "O pedido foi aprovado com sucesso.",
            "success"
        );

        await loadAll();

    } catch (
        error
    ) {
        console.error(
            "[ACCESS REQUESTS] Approval failed:",
            error
        );

        toast(
            "Não foi possível aprovar",
            error.message ||
                "Ocorreu um erro ao aprovar o pedido.",
            "error"
        );

        button.disabled =
            false;

        button.textContent =
            originalText;
    }
}


async function rejectRequest(
    id,
    button
) {
    if (
        !canReview() ||
        !id
    ) {
        return;
    }

    const request =
        state.requests.find(
            item =>
                String(
                    item.id
                ) ===
                String(id)
        );

    if (!request) {
        return;
    }

    const note =
        window.prompt(
            `Observação para rejeitar o pedido de ${request.name} (opcional):`
        );

    if (
        note ===
        null
    ) {
        return;
    }

    const confirmed =
        window.confirm(
            `Rejeitar o pedido de ${request.name}?`
        );

    if (!confirmed) {
        return;
    }

    const originalText =
        button.textContent;

    button.disabled =
        true;

    button.textContent =
        "A rejeitar...";

    try {
        await api(
            `/api/admin/access-requests/${encodeURIComponent(
                id
            )}/reject`,
            {
                method:
                    "POST",

                body:
                    JSON.stringify({
                        reviewNote:
                            note
                    })
            }
        );

        toast(
            "Pedido rejeitado",
            "O pedido de acesso foi marcado como rejeitado.",
            "success"
        );

        await loadAll();

    } catch (
        error
    ) {
        console.error(
            "[ACCESS REQUESTS] Rejection failed:",
            error
        );

        toast(
            "Não foi possível rejeitar",
            error.message ||
                "Ocorreu um erro ao rejeitar o pedido.",
            "error"
        );

        button.disabled =
            false;

        button.textContent =
            originalText;
    }
}


/*
 * ========================================================
 * TEMPORARY PASSWORD
 * ========================================================
 */

function showTemporaryPassword(
    data
) {
    const password =
        data?.temporaryPassword;

    const user =
        data?.user;

    if (!password) {
        return;
    }

    const existing =
        $("#temporaryPasswordModal");

    if (existing) {
        existing.remove();
    }

    const modal =
        document.createElement(
            "div"
        );

    modal.id =
        "temporaryPasswordModal";

    modal.className =
        "access-password-modal-backdrop";

    modal.innerHTML = `
        <div
            class="access-password-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="temporaryPasswordTitle"
        >

            <div class="access-password-mark">
                ✓
            </div>

            <div class="access-password-eyebrow">
                CONTA CRIADA
            </div>

            <h3 id="temporaryPasswordTitle">
                Colaborador aprovado
            </h3>

            <p>
                A conta de
                <strong>
                    ${escapeHtml(
                        user?.name ||
                        "colaborador"
                    )}
                </strong>
                foi criada com sucesso.
            </p>

            <div class="access-password-account">
                <span>Email</span>

                <strong>
                    ${escapeHtml(
                        user?.email ||
                        "—"
                    )}
                </strong>
            </div>

            <div class="access-password-box">

                <span>
                    PALAVRA-PASSE TEMPORÁRIA
                </span>

                <code id="temporaryPasswordValue">
                    ${escapeHtml(
                        password
                    )}
                </code>

            </div>

            <div class="access-password-warning">
                <span>!</span>

                <p>
                    Guarde esta palavra-passe e entregue-a
                    ao colaborador através de um canal seguro.
                    Ela não será apresentada novamente por este painel.
                </p>
            </div>

            <div class="access-password-actions">

                <button
                    type="button"
                    class="btn btn-secondary"
                    id="copyTemporaryPassword"
                >
                    Copiar palavra-passe
                </button>

                <button
                    type="button"
                    class="btn btn-primary"
                    id="closeTemporaryPassword"
                >
                    Concluir
                </button>

            </div>

        </div>
    `;

    document.body.appendChild(
        modal
    );

    const close =
        () => {
            modal.remove();
        };

    const closeButton =
        $("#closeTemporaryPassword");

    if (closeButton) {
        closeButton.addEventListener(
            "click",
            close
        );
    }

    const copyButton =
        $("#copyTemporaryPassword");

    if (copyButton) {
        copyButton.addEventListener(
            "click",
            async () => {
                try {
                    await navigator.clipboard.writeText(
                        password
                    );

                    copyButton.textContent =
                        "Copiado";

                    window.setTimeout(
                        () => {
                            if (
                                document.body.contains(
                                    copyButton
                                )
                            ) {
                                copyButton.textContent =
                                    "Copiar palavra-passe";
                            }
                        },
                        1800
                    );
                } catch {
                    toast(
                        "Não foi possível copiar",
                        "Copie a palavra-passe manualmente.",
                        "error"
                    );
                }
            }
        );
    }

    modal.addEventListener(
        "click",
        event => {
            if (
                event.target ===
                modal
            ) {
                close();
            }
        }
    );
}


/*
 * ========================================================
 * FILTERS
 * ========================================================
 */

function setFilter(
    filter
) {
    const validFilters = [
        "pending",
        "approved",
        "rejected",
        "all"
    ];

    if (
        !validFilters.includes(
            filter
        )
    ) {
        filter =
            "pending";
    }

    state.filter =
        filter;

    $$(".access-request-filter")
        .forEach(
            button => {
                button.classList.toggle(
                    "active",
                    button.dataset.filter ===
                        filter
                );
            }
        );

    loadRequests();
}


function bindFilters() {
    $$(".access-request-filter")
        .forEach(
            button => {
                button.addEventListener(
                    "click",
                    () => {
                        setFilter(
                            button.dataset.filter
                        );
                    }
                );
            }
        );
}


/*
 * ========================================================
 * INJECTION
 * ========================================================
 */

function injectSidebarItem() {
    const section =
        $(".admin-sidebar .sidebar-section");

    if (!section) {
        return;
    }

    if (
        $("#accessRequestsSidebarItem")
    ) {
        return;
    }

    const button =
        document.createElement(
            "button"
        );

    button.type =
        "button";

    button.id =
        "accessRequestsSidebarItem";

    button.className =
        "sidebar-item";

    button.dataset.scrollTarget =
        "accessRequestsSection";

    button.innerHTML = `
        <span class="sidebar-icon">
            ◇
        </span>

        <span>
            Pedidos de acesso
        </span>

        <span
            id="accessRequestsSidebarBadge"
            class="access-request-sidebar-badge"
            hidden
        >
            0
        </span>
    `;

    section.appendChild(
        button
    );

    button.addEventListener(
        "click",
        () => {
            const target =
                $("#accessRequestsSection");

            if (target) {
                target.scrollIntoView({
                    behavior:
                        "smooth",
                    block:
                        "start"
                });
            }

            $$(".sidebar-item")
                .forEach(
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


function injectSection() {
    const main =
        $(".admin-main");

    if (!main) {
        return;
    }

    if (
        $("#accessRequestsSection")
    ) {
        return;
    }

    const section =
        document.createElement(
            "section"
        );

    section.id =
        "accessRequestsSection";

    section.className =
        "content-section access-requests-section";

    section.innerHTML = `
        <div class="section-heading access-requests-heading">

            <div>
                <span class="section-kicker">
                    ACESSOS
                </span>

                <h2>
                    Pedidos de acesso
                </h2>

                <p class="access-requests-intro">
                    Analise os pedidos de colaboradores
                    antes de liberar o acesso à plataforma.
                </p>
            </div>

            <div class="access-request-permission"
                 id="accessRequestPermission">

                <span class="access-request-permission-dot"></span>

                <div>
                    <strong
                        id="accessRequestPermissionTitle"
                    >
                        Acesso de consulta
                    </strong>

                    <span
                        id="accessRequestPermissionDescription"
                    >
                        A verificar permissões...
                    </span>
                </div>

            </div>

        </div>

        <div class="access-request-stats">

            <article class="access-request-stat">
                <span>Todos</span>

                <strong id="accessRequestsTotal">
                    —
                </strong>
            </article>

            <article class="access-request-stat pending">
                <span>Pendentes</span>

                <strong id="accessRequestsPending">
                    —
                </strong>
            </article>

            <article class="access-request-stat approved">
                <span>Aprovados</span>

                <strong id="accessRequestsApproved">
                    —
                </strong>
            </article>

            <article class="access-request-stat rejected">
                <span>Rejeitados</span>

                <strong id="accessRequestsRejected">
                    —
                </strong>
            </article>

        </div>

        <div class="access-request-panel">

            <div class="access-request-toolbar">

                <div>
                    <strong>
                        Solicitações recebidas
                    </strong>

                    <span>
                        Os pedidos pertencem à conta administrativa
                        da sessão atual.
                    </span>
                </div>

                <button
                    type="button"
                    class="btn btn-secondary"
                    id="accessRequestsRefresh"
                >
                    ↻ Atualizar
                </button>

            </div>

            <div class="access-request-filters">

                <button
                    type="button"
                    class="access-request-filter active"
                    data-filter="pending"
                >
                    Pendentes
                </button>

                <button
                    type="button"
                    class="access-request-filter"
                    data-filter="approved"
                >
                    Aprovados
                </button>

                <button
                    type="button"
                    class="access-request-filter"
                    data-filter="rejected"
                >
                    Rejeitados
                </button>

                <button
                    type="button"
                    class="access-request-filter"
                    data-filter="all"
                >
                    Todos
                </button>

            </div>

            <div
                id="accessRequestsList"
                class="access-requests-list"
            >
                <div class="access-request-loading">
                    <div class="access-request-spinner"></div>

                    <span>
                        A carregar pedidos de acesso...
                    </span>
                </div>
            </div>

        </div>
    `;

    main.appendChild(
        section
    );
}


/*
 * ========================================================
 * EVENTS
 * ========================================================
 */

function bindEvents() {
    const refresh =
        $("#accessRequestsRefresh");

    if (refresh) {
        refresh.addEventListener(
            "click",
            () => {
                loadAll();
            }
        );
    }

    bindFilters();
}


/*
 * ========================================================
 * LOAD ALL
 * ========================================================
 */

async function loadAll() {
    if (!canView()) {
        return;
    }

    await Promise.all([
        loadStats(),
        loadRequests()
    ]);
}


/*
 * ========================================================
 * INIT
 * ========================================================
 */

async function init() {
    injectSidebarItem();
    injectSection();
    bindEvents();

    await loadCurrentUser();

    if (!canView()) {
        const list =
            $("#accessRequestsList");

        if (list) {
            list.innerHTML = `
                <div class="access-request-empty access-request-error">
                    <div class="access-request-empty-mark">
                        !
                    </div>

                    <strong>
                        Acesso não disponível
                    </strong>

                    <span>
                        O seu perfil não possui acesso aos pedidos administrativos.
                    </span>
                </div>
            `;
        }

        return;
    }

    await loadAll();
}


/*
 * ========================================================
 * PUBLIC API
 * ========================================================
 */

return {
    init,
    refresh:
        loadAll
};

})();

/*

* ============================================================
* START
* ============================================================
  */

if (
document.readyState ===
"loading"
) {
document.addEventListener(
"DOMContentLoaded",
() => {
AdminAccessRequests.init();
}
);
} else {
AdminAccessRequests.init();
}
