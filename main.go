package main

import (
	"embed"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"os"
	"path"
	"sort"

	"github.com/dhowden/tag"
)

const (
	address   = ":1984"
	mediaRoot = "./media"
)

var (
	htmlTemplate *template.Template
	//go:embed templates
	templateFS embed.FS
	//go:embed static
	staticFS embed.FS
)

type media struct {
	filePath string
	FileName string
	Album    string
	Artist   string
	Title    string
	Length   string
	Track    int
}

func readMedia() ([]media, error) {
	fs, err := os.ReadDir(mediaRoot)
	if err != nil {
		return nil, fmt.Errorf("failed to read directory: %w", err)
	}
	ms := make([]media, len(fs))
	for i, f := range fs {
		mfp := path.Join(mediaRoot, f.Name())
		mf, err := os.Open(mfp)
		if err != nil {
			return nil, fmt.Errorf("failed to open media file: %w", err)
		}
		defer mf.Close()
		t, err := tag.ReadFrom(mf)
		if err != nil {
			return nil, fmt.Errorf("failed to read tags from media file: %w", err)
		}
		d, _ := t.Track()
		ms[i] = media{
			FileName: f.Name(),
			Album:    t.Album(),
			Artist:   t.Artist(),
			Title:    t.Title(),
			Track:    d,
		}
	}
	sort.Slice(ms, func(i, j int) bool {
		ti := ms[i].Artist + ms[i].Album
		tj := ms[j].Artist + ms[j].Album
		if ti == tj {
			return ms[i].Track < ms[j].Track
		}
		return ti < tj
	})
	return ms, nil
}

func handleIndex(w http.ResponseWriter, r *http.Request) {
	ms, err := readMedia()
	if err != nil {
		log.Printf("failed to read media: %s", err)
		http.Error(w, "failed to read media", http.StatusInternalServerError)
		return
	}
	if err := htmlTemplate.Execute(w, ms); err != nil {
		log.Printf("failed to execute index template: %s", err)
		http.Error(w, "failed execute index template", http.StatusInternalServerError)
		return
	}
}

func main() {
	var err error
	htmlTemplate, err = template.ParseFS(templateFS, "templates/*.gohtml")
	if err != nil {
		log.Fatalf("failed to parse index template: %s", err)
	}
	http.Handle("/media/", http.StripPrefix("/media/", http.FileServer(http.Dir(mediaRoot))))
	http.Handle("/static/", http.FileServerFS(staticFS))
	http.HandleFunc("/", handleIndex)
	if err := http.ListenAndServe(address, nil); err != nil {
		log.Fatalf("failed to listen and serve: %s", err)
	}
}
