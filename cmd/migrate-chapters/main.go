// Command migrate-chapters converts the legacy segment lists in ID3 comments ("HH:MM:SS;Title", one per line) into
// ID3v2 chapter frames. Comment lines that aren't segments stay in the comment. Files that already have chapters are
// skipped. Needs ffprobe to determine the duration (the end time of the last chapter).
package main

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/bogem/id3v2/v2"

	"phinau.de/radiogogo/chapters"
)

// parseTimestamp parses "SS", "MM:SS" or "HH:MM:SS" into seconds.
func parseTimestamp(s string) (float64, bool) {
	parts := strings.Split(strings.TrimSpace(s), ":")
	if len(parts) > 3 {
		return 0, false
	}
	seconds := 0
	for _, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return 0, false
		}
		seconds = seconds*60 + n
	}
	return float64(seconds), true
}

func duration(path string) (float64, error) {
	out, err := exec.Command("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path).Output()
	if err != nil {
		return 0, fmt.Errorf("ffprobe: %w", err)
	}
	return strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
}

func migrate(path string, dryRun bool) (string, error) {
	t, err := id3v2.Open(path, id3v2.Options{Parse: true})
	if err != nil {
		return "", fmt.Errorf("failed to open tag: %w", err)
	}
	defer t.Close()

	if len(chapters.Read(t)) > 0 {
		return "already has chapters, skipped", nil
	}
	commentID := t.CommonID("Comments")
	var cs []chapters.Chapter
	var rest []string
	for _, f := range t.GetFrames(commentID) {
		cf, ok := f.(id3v2.CommentFrame)
		if !ok {
			continue
		}
		for _, line := range strings.Split(cf.Text, "\n") {
			timestamp, title, found := strings.Cut(line, ";")
			if start, ok := parseTimestamp(timestamp); found && ok {
				cs = append(cs, chapters.Chapter{Start: start, Title: strings.TrimSpace(title)})
			} else if strings.TrimSpace(line) != "" {
				rest = append(rest, line)
			}
		}
	}
	if len(cs) == 0 {
		return "no segments, skipped", nil
	}
	msg := fmt.Sprintf("%d segments -> chapters, %d comment lines kept", len(cs), len(rest))
	if dryRun {
		return msg + " (dry run)", nil
	}

	d, err := duration(path)
	if err != nil {
		return "", err
	}
	if err := chapters.Set(t, cs, d); err != nil {
		return "", err
	}
	t.DeleteFrames(commentID)
	if len(rest) > 0 {
		t.AddCommentFrame(id3v2.CommentFrame{
			Encoding: id3v2.EncodingUTF8,
			Language: "eng",
			Text:     strings.Join(rest, "\n"),
		})
	}
	if err := t.Save(); err != nil {
		return "", fmt.Errorf("failed to save tag: %w", err)
	}
	return msg, nil
}

func main() {
	dryRun := flag.Bool("n", false, "dry run: only report what would be migrated")
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: migrate-chapters [-n] [file.mp3 ...]\n\nWithout files, migrates media/*.mp3.\n\n")
		flag.PrintDefaults()
	}
	flag.Parse()

	paths := flag.Args()
	if len(paths) == 0 {
		paths, _ = filepath.Glob("media/*.mp3")
	}
	failed := false
	for _, path := range paths {
		msg, err := migrate(path, *dryRun)
		if err != nil {
			failed = true
			fmt.Fprintf(os.Stderr, "%s: error: %v\n", path, err)
			continue
		}
		fmt.Printf("%s: %s\n", path, msg)
	}
	if failed {
		os.Exit(1)
	}
}
