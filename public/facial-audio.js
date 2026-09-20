/*
 * ============================================================
 * TRAVEL AUTOMATION
 * ÁUDIO DA VERIFICAÇÃO FACIAL
 * ============================================================
 *
 * Sistema independente do speechSynthesis.
 *
 * PRINCÍPIO:
 *
 * - HTMLAudioElement é o mecanismo principal;
 * - o primeiro áudio é iniciado diretamente pelo clique;
 * - os áudios seguintes são reproduzidos automaticamente;
 * - não depende da voz instalada no Android;
 * - não altera o reconhecimento facial;
 * - speechSynthesis fica apenas como fallback opcional.
 *
 * Ficheiros esperados:
 *
 * /audio/facial/01-frontal.mp3
 * /audio/facial/02-left.mp3
 * /audio/facial/03-right.mp3
 * /audio/facial/04-up.mp3
 * /audio/facial/05-down.mp3
 * /audio/facial/06-left-up.mp3
 * /audio/facial/07-right-up.mp3
 * /audio/facial/08-left-down.mp3
 * /audio/facial/09-right-down.mp3
 * /audio/facial/10-smile.mp3
 *
 * ============================================================
 */

(() => {
  "use strict";

  const AUDIO_BASE = "/audio/facial/";

  const AUDIO_FILES = {
    frontal:
      "01-frontal.mp3",

    left:
      "02-left.mp3",

    right:
      "03-right.mp3",

    up:
      "04-up.mp3",

    down:
      "05-down.mp3",

    left_up:
      "06-left-up.mp3",

    right_up:
      "07-right-up.mp3",

    left_down:
      "08-left-down.mp3",

    right_down:
      "09-right-down.mp3",

    smile:
      "10-smile.mp3"
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


  let audio = null;

  let unlocked = false;

  let currentPosition = null;

  let playing = false;

  let fallbackEnabled = true;


  /*
   * ==========================================================
   * AUDIO ELEMENT
   * ==========================================================
   */

  function createAudio() {
    if (audio) {
      return audio;
    }

    audio = document.createElement("audio");

    audio.preload = "auto";

    audio.autoplay = false;

    audio.controls = false;

    audio.muted = false;

    audio.volume = 1;

    audio.playsInline = true;

    audio.setAttribute(
      "playsinline",
      ""
    );

    audio.setAttribute(
      "webkit-playsinline",
      ""
    );

    audio.style.display = "none";

    document.body.appendChild(
      audio
    );

    audio.addEventListener(
      "play",
      () => {
        playing = true;
      }
    );

    audio.addEventListener(
      "playing",
      () => {
        playing = true;
      }
    );

    audio.addEventListener(
      "pause",
      () => {
        playing = false;
      }
    );

    audio.addEventListener(
      "ended",
      () => {
        playing = false;
      }
    );

    audio.addEventListener(
      "error",
      event => {
        playing = false;

        console.warn(
          "[TravelFacialAudio] Falha no ficheiro de áudio:",
          currentPosition,
          event
        );
      }
    );

    return audio;
  }


  /*
   * ==========================================================
   * CAMINHO
   * ==========================================================
   */

  function getAudioUrl(
    position
  ) {
    const file =
      AUDIO_FILES[position];

    if (!file) {
      return null;
    }

    return (
      AUDIO_BASE +
      file
    );
  }


  /*
   * ==========================================================
   * DESBLOQUEIO
   * ==========================================================
   *
   * Esta função deve ser chamada diretamente pelo clique
   * do utilizador.
   */

  function unlock() {
    const player =
      createAudio();

    try {
      player.pause();

      player.currentTime = 0;

    } catch (_) {}

    unlocked = true;

    console.info(
      "[TravelFacialAudio] Áudio desbloqueado."
    );

    return true;
  }


  /*
   * ==========================================================
   * TESTE REAL DE REPRODUÇÃO
   * ==========================================================
   */

  function playFile(
    position
  ) {
    const player =
      createAudio();

    const url =
      getAudioUrl(
        position
      );

    if (!url) {
      return false;
    }

    currentPosition =
      position;

    try {
      player.pause();

      player.currentTime = 0;

      player.src = url;

      player.load();

    } catch (error) {
      console.error(
        "[TravelFacialAudio] Preparação do áudio:",
        error
      );

      return false;
    }

    const promise =
      player.play();

    if (
      promise &&
      typeof promise.then ===
        "function"
    ) {
      promise
        .then(() => {
          playing = true;

          console.info(
            "[TravelFacialAudio] Reproduzindo:",
            position
          );
        })
        .catch(error => {
          playing = false;

          console.warn(
            "[TravelFacialAudio] Reprodução bloqueada:",
            position,
            error
          );
        });

      return true;
    }

    playing = true;

    return true;
  }


  /*
   * ==========================================================
   * TTS DE RESERVA
   * ==========================================================
   *
   * Não é o mecanismo principal.
   *
   * Se os MP3 existirem, nunca chegamos aqui.
   */

  function speakFallback(
    position
  ) {
    if (
      !fallbackEnabled ||
      !TEXT_FALLBACK[position]
    ) {
      return false;
    }

    if (
      !("speechSynthesis" in window) ||
      typeof SpeechSynthesisUtterance ===
        "undefined"
    ) {
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
          TEXT_FALLBACK[position]
        );

      utterance.lang =
        "pt-PT";

      utterance.rate =
        0.94;

      utterance.pitch =
        1;

      utterance.volume =
        1;

      synthesis.speak(
        utterance
      );

      console.warn(
        "[TravelFacialAudio] A utilizar fallback TTS:",
        position
      );

      return true;

    } catch (error) {
      console.warn(
        "[TravelFacialAudio] Fallback TTS falhou:",
        error
      );

      return false;
    }
  }


  /*
   * ==========================================================
   * REPRODUZIR POSIÇÃO
   * ==========================================================
   */

  function play(
    position
  ) {
    if (!position) {
      return false;
    }

    const normalized =
      String(position);

    const url =
      getAudioUrl(
        normalized
      );

    if (!url) {
      return false;
    }

    const result =
      playFile(
        normalized
      );

    /*
     * Se o navegador bloquear ou o ficheiro
     * não existir, tentamos TTS.
     */

    if (!result) {
      return speakFallback(
        normalized
      );
    }

    return true;
  }


  /*
   * ==========================================================
   * INICIAR SESSÃO
   * ==========================================================
   *
   * É chamado diretamente pelo clique.
   */

  function start(
    firstPosition = "frontal"
  ) {
    unlock();

    /*
     * IMPORTANTE:
     *
     * play() é chamado imediatamente.
     * Não existe await antes dele.
     */

    const played =
      play(
        firstPosition
      );

    if (!played) {
      speakFallback(
        firstPosition
      );
    }

    return played;
  }


  /*
   * ==========================================================
   * PARAR
   * ==========================================================
   */

  function stop() {
    if (audio) {
      try {
        audio.pause();

        audio.currentTime =
          0;

        audio.removeAttribute(
          "src"
        );

        audio.load();

      } catch (_) {}
    }

    playing = false;

    currentPosition =
      null;

    try {
      if (
        "speechSynthesis" in
        window
      ) {
        window
          .speechSynthesis
          .cancel();
      }
    } catch (_) {}
  }


  /*
   * ==========================================================
   * ESTADO
   * ==========================================================
   */

  function getState() {
    return {
      unlocked,
      playing,
      currentPosition,
      fallbackEnabled
    };
  }


  /*
   * ==========================================================
   * CONFIGURAÇÃO
   * ==========================================================
   */

  function setFallback(
    enabled
  ) {
    fallbackEnabled =
      Boolean(enabled);
  }


  /*
   * ==========================================================
   * API
   * ==========================================================
   */

  window.TravelFacialAudio = {
    unlock,

    start,

    play,

    stop,

    getState,

    setFallback,

    positions:
      {
        ...AUDIO_FILES
      },

    texts:
      {
        ...TEXT_FALLBACK
      }
  };


  console.info(
    "[TravelFacialAudio] Sistema de áudio disponível."
  );

})();
