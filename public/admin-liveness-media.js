"use strict";

/*
 * ============================================================
 * TRAVEL AUTOMATION
 * ADMIN — LIVENESS MEDIA
 * ============================================================
 *
 * Mostra na Administração:
 *
 * 1. Passaporte real do cliente
 * 2. Estado da sessão de liveness
 * 3. As 10 posições realizadas
 * 4. Apenas os vídeos realmente existentes
 * 5. Reprodução individual dos segmentos
 *
 * APIs:
 *
 * GET /api/admin/liveness/:applicationId
 * GET /api/admin/liveness/:applicationId/:position
 * GET /api/clients/:clientId/facial-preflight/passport-image
 *
 * ============================================================
 */

(() => {

    const state = {
        applicationId: null,
        clientId: null,
        sessionId: null,
        loading: false,
        loadedApplicationId: null,
        observer: null,
        refreshTimer: null
    };


    /*
     * ========================================================
     * UTILIDADES
     * ========================================================
     */

    function $(selector) {
        return document.querySelector(
            selector
        );
    }


    function escapeHtml(value) {

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


    function formatDate(value) {

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

        try {

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

        } catch {
            return date.toLocaleString();
        }
    }


    function getApplicationId() {

        const element =
            $(
                "#selectedProcessId"
            );

        if (!element) {
            return null;
        }

        const value =
            String(
                element.textContent ||
                ""
            ).trim();

        if (
            !value ||
            value ===
                "Nenhum processo selecionado"
        ) {
            return null;
        }

        return value;
    }


    /*
     * ========================================================
     * API
     * ========================================================
     */

    async function fetchJson(
        url
    ) {

        const response =
            await fetch(
                url,
                {
                    method:
                        "GET",

                    credentials:
                        "include",

                    headers: {
                        Accept:
                            "application/json"
                    },

                    cache:
                        "no-store"
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
            !response.ok
        ) {

            throw new Error(
                data?.error ||
                data?.message ||
                `Erro HTTP ${response.status}`
            );
        }

        return data;
    }


    /*
     * ========================================================
     * CRIAR SECÇÃO
     * ========================================================
     */

    function getOrCreateMediaSection() {

        const panel =
            $(
                "#detailsPanel"
            );

        if (!panel) {
            return null;
        }

        let section =
            $(
                "#adminLivenessMediaSection"
            );

        if (section) {
            return section;
        }

        section =
            document.createElement(
                "section"
            );

        section.id =
            "adminLivenessMediaSection";

        section.className =
            "admin-liveness-media-section";


        const identityStatus =
            $(
                "#detailIdentityStatus"
            );

        const identityCard =
            identityStatus
                ? identityStatus.closest(
                    ".detail-grid"
                )
                : null;


        if (
            identityCard &&
            identityCard.parentNode
        ) {

            identityCard.parentNode.insertBefore(
                section,
                identityCard.nextSibling
            );

        } else {

            panel.appendChild(
                section
            );
        }

        return section;
    }


    /*
     * ========================================================
     * LOADING
     * ========================================================
     */

    function renderLoading() {

        const section =
            getOrCreateMediaSection();

        if (!section) {
            return;
        }

        section.innerHTML =
            `
                <div class="admin-media-card">

                    <div class="admin-media-header">

                        <div>
                            <span class="admin-media-kicker">
                                EVIDÊNCIAS DA VERIFICAÇÃO
                            </span>

                            <h3>
                                Passaporte e prova de vida
                            </h3>

                            <p>
                                A carregar os documentos e os
                                movimentos reais realizados pelo cliente.
                            </p>
                        </div>

                        <div class="admin-media-loading">
                            <span></span>
                            A carregar
                        </div>

                    </div>

                    <div class="admin-media-loading-body">

                        <div class="admin-media-skeleton large"></div>

                        <div class="admin-media-skeleton"></div>

                        <div class="admin-media-skeleton"></div>

                    </div>

                </div>
            `;
    }


    /*
     * ========================================================
     * EMPTY / ERROR
     * ========================================================
     */

    function renderEmpty(
        message
    ) {

        const section =
            getOrCreateMediaSection();

        if (!section) {
            return;
        }

        section.innerHTML =
            `
                <div class="admin-media-card">

                    <div class="admin-media-header">

                        <div>
                            <span class="admin-media-kicker">
                                EVIDÊNCIAS DA VERIFICAÇÃO
                            </span>

                            <h3>
                                Passaporte e prova de vida
                            </h3>
                        </div>

                    </div>

                    <div class="admin-media-empty">

                        <div class="admin-media-empty-icon">
                            !
                        </div>

                        <strong>
                            Evidências ainda não disponíveis
                        </strong>

                        <span>
                            ${escapeHtml(
                                message ||
                                "Não foi possível encontrar a sessão de liveness."
                            )}
                        </span>

                    </div>

                </div>
            `;
    }


    /*
     * ========================================================
     * PASSAPORTE
     * ========================================================
     */

    function renderPassport(
        clientId
    ) {

        if (!clientId) {

            return `
                <div class="admin-passport-preview unavailable">

                    <div class="admin-passport-placeholder">
                        <span>
                            PASSAPORTE
                        </span>
                    </div>

                    <div class="admin-passport-caption">

                        <strong>
                            Documento não disponível
                        </strong>

                        <span>
                            Não foi possível localizar o cliente.
                        </span>

                    </div>

                </div>
            `;
        }


        const passportUrl =
            `/api/clients/${encodeURIComponent(
                clientId
            )}/facial-preflight/passport-image`;


        return `
            <div class="admin-passport-preview">

                <div class="admin-passport-image-wrap">

                    <img
                        src="${escapeHtml(
                            passportUrl
                        )}"
                        alt="Passaporte do cliente"
                        class="admin-passport-image"
                        loading="eager"
                        decoding="async"
                    >

                    <div
                        class="admin-passport-image-loading"
                    >
                        A carregar documento...
                    </div>

                    <div
                        class="admin-passport-image-error"
                        hidden
                    >
                        Não foi possível carregar o passaporte.
                    </div>

                </div>

                <div class="admin-passport-caption">

                    <strong>
                        Documento apresentado
                    </strong>

                    <span>
                        Imagem original armazenada no processo.
                    </span>

                </div>

            </div>
        `;
    }


    /*
     * ========================================================
     * NOMES DAS POSIÇÕES
     * ========================================================
     */

    function positionLabel(
        position
    ) {

        const labels = {
            1:
                "Frontal",

            2:
                "Virar para a esquerda",

            3:
                "Virar para a direita",

            4:
                "Olhar para cima",

            5:
                "Olhar para baixo",

            6:
                "Esquerda + cima",

            7:
                "Direita + cima",

            8:
                "Esquerda + baixo",

            9:
                "Direita + baixo",

            10:
                "Sorriso"
        };

        return (
            labels[
                Number(
                    position
                )
            ] ||
            `Posição ${position}`
        );
    }


    /*
     * ========================================================
     * POSIÇÃO
     * ========================================================
     */

    function getPosition(
        positions,
        position
    ) {

        if (
            !Array.isArray(
                positions
            )
        ) {
            return null;
        }

        return (
            positions.find(
                item =>
                    Number(
                        item?.position
                    ) ===
                    Number(
                        position
                    )
            ) ||
            null
        );
    }


    /*
     * ========================================================
     * SEGMENTO
     * ========================================================
     */

    function getSegmentForPosition(
        segments,
        position
    ) {

        if (
            !Array.isArray(
                segments
            )
        ) {
            return null;
        }

        return (
            segments.find(
                segment =>
                    Number(
                        segment?.position
                    ) ===
                    Number(
                        position
                    )
            ) ||
            null
        );
    }


    /*
     * ========================================================
     * VERIFICAR SE EXISTE VÍDEO REAL
     * ========================================================
     *
     * NÃO usar:
     *
     * segment?.available !== false
     *
     * porque undefined !== false resulta em true.
     *
     * O backend fornece videoId quando o segmento realmente
     * existe no GridFS.
     * ========================================================
     */

    function segmentHasVideo(
        segment
    ) {

        if (!segment) {
            return false;
        }

        return Boolean(
            segment.videoId
        );
    }


    /*
     * ========================================================
     * CARD DE POSIÇÃO
     * ========================================================
     */

    function renderPositionCard(
        position,
        segment,
        positionData,
        applicationId
    ) {

        const positionNumber =
            Number(
                position
            );

        const hasVideo =
            segmentHasVideo(
                segment
            );

        const label =
            segment?.label ||
            positionData?.label ||
            positionLabel(
                positionNumber
            );

        const instruction =
            segment?.instruction ||
            positionData?.instruction ||
            "Movimento validado";

        const score =
            Number(
                segment?.positionScore ??
                segment?.score
            );

        const scoreText =
            Number.isFinite(
                score
            )
                ? `${Math.round(
                    score * 100
                )}%`
                : "—";

        const completedAt =
            segment?.completedAt ||
            positionData?.completedAt ||
            null;

        const uploadedAt =
            segment?.uploadedAt ||
            null;

        const videoUrl =
            `/api/admin/liveness/${encodeURIComponent(
                applicationId
            )}/${positionNumber}`;


        return `
            <article
                class="admin-liveness-video-card ${
                    hasVideo
                        ? "has-video"
                        : "no-video"
                }"
                data-liveness-position="${positionNumber}"
            >

                <div class="admin-liveness-video-top">

                    <div class="admin-liveness-video-number">
                        ${positionNumber}
                    </div>

                    <div class="admin-liveness-video-title">

                        <strong>
                            ${escapeHtml(
                                label
                            )}
                        </strong>

                        <span>
                            ${escapeHtml(
                                instruction
                            )}
                        </span>

                    </div>

                    <div class="admin-liveness-video-score">
                        ${scoreText}
                    </div>

                </div>


                ${
                    hasVideo
                        ? `
                            <div class="admin-liveness-player">

                                <video
                                    class="admin-liveness-video"
                                    controls
                                    playsinline
                                    preload="metadata"
                                    data-video-url="${escapeHtml(
                                        videoUrl
                                    )}"
                                ></video>

                                <div class="admin-video-loading">
                                    <span></span>
                                    A preparar vídeo...
                                </div>

                                <div
                                    class="admin-video-error"
                                    hidden
                                >
                                    Não foi possível reproduzir
                                    este movimento.
                                </div>

                            </div>
                        `
                        : `
                            <div class="admin-video-unavailable">

                                <span class="admin-video-unavailable-icon">
                                    —
                                </span>

                                <div>

                                    <strong>
                                        Vídeo não disponível
                                    </strong>

                                    <span>
                                        A posição foi validada,
                                        mas não existe segmento
                                        armazenado para este movimento.
                                    </span>

                                </div>

                            </div>
                        `
                }


                <div class="admin-liveness-video-meta">

                    <div>
                        <span>
                            Conclusão
                        </span>

                        <strong>
                            ${escapeHtml(
                                formatDate(
                                    completedAt
                                )
                            )}
                        </strong>
                    </div>

                    <div>
                        <span>
                            Vídeo
                        </span>

                        <strong class="${
                            hasVideo
                                ? "verified"
                                : ""
                        }">
                            ${
                                hasVideo
                                    ? "✓ Disponível"
                                    : "— Não disponível"
                            }
                        </strong>
                    </div>

                    <div>
                        <span>
                            Segmento
                        </span>

                        <strong>
                            ${escapeHtml(
                                formatDate(
                                    uploadedAt
                                )
                            )}
                        </strong>
                    </div>

                </div>

            </article>
        `;
    }


    /*
     * ========================================================
     * INICIALIZAR PLAYERS
     * ========================================================
     */

    function initializePlayers(
        section
    ) {

        const videos =
            section.querySelectorAll(
                ".admin-liveness-video"
            );


        videos.forEach(
            video => {

                const url =
                    video.dataset.videoUrl;

                if (!url) {
                    return;
                }


                const player =
                    video.closest(
                        ".admin-liveness-player"
                    );

                const loading =
                    player?.querySelector(
                        ".admin-video-loading"
                    );

                const errorElement =
                    player?.querySelector(
                        ".admin-video-error"
                    );


                video.addEventListener(
                    "loadedmetadata",
                    () => {

                        if (loading) {
                            loading.hidden =
                                true;
                        }

                        video.classList.add(
                            "ready"
                        );

                    },
                    {
                        once:
                            true
                    }
                );


                video.addEventListener(
                    "error",
                    () => {

                        if (loading) {
                            loading.hidden =
                                true;
                        }

                        if (errorElement) {
                            errorElement.hidden =
                                false;
                        }

                    }
                );


                video.src =
                    url;

                video.load();
            }
        );


        /*
         * Só um vídeo pode tocar de cada vez.
         */

        videos.forEach(
            currentVideo => {

                currentVideo.addEventListener(
                    "play",
                    () => {

                        videos.forEach(
                            otherVideo => {

                                if (
                                    otherVideo !==
                                    currentVideo
                                ) {
                                    otherVideo.pause();
                                }

                            }
                        );

                    }
                );

            }
        );


        /*
         * Passaporte.
         */

        const passportImage =
            section.querySelector(
                ".admin-passport-image"
            );


        if (
            passportImage
        ) {

            const loading =
                section.querySelector(
                    ".admin-passport-image-loading"
                );

            const error =
                section.querySelector(
                    ".admin-passport-image-error"
                );


            passportImage.addEventListener(
                "load",
                () => {

                    if (loading) {
                        loading.hidden =
                            true;
                    }

                    passportImage.classList.add(
                        "loaded"
                    );

                },
                {
                    once:
                        true
                }
            );


            passportImage.addEventListener(
                "error",
                () => {

                    if (loading) {
                        loading.hidden =
                            true;
                    }

                    if (error) {
                        error.hidden =
                            false;
                    }

                },
                {
                    once:
                        true
                }
            );

        }
    }


    /*
     * ========================================================
     * RENDER COMPLETO
     * ========================================================
     */

    function renderMedia(
        data
    ) {

        const section =
            getOrCreateMediaSection();

        if (!section) {
            return;
        }


        const applicationId =
            state.applicationId;

        const clientId =
            data?.clientId ||
            null;

        const segments =
            Array.isArray(
                data?.segments
            )
                ? data.segments
                : [];

        const positions =
            Array.isArray(
                data?.positions
            )
                ? data.positions
                : [];


        state.clientId =
            clientId;

        state.sessionId =
            data?.sessionId ||
            null;


        const completedCount =
            Number(
                data?.completedCount ||
                0
            );

        const total =
            Number(
                data?.total ||
                10
            );

        const verified =
            data?.verified ===
            true;

        const available =
            data?.available ===
            true;


        let statusText =
            "Liveness incompleto";

        if (
            verified
        ) {
            statusText =
                available
                    ? "Liveness validado"
                    : "Liveness validado · vídeo indisponível";
        } else if (
            data?.status ===
            "failed"
        ) {
            statusText =
                "Liveness reprovado";
        }


        const positionCards =
            Array.from(
                {
                    length:
                        10
                },
                (
                    _,
                    index
                ) => {

                    const position =
                        index + 1;

                    const segment =
                        getSegmentForPosition(
                            segments,
                            position
                        );

                    const positionData =
                        getPosition(
                            positions,
                            position
                        );

                    return renderPositionCard(
                        position,
                        segment,
                        positionData,
                        applicationId
                    );
                }
            )
                .join("");


        section.innerHTML =
            `
                <div class="admin-media-card">

                    <div class="admin-media-header">

                        <div>

                            <span class="admin-media-kicker">
                                EVIDÊNCIAS DA VERIFICAÇÃO
                            </span>

                            <h3>
                                Passaporte e prova de vida
                            </h3>

                            <p>
                                Documentos e segmentos reais
                                capturados durante a sessão.
                            </p>

                        </div>

                        <div class="admin-media-status ${
                            verified
                                ? "verified"
                                : "pending"
                        }">

                            <span></span>

                            ${escapeHtml(
                                statusText
                            )}

                        </div>

                    </div>


                    <div class="admin-media-overview">

                        <div class="admin-media-stat">

                            <span>
                                Sessão
                            </span>

                            <strong
                                title="${escapeHtml(
                                    data?.sessionId ||
                                    "—"
                                )}"
                            >
                                ${escapeHtml(
                                    data?.sessionId ||
                                    "—"
                                )}
                            </strong>

                        </div>


                        <div class="admin-media-stat">

                            <span>
                                Posições
                            </span>

                            <strong>
                                ${completedCount}/${total}
                            </strong>

                        </div>


                        <div class="admin-media-stat">

                            <span>
                                Vídeos
                            </span>

                            <strong>
                                ${segments.length}/10
                            </strong>

                        </div>


                        <div class="admin-media-stat">

                            <span>
                                Concluído
                            </span>

                            <strong>
                                ${escapeHtml(
                                    formatDate(
                                        data?.completedAt
                                    )
                                )}
                            </strong>

                        </div>

                    </div>


                    <div class="admin-media-passport">

                        <div class="admin-media-subheading">

                            <div>

                                <span>
                                    DOCUMENTO
                                </span>

                                <strong>
                                    Passaporte apresentado
                                </strong>

                            </div>

                        </div>

                        ${renderPassport(
                            clientId
                        )}

                    </div>


                    <div class="admin-media-liveness">

                        <div class="admin-media-subheading">

                            <div>

                                <span>
                                    LIVENESS
                                </span>

                                <strong>
                                    Os 10 movimentos realizados
                                </strong>

                            </div>

                            <span class="admin-media-session-id">
                                ${escapeHtml(
                                    data?.sessionId ||
                                    "Sessão não identificada"
                                )}
                            </span>

                        </div>


                        ${
                            segments.length ===
                            0
                                ? `
                                    <div class="admin-no-video-session">

                                        <strong>
                                            Nenhum vídeo armazenado
                                        </strong>

                                        <span>
                                            A sessão foi localizada,
                                            mas ainda não existem segmentos
                                            disponíveis no armazenamento.
                                        </span>

                                    </div>
                                `
                                : ""
                        }


                        <div class="admin-liveness-video-grid">

                            ${positionCards}

                        </div>

                    </div>

                </div>
            `;


        initializePlayers(
            section
        );
    }


    /*
     * ========================================================
     * CARREGAR
     * ========================================================
     */

    async function load(
        applicationId
    ) {

        if (
            !applicationId
        ) {
            return;
        }


        if (
            state.loading
        ) {
            return;
        }


        state.loading =
            true;

        state.applicationId =
            applicationId;


        renderLoading();


        try {

            const data =
                await fetchJson(
                    `/api/admin/liveness/${encodeURIComponent(
                        applicationId
                    )}`
                );


            state.loadedApplicationId =
                applicationId;


            renderMedia(
                data
            );


        } catch (
            error
        ) {

            console.error(
                "[ADMIN LIVENESS MEDIA]",
                error
            );


            state.loadedApplicationId =
                applicationId;


            renderEmpty(
                error.message ||
                "Não foi possível carregar as evidências."
            );


        } finally {

            state.loading =
                false;
        }
    }


    /*
     * ========================================================
     * OBSERVAR PROCESSO SELECIONADO
     * ========================================================
     */

    function watchSelectedApplication() {

        const selected =
            $(
                "#selectedProcessId"
            );

        if (!selected) {
            return;
        }


        let lastValue =
            String(
                selected.textContent ||
                ""
            ).trim();


        state.observer =
            new MutationObserver(
                () => {

                    const current =
                        getApplicationId();


                    if (
                        current ===
                        lastValue
                    ) {
                        return;
                    }


                    lastValue =
                        current ||
                        "";


                    if (
                        !current
                    ) {

                        state.applicationId =
                            null;

                        state.clientId =
                            null;

                        state.sessionId =
                            null;

                        state.loadedApplicationId =
                            null;


                        const section =
                            $(
                                "#adminLivenessMediaSection"
                            );


                        if (
                            section
                        ) {
                            section.remove();
                        }

                        return;
                    }


                    state.loadedApplicationId =
                        null;


                    load(
                        current
                    );
                }
            );


        state.observer.observe(
            selected,
            {
                childList:
                    true,

                characterData:
                    true,

                subtree:
                    true
            }
        );


        const initial =
            getApplicationId();


        if (
            initial
        ) {

            load(
                initial
            );
        }
    }


    /*
     * ========================================================
     * FALLBACK
     * ========================================================
     */

    function startFallbackWatcher() {

        if (
            state.refreshTimer
        ) {
            clearInterval(
                state.refreshTimer
            );
        }


        state.refreshTimer =
            setInterval(
                () => {

                    const current =
                        getApplicationId();


                    if (
                        !current
                    ) {
                        return;
                    }


                    if (
                        current ===
                        state.loadedApplicationId ||
                        state.loading
                    ) {
                        return;
                    }


                    load(
                        current
                    );

                },
                1500
            );
    }


    /*
     * ========================================================
     * ESTILOS
     * ========================================================
     */

    function injectStyles() {

        if (
            document.getElementById(
                "adminLivenessMediaStyles"
            )
        ) {
            return;
        }


        const style =
            document.createElement(
                "style"
            );

        style.id =
            "adminLivenessMediaStyles";


        style.textContent =
            `
                .admin-liveness-media-section {
                    width: 100%;
                    margin-top: 24px;
                }

                .admin-media-card {
                    width: 100%;
                    box-sizing: border-box;
                    background: rgba(255,255,255,0.025);
                    border: 1px solid rgba(255,255,255,0.08);
                    border-radius: 24px;
                    padding: 24px;
                    overflow: hidden;
                }

                .admin-media-header {
                    display: flex;
                    align-items: flex-start;
                    justify-content: space-between;
                    gap: 20px;
                    margin-bottom: 22px;
                }

                .admin-media-kicker {
                    display: block;
                    font-size: 10px;
                    font-weight: 800;
                    letter-spacing: .16em;
                    opacity: .58;
                    margin-bottom: 7px;
                }

                .admin-media-header h3 {
                    margin: 0;
                    font-size: 21px;
                    font-weight: 800;
                }

                .admin-media-header p {
                    margin: 8px 0 0;
                    opacity: .62;
                    line-height: 1.55;
                    font-size: 13px;
                }

                .admin-media-status {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    white-space: nowrap;
                    padding: 9px 13px;
                    border-radius: 999px;
                    border: 1px solid rgba(255,255,255,.08);
                    font-size: 11px;
                    font-weight: 800;
                }

                .admin-media-status > span {
                    width: 7px;
                    height: 7px;
                    border-radius: 50%;
                    display: inline-block;
                    background: currentColor;
                }

                .admin-media-status.verified {
                    color: #79e6a2;
                    background: rgba(121,230,162,.08);
                }

                .admin-media-status.pending {
                    color: #f0bd68;
                    background: rgba(240,189,104,.08);
                }

                .admin-media-overview {
                    display: grid;
                    grid-template-columns:
                        repeat(4,minmax(0,1fr));
                    gap: 10px;
                    margin-bottom: 24px;
                }

                .admin-media-stat {
                    min-width: 0;
                    padding: 14px;
                    border-radius: 16px;
                    background: rgba(255,255,255,.025);
                    border: 1px solid rgba(255,255,255,.06);
                }

                .admin-media-stat span {
                    display: block;
                    font-size: 10px;
                    opacity: .52;
                    margin-bottom: 6px;
                    text-transform: uppercase;
                    letter-spacing: .08em;
                }

                .admin-media-stat strong {
                    display: block;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    font-size: 12px;
                }

                .admin-media-subheading {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 15px;
                    margin-bottom: 14px;
                }

                .admin-media-subheading > div span {
                    display: block;
                    font-size: 9px;
                    letter-spacing: .15em;
                    font-weight: 800;
                    opacity: .48;
                    margin-bottom: 4px;
                }

                .admin-media-subheading strong {
                    display: block;
                    font-size: 15px;
                }

                .admin-media-passport,
                .admin-media-liveness {
                    padding: 20px;
                    border-radius: 20px;
                    background: rgba(255,255,255,.018);
                    border: 1px solid rgba(255,255,255,.06);
                }

                .admin-media-passport {
                    margin-bottom: 22px;
                }

                .admin-passport-preview {
                    display: grid;
                    grid-template-columns:
                        minmax(240px,520px)
                        minmax(0,1fr);
                    gap: 20px;
                    align-items: start;
                }

                .admin-passport-image-wrap {
                    position: relative;
                    min-height: 160px;
                    border-radius: 16px;
                    overflow: hidden;
                    background: #090b0e;
                    border: 1px solid rgba(255,255,255,.08);
                }

                .admin-passport-image {
                    display: block;
                    width: 100%;
                    height: auto;
                    max-height: 430px;
                    object-fit: contain;
                    margin: 0 auto;
                    opacity: 0;
                    transition: opacity .2s ease;
                }

                .admin-passport-image.loaded {
                    opacity: 1;
                }

                .admin-passport-image-loading,
                .admin-passport-image-error {
                    position: absolute;
                    inset: 0;
                    display: grid;
                    place-items: center;
                    padding: 20px;
                    text-align: center;
                    font-size: 12px;
                    opacity: .62;
                }

                .admin-passport-image-error {
                    color: #ff9d9d;
                }

                .admin-passport-caption {
                    display: flex;
                    flex-direction: column;
                    gap: 7px;
                    padding-top: 5px;
                }

                .admin-passport-caption strong {
                    font-size: 14px;
                }

                .admin-passport-caption span {
                    font-size: 12px;
                    line-height: 1.55;
                    opacity: .58;
                }

                .admin-passport-placeholder {
                    min-height: 180px;
                    display: grid;
                    place-items: center;
                    border: 1px dashed rgba(255,255,255,.12);
                    border-radius: 16px;
                    opacity: .45;
                }

                .admin-media-session-id {
                    max-width: 260px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    font-size: 10px;
                    opacity: .48;
                }

                .admin-liveness-video-grid {
                    display: grid;
                    grid-template-columns:
                        repeat(2,minmax(0,1fr));
                    gap: 14px;
                }

                .admin-liveness-video-card {
                    min-width: 0;
                    border-radius: 18px;
                    overflow: hidden;
                    background: rgba(0,0,0,.16);
                    border: 1px solid rgba(255,255,255,.07);
                }

                .admin-liveness-video-top {
                    display: grid;
                    grid-template-columns:
                        34px minmax(0,1fr) auto;
                    align-items: center;
                    gap: 10px;
                    padding: 13px;
                }

                .admin-liveness-video-number {
                    width: 34px;
                    height: 34px;
                    display: grid;
                    place-items: center;
                    border-radius: 10px;
                    background: rgba(255,255,255,.06);
                    font-size: 12px;
                    font-weight: 900;
                }

                .admin-liveness-video-title {
                    min-width: 0;
                }

                .admin-liveness-video-title strong,
                .admin-liveness-video-title span {
                    display: block;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .admin-liveness-video-title strong {
                    font-size: 12px;
                }

                .admin-liveness-video-title span {
                    margin-top: 3px;
                    font-size: 10px;
                    opacity: .5;
                }

                .admin-liveness-video-score {
                    font-size: 11px;
                    font-weight: 800;
                    opacity: .72;
                }

                .admin-liveness-player {
                    position: relative;
                    aspect-ratio: 16/9;
                    background: #050607;
                    overflow: hidden;
                }

                .admin-liveness-video {
                    width: 100%;
                    height: 100%;
                    display: block;
                    object-fit: contain;
                    background: #050607;
                }

                .admin-video-loading {
                    position: absolute;
                    inset: 0;
                    display: grid;
                    place-items: center;
                    font-size: 11px;
                    opacity: .58;
                    pointer-events: none;
                }

                .admin-video-loading span {
                    width: 12px;
                    height: 12px;
                    border: 2px solid rgba(255,255,255,.18);
                    border-top-color: currentColor;
                    border-radius: 50%;
                    animation: adminMediaSpin .8s linear infinite;
                    margin-right: 7px;
                    display: inline-block;
                }

                .admin-video-error {
                    position: absolute;
                    inset: 0;
                    display: grid;
                    place-items: center;
                    padding: 20px;
                    text-align: center;
                    background: rgba(0,0,0,.82);
                    font-size: 11px;
                    color: #ff9d9d;
                }

                .admin-video-unavailable {
                    min-height: 150px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 20px;
                    box-sizing: border-box;
                }

                .admin-video-unavailable-icon {
                    width: 30px;
                    height: 30px;
                    flex: 0 0 30px;
                    display: grid;
                    place-items: center;
                    border-radius: 50%;
                    background: rgba(255,180,90,.1);
                    color: #ffbd70;
                    font-weight: 900;
                }

                .admin-video-unavailable strong,
                .admin-video-unavailable span {
                    display: block;
                }

                .admin-video-unavailable strong {
                    font-size: 12px;
                }

                .admin-video-unavailable span {
                    margin-top: 4px;
                    font-size: 10px;
                    line-height: 1.45;
                    opacity: .52;
                }

                .admin-liveness-video-meta {
                    display: grid;
                    grid-template-columns:
                        repeat(3,minmax(0,1fr));
                    gap: 8px;
                    padding: 12px;
                    border-top: 1px solid rgba(255,255,255,.06);
                }

                .admin-liveness-video-meta span,
                .admin-liveness-video-meta strong {
                    display: block;
                }

                .admin-liveness-video-meta span {
                    font-size: 9px;
                    opacity: .42;
                    margin-bottom: 3px;
                }

                .admin-liveness-video-meta strong {
                    font-size: 10px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .admin-liveness-video-meta strong.verified {
                    color: #79e6a2;
                }

                .admin-no-video-session {
                    padding: 18px;
                    margin-bottom: 14px;
                    border-radius: 14px;
                    border: 1px solid rgba(240,189,104,.12);
                    background: rgba(240,189,104,.045);
                }

                .admin-no-video-session strong,
                .admin-no-video-session span {
                    display: block;
                }

                .admin-no-video-session strong {
                    font-size: 12px;
                    color: #f0bd68;
                }

                .admin-no-video-session span {
                    margin-top: 5px;
                    font-size: 11px;
                    line-height: 1.5;
                    opacity: .58;
                }

                .admin-media-loading-body {
                    display: grid;
                    gap: 10px;
                }

                .admin-media-skeleton {
                    height: 55px;
                    border-radius: 14px;
                    background: rgba(255,255,255,.045);
                    animation: adminMediaPulse 1.2s ease-in-out infinite;
                }

                .admin-media-skeleton.large {
                    height: 220px;
                }

                .admin-media-loading {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 10px;
                    opacity: .5;
                }

                .admin-media-loading span {
                    width: 9px;
                    height: 9px;
                    border: 2px solid rgba(255,255,255,.15);
                    border-top-color: currentColor;
                    border-radius: 50%;
                    animation: adminMediaSpin .8s linear infinite;
                }

                .admin-media-empty {
                    min-height: 180px;
                    display: grid;
                    place-items: center;
                    align-content: center;
                    gap: 8px;
                    text-align: center;
                    opacity: .65;
                }

                .admin-media-empty-icon {
                    width: 44px;
                    height: 44px;
                    display: grid;
                    place-items: center;
                    border-radius: 14px;
                    background: rgba(255,255,255,.05);
                    margin-bottom: 4px;
                    font-weight: 900;
                }

                .admin-media-empty strong {
                    font-size: 13px;
                }

                .admin-media-empty span {
                    max-width: 520px;
                    font-size: 11px;
                    line-height: 1.5;
                }

                @keyframes adminMediaSpin {
                    to {
                        transform: rotate(360deg);
                    }
                }

                @keyframes adminMediaPulse {
                    0%,100% {
                        opacity: .5;
                    }

                    50% {
                        opacity: 1;
                    }
                }

                @media (max-width:900px) {

                    .admin-media-overview {
                        grid-template-columns:
                            repeat(2,minmax(0,1fr));
                    }

                    .admin-passport-preview {
                        grid-template-columns:
                            1fr;
                    }

                    .admin-liveness-video-grid {
                        grid-template-columns:
                            1fr;
                    }
                }

                @media (max-width:600px) {

                    .admin-media-card {
                        padding: 15px;
                        border-radius: 18px;
                    }

                    .admin-media-header {
                        flex-direction: column;
                    }

                    .admin-media-overview {
                        grid-template-columns:
                            1fr 1fr;
                    }

                    .admin-media-passport,
                    .admin-media-liveness {
                        padding: 13px;
                    }

                    .admin-liveness-video-meta {
                        grid-template-columns:
                            1fr;
                    }

                    .admin-media-session-id {
                        max-width: 150px;
                    }
                }
            `;


        document.head.appendChild(
            style
        );
    }


    /*
     * ========================================================
     * INIT
     * ========================================================
     */

    function init() {

        injectStyles();

        watchSelectedApplication();

        startFallbackWatcher();


        setTimeout(
            () => {

                const applicationId =
                    getApplicationId();

                if (
                    applicationId &&
                    applicationId !==
                        state.loadedApplicationId
                ) {

                    load(
                        applicationId
                    );
                }

            },
            700
        );
    }


    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            init,
            {
                once:
                    true
            }
        );

    } else {

        init();
    }

})();
