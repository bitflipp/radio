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
    const uploadInputRef = useTemplateRef("uploadInput");
    const uploading = ref(false);
    const uploadError = ref("");
    const editingFileName = ref(null);
    const editDraft = ref({ artist: "", album: "", title: "", track: 0, comment: "" });
    const editError = ref("");

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
        const [timestamp, title] = segment.split(";");
        segments.push({ timestamp, title });
      }
      return segments;
    }

    function onMediaClick(media) {
      activeMedia.value = media;
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
      nextTick(() => {
        audioRef.value.currentTime = timestampToSeconds(segment.timestamp);
        audioRef.value.play();
      });
    }

    async function refreshMedia() {
      const response = await fetch("/api/media");
      const data = await response.json();
      const activeFileName = activeMedia.value?.fileName;
      allMedia.value = data;
      if (activeFileName) {
        activeMedia.value = allMedia.value.find((m) => m.fileName === activeFileName);
      }
    }

    async function uploadFiles(files) {
      if (!files || files.length === 0) {
        return;
      }
      uploading.value = true;
      uploadError.value = "";
      const formData = new FormData();
      for (const file of files) {
        formData.append("files", file);
      }
      try {
        const response = await fetch("/api/media", { method: "POST", body: formData });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        await refreshMedia();
      } catch (err) {
        uploadError.value = `Hochladen fehlgeschlagen: ${err.message}`;
      } finally {
        uploading.value = false;
        if (uploadInputRef.value) {
          uploadInputRef.value.value = "";
        }
      }
    }

    function onUploadInputChange(event) {
      uploadFiles(event.target.files);
    }

    function onDrop(event) {
      uploadFiles(event.dataTransfer.files);
    }

    function startEdit(media) {
      editingFileName.value = media.fileName;
      editDraft.value = {
        artist: media.artist,
        album: media.album,
        title: media.title,
        track: media.track,
        comment: media.comment,
      };
      editError.value = "";
    }

    function cancelEdit() {
      editingFileName.value = null;
    }

    async function saveEdit(media) {
      editError.value = "";
      const payload = { ...editDraft.value, track: Number(editDraft.value.track) || 0 };
      try {
        const response = await fetch(`/api/media/${encodeURIComponent(media.fileName)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        Object.assign(media, payload);
        editingFileName.value = null;
      } catch (err) {
        editError.value = `Speichern fehlgeschlagen: ${err.message}`;
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

    refreshMedia().then(() => {
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
      uploading,
      uploadError,
      editingFileName,
      editDraft,
      editError,
      onUploadInputChange,
      onDrop,
      startEdit,
      cancelEdit,
      saveEdit,
    };
  },
}).mount("body");
