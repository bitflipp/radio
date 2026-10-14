package chapters

import (
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"phinau.de/radiogogo/vorbis"
)

// Vorbis comments have no chapter frames; by convention (ffmpeg, MKVToolNix, the Ogg chapter extension) a chapter
// is a CHAPTERnnn=HH:MM:SS.mmm field, optionally with a CHAPTERnnnNAME=title field.
var chapterKey = regexp.MustCompile(`(?i)^CHAPTER(\d+)(NAME|URL)?$`)

// ReadVorbis returns the comments' chapters ordered by start time.
func ReadVorbis(c *vorbis.Comments) []Chapter {
	starts := map[int]float64{}
	titles := map[int]string{}
	for _, f := range c.Fields {
		m := chapterKey.FindStringSubmatch(f.Key)
		if m == nil {
			continue
		}
		n, err := strconv.Atoi(m[1])
		if err != nil {
			continue
		}
		switch strings.ToUpper(m[2]) {
		case "":
			if s, ok := parseTimestamp(f.Value); ok {
				starts[n] = s
			}
		case "NAME":
			titles[n] = f.Value
		}
	}
	cs := []Chapter{}
	for n, s := range starts {
		cs = append(cs, Chapter{Start: s, Title: titles[n]})
	}
	slices.SortStableFunc(cs, byStart)
	return cs
}

// SetVorbis replaces the comments' chapters.
func SetVorbis(c *vorbis.Comments, cs []Chapter) error {
	if len(cs) > 999 {
		return fmt.Errorf("too many chapters: %d (max. 999)", len(cs))
	}
	cs = slices.Clone(cs)
	slices.SortStableFunc(cs, byStart)
	c.Delete(chapterKey.MatchString)
	for i, ch := range cs {
		if ch.Start < 0 {
			return fmt.Errorf("negative chapter start: %v", ch.Start)
		}
		key := fmt.Sprintf("CHAPTER%03d", i+1)
		c.Fields = append(c.Fields,
			vorbis.Field{Key: key, Value: formatTimestamp(ch.Start)},
			vorbis.Field{Key: key + "NAME", Value: ch.Title},
		)
	}
	return nil
}

func formatTimestamp(s float64) string {
	ms := int64(math.Round(s * 1000))
	return fmt.Sprintf("%02d:%02d:%02d.%03d", ms/3600000, ms/60000%60, ms/1000%60, ms%1000)
}

func parseTimestamp(v string) (float64, bool) {
	parts := strings.Split(strings.TrimSpace(v), ":")
	if len(parts) != 3 {
		return 0, false
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	s, err3 := strconv.ParseFloat(parts[2], 64)
	if err1 != nil || err2 != nil || err3 != nil || h < 0 || m < 0 || s < 0 {
		return 0, false
	}
	return float64(h*3600+m*60) + s, true
}
