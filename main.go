package main

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/bogem/id3v2/v2"
	"github.com/dhowden/tag"

	"phinau.de/radiogogo/chapters"
	"phinau.de/radiogogo/vorbis"
)

const (
	address       = "127.0.0.1:1984"
	mediaRoot     = "./media"
	maxUploadSize = 100 << 20 // 100 MiB per request
)

var (
	//go:embed static
	staticFS embed.FS
)

type media struct {
	Album       string             `json:"album"`
	AlbumArtist string             `json:"albumArtist"`
	Artist      string             `json:"artist"`
	Title       string             `json:"title"`
	Track       int                `json:"track"`
	FileName    string             `json:"fileName"`
	Comment     string             `json:"comment"`
	Chapters    []chapters.Chapter `json:"chapters"`
	Size        int64              `json:"size"`
}

// audioExts lists the accepted upload formats; the sniff func checks the file's magic bytes.
var audioExts = map[string]func(head []byte) bool{
	".mp3":  func(b []byte) bool { return http.DetectContentType(b) == "audio/mpeg" },
	".ogg":  isOgg,
	".oga":  isOgg,
	".opus": isOgg,
	".flac": func(b []byte) bool { return bytes.HasPrefix(b, []byte("fLaC")) },
}

func isOgg(b []byte) bool { return bytes.HasPrefix(b, []byte("OggS")) }

func isID3(fileName string) bool { return strings.ToLower(filepath.Ext(fileName)) == ".mp3" }

func readChapters(filePath string) []chapters.Chapter {
	if !isID3(filePath) {
		c, err := vorbis.Read(filePath)
		if err != nil {
			return []chapters.Chapter{}
		}
		return chapters.ReadVorbis(c)
	}
	t, err := id3v2.Open(filePath, id3v2.Options{Parse: true, ParseFrames: []string{"Chapters"}})
	if err != nil {
		return []chapters.Chapter{}
	}
	defer t.Close()
	return chapters.Read(t)
}

func readSingleMedia(fileName string) (media, error) {
	mfp := path.Join(mediaRoot, fileName)
	mf, err := os.Open(mfp)
	if err != nil {
		return media{}, fmt.Errorf("failed to open media file: %w", err)
	}
	defer mf.Close()
	var size int64
	if fi, err := mf.Stat(); err == nil {
		size = fi.Size()
	}
	t, err := tag.ReadFrom(mf)
	if err != nil {
		return media{
			Title:    fmt.Sprintf("[%s]", fileName),
			FileName: fileName,
			Chapters: []chapters.Chapter{},
			Size:     size,
		}, nil
	}
	d, _ := t.Track()
	return media{
		Album:       t.Album(),
		AlbumArtist: t.AlbumArtist(),
		Artist:      t.Artist(),
		Title:       t.Title(),
		Track:       d,
		FileName:    fileName,
		Comment:     t.Comment(),
		Chapters:    readChapters(mfp),
		Size:        size,
	}, nil
}

func readMedia() ([]media, error) {
	fs, err := os.ReadDir(mediaRoot)
	if err != nil {
		return nil, fmt.Errorf("failed to read directory: %w", err)
	}
	ms := make([]media, len(fs))
	for i, f := range fs {
		m, err := readSingleMedia(f.Name())
		if err != nil {
			return nil, err
		}
		ms[i] = m
	}
	sort.Slice(ms, func(i, j int) bool {
		ai, aj := ms[i].albumKey(), ms[j].albumKey()
		if ai != aj {
			return ai < aj
		}
		if ms[i].Track != ms[j].Track {
			return ms[i].Track < ms[j].Track
		}
		return ms[i].Artist < ms[j].Artist
	})
	return ms, nil
}

// albumKey identifies the album a track belongs to: the album artist (falling back to the track
// artist) plus the album name, so compilations with per-track artists stay together.
func (m media) albumKey() string {
	artist := m.AlbumArtist
	if artist == "" {
		artist = m.Artist
	}
	return artist + "\x00" + m.Album
}

func handleAPIMedia(w http.ResponseWriter, r *http.Request) {
	ms, err := readMedia()
	if err != nil {
		log.Printf("failed to read media: %s", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(ms)
}

func saveUploadedFile(fh *multipart.FileHeader) (media, error) {
	name := filepath.Base(filepath.Clean(fh.Filename))
	ext := strings.ToLower(filepath.Ext(name))
	sniff, ok := audioExts[ext]
	if !ok {
		return media{}, fmt.Errorf("unsupported file type (expected MP3, OGG, OPUS or FLAC)")
	}

	src, err := fh.Open()
	if err != nil {
		return media{}, fmt.Errorf("failed to open upload: %w", err)
	}
	defer src.Close()

	var head [512]byte
	n, _ := io.ReadFull(src, head[:])
	if !sniff(head[:n]) {
		return media{}, fmt.Errorf("file content does not match its %s extension", ext)
	}
	if _, err := src.Seek(0, io.SeekStart); err != nil {
		return media{}, fmt.Errorf("failed to rewind upload: %w", err)
	}

	// The file name is a content hash, not the uploaded name: it's an opaque identifier that
	// never needs to change, since tag edits rewrite the file in place rather than re-uploading
	// it. A hash collision means byte-identical content was already uploaded.
	h := sha256.New()
	if _, err := io.Copy(h, src); err != nil {
		return media{}, fmt.Errorf("failed to hash upload: %w", err)
	}
	if _, err := src.Seek(0, io.SeekStart); err != nil {
		return media{}, fmt.Errorf("failed to rewind upload: %w", err)
	}

	destName := hex.EncodeToString(h.Sum(nil)) + ext
	dst, err := os.OpenFile(path.Join(mediaRoot, destName), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		if os.IsExist(err) {
			return media{}, fmt.Errorf("duplicate file already exists")
		}
		return media{}, fmt.Errorf("failed to create file: %w", err)
	}
	defer dst.Close()
	if _, err := io.Copy(dst, src); err != nil {
		os.Remove(path.Join(mediaRoot, destName))
		return media{}, fmt.Errorf("failed to write file: %w", err)
	}

	return readSingleMedia(destName)
}

func handleAPIMediaUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		log.Printf("failed to parse upload: %s", err)
		http.Error(w, "invalid upload", http.StatusBadRequest)
		return
	}
	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		http.Error(w, "no files provided", http.StatusBadRequest)
		return
	}
	uploaded := make([]media, 0, len(files))
	for _, fh := range files {
		m, err := saveUploadedFile(fh)
		if err != nil {
			log.Printf("failed to save uploaded file %q: %s", fh.Filename, err)
			http.Error(w, fmt.Sprintf("%s: %s", fh.Filename, err), http.StatusBadRequest)
			return
		}
		uploaded = append(uploaded, m)
	}
	json.NewEncoder(w).Encode(uploaded)
}

