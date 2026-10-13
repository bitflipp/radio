import { createApp, ref, computed, watch, useTemplateRef, nextTick } from "./vue.js";

const AUDIO_CACHE = "radio-audio"; // keep in sync with sw.js

createApp({
  setup() {
    const initialized = ref(false);
    const allMedia = ref([]);
    const activeMedia = ref();
    const filterTerm = ref("");
    const filteredMedia = computed(() => allMedia.value.filter(filterMedia));
    const mediaCount = computed(() => allMedia.value.length);
    const storageUsed = computed(() => {
      const bytes = allMedia.value.reduce((sum, m) => sum + (offlineFiles.value.has(m.fileName) ? m.size || 0 : 0), 0);
      if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2).replace(".", ",")} GB`;
      return `${Math.round(bytes / 1e6).toLocaleString("de-DE")} MB`;
    });
    const filterInputRef = useTemplateRef("filterInput");
    const audioRef = useTemplateRef("audio");
    const uploadInputRef = useTemplateRef("uploadInput");
    const uploading = ref(false);
    const editingFileName = ref(null);
    const hoverSuppressed = ref(false);
    const editDraft = ref({ artist: "", albumArtist: "", album: "", title: "", track: 0, comment: "", chapters: [] });
    const playing = ref(false);
    const currentTime = ref(0);
    const duration = ref(0);
    const volume = ref(loadNumber("radio.volume", 1));
    const muted = ref(false);
    const toasts = ref([]);
    const draggingFiles = ref(false);
    const online = ref(navigator.onLine);
    // File names of tracks saved for offline playback (in the Cache API, served by sw.js) and of those being saved.
    const offlineFiles = ref(new Set());
    const savingFiles = ref(new Set());
    let dragDepth = 0;
    let toastId = 0;
    let chapterKey = 0;

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

    const activeChapters = computed(() => activeMedia.value?.chapters || []);
    const currentChapterIndex = computed(() => {
      let index = -1;
      activeChapters.value.forEach((chapter, i) => {
        if (chapter.start <= currentTime.value + 0.25) {
          index = i;
        }
      });
      return index;
    });
    const currentChapterTitle = computed(() => activeChapters.value[currentChapterIndex.value]?.title || "");
    const progress = computed(() => (duration.value ? (currentTime.value / duration.value) * 100 : 0));

    function loadNumber(key, fallback) {
      try {
        const value = parseFloat(localStorage.getItem(key));
        return Number.isFinite(value) ? value : fallback;
      } catch {
        return fallback;
      }
    }

    function mediaURL(media) {
      return `/media/${encodeURIComponent(media.fileName)}`;
    }

    function albumArtistOf(media) {
      return media.albumArtist || media.artist;
    }

    function filterMedia(media) {
      if (media === activeMedia.value) {
        return true;
      }
      if (!online.value && !offlineFiles.value.has(media.fileName)) {
        return false;
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
        media.comment +
        media.chapters.map((c) => c.title).join("")
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

    // Parses "SS", "MM:SS" or "HH:MM:SS"; NaN if malformed.
    function timestampToSeconds(timestamp) {
      const parts = timestamp.trim().split(":");
      if (parts.length > 3 || !parts.every((p) => /^\d+$/.test(p))) {
        return NaN;
      }
      return parts.reduce((a, p) => a * 60 + Number(p), 0);
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

    // In the editor, chapters are rows with a free-text time ("H:MM:SS", "MM:SS" or "SS") and a title.
    function draftChapter(start, title) {
      return { key: ++chapterKey, time: Number.isFinite(start) ? formatTime(start) : "", title };
    }

    function isDraftChapterEmpty(chapter) {
      return !chapter.time.trim() && !chapter.title.trim();
    }

    function isDraftChapterValid(chapter) {
      return isDraftChapterEmpty(chapter) || Number.isFinite(timestampToSeconds(chapter.time));
    }

    function focusDraftChapter(chapter, field) {
      nextTick(() => document.querySelector(`[data-chapter="${chapter.key}"] .${field}`)?.focus());
    }

    // Adds a row at the current playback position (kept in time order) if the track is playing, otherwise an
    // empty row at the end.
    function addDraftChapter(media) {
      const chapters = editDraft.value.chapters;
      if (media !== activeMedia.value) {
        const chapter = draftChapter(NaN, "");
        chapters.push(chapter);
        focusDraftChapter(chapter, "c-time");
        return;
      }
      const chapter = draftChapter(currentTime.value, "");
      const index = chapters.findIndex((c) => timestampToSeconds(c.time) > currentTime.value);
      chapters.splice(index < 0 ? chapters.length : index, 0, chapter);
      focusDraftChapter(chapter, "c-title");
    }

    function removeDraftChapter(chapter) {
      editDraft.value.chapters = editDraft.value.chapters.filter((c) => c !== chapter);
    }

    function setDraftChapterToNow(chapter) {
      chapter.time = formatTime(currentTime.value);
    }

    function addChapterAtCurrentPosition() {
      const media = activeMedia.value;
      if (!media) {
        return;
      }
      if (editingFileName.value !== media.fileName) {
        startEdit(media);
      }
      addDraftChapter(media);
    }

    function parseDraftChapters(chapters) {
      return chapters
        .filter((c) => !isDraftChapterEmpty(c))
        .map((c) => {
          const start = timestampToSeconds(c.time);
          if (!Number.isFinite(start)) {
            focusDraftChapter(c, "c-time");
            throw new Error(`ungültige Zeit „${c.time}“`);
          }
          return { start, title: c.title.trim() };
        })
        .sort((a, b) => a.start - b.start);
    }

    // The duration is the end time of the last chapter. Use the player's if this track is loaded, otherwise
    // load just the file's metadata.
    function mediaDuration(media) {
      if (media === activeMedia.value && duration.value) {
        return Promise.resolve(duration.value);
      }
      return new Promise((resolve, reject) => {
        const audio = new Audio();
        audio.preload = "metadata";
        audio.onloadedmetadata = () => resolve(audio.duration);
        audio.onerror = () => reject(new Error("Dauer konnte nicht ermittelt werden"));
        audio.src = mediaURL(media);
      });
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

    function onChapterClick(media, chapter) {
      activeMedia.value = media;
      nextTick(() => {
        audioRef.value.currentTime = chapter.start;
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

    async function loadOfflineFiles() {
      try {
        const cache = await caches.open(AUDIO_CACHE);
        const requests = await cache.keys();
        offlineFiles.value = new Set(requests.map((r) => decodeURIComponent(new URL(r.url).pathname.slice("/media/".length))));
      } catch {}
    }

    // Drops saved copies of tracks that no longer exist on the server.
    async function pruneOfflineFiles(data) {
      const fileNames = new Set(data.map((m) => m.fileName));
      try {
        const cache = await caches.open(AUDIO_CACHE);
        for (const fileName of offlineFiles.value) {
          if (!fileNames.has(fileName)) {
            await cache.delete(mediaURL({ fileName }));
            offlineFiles.value.delete(fileName);
          }
        }
      } catch {}
    }

    // Re-downloads saved tracks whose file changed on the server (tag edits rewrite files in place). The Go file
    // server sends Last-Modified but no ETag, so that is the validator compared.
    async function revalidateOfflineFiles() {
      try {
        const cache = await caches.open(AUDIO_CACHE);
        for (const fileName of [...offlineFiles.value]) {
          const url = mediaURL({ fileName });
          const cached = await cache.match(url);
          const head = await fetch(`${url}?revalidate`, { method: "HEAD", cache: "no-cache" });
          if (!cached || !head.ok) {
            continue;
          }
          const validator = (r) => r.headers.get("ETag") || r.headers.get("Last-Modified");
          if (validator(head) === validator(cached)) {
            continue;
          }
          const response = await fetch(`${url}?revalidate`, { cache: "no-cache" });
          if (response.ok) {
            await cache.put(url, response);
          }
        }
      } catch {}
    }

    async function toggleOffline(media) {
      const fileName = media.fileName;
      if (savingFiles.value.has(fileName)) {
        return;
      }
      try {
        const cache = await caches.open(AUDIO_CACHE);
        if (offlineFiles.value.has(fileName)) {
          await cache.delete(mediaURL(media));
          offlineFiles.value.delete(fileName);
          return;
        }
        savingFiles.value.add(fileName);
        navigator.storage?.persist?.();
        const response = await fetch(mediaURL(media));
        if (!response.ok) {
          throw new Error(await response.text());
        }
        await cache.put(mediaURL(media), response);
        offlineFiles.value.add(fileName);
      } catch (err) {
        showToast("error", `Offline speichern fehlgeschlagen: ${err.message}`);
      } finally {
        savingFiles.value.delete(fileName);
      }
    }

    async function refreshMedia() {
      const response = await fetch("/api/media");
      const data = await response.json();
      if (navigator.onLine) {
        pruneOfflineFiles(data).then(revalidateOfflineFiles);
      }
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
        chapters: media.chapters.map((c) => draftChapter(c.start, c.title)),
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
      try {
        const chapters = parseDraftChapters(editDraft.value.chapters);
        const payload = {
          ...editDraft.value,
          track: Number(editDraft.value.track) || 0,
          chapters,
          duration: chapters.length ? await mediaDuration(media) : 0,
        };
        const response = await fetch(`/api/media/${encodeURIComponent(media.fileName)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        editingFileName.value = null;
        // The pointer is still where the save button was, so the row below it would look hovered (play icon)
        // until the mouse moves.
        hoverSuppressed.value = true;
        window.addEventListener("mousemove", () => (hoverSuppressed.value = false), { once: true });
        // Refetch rather than patching locally: album changes can move the track to another group.
        await refreshMedia();
        toasts.value = toasts.value.filter((t) => t.kind !== "error");
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

    window.addEventListener("online", () => (online.value = true));
    window.addEventListener("offline", () => (online.value = false));

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

    watch(activeMedia, (media, previous) => {
      // A refetch (e.g. after saving tags) replaces the object but keeps the file playing.
      if (media?.fileName !== previous?.fileName) {
        currentTime.value = 0;
        duration.value = 0;
      }
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

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    loadOfflineFiles().then(refreshMedia).then(() => {
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
      storageUsed,
      groups,
      activeMedia,
      activeChapters,
      currentChapterIndex,
      currentChapterTitle,
      filterTerm,
      playing,
      currentTime,
      duration,
      progress,
      volume,
      muted,
      toasts,
      draggingFiles,
      online,
      offlineFiles,
      savingFiles,
      mediaURL,
      toggleOffline,
      activateNextMedia,
      activatePreviousMedia,
      togglePlay,
      formatTime,
      coverStyle,
      initials,
      dismissToast,
      onMediaClick,
      onFilterInputKeyDown,
      onChapterClick,
      onTimeUpdate,
      onDurationChange,
      onSeek,
      uploading,
      editingFileName,
      hoverSuppressed,
      editDraft,
      onUploadInputChange,
      startEdit,
      cancelEdit,
      onEditorKeyDown,
      saveEdit,
      isDraftChapterValid,
      addDraftChapter,
      removeDraftChapter,
      setDraftChapterToNow,
      addChapterAtCurrentPosition,
    };
  },
}).mount("body");
