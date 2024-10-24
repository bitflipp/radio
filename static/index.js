import { createApp, ref } from "./vue.js";

createApp({
  setup() {
    const allMedia = ref();
    const activeMedia = ref();

    function onMediaClick(media) {
      if (activeMedia.value === media) {
        activeMedia.value = undefined;
        return;
      }
      activeMedia.value = media;
    }

    function onAudioEnded() {
      const index = allMedia.value.indexOf(activeMedia.value);
      activeMedia.value =
        index < allMedia.value.length - 1 && allMedia.value[index + 1];
    }

    fetch("/api/media").then((response) => {
      response.json().then((data) => (allMedia.value = data));
    });

    return {
      allMedia,
      activeMedia,
      onMediaClick,
      onAudioEnded,
    };
  },
}).mount("#app");
