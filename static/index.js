import { createApp, ref } from "./vue.js";

createApp({
  setup() {
    const initialized = ref(false);
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
      initialized.value = true;
    });

    return {
      initialized,
      allMedia,
      activeMedia,
      onMediaClick,
      onAudioEnded,
    };
  },
}).mount("body");