type mediaPatch struct {
	Artist      string             `json:"artist"`
	AlbumArtist string             `json:"albumArtist"`
	Album       string             `json:"album"`
	Title       string             `json:"title"`
	Track       int                `json:"track"`
	Comment     string             `json:"comment"`
	Chapters    []chapters.Chapter `json:"chapters"`
	// Duration in seconds, as measured by the client; the end time of the last chapter.
	Duration float64 `json:"duration"`
}

func writeTags(filePath string, p mediaPatch) error {
	if !isID3(filePath) {
		return writeVorbisTags(filePath, p)
	}
	return writeID3Tags(filePath, p)
}

func writeVorbisTags(filePath string, p mediaPatch) error {
	return vorbis.Update(filePath, func(c *vorbis.Comments) error {
		c.Set("ARTIST", p.Artist)
		c.Set("ALBUMARTIST", p.AlbumArtist)
		c.Set("ALBUM", p.Album)
		c.Set("TITLE", p.Title)
		track := ""
		if p.Track > 0 {
			track = strconv.Itoa(p.Track)
		}
		c.Set("TRACKNUMBER", track)
		// dhowden/tag prefers COMMENT but falls back to DESCRIPTION, so clear both to avoid resurrecting an old one.
		c.Set("DESCRIPTION", "")
		c.Set("COMMENT", p.Comment)
		return chapters.SetVorbis(c, p.Chapters)
	})
}

func writeID3Tags(filePath string, p mediaPatch) error {
	t, err := id3v2.Open(filePath, id3v2.Options{Parse: true})
	if err != nil {
		return fmt.Errorf("failed to open tag: %w", err)
	}
	defer t.Close()

	t.SetArtist(p.Artist)
	t.SetAlbum(p.Album)
	albumArtistID := t.CommonID("Band/Orchestra/Accompaniment")
	t.DeleteFrames(albumArtistID)
	if p.AlbumArtist != "" {
		t.AddTextFrame(albumArtistID, t.DefaultEncoding(), p.AlbumArtist)
	}
	t.SetTitle(p.Title)
	t.AddTextFrame(t.CommonID("Track number/Position in set"), t.DefaultEncoding(), strconv.Itoa(p.Track))

	t.DeleteFrames(t.CommonID("Comments"))
	if p.Comment != "" {
		t.AddCommentFrame(id3v2.CommentFrame{
			Encoding:    id3v2.EncodingUTF8,
			Language:    "eng",
			Description: "",
			Text:        p.Comment,
		})
	}

	if err := chapters.Set(t, p.Chapters, p.Duration); err != nil {
		return err
	}

	return t.Save()
}

func handleAPIMediaPatch(w http.ResponseWriter, r *http.Request) {
	fileName := r.PathValue("fileName")
	if fileName == "" || fileName != filepath.Base(fileName) || fileName == ".." {
		http.Error(w, "invalid file name", http.StatusBadRequest)
		return
	}
	filePath := path.Join(mediaRoot, fileName)
	if _, err := os.Stat(filePath); err != nil {
		http.Error(w, "file not found", http.StatusNotFound)
		return
	}

	var p mediaPatch
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if err := writeTags(filePath, p); err != nil {
		log.Printf("failed to write tags for %q: %s", fileName, err)
		http.Error(w, "failed to write tags", http.StatusInternalServerError)
		return
	}

	m, err := readSingleMedia(fileName)
	if err != nil {
		log.Printf("failed to re-read media after tag write: %s", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(m)
}

func main() {
	if err := os.MkdirAll(mediaRoot, 0o755); err != nil {
		log.Fatalf("failed to ensure media directory: %s", err)
	}
	http.HandleFunc("GET /api/media", handleAPIMedia)
	http.HandleFunc("POST /api/media", handleAPIMediaUpload)
	http.HandleFunc("PATCH /api/media/{fileName}", handleAPIMediaPatch)
	http.Handle("/media/", http.StripPrefix("/media/", http.FileServer(http.Dir(mediaRoot))))
	sfs, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatalf("failed to create subtree: %s", err)
	}
	// The embedded files carry no modification time, so browsers can't revalidate them; no-cache makes them
	// refetch the (small) frontend on every load instead of guessing a freshness lifetime.
	staticHandler := http.FileServerFS(sfs)
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		staticHandler.ServeHTTP(w, r)
	})
	if err := http.ListenAndServe(address, nil); err != nil {
		log.Fatalf("failed to listen and serve: %s", err)
	}
}
