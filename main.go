package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
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
	//go:embed static
	staticFS embed.FS
)

type media struct {
	Album    string `json:"album"`
	Artist   string `json:"artist"`
	Title    string `json:"title"`
	Track    int    `json:"track"`
	FileName string `json:"fileName"`
	Comment  string `json:"comment"`
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
		t, err := tag.ReadFrom(mf)
		if err != nil {
			ms[i] = media{
				Title:    fmt.Sprintf("[%s]", f.Name()),
				FileName: f.Name(),
			}
		} else {
			d, _ := t.Track()
			ms[i] = media{
				Album:    t.Album(),
				Artist:   t.Artist(),
				Title:    t.Title(),
				Track:    d,
				FileName: f.Name(),
				Comment:  t.Comment(),
			}
		}
		mf.Close()
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

func handleAPIMedia(w http.ResponseWriter, r *http.Request) {
	ms, err := readMedia()
	if err != nil {
		log.Printf("failed to read media: %s", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(ms)
}

func main() {
	http.HandleFunc("/api/media", handleAPIMedia)
	http.Handle("/media/", http.StripPrefix("/media/", http.FileServer(http.Dir(mediaRoot))))
	sfs, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatalf("failed to create subtree: %s", err)
	}
	http.Handle("/", http.FileServerFS(sfs))
	if err := http.ListenAndServe(address, nil); err != nil {
		log.Fatalf("failed to listen and serve: %s", err)
	}
}
