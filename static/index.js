import { createApp, ref, computed, watch, useTemplateRef, nextTick } from "./vue.js";

createApp({
  setup() {
    const initialized = ref(false);
    const allMedia = ref([]);
    const activeMedia = ref();
    const filterTerm = ref("");
    const filteredMedia = computed(() => allMedia.value.filter(filterMedia));
    const mediaCount = computed(() => allMedia.value.length);
    const filterInputRef = useTemplateRef("filterInput");
    const audioRef = useTemplateRef("audio");
    const uploadInputRef = useTemplateRef("uploadInput");
    const uploading = ref(false);
    const editingFileName = ref(null);
    const editDraft = ref({ artist: "", albumArtist: "", album: "", title: "", track: 0, comment: "" });
    const playing = ref(false);
    const currentTime = ref(0);
    const duration = ref(0);
    const volume = ref(loadNumber("radio.volume", 1));
    const muted = ref(false);
    const toasts = ref([]);
    const draggingFiles = ref(false);
    let dragDepth = 0;
    let toastId = 0;

    // Consecutive tracks sharing album artist (falling back to artist) and album form one group; the backend
    // sorts by the same key. Groups whose tracks have differing artists are flagged as mixed.
    const groups = computed(() => {
      const result = [];
      let group;
      for (const media of filteredMedia.value) {
        const artist = albumArtistOf(media);
        const key = artist + "\u0000" + media.album;
        if (!group || group.key !== key) {
          group = { key, artist, album: media.album, mixed: false, items: [] };
          result.push(group);
        }
        if (group.items.length > 0 && group.items[0].artist !== media.artist) {
          group.mixed = true;
        }
        group.items.push(media);
      }
      return result;
    });

    const activeSegments = computed(() => (activeMedia.value ? parseSegments(activeMedia.value) : []));
    const currentSegmentIndex = computed(() => {
      let index = -1;
      activeSegments.value.forEach((segment, i) => {
        if (segment.seconds <= currentTime.value + 0.25) {
          index = i;
        }
      });
      return index;
    });
    const currentSegmentTitle = computed(() => activeSegments.value[currentSegmentIndex.value]?.title || "");
    const progress = computed(() => (duration.value ? (currentTime.value / duration.value) * 100 : 0));

    function loadNumber(key, fallback) {
      try {
        const value = parseFloat(localStorage.getItem(key));
        return Number.isFinite(value) ? value : fallback;
      } catch {
        return fallback;
      }
    }

    function albumArtistOf(media) {
      return media.albumArtist || media.artist;
    }

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
        media.albumArtist +
        media.album +
        media.title +
        media.comment
      ).toLocaleLowerCase();
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

    function togglePlay() {
      const audio = audioRef.value;
      if (!activeMedia.value) {
        activateNextMedia();
      } else if (audio.paused) {
        audio.play();
      } else {
        audio.pause();
      }
    }

    function timestampToSeconds(timestamp) {
      return timestamp
        .split(":")
        .reverse()
        .reduce((a, p, i) => a + p * 60 ** i, 0);
    }

    function formatTime(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) {
        seconds = 0;
      }
      seconds = Math.floor(seconds);
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = String(seconds % 60).padStart(2, "0");
      return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
    }

    function parseSegments(media) {
      const segments = [];
      const comment = media.comment || "";
      if (!comment) {
        return segments;
      }
      for (const segment of comment.split("\n")) {
        if (!segment.trim()) {
          continue;
        }
        if (!segment.includes(";")) {
          segments.push({ timestamp: "", title: segment, seconds: NaN });
          continue;
        }
        const [timestamp, title] = segment.split(";");
        segments.push({ timestamp, title, seconds: timestampToSeconds(timestamp) });
      }
      return segments;
    }

    function hashString(text) {
      let hash = 0;
      for (const char of text) {
        hash = (hash * 31 + char.codePointAt(0)) | 0;
      }
      return Math.abs(hash);
    }

    // Deterministic gradient "album art" derived from artist+album.
    function coverStyle(artist, album) {
      const hash = hashString(`${artist}\u0000${album}`);
      const hue = hash % 360;
      const shift = 40 + (hash % 80);
      const angle = (hash >> 3) % 360;
      return {
        background: `linear-gradient(${angle}deg, hsl(${hue} 85% 60%), hsl(${(hue + shift) % 360} 75% 38%))`,
      };
    }

    function initials(text) {
      const words = (text || "?").split(/\s+/).filter((w) => /\p{L}|\p{N}/u.test(w));
      return words
        .slice(0, 2)
        .map((w) => w.match(/[\p{L}\p{N}]/u)[0])
        .join("")
        .toLocaleUpperCase();
    }

    function showToast(kind, text) {
      const toast = { id: ++toastId, kind, text };
      toasts.value.push(toast);
      setTimeout(() => dismissToast(toast), kind === "error" ? 10000 : 4000);
    }

    function dismissToast(toast) {
      toasts.value = toasts.value.filter((t) => t.id !== toast.id);
    }

    function onMediaClick(media) {
      if (activeMedia.value === media) {
        togglePlay();
      } else {
        activeMedia.value = media;
      }
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
      if (!Number.isFinite(segment.seconds)) {
        return;
      }
      nextTick(() => {
        audioRef.value.currentTime = segment.seconds;
        audioRef.value.play();
      });
    }

    function onTimeUpdate() {
      currentTime.value = audioRef.value.currentTime;
    }

    function onDurationChange() {
      duration.value = audioRef.value.duration || 0;
    }

    function onSeek(event) {
      const time = Number(event.target.value);
      audioRef.value.currentTime = time;
      currentTime.value = time;
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
        showToast("success", files.length === 1 ? "1 Datei hochgeladen." : `${files.length} Dateien hochgeladen.`);
      } catch (err) {
        showToast("error", `Hochladen fehlgeschlagen: ${err.message}`);
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

    function startEdit(media) {
      editingFileName.value = media.fileName;
      editDraft.value = {
        artist: media.artist,
        albumArtist: media.albumArtist,
        album: media.album,
        title: media.title,
        track: media.track,
        comment: media.comment,
      };
      nextTick(() => document.querySelector(".editor .f-title input")?.focus());
    }

    function cancelEdit() {
      editingFileName.value = null;
    }

    function onEditorKeyDown(event, media) {
      if (event.key === "Escape") {
        cancelEdit();
      } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        saveEdit(media);
      }
    }

    async function saveEdit(media) {
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
        editingFileName.value = null;
        // Refetch rather than patching locally: album changes can move the track to another group.
        await refreshMedia();
        showToast("success", "Gespeichert.");
      } catch (err) {
        showToast("error", `Speichern fehlgeschlagen: ${err.message}`);
      }
    }

    function hasFiles(event) {
      return event.dataTransfer && Array.from(event.dataTransfer.types).includes("Files");
    }

    window.addEventListener("dragenter", (event) => {
      if (hasFiles(event)) {
        dragDepth++;
        draggingFiles.value = true;
      }
    });
    window.addEventListener("dragleave", (event) => {
      if (hasFiles(event) && --dragDepth <= 0) {
        dragDepth = 0;
        draggingFiles.value = false;
      }
    });
    window.addEventListener("dragover", (event) => {
      if (hasFiles(event)) {
        event.preventDefault();
      }
    });
    window.addEventListener("drop", (event) => {
      if (!hasFiles(event)) {
        return;
      }
      event.preventDefault();
      dragDepth = 0;
      draggingFiles.value = false;
      uploadFiles(event.dataTransfer.files);
    });

    document.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.key === "f") {
        event.preventDefault();
        focusFilterInput();
        return;
      }
      const tag = event.target.tagName;
      if (event.key === " " && !["INPUT", "TEXTAREA", "BUTTON", "SELECT"].includes(tag)) {
        event.preventDefault();
        togglePlay();
      }
    });

    watch(volume, (value) => {
      audioRef.value.volume = value;
      try {
        localStorage.setItem("radio.volume", String(value));
      } catch {}
    });
    watch(muted, (value) => {
      audioRef.value.muted = value;
    });

    watch(activeMedia, (media) => {
      currentTime.value = 0;
      duration.value = 0;
      if (!media) {
        document.title = "Radio Go Go";
        return;
      }
      document.title = `${media.title} · Radio Go Go`;
      if ("MediaMetadata" in window) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: media.title,
          artist: media.artist,
          album: media.album,
        });
      }
      nextTick(() => document.querySelector(".track.active")?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    });

    navigator.mediaSession.setActionHandler("previoustrack", activatePreviousMedia);
    navigator.mediaSession.setActionHandler("nexttrack", activateNextMedia);

    refreshMedia().then(() => {
      initialized.value = true;
      nextTick(() => {
        audioRef.value.volume = volume.value;
        focusFilterInput();
      });
    });

    return {
      initialized,
      filteredMedia,
      mediaCount,
      groups,
      activeMedia,
      activeSegments,
      currentSegmentIndex,
      currentSegmentTitle,
      filterTerm,
      playing,
      currentTime,
      duration,
      progress,
      volume,
      muted,
      toasts,
      draggingFiles,
      activateNextMedia,
      activatePreviousMedia,
      togglePlay,
      formatTime,
      parseSegments,
      coverStyle,
      initials,
      dismissToast,
      onMediaClick,
      onFilterInputKeyDown,
      onSegmentClick,
      onTimeUpdate,
      onDurationChange,
      onSeek,
      uploading,
      editingFileName,
      editDraft,
      onUploadInputChange,
      startEdit,
      cancelEdit,
      onEditorKeyDown,
      saveEdit,
    };
  },
}).mount("body");
