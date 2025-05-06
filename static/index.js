import { createApp, ref, computed, useTemplateRef, nextTick } from "./vue.js";

createApp({
  setup() {
    const initialized = ref(false);
    const allMedia = ref([]);
    const activeMedia = ref();
    const filterTerm = ref("");
    const filteredMedia = computed(() => allMedia.value.filter(filterMedia));
    const filterInputRef = useTemplateRef("filterInput");
    const audioRef = useTemplateRef("audio");

    function filterMedia(media) {
      if (media === activeMedia.value) {
        return true;
      }
      const filterTermLower = filterTerm.value.toLocaleLowerCase();
      if (!filterTermLower) {
        return true;
      }
      const mediaTermLower = (media.artist + media.album + media.title + media.comment).toLocaleLowerCase();
      return mediaTermLower.includes(filterTermLower);
    }

    function focusFilterInput() {
      const filterInput = filterInputRef.value;
      filterInput.focus();
      filterInput.select();
    }

    function activateNextMedia() {
      const index = filteredMedia.value.indexOf(activeMedia.value);
      activeMedia.value = filteredMedia.value[index < filteredMedia.value.length - 1 ? index + 1 : 0];
    }

    function activatePreviousMedia() {
      const index = filteredMedia.value.indexOf(activeMedia.value);
      activeMedia.value = filteredMedia.value[index > 0 ? index - 1 : filteredMedia.value.length - 1];
    }

    function timestampToSeconds(timestamp) {
      return timestamp
        .split(":")
        .reverse()
        .reduce((a, p, i) => a + p * 60 ** i, 0);
    }

    function parseSegments(media) {
      const segments = [];
      const comment = media.comment || "";
      if (!comment) {
        return segments;
      }
      for (const segment of comment.split("\n")) {
        const [timestamp, title] = segment.split("\t");
        segments.push({ timestamp, title });
      }
      return segments;
    }

    function onMediaClick(media) {
      activeMedia.value = media;
      focusFilterInput();
    }

    function onFilterInputKeyDown(event) {
      switch (event.key) {
        case "Enter":
          activateNextMedia();
          break;
        case "Escape":
          filterTerm.value = "";
          break;
      }
    }

    function onSegmentClick(media, segment) {
      activeMedia.value = media;
      focusFilterInput();
      nextTick(() => {
        audioRef.value.currentTime = timestampToSeconds(segment.timestamp);
        audioRef.value.play();
      });
    }

    document.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.key === "f") {
        event.preventDefault();
        focusFilterInput();
      }
    });

    navigator.mediaSession.setActionHandler("previoustrack", activatePreviousMedia);
    navigator.mediaSession.setActionHandler("nexttrack", activateNextMedia);

    fetch("/api/media").then((response) => {
      response.json().then((data) => (allMedia.value = data));
      initialized.value = true;
      nextTick(focusFilterInput);
    });

    return {
      initialized,
      filteredMedia,
      activeMedia,
      filterTerm,
      activateNextMedia,
      parseSegments,
      onMediaClick,
      onFilterInputKeyDown,
      onSegmentClick,
    };
  },
}).mount("body");
