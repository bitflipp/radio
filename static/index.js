(function () {
  let updateControlsInterval;

  function onFilterInput(event) {
    const term = (event.target.value || "").toLocaleLowerCase();
    for (const tr of document.querySelectorAll("tr.media")) {
      tr.classList.toggle(
        "highlight",
        term && tr.dataset["term"].toLocaleLowerCase().includes(term)
      );
    }
  }

  function onDocumentKeyDown(event) {
    if (event.key === "f" && event.ctrlKey) {
      event.preventDefault();
      document.querySelector('input[name="filter"]').focus();
    }
  }

  function onButtonControlClick(event) {
    const element = event.target;
    const tr = element.closest("tr");
    const audio = tr.querySelector("audio");
    const action = event.target.dataset["action"];
    switch (action) {
      case "toggle":
        if (audio.paused) {
          stopAllExcept(audio);
          audio.play();
        } else {
          audio.pause();
        }
        updateControls();
        break;
    }
  }

  function onAudioCanPlay() {
    updateControls();
  }

  function onAudioPlay() {
    updateControls();
    updateControlsInterval = setInterval(updateControls, 1000);
  }

  function onAudioPause() {
    clearTimeout(updateControlsInterval);
  }

  function stopAllExcept(exceptAudio) {
    for (const audio of document.querySelectorAll("audio")) {
      if (audio !== exceptAudio) {
        audio.pause();
        audio.currentTime = 0;
      }
    }
    updateControls();
  }

  function updateControls() {
    for (const audio of document.querySelectorAll("audio")) {
      const tr = audio.closest("tr");
      tr.querySelector("td.time").innerHTML =
        (audio.paused ? "" : formatDuration(audio.currentTime) + "/") +
        formatDuration(audio.duration);
      for (const button of tr.querySelectorAll("button")) {
        const action = button.dataset["action"];
        switch (action) {
          case "toggle":
            button.innerHTML = audio.paused ? "[Play]" : "[Pause]";
            break;
        }
      }
    }
  }

  function leftPadWithZeroes(value, length) {
    while (value.length < (length || 2)) {
      value = "0" + value;
    }
    return value;
  }

  function formatDuration(value) {
    const minutes = "" + Math.floor(value / 60);
    const seconds = "" + Math.floor(value % 60);
    return leftPadWithZeroes(minutes) + ":" + leftPadWithZeroes(seconds);
  }

  document.addEventListener("DOMContentLoaded", function () {
    document
      .querySelector('input[name="filter"]')
      .addEventListener("input", onFilterInput);
    document.addEventListener("keydown", onDocumentKeyDown);
    for (const audio of document.querySelectorAll("audio")) {
      audio.addEventListener("canplay", onAudioCanPlay);
      audio.addEventListener("play", onAudioPlay);
      audio.addEventListener("pause", onAudioPause);
    }
    for (const control of document.querySelectorAll("button")) {
      control.addEventListener("click", onButtonControlClick);
    }
  });
})();
