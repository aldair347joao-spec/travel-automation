"use strict";

/*
 * ============================================================
 * TRAVEL AUTOMATION
 * PEDIDOS DE ACESSO — ADMIN
 * ============================================================
 *
 * Módulo independente do admin.js principal.
 *
 * RESPONSABILIDADES
 * ------------------------------------------------------------
 * - carregar pedidos de acesso;
 * - apresentar pedidos pendentes;
 * - consultar estatísticas;
 * - aprovar colaboradores;
 * - rejeitar colaboradores;
 * - apresentar a palavra-passe temporária após aprovação.
 *
 * IDENTIDADE VISUAL
 * ------------------------------------------------------------
 * Este módulo utiliza a linguagem visual própria do
 * Travel Automation:
 *
 * - identidade;
 * - documentos;
 * - segurança;
 * - controlo operacional;
 * - precisão;
 * - ambiente premium.
 *
 * A autorização real permanece no backend.
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
        document.querySelector(selector);


    const $$ = selector =>
        Array.from(
            document.querySelectorAll(selector)
        );


    /*
     * ========================================================
     * ÍCONES
     * ========================================================
     *
     * Ícones desenhados para o Travel Automation.
     * Não dependem de Font Awesome, Lucide ou bibliotecas
     * externas.
     * ========================================================
     */

    const ICONS = {

        access: `
            <svg viewBox="0 0 24 24"
                 aria-hidden="true"
                 focusable="false">
                <rect x="4.5" y="3.5"
                      width="15" height="17"
                      rx="2.5"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.55"/>
                <circle cx="12" cy="9"
                        r="2.25"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.55"/>
                <path d="M8.2 16.3c.95-2.1 6.65-2.1 7.6 0"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.55"
                      stroke-linecap="round"/>
                <path d="M7.2 6.4h2.1"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.55"
                      stroke-linecap="round"/>
            </svg>
        `,

        passport: `
            <svg viewBox="0 0 24 24"
                 aria-hidden="true"
                 focusable="false">
                <rect x="4" y="3.5"
                      width="16" height="17"
                      rx="2.2"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.55"/>
                <circle cx="12" cy="9.1"
                        r="2.35"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.35"/>
                <path d="M8.1 14.4h7.8"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.35"
                      stroke-linecap="round"/>
                <path d="M8.1 17.1h5.1"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.35"
                      stroke-linecap="round"/>
            </svg>
        `,

        shield: `
            <svg viewBox="0 0 24 24"
                 aria-hidden="true"
                 focusable="false">
                <path d="M12 3.4 19 6v5.35c0 4.55-2.9 7.55-7 9.25-4.1-1.7-7-4.7-7-9.25V6l7-2.6Z"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.55"
                      stroke-linejoin="round"/>
                <path d="m8.8 12 2.05 2.05L15.5 9.4"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.55"
                      stroke-linecap="round"
                      stroke-linejoin="round"/>
            </svg>
        `,

        clock: `
            <svg viewBox="0 0 24 24"
                 aria-hidden="true"
                 focusable="false">
                <circle cx="12" cy="12"
                        r="8.1"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.55"/>
                <path d="M12 7.6v4.8l3.1 1.8"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.55"
                      stroke-linecap="round"
                      stroke-linejoin="round"/>
            </svg>
        `,

        check: `
            <svg viewBox="0 0 24 24"
                 aria-hidden="true"
                 focusable="false">
                <path d="m6.7 12.2 3.35 3.35L17.5 8.1"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"/>
            </svg>
        `,

        close: `
            <svg viewBox="0 0 24 24"
                 aria-hidden="true"
                 focusable="false">
                <path d="m7.4 7.4 9.2 9.2M16.6 7.4l-9.2 9.2"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.65"
                      stroke-linecap="round"/>
            </svg>
        `,

        refresh: `
            <svg viewBox="0 0 24 24"
                 aria-hidden="true"
                 focusable="false">
                <path d="M19 8.5A7.4 7.4 0 0 0 5.9 6.1"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.55"
                      stroke-linecap="round"/>
                <path d="M5.4 3.9v3.7h3.7"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.55"
                      stroke-linecap="round"
                      stroke-linejoin="round"/>
                <path d="M5 15.5a7.4 7.4 0 0 0 13.1 2.4"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.55"
                      stroke-linecap="round"/>
                <path d="M18.6 20.1v-3.7h-3.7"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.55"
                      stroke-linecap="round"
                      stroke-linejoin="round"/>
            </svg>
        `,

        mail: `
            <svg viewBox="0 0 24 24"
                 aria-hidden="true"
                 focusable="false">
                <rect x="4" y="5.5"
                      width="16" height="13"
                      rx="2"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"/>
                <path d="m5.4 7 6.6 5.1L18.6 7"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"/>
            </svg>
        `,

        phone: `
            <svg viewBox="0 0 24 24"
                 aria-hidden="true"
                 focusable="false">
                <path d="M7.1 4.5 9.2 4c.65-.15 1.25.2 1.45.8l.8 2.55c.16.52-.02 1.08-.45 1.4l-1.35 1.02a12.1 12.1 0 0 0 4.58 4.58l1.02-1.35c.32-.43.88-.61 1.4-.45l2.55.8c.6.2.95.8.8 1.45l-.5 2.1c-.15.63-.72 1.1-1.37 1.12C10.7 18.25 5.75 13.3 5.98 5.87c.02-.65.49-1.22 1.12-1.37Z"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.45"
                      stroke-linejoin="round"/>
            </svg>
        `,

        building: `
            <svg viewBox="0 0 24 24"
                 aria-hidden="true"
                 focusable="false">
                <path d="M5 20V5.2c0-.66.54-1.2 1.2-1.2h7.1c.66 0 1.2.54 1.2 1.2V20"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"/>
                <path d="M14.5 9.2h3.3c.66 0 1.2.54 1.2 1.2V20"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"/>
                <path d="M8.2 7.4h2M8.2 10.4h2M8.2 13.4h2M16.2 12.3h1"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.35"
                      stroke-linecap="round"/>
                <path d="M3.5 20h17"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.55"
                      stroke-linecap="round"/>
            </svg>
        `,

        message: `
            <svg viewBox="0 0 24 24"
                 aria-hidden="true"
                 focusable="false">
                <path d="M5.2 5.3h13.6c.66 0 1.2.54 1.2 1.2v8.1c0 .66-.54 1.2-1.2 1.2H11l-3.8 3v-3H5.2c-.66 0-1.2-.54-1.2-1.2V6.5c0-.66.54-1.2 1.2-1.2Z"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linejoin="round"/>
            </svg>
        `,

        key: `
            <svg viewBox="0 0 24 24"
                 aria-hidden="true"
                 focusable="false">
                <circle cx="8.1" cy="11.9"
                        r="3.5"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.55"/>
                <path d="m11.2 14.5 6.8 6.8M15.2 18.5l2-2M17.2 20.5l2-2"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.55"
                      stroke-linecap="round"/>
            </svg>
        `,

        alert: `
            <svg viewBox="0 0 24 24"
                 aria-hidden="true"
                 focusable="false">
                <path d="M12 4.2 20 19H4l8-14.8Z"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.55"
                      stroke-linejoin="round"/>
                <path d="M12 9v4.5"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.65"
                      stroke-linecap="round"/>
                <circle cx="12" cy="16.2"
                        r=".85"
                        fill="currentColor"/>
            </svg>
        `

    };


    /*
     * ========================================================
     * VISUAL SYSTEM
     * ========================================================
     *
     * O módulo injeta apenas os estilos específicos desta
     * área. Assim não fica dependente de um ícone externo.
     * ========================================================
     */

    function injectVisualStyles() {

        if (
            document.getElementById(
                "travelAutomationAccessVisuals"
            )
        ) {
            return;
        }

        const style =
            document.createElement("style");

        style.id =
            "travelAutomationAccessVisuals";

        style.textContent = `

            /* ------------------------------------------------
               IDENTIDADE GERAL
            ------------------------------------------------ */

            .access-requests-section {
                position: relative;
                isolation: isolate;
            }

            .access-requests-section::before {
                content: "";
                position: absolute;
                top: -80px;
                right: -120px;
                width: 320px;
                height: 320px;
                border-radius: 50%;
                background:
                    radial-gradient(
                        circle,
                        rgba(7,86,166,.075),
                        rgba(7,86,166,0) 70%
                    );
                pointer-events: none;
                z-index: -1;
            }

            .access-requests-heading {
                align-items: flex-start;
            }

            .access-requests-heading h2 {
                letter-spacing: -.025em;
            }

            .access-requests-intro {
                max-width: 610px;
                margin-top: 8px !important;
                line-height: 1.65 !important;
            }


            /* ------------------------------------------------
               SIDEBAR
            ------------------------------------------------ */

            #accessRequestsSidebarItem {
                position: relative;
            }

            #accessRequestsSidebarItem .sidebar-icon {
                width: 31px;
                height: 31px;

                display: grid;
                place-items: center;

                border: 1px solid rgba(7,86,166,.10);
                border-radius: 10px;

                color: #0756a6;

                background:
                    linear-gradient(
                        145deg,
                        rgba(7,86,166,.075),
                        rgba(34,196,232,.035)
                    );

                transition:
                    transform 180ms ease,
                    color 180ms ease,
                    background 180ms ease,
                    border-color 180ms ease;
            }

            #accessRequestsSidebarItem
            .sidebar-icon svg {
                width: 17px;
                height: 17px;
            }

            #accessRequestsSidebarItem:hover
            .sidebar-icon {
                transform: translateY(-1px);
                color: #064a8f;
                border-color: rgba(7,86,166,.18);
                background: rgba(7,86,166,.09);
            }

            #accessRequestsSidebarItem.active
            .sidebar-icon {
                color: #fff;
                border-color: transparent;

                background:
                    linear-gradient(
                        135deg,
                        #031b3d,
                        #0756a6
                    );

                box-shadow:
                    0 7px 18px rgba(3,27,61,.17);
            }


            /* ------------------------------------------------
               BADGE
            ------------------------------------------------ */

            .access-request-sidebar-badge {
                min-width: 21px;
                height: 21px;

                display: inline-flex;
                align-items: center;
                justify-content: center;

                margin-left: auto;
                padding: 0 6px;

                border: 1px solid rgba(7,86,166,.13);
                border-radius: 999px;

                color: #0756a6;

                background: rgba(7,86,166,.065);

                font-family:
                    "JetBrains Mono",
                    monospace;

                font-size: 8px;
                font-weight: 800;
            }


            /* ------------------------------------------------
               PERMISSÃO
            ------------------------------------------------ */

            .access-request-permission {
                min-width: 260px;

                display: flex;
                align-items: center;

                gap: 11px;

                padding: 12px 14px;

                border: 1px solid rgba(22,163,106,.15);
                border-radius: 15px;

                background:
                    linear-gradient(
                        135deg,
                        rgba(22,163,106,.065),
                        rgba(22,163,106,.018)
                    );

                box-shadow:
                    0 8px 24px rgba(3,27,61,.035);
            }

            .access-request-permission.readonly {
                border-color: rgba(7,86,166,.12);

                background:
                    linear-gradient(
                        135deg,
                        rgba(7,86,166,.055),
                        rgba(7,86,166,.018)
                    );
            }

            .access-request-permission-dot {
                width: 9px;
                height: 9px;

                flex: 0 0 9px;

                border-radius: 50%;

                background: #16a36a;

                box-shadow:
                    0 0 0 5px rgba(22,163,106,.08);
            }

            .access-request-permission.readonly
            .access-request-permission-dot {
                background: #0756a6;

                box-shadow:
                    0 0 0 5px rgba(7,86,166,.08);
            }

            .access-request-permission strong {
                display: block;

                color: #29445d;

                font-family:
                    var(--ta-display,
                    "Inter",
                    sans-serif);

                font-size: 10px;
                font-weight: 800;
            }

            .access-request-permission span:last-child {
                display: block;

                margin-top: 3px;

                color: #8194a5;

                font-size: 8px;
                line-height: 1.45;
            }


            /* ------------------------------------------------
               ESTATÍSTICAS
            ------------------------------------------------ */

            .access-request-stat {
                position: relative;
                overflow: hidden;

                border: 1px solid rgba(7,86,166,.08) !important;
                border-radius: 17px !important;

                background:
                    linear-gradient(
                        145deg,
                        rgba(255,255,255,.96),
                        rgba(246,249,252,.90)
                    ) !important;

                box-shadow:
                    0 9px 25px rgba(3,27,61,.045);

                transition:
                    transform 180ms ease,
                    box-shadow 180ms ease,
                    border-color 180ms ease;
            }

            .access-request-stat::after {
                content: "";
                position: absolute;

                right: -24px;
                bottom: -38px;

                width: 95px;
                height: 95px;

                border-radius: 50%;

                background:
                    radial-gradient(
                        circle,
                        rgba(7,86,166,.08),
                        transparent 68%
                    );

                pointer-events: none;
            }

            .access-request-stat:hover {
                transform: translateY(-2px);

                border-color:
                    rgba(7,86,166,.15) !important;

                box-shadow:
                    0 14px 31px rgba(3,27,61,.075);
            }

            .access-request-stat strong {
                position: relative;
                z-index: 1;

                font-family:
                    "JetBrains Mono",
                    monospace !important;
            }

            .access-request-stat.pending strong {
                color: #0756a6 !important;
            }

            .access-request-stat.approved strong {
                color: #16a36a !important;
            }

            .access-request-stat.rejected strong {
                color: #c6535a !important;
            }


            /* ------------------------------------------------
               PAINEL
            ------------------------------------------------ */

            .access-request-panel {
                overflow: hidden;

                border: 1px solid rgba(7,86,166,.085) !important;
                border-radius: 20px !important;

                background:
                    rgba(255,255,255,.78) !important;

                box-shadow:
                    0 18px 45px rgba(3,27,61,.055);
            }

            .access-request-toolbar {
                padding: 19px 20px !important;

                border-bottom:
                    1px solid rgba(7,86,166,.065) !important;

                background:
                    linear-gradient(
                        120deg,
                        rgba(3,27,61,.025),
                        rgba(7,86,166,.015)
                    );
            }

            .access-request-toolbar strong {
                color: #17364f;
                font-family:
                    var(--ta-display,
                    "Inter",
                    sans-serif);
                font-size: 11px;
                font-weight: 850;
            }

            .access-request-toolbar span {
                display: block;

                margin-top: 4px;

                color: #8a9cac;

                font-size: 8px;
                line-height: 1.5;
            }

            #accessRequestsRefresh {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
            }

            #accessRequestsRefresh::before {
                content: "";
                width: 16px;
                height: 16px;

                display: block;

                background:
                    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%230756a6' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M19 8.5A7.4 7.4 0 0 0 5.9 6.1'/%3E%3Cpath d='M5.4 3.9v3.7h3.7'/%3E%3Cpath d='M5 15.5a7.4 7.4 0 0 0 13.1 2.4'/%3E%3Cpath d='M18.6 20.1v-3.7h-3.7'/%3E%3C/svg%3E")
                    center / contain
                    no-repeat;
            }


            /* ------------------------------------------------
               FILTROS
            ------------------------------------------------ */

            .access-request-filters {
                gap: 7px !important;

                padding: 12px 16px !important;

                border-bottom:
                    1px solid rgba(7,86,166,.055);
            }

            .access-request-filter {
                position: relative;

                border: 1px solid transparent !important;
                border-radius: 10px !important;

                color: #8396a6 !important;

                background: transparent !important;

                font-size: 8px !important;
                font-weight: 800 !important;

                transition:
                    color 160ms ease,
                    background 160ms ease,
                    border-color 160ms ease,
                    transform 160ms ease;
            }

            .access-request-filter:hover {
                color: #0756a6 !important;

                border-color:
                    rgba(7,86,166,.09) !important;

                background:
                    rgba(7,86,166,.035) !important;
            }

            .access-request-filter.active {
                color: #0756a6 !important;

                border-color:
                    rgba(7,86,166,.12) !important;

                background:
                    rgba(7,86,166,.065) !important;

                box-shadow:
                    0 4px 12px rgba(7,86,166,.055);
            }


            /* ------------------------------------------------
               LISTA
            ------------------------------------------------ */

            .access-requests-list {
                padding: 16px !important;
            }

            .access-request-card-admin {
                position: relative;
                overflow: hidden;

                border:
                    1px solid rgba(7,86,166,.08) !important;

                border-radius: 17px !important;

                background:
                    linear-gradient(
                        145deg,
                        #ffffff,
                        #f9fbfd
                    ) !important;

                box-shadow:
                    0 8px 25px rgba(3,27,61,.045);

                transition:
                    transform 180ms ease,
                    box-shadow 180ms ease,
                    border-color 180ms ease;
            }

            .access-request-card-admin::before {
                content: "";

                position: absolute;
                top: 0;
                left: 0;
                bottom: 0;

                width: 3px;

                background:
                    linear-gradient(
                        180deg,
                        #0756a6,
                        #22c4e8
                    );

                opacity: .75;
            }

            .access-request-card-admin:hover {
                transform: translateY(-2px);

                border-color:
                    rgba(7,86,166,.14) !important;

                box-shadow:
                    0 15px 35px rgba(3,27,61,.075);
            }


            /* ------------------------------------------------
               PESSOA
            ------------------------------------------------ */

            .access-request-avatar {
                width: 45px !important;
                height: 45px !important;

                display: grid !important;
                place-items: center !important;

                border:
                    1px solid rgba(7,86,166,.14) !important;

                border-radius: 14px !important;

                color: #0756a6 !important;

                background:
                    linear-gradient(
                        145deg,
                        rgba(7,86,166,.10),
                        rgba(34,196,232,.055)
                    ) !important;

                font-family:
                    var(--ta-display,
                    "Inter",
                    sans-serif) !important;

                font-size: 13px !important;
                font-weight: 850 !important;

                box-shadow:
                    inset 0 1px 0 rgba(255,255,255,.8);
            }

            .access-request-person strong {
                color: #17364f !important;

                font-family:
                    var(--ta-display,
                    "Inter",
                    sans-serif) !important;

                font-weight: 850 !important;
            }

            .access-request-person > div:last-child span {
                color: #8b9dac !important;

                font-size: 8px !important;
            }


            /* ------------------------------------------------
               DADOS
            ------------------------------------------------ */

            .access-request-data-item {
                position: relative;

                border:
                    1px solid rgba(7,86,166,.055) !important;

                border-radius: 12px !important;

                background:
                    rgba(247,250,252,.78) !important;
            }

            .access-request-data-item::before {
                content: "";

                position: absolute;
                top: 12px;
                left: 12px;

                width: 20px;
                height: 20px;

                border-radius: 7px;

                background:
                    rgba(7,86,166,.06);
            }

            .access-request-data-item:nth-child(1)::after {
                content: "";
                position: absolute;
                top: 16px;
                left: 16px;
                width: 12px;
                height: 12px;

                background:
                    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%230756a6' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='4' y='5.5' width='16' height='13' rx='2'/%3E%3Cpath d='m5.4 7 6.6 5.1L18.6 7'/%3E%3C/svg%3E")
                    center / contain
                    no-repeat;
            }

            .access-request-data-item:nth-child(2)::after {
                content: "";
                position: absolute;
                top: 16px;
                left: 16px;
                width: 12px;
                height: 12px;

                background:
                    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%230756a6' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M7.1 4.5 9.2 4c.65-.15 1.25.2 1.45.8l.8 2.55c.16.52-.02 1.08-.45 1.4l-1.35 1.02a12.1 12.1 0 0 0 4.58 4.58l1.02-1.35c.32-.43.88-.61 1.4-.45l2.55.8c.6.2.95.8.8 1.45l-.5 2.1c-.15.63-.72 1.1-1.37 1.12C10.7 18.25 5.75 13.3 5.98 5.87c.02-.65.49-1.22 1.12-1.37Z'/%3E%3C/svg%3E")
                    center / contain
                    no-repeat;
            }

            .access-request-data-item:nth-child(3)::after {
                content: "";
                position: absolute;
                top: 16px;
                left: 16px;
                width: 12px;
                height: 12px;

                background:
                    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%230756a6' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 20V5.2c0-.66.54-1.2 1.2-1.2h7.1c.66 0 1.2.54 1.2 1.2V20'/%3E%3Cpath d='M14.5 9.2h3.3c.66 0 1.2.54 1.2 1.2V20'/%3E%3Cpath d='M8.2 7.4h2M8.2 10.4h2M8.2 13.4h2M16.2 12.3h1'/%3E%3Cpath d='M3.5 20h17'/%3E%3C/svg%3E")
                    center / contain
                    no-repeat;
            }

            .access-request-data-item span {
                margin-left: 31px !important;

                color: #91a1ae !important;

                font-size: 7px !important;
                font-weight: 800 !important;
                letter-spacing: .055em !important;
                text-transform: uppercase;
            }

            .access-request-data-item strong {
                display: block;

                margin-left: 31px !important;
                margin-top: 4px !important;

                color: #29445d !important;

                font-size: 9px !important;
                line-height: 1.45 !important;
            }


            /* ------------------------------------------------
               MOTIVO / OBSERVAÇÃO
            ------------------------------------------------ */

            .access-request-reason,
            .access-request-review-note {
                position: relative;

                border-radius: 13px !important;

                border:
                    1px solid rgba(7,86,166,.07) !important;

                background:
                    rgba(7,86,166,.025) !important;
            }

            .access-request-reason span,
            .access-request-review-note span {
                color: #0756a6 !important;

                font-size: 7px !important;
                font-weight: 850 !important;
                letter-spacing: .08em !important;
                text-transform: uppercase;
            }

            .access-request-reason p,
            .access-request-review-note p {
                color: #728697 !important;

                font-size: 9px !important;
                line-height: 1.65 !important;
            }


            /* ------------------------------------------------
               ESTADOS
            ------------------------------------------------ */

            .access-request-status {
                display: inline-flex !important;
                align-items: center;
                gap: 6px;

                border-radius: 999px !important;

                font-size: 7px !important;
                font-weight: 850 !important;
                letter-spacing: .06em;
                text-transform: uppercase;
            }

            .access-request-status::before {
                content: "";

                width: 5px;
                height: 5px;

                border-radius: 50%;

                background: currentColor;
            }

            .access-status-pending {
                color: #0756a6 !important;

                border-color:
                    rgba(7,86,166,.12) !important;

                background:
                    rgba(7,86,166,.055) !important;
            }

            .access-status-approved {
                color: #16845a !important;

                border-color:
                    rgba(22,163,106,.14) !important;

                background:
                    rgba(22,163,106,.06) !important;
            }

            .access-status-rejected {
                color: #b34d55 !important;

                border-color:
                    rgba(179,77,85,.13) !important;

                background:
                    rgba(179,77,85,.055) !important;
            }


            /* ------------------------------------------------
               RESULTADO
            ------------------------------------------------ */

            .access-request-result.approved {
                border:
                    1px solid rgba(22,163,106,.13) !important;

                border-radius: 12px !important;

                color: #18734f !important;

                background:
                    rgba(22,163,106,.045) !important;
            }


            /* ------------------------------------------------
               BOTÕES DE AÇÃO
            ------------------------------------------------ */

            .access-request-actions {
                gap: 9px !important;
            }

            .access-approve-button,
            .access-reject-button {
                min-height: 41px;

                display: inline-flex !important;
                align-items: center;
                justify-content: center;
                gap: 8px;

                border-radius: 11px !important;

                font-size: 8px !important;
                font-weight: 850 !important;
            }

            .access-approve-button::before {
                content: "";

                width: 14px;
                height: 14px;

                background:
                    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6.7 12.2 3.35 3.35L17.5 8.1'/%3E%3C/svg%3E")
                    center / contain
                    no-repeat;
            }

            .access-reject-button::before {
                content: "";

                width: 14px;
                height: 14px;

                background:
                    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235e7182' stroke-width='1.7' stroke-linecap='round'%3E%3Cpath d='m7.4 7.4 9.2 9.2M16.6 7.4l-9.2 9.2'/%3E%3C/svg%3E")
                    center / contain
                    no-repeat;
            }


            /* ------------------------------------------------
               LOADING
            ------------------------------------------------ */

            .access-request-loading {
                min-height: 210px !important;

                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                justify-content: center !important;

                gap: 12px !important;

                color: #8497a7 !important;

                font-size: 8px !important;
                font-weight: 750 !important;
            }

            .access-request-spinner {
                width: 28px !important;
                height: 28px !important;

                border:
                    2px solid rgba(7,86,166,.10) !important;

                border-top-color:
                    #0756a6 !important;

                border-radius: 50% !important;

                box-shadow:
                    0 5px 18px rgba(7,86,166,.08);

                animation:
                    travelAccessSpin
                    .75s
                    linear
                    infinite !important;
            }

            @keyframes travelAccessSpin {
                to {
                    transform: rotate(360deg);
                }
            }


            /* ------------------------------------------------
               EMPTY / ERROR
            ------------------------------------------------ */

            .access-request-empty {
                min-height: 220px !important;

                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                justify-content: center !important;

                gap: 8px !important;

                padding: 28px !important;

                border:
                    1px dashed rgba(7,86,166,.13) !important;

                border-radius: 16px !important;

                background:
                    linear-gradient(
                        145deg,
                        rgba(7,86,166,.018),
                        rgba(34,196,232,.012)
                    ) !important;

                text-align: center;
            }

            .access-request-empty-mark {
                width: 47px !important;
                height: 47px !important;

                display: grid !important;
                place-items: center !important;

                margin-bottom: 5px;

                border:
                    1px solid rgba(7,86,166,.12) !important;

                border-radius: 15px !important;

                color: #0756a6 !important;

                background:
                    rgba(7,86,166,.055) !important;

                font-family:
                    var(--ta-display,
                    "Inter",
                    sans-serif);

                font-size: 17px !important;
                font-weight: 850 !important;
            }

            .access-request-empty strong {
                color: #29445d !important;

                font-size: 10px !important;
                font-weight: 850 !important;
            }

            .access-request-empty span {
                max-width: 420px;

                color: #8b9cac !important;

                font-size: 8px !important;
                line-height: 1.6 !important;
            }


            /* ------------------------------------------------
               SOMENTE ÍCONE DO ERRO
            ------------------------------------------------ */

            .access-request-error
            .access-request-empty-mark {
                color: #b34d55 !important;

                border-color:
                    rgba(179,77,85,.12) !important;

                background:
                    rgba(179,77,85,.045) !important;
            }


            /* ------------------------------------------------
               READONLY
            ------------------------------------------------ */

            .access-request-readonly {
                display: flex;
                align-items: center;
                gap: 8px;

                color: #7d90a0 !important;

                font-size: 8px !important;
                font-weight: 750 !important;
            }

            .access-request-readonly::before {
                content: "";

                width: 7px;
                height: 7px;

                border-radius: 50%;

                background: #0756a6;

                box-shadow:
                    0 0 0 4px rgba(7,86,166,.07);
            }


            /* ------------------------------------------------
               MODAL DA PALAVRA-PASSE
            ------------------------------------------------ */

            .access-password-modal-backdrop {
                backdrop-filter: blur(12px);

                background:
                    rgba(3,27,61,.48) !important;
            }

            .access-password-modal {
                position: relative;
                overflow: hidden;

                border:
                    1px solid rgba(255,255,255,.45) !important;

                border-radius: 25px !important;

                background:
                    linear-gradient(
                        145deg,
                        rgba(255,255,255,.99),
                        rgba(247,250,253,.98)
                    ) !important;

                box-shadow:
                    0 30px 90px rgba(3,27,61,.25) !important;
            }

            .access-password-modal::before {
                content: "";

                position: absolute;
                top: -100px;
                right: -100px;

                width: 230px;
                height: 230px;

                border-radius: 50%;

                background:
                    radial-gradient(
                        circle,
                        rgba(34,196,232,.10),
                        transparent 68%
                    );

                pointer-events: none;
            }

            .access-password-mark {
                width: 53px !important;
                height: 53px !important;

                display: grid !important;
                place-items: center !important;

                border-radius: 17px !important;

                color: #16a36a !important;

                border:
                    1px solid rgba(22,163,106,.14) !important;

                background:
                    rgba(22,163,106,.065) !important;

                box-shadow:
                    0 10px 25px rgba(22,163,106,.08);
            }

            .access-password-eyebrow {
                color: #0756a6 !important;

                font-size: 7px !important;
                font-weight: 850 !important;
                letter-spacing: .16em !important;
            }

            .access-password-modal h3 {
                color: #17364f !important;

                font-family:
                    var(--ta-display,
                    "Inter",
                    sans-serif) !important;

                letter-spacing: -.02em;
            }

            .access-password-account,
            .access-password-box,
            .access-password-warning {
                border-radius: 14px !important;
            }

            .access-password-box {
                border:
                    1px solid rgba(7,86,166,.12) !important;

                background:
                    linear-gradient(
                        145deg,
                        rgba(7,86,166,.055),
                        rgba(34,196,232,.025)
                    ) !important;
            }

            .access-password-box code {
                color: #0756a6 !important;

                font-family:
                    "JetBrains Mono",
                    monospace !important;
            }

            .access-password-warning {
                border:
                    1px solid rgba(217,75,82,.12) !important;

                background:
                    rgba(217,75,82,.035) !important;
            }


            /* ------------------------------------------------
               MOBILE
            ------------------------------------------------ */

            @media (max-width: 760px) {

                .access-request-permission {
                    width: 100%;
                    min-width: 0;
                }

                .access-requests-heading {
                    gap: 15px;
                }

                .access-request-toolbar {
                    gap: 12px;
                }

                .access-request-actions {
                    flex-direction: column;
                }

                .access-approve-button,
                .access-reject-button {
                    width: 100%;
                }

            }

            @media (max-width: 480px) {

                .access-requests-section::before {
                    display: none;
                }

                .access-request-stat {
                    border-radius: 14px !important;
                }

                .access-request-panel {
                    border-radius: 16px !important;
                }

                .access-requests-list {
                    padding: 10px !important;
                }

                .access-request-card-admin {
                    border-radius: 15px !important;
                }

                .access-request-toolbar {
                    padding: 15px !important;
                }

            }

            @media (prefers-reduced-motion: reduce) {

                .access-request-stat,
                .access-request-card-admin,
                #accessRequestsSidebarItem
                .sidebar-icon {
                    transition: none;
                }

                .access-request-spinner {
                    animation: none !important;
                }

            }

        `;

        document.head.appendChild(style);
    }


    /*
     * ========================================================
     * UTILITIES
     * ========================================================
     */

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


    function firstLetter(value) {

        return (
            String(
                value || "C"
            )
                .trim()
                .charAt(0)
                .toUpperCase() ||
            "C"
        );
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
                dateStyle: "medium",
                timeStyle: "short"
            }
        ).format(date);
    }


    function getCookie(name) {

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
            getCookie("csrf_token");

        if (!token) {
            return {};
        }

        return {
            "x-csrf-token": token
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
            document.createElement("div");

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

        container.appendChild(element);

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
                ].includes(method)
                    ? csrfHeaders()
                    : {}
            ),

            ...(options.headers || {})
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

            window.location.href =
                "/login";

            throw new Error(
                data?.error ||
                "Sessão expirada."
            );
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

        } catch (error) {

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

        if (canReview()) {

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

        } catch (error) {

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
                String(state.stats.total);
        }

        if (pending) {
            pending.textContent =
                String(state.stats.pending);
        }

        if (approved) {
            approved.textContent =
                String(state.stats.approved);
        }

        if (rejected) {
            rejected.textContent =
                String(state.stats.rejected);
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

        if (state.loading) {
            return;
        }

        state.loading = true;

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

        } catch (error) {

            console.error(
                "[ACCESS REQUESTS] Failed to load requests:",
                error
            );

            renderError(
                error.message ||
                "Não foi possível carregar os pedidos."
            );

        } finally {

            state.loading = false;
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
                    A sincronizar pedidos de acesso...
                </span>

            </div>
        `;
    }


    function renderError(message) {

        const list =
            $("#accessRequestsList");

        if (!list) {
            return;
        }

        list.innerHTML = `
            <div class="access-request-empty access-request-error">

                <div class="access-request-empty-mark">
                    ${ICONS.alert}
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
                        ${ICONS.passport}
                    </div>

                    <strong>
                        Tudo sob controlo
                    </strong>

                    <span>
                        ${
                            state.filter === "pending"
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
                        renderRequest(request)
                )
                .join("");

        bindRequestActions();
    }


    function renderRequest(request) {

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

                        <span>
                            Registo administrativo
                        </span>

                        <p>
                            ${escapeHtml(
                                request.reviewNote
                            )}
                        </p>

                    </div>
                `
                : "";


        const actionArea =
            status === "pending" &&
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
            status === "pending" &&
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
                                Solicitação recebida
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

                            <span>
                                Email
                            </span>

                            <strong>
                                ${escapeHtml(
                                    request.email
                                )}
                            </strong>

                        </div>


                        <div class="access-request-data-item">

                            <span>
                                Telefone
                            </span>

                            <strong>
                                ${escapeHtml(
                                    request.phone ||
                                    "Não informado"
                                )}
                            </strong>

                        </div>


                        <div class="access-request-data-item">

                            <span>
                                Empresa / organização
                            </span>

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

                                    <span>
                                        Motivo do pedido
                                    </span>

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
                    status === "approved"

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

        button.disabled = true;

        button.textContent =
            "A aprovar...";

        try {

            const data =
                await api(
                    `/api/admin/access-requests/${encodeURIComponent(
                        id
                    )}/approve`,
                    {
                        method: "POST",

                        body:
                            JSON.stringify({})
                    }
                );

            showTemporaryPassword(data);

            toast(
                "Colaborador criado",
                "O pedido foi aprovado com sucesso.",
                "success"
            );

            await loadAll();

        } catch (error) {

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

            button.disabled = false;

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

        if (note === null) {
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

        button.disabled = true;

        button.textContent =
            "A rejeitar...";

        try {

            await api(
                `/api/admin/access-requests/${encodeURIComponent(
                    id
                )}/reject`,
                {
                    method: "POST",

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

        } catch (error) {

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

            button.disabled = false;

            button.textContent =
                originalText;
        }
    }


    /*
     * ========================================================
     * TEMPORARY PASSWORD
     * ========================================================
     */

    function showTemporaryPassword(data) {

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
            document.createElement("div");

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
                    ${ICONS.shield}
                </div>


                <div class="access-password-eyebrow">
                    ACESSO AUTORIZADO
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

                    <span>
                        Conta
                    </span>

                    <strong>
                        ${escapeHtml(
                            user?.email ||
                            "—"
                        )}
                    </strong>

                </div>


                <div class="access-password-box">

                    <span>
                        CREDENCIAL TEMPORÁRIA
                    </span>

                    <code id="temporaryPasswordValue">
                        ${escapeHtml(
                            password
                        )}
                    </code>

                </div>


                <div class="access-password-warning">

                    <span>
                        ${ICONS.alert}
                    </span>

                    <p>
                        Guarde esta credencial e entregue-a
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
                        Copiar credencial
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

        document.body.appendChild(modal);


        const close = () => {
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
                            "Credencial copiada";

                        window.setTimeout(
                            () => {

                                if (
                                    document.body.contains(
                                        copyButton
                                    )
                                ) {

                                    copyButton.textContent =
                                        "Copiar credencial";
                                }

                            },
                            1800
                        );

                    } catch {

                        toast(
                            "Não foi possível copiar",
                            "Copie a credencial manualmente.",
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

    function setFilter(filter) {

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
     * SIDEBAR
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
            document.createElement("button");

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
                ${ICONS.access}
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

        section.appendChild(button);


        button.addEventListener(
            "click",
            () => {

                const target =
                    $("#accessRequestsSection");

                if (target) {

                    target.scrollIntoView({
                        behavior: "smooth",
                        block: "start"
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


    /*
     * ========================================================
     * SECTION
     * ========================================================
     */

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
            document.createElement("section");

        section.id =
            "accessRequestsSection";

        section.className =
            "content-section access-requests-section";

        section.innerHTML = `

            <div class="section-heading access-requests-heading">

                <div>

                    <span class="section-kicker">
                        CONTROLO DE ACESSO
                    </span>

                    <h2>
                        Pedidos de acesso
                    </h2>

                    <p class="access-requests-intro">
                        Valide quem pode entrar no ambiente
                        operacional do Travel Automation.
                    </p>

                </div>


                <div
                    class="access-request-permission"
                    id="accessRequestPermission"
                >

                    <span
                        class="access-request-permission-dot"
                    ></span>

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

                    <span>
                        Registos
                    </span>

                    <strong id="accessRequestsTotal">
                        —
                    </strong>

                </article>


                <article class="access-request-stat pending">

                    <span>
                        Em análise
                    </span>

                    <strong id="accessRequestsPending">
                        —
                    </strong>

                </article>


                <article class="access-request-stat approved">

                    <span>
                        Autorizados
                    </span>

                    <strong id="accessRequestsApproved">
                        —
                    </strong>

                </article>


                <article class="access-request-stat rejected">

                    <span>
                        Recusados
                    </span>

                    <strong id="accessRequestsRejected">
                        —
                    </strong>

                </article>

            </div>


            <div class="access-request-panel">

                <div class="access-request-toolbar">

                    <div>

                        <strong>
                            Central de solicitações
                        </strong>

                        <span>
                            Analise cada pedido antes de
                            conceder acesso à operação.
                        </span>

                    </div>


                    <button
                        type="button"
                        class="btn btn-secondary"
                        id="accessRequestsRefresh"
                    >
                        Atualizar
                    </button>

                </div>


                <div class="access-request-filters">

                    <button
                        type="button"
                        class="access-request-filter active"
                        data-filter="pending"
                    >
                        Em análise
                    </button>


                    <button
                        type="button"
                        class="access-request-filter"
                        data-filter="approved"
                    >
                        Autorizados
                    </button>


                    <button
                        type="button"
                        class="access-request-filter"
                        data-filter="rejected"
                    >
                        Recusados
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
                            A sincronizar pedidos de acesso...
                        </span>

                    </div>

                </div>

            </div>
        `;

        main.appendChild(section);
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

        injectVisualStyles();

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
                            ${ICONS.shield}
                        </div>

                        <strong>
                            Área não disponível
                        </strong>

                        <span>
                            O seu perfil não possui
                            acesso aos pedidos administrativos.
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
        refresh: loadAll
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
