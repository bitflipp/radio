// Command cbr re-encodes VBR MP3 files to constant bitrate so browsers can seek them accurately.
//
// Audio is re-encoded with ffmpeg (libmp3lame); the original ID3v2 and ID3v1 tags are copied over byte for byte,
// so no tag data is lost. Files that are already CBR are skipped. Each file is replaced in place via an atomic
// rename, keeping its name.
package main

import (
	"bytes"
	"flag"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
)

// MPEG-1 Layer III bitrates in kbit/s.
var bitrates = []int{32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320}

type audioInfo struct {
	cbr      bool
	bitrate  int // average, kbit/s
	duration float64
}

func probe(path string) (audioInfo, error) {
	out, err := exec.Command("ffprobe", "-v", "error", "-select_streams", "a:0",
		"-show_entries", "packet=size,duration_time", "-of", "csv=p=0", path).Output()
	if err != nil {
		return audioInfo{}, fmt.Errorf("ffprobe: %w", err)
	}
	minSize, maxSize, totalSize, duration := math.MaxInt, 0, 0, 0.0
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Split(strings.TrimSpace(line), ",")
		if len(fields) != 2 {
			continue
		}
		d, err1 := strconv.ParseFloat(fields[0], 64)
		size, err2 := strconv.Atoi(fields[1])
		if err1 != nil || err2 != nil {
			continue
		}
		minSize, maxSize = min(minSize, size), max(maxSize, size)
		totalSize += size
		duration += d
	}
	if duration == 0 {
		return audioInfo{}, fmt.Errorf("no audio packets")
	}
	return audioInfo{
		// CBR frames differ by at most the one padding byte.
		cbr:      maxSize-minSize <= 1,
		bitrate:  int(float64(totalSize) * 8 / duration / 1000),
		duration: duration,
	}, nil
}

// targetBitrate returns the smallest standard bitrate at or above avg, so quality stays roughly the same.
func targetBitrate(avg int) int {
	for _, b := range bitrates {
		if b >= avg {
			return b
		}
	}
	return bitrates[len(bitrates)-1]
}

// splitTags returns the leading ID3v2 tag and the trailing ID3v1 tag of an MP3 file (either may be empty).
func splitTags(data []byte) (id3v2, id3v1 []byte) {
	if len(data) >= 10 && bytes.HasPrefix(data, []byte("ID3")) {
		size := int(data[6]&0x7f)<<21 | int(data[7]&0x7f)<<14 | int(data[8]&0x7f)<<7 | int(data[9]&0x7f)
		size += 10
		if data[5]&0x10 != 0 { // footer present
			size += 10
		}
		id3v2 = data[:min(size, len(data))]
	}
	if len(data)-len(id3v2) >= 128 && bytes.HasPrefix(data[len(data)-128:], []byte("TAG")) {
		id3v1 = data[len(data)-128:]
	}
	return id3v2, id3v1
}

func convert(path string, forceBitrate int, dryRun bool) (string, error) {
	info, err := probe(path)
	if err != nil {
		return "", err
	}
	if info.cbr {
		return fmt.Sprintf("already CBR (%d kbit/s), skipped", info.bitrate), nil
	}
	bitrate := forceBitrate
	if bitrate == 0 {
		bitrate = targetBitrate(info.bitrate)
	}
	if dryRun {
		return fmt.Sprintf("VBR %d kbit/s -> CBR %d kbit/s (dry run)", info.bitrate, bitrate), nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	id3v2, id3v1 := splitTags(data)

	audio, err := os.CreateTemp(filepath.Dir(path), ".cbr-*.mp3")
	if err != nil {
		return "", err
	}
	audio.Close()
	defer os.Remove(audio.Name())
	cmd := exec.Command("ffmpeg", "-v", "error", "-y", "-i", path,
		"-map", "0:a:0", "-map_metadata", "-1", "-map_chapters", "-1",
		"-c:a", "libmp3lame", "-b:a", fmt.Sprintf("%dk", bitrate),
		"-id3v2_version", "0", "-write_xing", "1", "-f", "mp3", audio.Name())
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("ffmpeg: %w: %s", err, out)
	}
	encoded, err := os.ReadFile(audio.Name())
	if err != nil {
		return "", err
	}

	stat, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".cbr-*.mp3")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())
	for _, part := range [][]byte{id3v2, encoded, id3v1} {
		if _, err := tmp.Write(part); err != nil {
			tmp.Close()
			return "", err
		}
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	if err := os.Chmod(tmp.Name(), stat.Mode().Perm()); err != nil {
		return "", err
	}

	// Sanity-check the result before replacing the original.
	result, err := probe(tmp.Name())
	if err != nil {
		return "", fmt.Errorf("verifying output: %w", err)
	}
	if !result.cbr {
		return "", fmt.Errorf("output is not CBR")
	}
	if math.Abs(result.duration-info.duration) > 1 {
		return "", fmt.Errorf("duration changed from %.1fs to %.1fs", info.duration, result.duration)
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return "", err
	}
	return fmt.Sprintf("VBR %d kbit/s -> CBR %d kbit/s, %d MB -> %d MB",
		info.bitrate, bitrate, len(data)>>20, (len(id3v2)+len(encoded)+len(id3v1))>>20), nil
}

func main() {
	bitrate := flag.Int("b", 0, "target bitrate in kbit/s (default: next standard bitrate above the source average)")
	jobs := flag.Int("j", runtime.NumCPU(), "number of files to encode in parallel")
	dryRun := flag.Bool("n", false, "dry run: only report what would be converted")
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: cbr [flags] [file.mp3 ...]\n\nWithout files, converts media/*.mp3.\n\n")
		flag.PrintDefaults()
	}
	flag.Parse()
	if *bitrate != 0 && !slices.Contains(bitrates, *bitrate) {
		fmt.Fprintf(os.Stderr, "invalid bitrate %d, must be one of %v\n", *bitrate, bitrates)
		os.Exit(2)
	}

	paths := flag.Args()
	if len(paths) == 0 {
		paths, _ = filepath.Glob("media/*.mp3")
	}

	var (
		wg     sync.WaitGroup
		mu     sync.Mutex
		failed bool
		sem    = make(chan struct{}, max(*jobs, 1))
	)
	for _, path := range paths {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			msg, err := convert(path, *bitrate, *dryRun)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				failed = true
				fmt.Fprintf(os.Stderr, "%s: error: %v\n", path, err)
				return
			}
			fmt.Printf("%s: %s\n", path, msg)
		}()
	}
	wg.Wait()
	if failed {
		os.Exit(1)
	}
}
