(function () {
  function onFilterInput(event) {
    const term = (event.target.value || "").toLocaleLowerCase();
    for (const tr of document.querySelectorAll("tr.media")) {
      const audio = tr.querySelector("audio");
      tr.classList.toggle(
        "filtered",
        term &&
          !tr.dataset["term"].toLocaleLowerCase().includes(term) &&
          audio.paused
      );
    }
  }

  function onRangeInput(event) {
    for (const audio of document.querySelectorAll("audio")) {
      if (audio.paused) {
        continue;
      }
      audio.currentTime = Math.ceil(
        (event.target.value / 100) * audio.duration
      );
      break;
    }
  }

  function onDocumentKeyDown(event) {
    if (event.key === "f" && event.ctrlKey) {
      event.preventDefault();
      document.querySelector('input[name="filter"]').focus();
    }
  }

  function onTdClick(event) {
    const audio = event.target.parentNode.querySelector("audio");
    if (audio.paused) {
      stopAllExcept(audio);
      audio.play();
    } else {
      audio.pause();
    }
  }

  function stopAllExcept(exceptAudio) {
    for (const audio of document.querySelectorAll("audio")) {
      if (audio !== exceptAudio) {
        audio.pause();
        audio.currentTime = 0;
      }
    }
  }

  function updateControls() {
    const rangeInput = document.querySelector('input[name="range"]');
    rangeInput.value = 0;
    rangeInput.disabled = true;
    const timeInput = document.querySelector('input[name="time"]');
    timeInput.value = "";
    for (const audio of document.querySelectorAll("audio")) {
      const tr = audio.closest("tr");
      if (audio.paused) {
        tr.classList.remove("playing");
        continue;
      }
      rangeInput.value = (audio.currentTime / audio.duration) * 100;
      rangeInput.disabled = false;
      timeInput.value =
        formatDuration(audio.currentTime) +
        "/" +
        formatDuration(audio.duration);
      tr.classList.add("playing");
    }
  }

  function onAudioEnded(event) {
    const nextTr = event.target.closest("tr").nextElementSibling;
    if (nextTr) {
      nextTr.querySelector("audio").play();
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
    document
      .querySelector('input[name="range"]')
      .addEventListener("input", onRangeInput);
    document.addEventListener("keydown", onDocumentKeyDown);
    for (const audio of document.querySelectorAll("audio")) {
      audio.addEventListener("canplay", updateControls);
      audio.addEventListener("play", updateControls);
      audio.addEventListener("pause", updateControls);
      audio.addEventListener("seek", updateControls);
      audio.addEventListener("suspend", updateControls);
      audio.addEventListener("ended", onAudioEnded);
    }
    for (const tr of document.querySelectorAll("tr.media td")) {
      tr.addEventListener("click", onTdClick);
    }
    setInterval(updateControls, 1000);
  });
})();
