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
      const mediaTermLower = (
        media.artist +
        media.album +
        media.title
      ).toLocaleLowerCase();
      return mediaTermLower.includes(filterTerm.value);
    }

    function focusFilterInput() {
      filterInputRef.value.focus();
      filterInputRef.value.select();
    }

    function activateNextMedia() {
      const index = filteredMedia.value.indexOf(activeMedia.value);
      activeMedia.value =
        filteredMedia.value[
          index < filteredMedia.value.length - 1 ? index + 1 : 0
        ];
    }

    function onMediaClick(media) {
      if (activeMedia.value === media) {
        activeMedia.value = undefined;
        return;
      }
      activeMedia.value = media;
      focusFilterInput;
    }

    function onFilterInputKeyDown(event) {
      if (event.key === "Enter") {
        activateNextMedia();
      }
      if (event.key === "Escape") {
        filterTerm.value = "";
      }
    }

    document.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.key === "f") {
        event.preventDefault();
        focusFilterInput();
      }
    });

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
