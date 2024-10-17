const { createApp, ref } = Vue;

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
      if (index < allMedia.value.length - 1) {
        activeMedia.value = allMedia.value[index + 1];
      }
    }

    fetch("/api/media").then((response) => {
      response.json().then((json) => (allMedia.value = json));
    });

    return {
      allMedia,
      activeMedia,
      onMediaClick,
      onAudioEnded,
    };
  },
}).mount("#app");
