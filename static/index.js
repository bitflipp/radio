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
        break;
      case "seekBackwards":
        audio.currentTime = Math.max(0, audio.currentTime - 10);
        break;
      case "seekForwards":
        audio.currentTime = Math.min(audio.currentTime + 10, audio.duration);
        break;
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
    for (const audio of document.querySelectorAll("audio")) {
      const tr = audio.closest("tr");
      tr.querySelector("td.time").innerHTML =
        (audio.paused ? "" : formatDuration(audio.currentTime) + "/") +
        formatDuration(audio.duration);
      for (const button of tr.querySelectorAll("button")) {
        const action = button.dataset["action"];
        switch (action) {
          case "toggle":
            button.querySelector("img").src =
              "/static/" + (audio.paused ? "play" : "pause") + ".png";
            break;
          case "seekBackwards":
            button.disabled = audio.paused;
            break;
          case "seekForwards":
            button.disabled = audio.paused;
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
      audio.addEventListener("canplay", updateControls);
      audio.addEventListener("play", updateControls);
      audio.addEventListener("pause", updateControls);
      audio.addEventListener("suspend", updateControls);
      audio.addEventListener("seek", updateControls);
    }
    for (const control of document.querySelectorAll("button")) {
      control.addEventListener("click", onButtonControlClick);
    }
    setInterval(updateControls, 1000);
  });
})();
