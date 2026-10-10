// Package chapters reads and writes ID3v2 chapter frames (CHAP, plus a CTOC table of contents),
// following https://id3.org/id3v2-chapters-1.0.
package chapters

import (
	"cmp"
	"fmt"
	"slices"
	"time"

	"github.com/bogem/id3v2/v2"
)

const tocElementID = "toc"

type Chapter struct {
	Start float64 `json:"start"` // seconds
	Title string  `json:"title"`
}

// Read returns the tag's chapters ordered by start time.
func Read(t *id3v2.Tag) []Chapter {
	cs := []Chapter{}
	for _, f := range t.GetFrames(t.CommonID("Chapters")) {
		cf, ok := f.(id3v2.ChapterFrame)
		if !ok {
			continue
		}
		c := Chapter{Start: cf.StartTime.Seconds()}
		if cf.Title != nil {
			c.Title = cf.Title.Text
		}
		cs = append(cs, c)
	}
	slices.SortStableFunc(cs, byStart)
	return cs
}

// Set replaces the tag's chapters. Each chapter ends where the next one starts; the last one ends at duration
// (seconds).
func Set(t *id3v2.Tag, cs []Chapter, duration float64) error {
	if len(cs) > 255 {
		return fmt.Errorf("too many chapters: %d (max. 255)", len(cs))
	}
	cs = slices.Clone(cs)
	slices.SortStableFunc(cs, byStart)

	t.DeleteFrames(t.CommonID("Chapters"))
	t.DeleteFrames("CTOC")
	if len(cs) == 0 {
		return nil
	}

	toc := []byte(tocElementID)
	toc = append(toc, 0, 0x03, byte(len(cs))) // flags: top-level, ordered
	for i, c := range cs {
		if c.Start < 0 {
			return fmt.Errorf("negative chapter start: %v", c.Start)
		}
		end := duration
		if i+1 < len(cs) {
			end = cs[i+1].Start
		}
		end = max(end, c.Start)
		id := fmt.Sprintf("ch%d", i)
		t.AddChapterFrame(id3v2.ChapterFrame{
			ElementID:   id,
			StartTime:   seconds(c.Start),
			EndTime:     seconds(end),
			StartOffset: id3v2.IgnoredOffset,
			EndOffset:   id3v2.IgnoredOffset,
			Title:       &id3v2.TextFrame{Encoding: id3v2.EncodingUTF8, Text: c.Title},
		})
		toc = append(toc, id...)
		toc = append(toc, 0)
	}
	t.AddFrame("CTOC", id3v2.UnknownFrame{Body: toc})
	return nil
}

func byStart(a, b Chapter) int {
	return cmp.Compare(a.Start, b.Start)
}

func seconds(s float64) time.Duration {
	return time.Duration(s * float64(time.Second)).Round(time.Millisecond)
}
