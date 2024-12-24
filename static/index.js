import { createApp, ref, computed, useTemplateRef, nextTick } from "./vue.js";

createApp({
  setup() {
    const initialized = ref(false);
    const allMedia = ref([]);
    const activeMedia = ref();
    const filterTerm = ref("");
    const filteredMedia = computed(() => allMedia.value.filter(filterMedia));
    const filterInputRef = useTemplateRef("filterInput");

    function filterMedia(media) {
      if (media === activeMedia.value) {
        return true;
      }
      const filterTermLower = filterTerm.value.toLocaleLowerCase();
      if (!filterTermLower) {
        return true;
      }
      const mediaTermLower = (media.artist + media.album + media.title).toLocaleLowerCase();
      return mediaTermLower.includes(filterTerm.value);
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

    function onMediaClick(media) {
      activeMedia.value = activeMedia.value === media ? undefined : media;
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
      onMediaClick,
      onFilterInputKeyDown,
    };
  },
}).mount("body");
