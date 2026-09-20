(function () {
  "use strict";

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
    frontal: "Olhe diretamente para a câmera e mantenha o rosto parado.",
    left: "Vire lentamente o rosto para a esquerda.",
    right: "Vire lentamente o rosto para a direita.",
    up: "Levante lentamente o rosto e olhe para cima.",
    down: "Baixe lentamente o rosto e olhe para baixo.",
    left_up: "Vire o rosto para a esquerda e olhe para cima.",
    right_up: "Vire o rosto para a direita e olhe para cima.",
    left_down: "Vire o rosto para a esquerda e olhe para baixo.",
    right_down: "Vire o rosto para a direita e olhe para baixo.",
    smile: "Agora sorria e mantenha o sorriso por alguns segundos."
  };

  let audio = null;
  let initialized = false;
  let enabled = true;
  let fallbackEnabled = true;
  let currentPosition = null;
  let currentUrl = null;

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
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "");

    audio.style.display = "none";

    document.body.appendChild(audio);

    initialized = true;

    return audio;
  }

  function stop() {
    if (!audio) {
      return;
    }

    try {
      audio.pause();
      audio.currentTime = 0;
    } catch (error) {
      console.warn("[FACIAL AUDIO] Não foi possível parar o áudio:", error);
    }

    currentPosition = null;
    currentUrl = null;
  }

  function prepare(position) {
    const file = AUDIO_FILES[position];

    if (!file) {
      return null;
    }

    const url = AUDIO_BASE + file;

    const player = createAudio();

    if (currentUrl !== url) {
      try {
        player.pause();
        player.currentTime = 0;
      } catch (error) {
        console.warn("[FACIAL AUDIO] Erro ao preparar áudio:", error);
      }

      player.src = url;
      player.load();

      currentUrl = url;
    }

    currentPosition = position;

    return player;
  }

  async function playFile(position) {
    if (!enabled) {
      return false;
    }

    const player = prepare(position);

    if (!player) {
      return false;
    }

    try {
      player.muted = false;
      player.volume = 1;
      player.currentTime = 0;

      const playResult = player.play();

      if (playResult && typeof playResult.then === "function") {
        await playResult;
      }

      console.log(
        "[FACIAL AUDIO] Áudio reproduzido:",
        position,
        AUDIO_FILES[position]
      );

      return true;
    } catch (error) {
      console.warn(
        "[FACIAL AUDIO] Reprodução do MP3 falhou:",
        position,
        error
      );

      return false;
    }
  }

  function speakFallback(position) {
    if (!fallbackEnabled) {
      return false;
    }

    if (
      !("speechSynthesis" in window) ||
      typeof window.SpeechSynthesisUtterance === "undefined"
    ) {
      return false;
    }

    const text = TEXT_FALLBACK[position];

    if (!text) {
      return false;
    }

    try {
      const synthesis = window.speechSynthesis;

      synthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);

      utterance.lang = "pt-PT";
      utterance.volume = 1;
      utterance.rate = 0.9;
      utterance.pitch = 1;

      synthesis.speak(utterance);

      return true;
    } catch (error) {
      console.warn(
        "[FACIAL AUDIO] Fallback de voz falhou:",
        error
      );

      return false;
    }
  }

  async function play(position) {
    if (!position) {
      return false;
    }

    stop();

    const played = await playFile(position);

    if (played) {
      return true;
    }

    console.warn(
      "[FACIAL AUDIO] MP3 indisponível. Tentando voz do navegador:",
      position
    );

    return speakFallback(position);
  }

  function start(position) {
    /*
     * Esta função é chamada diretamente a partir do clique
     * do utilizador no botão "Iniciar verificação".
     *
     * Isso é importante no Android porque o navegador pode
     * bloquear reprodução automática fora de uma interação.
     */

    createAudio();

    return play(position);
  }

  function unlock() {
    const player = createAudio();

    try {
      player.muted = false;
      player.volume = 1;
    } catch (error) {
      console.warn(
        "[FACIAL AUDIO] Não foi possível preparar o áudio:",
        error
      );
    }

    return true;
  }

  function setEnabled(value) {
    enabled = Boolean(value);

    if (!enabled) {
      stop();
    }
  }

  function setFallback(value) {
    fallbackEnabled = Boolean(value);
  }

  function getState() {
    return {
      initialized,
      enabled,
      fallbackEnabled,
      currentPosition,
      currentUrl,
      audioReady: Boolean(audio)
    };
  }

  window.TravelFacialAudio = {
    init: createAudio,
    unlock,
    start,
    play,
    stop,
    setEnabled,
    setFallback,
    getState,
    files: { ...AUDIO_FILES },
    texts: { ...TEXT_FALLBACK }
  };

  console.log(
    "[FACIAL AUDIO] Controlador carregado.",
    Object.keys(AUDIO_FILES).length,
    "instruções disponíveis."
  );
})();
