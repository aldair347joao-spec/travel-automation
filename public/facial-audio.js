(function () {
  "use strict";

  /*
   * ============================================================
   * TRAVEL AUTOMATION
   * ÁUDIO DA VERIFICAÇÃO FACIAL
   * ============================================================
   *
   * O reconhecimento facial continua no
   * facial-preflight.js.
   *
   * Este módulo apenas controla o áudio.
   *
   * PRIORIDADE:
   *
   * 1. MP3 local
   * 2. Speech Synthesis como fallback
   *
   * O sistema acompanha automaticamente a posição
   * atual do motor facial.
   * ============================================================
   */

  const AUDIO_BASE = "/audio/facial/";

  const AUDIO_FILES = {
    frontal: "01-frontal.mp3",
    left: "02-left.mp3",
    right: "03-right.mp3",
    up: "04-up.mp3",
    down: "05-down.mp3",
    left_up: "06-left-up.mp3",
    right_up: "07-right-up.mp3",
    left_down: "08-left-down.mp3",
    right_down: "09-right-down.mp3",
    smile: "10-smile.mp3"
  };

  const TEXT_FALLBACK = {
    frontal:
      "Olhe diretamente para a câmera e mantenha o rosto parado.",

    left:
      "Vire lentamente o rosto para a esquerda.",

    right:
      "Vire lentamente o rosto para a direita.",

    up:
      "Levante lentamente o rosto e olhe para cima.",

    down:
      "Baixe lentamente o rosto e olhe para baixo.",

    left_up:
      "Vire o rosto para a esquerda e olhe para cima.",

    right_up:
      "Vire o rosto para a direita e olhe para cima.",

    left_down:
      "Vire o rosto para a esquerda e olhe para baixo.",

    right_down:
      "Vire o rosto para a direita e olhe para baixo.",

    smile:
      "Agora sorria e mantenha o sorriso por alguns segundos."
  };


  /*
   * ============================================================
   * ESTADO
   * ============================================================
   */

  let audio = null;

  let initialized = false;

  let enabled = true;

  let fallbackEnabled = true;

  let currentPosition = null;

  let lastObservedPosition = null;

  let monitorTimer = null;

  let userStartedSession = false;

  let playing = false;

  let currentUrl = null;


  /*
   * ============================================================
   * CRIAR ELEMENTO DE ÁUDIO
   * ============================================================
   */

  function createAudio() {

    if (audio) {
      return audio;
    }

    audio = document.createElement("audio");

    audio.preload = "auto";

    audio.autoplay = false;

    audio.controls = false;

    audio.loop = false;

    audio.muted = false;

    audio.volume = 1;

    audio.setAttribute(
      "playsinline",
      ""
    );

    audio.setAttribute(
      "webkit-playsinline",
      ""
    );

    audio.setAttribute(
      "aria-hidden",
      "true"
    );

    audio.style.position = "fixed";

    audio.style.width = "1px";

    audio.style.height = "1px";

    audio.style.opacity = "0";

    audio.style.pointerEvents = "none";

    audio.style.left = "-9999px";

    document.body.appendChild(audio);

    audio.addEventListener(
      "play",
      function () {

        playing = true;

      }
    );

    audio.addEventListener(
      "playing",
      function () {

        playing = true;

        console.log(
          "[FACIAL AUDIO] Reprodução iniciada:",
          currentPosition
        );

      }
    );

    audio.addEventListener(
      "ended",
      function () {

        playing = false;

        console.log(
          "[FACIAL AUDIO] Reprodução concluída:",
          currentPosition
        );

      }
    );

    audio.addEventListener(
      "pause",
      function () {

        playing = false;

      }
    );

    audio.addEventListener(
      "error",
      function (event) {

        playing = false;

        console.warn(
          "[FACIAL AUDIO] Erro no ficheiro:",
          currentUrl,
          event
        );

      }
    );

    initialized = true;

    return audio;
  }


  /*
   * ============================================================
   * PARAR
   * ============================================================
   */

  function stop() {

    if (audio) {

      try {

        audio.pause();

        audio.currentTime = 0;

      } catch (error) {

        console.warn(
          "[FACIAL AUDIO] Erro ao parar:",
          error
        );
      }
    }

    playing = false;

    currentPosition = null;

    currentUrl = null;
  }


  /*
   * ============================================================
   * PREPARAR FICHEIRO
   * ============================================================
   */

  function prepare(position) {

    const file =
      AUDIO_FILES[position];

    if (!file) {

      console.warn(
        "[FACIAL AUDIO] Posição desconhecida:",
        position
      );

      return null;
    }

    const url =
      AUDIO_BASE + file;

    const player =
      createAudio();

    if (
      currentUrl !== url
    ) {

      try {

        player.pause();

        player.currentTime = 0;

      } catch (_) {}

      player.src = url;

      player.load();

      currentUrl = url;
    }

    currentPosition =
      position;

    return player;
  }


  /*
   * ============================================================
   * REPRODUZIR MP3
   * ============================================================
   */

  async function playFile(position) {

    if (!enabled) {
      return false;
    }

    const player =
      prepare(position);

    if (!player) {
      return false;
    }

    try {

      player.muted = false;

      player.volume = 1;

      player.currentTime = 0;

      const promise =
        player.play();

      if (
        promise &&
        typeof promise.then ===
          "function"
      ) {

        await promise;
      }

      playing = true;

      console.log(
        "[FACIAL AUDIO] MP3 reproduzido:",
        AUDIO_FILES[position]
      );

      return true;

    } catch (error) {

      playing = false;

      console.warn(
        "[FACIAL AUDIO] O navegador recusou o MP3:",
        position,
        error
      );

      return false;
    }
  }


  /*
   * ============================================================
   * FALLBACK — VOZ DO NAVEGADOR
   * ============================================================
   */

  function speakFallback(position) {

    if (!fallbackEnabled) {
      return false;
    }

    if (
      !("speechSynthesis" in window)
    ) {
      return false;
    }

    if (
      typeof SpeechSynthesisUtterance ===
        "undefined"
    ) {
      return false;
    }

    const text =
      TEXT_FALLBACK[position];

    if (!text) {
      return false;
    }

    try {

      const synthesis =
        window.speechSynthesis;

      synthesis.cancel();

      try {
        synthesis.resume();
      } catch (_) {}

      const utterance =
        new SpeechSynthesisUtterance(
          text
        );

      utterance.lang =
        "pt-PT";

      utterance.rate =
        0.90;

      utterance.pitch =
        1;

      utterance.volume =
        1;

      synthesis.speak(
        utterance
      );

      console.log(
        "[FACIAL AUDIO] Fallback TTS:",
        position
      );

      return true;

    } catch (error) {

      console.warn(
        "[FACIAL AUDIO] TTS falhou:",
        error
      );

      return false;
    }
  }


  /*
   * ============================================================
   * REPRODUZIR POSIÇÃO
   * ============================================================
   */

  async function play(position) {

    if (!position) {
      return false;
    }

    if (
      position === currentPosition &&
      playing
    ) {
      return true;
    }

    stop();

    const played =
      await playFile(position);

    if (played) {
      return true;
    }

    console.warn(
      "[FACIAL AUDIO] Tentando fallback de voz:",
      position
    );

    return speakFallback(
      position
    );
  }


  /*
   * ============================================================
   * INICIAR SESSÃO
   * ============================================================
   *
   * Esta função é chamada pelo clique do utilizador.
   *
   * Portanto o primeiro áudio acontece dentro da
   * interação do utilizador, o que é importante no Android.
   */

  async function start(position) {

    userStartedSession =
      true;

    createAudio();

    const result =
      await play(
        position || "frontal"
      );

    startMonitor();

    return result;
  }


  /*
   * ============================================================
   * MONITOR DO MOTOR FACIAL
   * ============================================================
   *
   * Não alteramos o motor.
   *
   * Apenas verificamos a posição atual através
   * da API pública existente:
   *
   * TravelFacialPreflight.getState()
   *
   * Quando a posição muda:
   *
   * frontal -> left
   * left -> right
   * right -> up
   * ...
   *
   * o áudio correspondente é reproduzido.
   */

  function monitorPosition() {

    if (
      !userStartedSession
    ) {
      return;
    }

    const engine =
      window.TravelFacialPreflight;

    if (!engine) {
      return;
    }

    if (
      typeof engine.getState !==
        "function"
    ) {
      return;
    }

    let state = null;

    try {

      state =
        engine.getState();

    } catch (error) {

      console.warn(
        "[FACIAL AUDIO] Não foi possível obter o estado facial:",
        error
      );

      return;
    }

    const position =
      state?.currentPosition ||
      null;

    if (!position) {
      return;
    }

    if (
      position ===
      lastObservedPosition
    ) {
      return;
    }

    lastObservedPosition =
      position;

    currentPosition =
      position;

    console.log(
      "[FACIAL AUDIO] Nova posição detectada:",
      position
    );

    play(
      position
    );
  }


  /*
   * ============================================================
   * INICIAR MONITOR
   * ============================================================
   */

  function startMonitor() {

    if (monitorTimer) {
      return;
    }

    monitorTimer =
      window.setInterval(
        monitorPosition,
        120
      );
  }


  /*
   * ============================================================
   * PARAR MONITOR
   * ============================================================
   */

  function stopMonitor() {

    if (
      monitorTimer
    ) {

      window.clearInterval(
        monitorTimer
      );

      monitorTimer =
        null;
    }
  }


  /*
   * ============================================================
   * DESBLOQUEAR / PREPARAR
   * ============================================================
   */

  function unlock() {

    createAudio();

    try {

      audio.muted =
        false;

      audio.volume =
        1;

    } catch (error) {

      console.warn(
        "[FACIAL AUDIO] Preparação falhou:",
        error
      );
    }

    return true;
  }


  /*
   * ============================================================
   * CONFIGURAÇÕES
   * ============================================================
   */

  function setEnabled(value) {

    enabled =
      Boolean(value);

    if (!enabled) {

      stop();

      stopMonitor();
    }
  }


  function setFallback(value) {

    fallbackEnabled =
      Boolean(value);
  }


  /*
   * ============================================================
   * ESTADO
   * ============================================================
   */

  function getState() {

    return {

      initialized,

      enabled,

      fallbackEnabled,

      currentPosition,

      lastObservedPosition,

      currentUrl,

      audioReady:
        Boolean(audio),

      playing,

      sessionStarted:
        userStartedSession
    };
  }


  /*
   * ============================================================
   * RESET DA SESSÃO
   * ============================================================
   */

  function resetSession() {

    userStartedSession =
      false;

    lastObservedPosition =
      null;

    currentPosition =
      null;

    stop();

    stopMonitor();
  }


  /*
   * ============================================================
   * EVENTOS DA INTERFACE
   * ============================================================
   *
   * Aqui ligamos diretamente o áudio ao botão
   * existente no facial-preflight-ui.js.
   *
   * Não precisamos alterar aquele ficheiro.
   */

  function attachStartButton() {

    const button =
      document.getElementById(
        "facialPreflightStart"
      );

    if (!button) {

      window.setTimeout(
        attachStartButton,
        250
      );

      return;
    }

    if (
      button.dataset
        .travelFacialAudioBound ===
      "true"
    ) {
      return;
    }

    button.dataset
      .travelFacialAudioBound =
      "true";

    button.addEventListener(
      "click",
      function () {

        /*
         * MUITO IMPORTANTE:
         *
         * Esta chamada acontece diretamente
         * dentro do clique do utilizador.
         */

        start(
          "frontal"
        );

      },
      {
        capture: true
      }
    );

    console.log(
      "[FACIAL AUDIO] Botão de início ligado."
    );
  }


  /*
   * ============================================================
   * BOTÃO PARAR
   * ============================================================
   */

  function attachStopButton() {

    const button =
      document.getElementById(
        "facialPreflightStop"
      );

    if (!button) {

      window.setTimeout(
        attachStopButton,
        250
      );

      return;
    }

    if (
      button.dataset
        .travelFacialAudioBound ===
      "true"
    ) {
      return;
    }

    button.dataset
      .travelFacialAudioBound =
      "true";

    button.addEventListener(
      "click",
      function () {

        resetSession();

      },
      {
        capture: true
      }
    );
  }


  /*
   * ============================================================
   * FECHAR
   * ============================================================
   */

  function attachCloseButton() {

    const button =
      document.getElementById(
        "identityClose"
      );

    if (!button) {

      window.setTimeout(
        attachCloseButton,
        250
      );

      return;
    }

    if (
      button.dataset
        .travelFacialAudioBound ===
      "true"
    ) {
      return;
    }

    button.dataset
      .travelFacialAudioBound =
      "true";

    button.addEventListener(
      "click",
      function () {

        resetSession();

      },
      {
        capture: true
      }
    );
  }


  /*
   * ============================================================
   * INICIALIZAÇÃO
   * ============================================================
   */

  function initialize() {

    createAudio();

    attachStartButton();

    attachStopButton();

    attachCloseButton();

    console.log(
      "[FACIAL AUDIO] Sistema de áudio facial pronto."
    );
  }


  /*
   * ============================================================
   * API GLOBAL
   * ============================================================
   */

  window.TravelFacialAudio = {

    init:
      createAudio,

    unlock,

    start,

    play,

    stop,

    startMonitor,

    stopMonitor,

    resetSession,

    setEnabled,

    setFallback,

    getState,

    files:
      {
        ...AUDIO_FILES
      },

    texts:
      {
        ...TEXT_FALLBACK
      }
  };


  /*
   * ============================================================
   * BOOT
   * ============================================================
   */

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

})();
