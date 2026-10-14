// Package vorbis reads and rewrites Vorbis comments (the KEY=value tags) in FLAC, Ogg Vorbis and Ogg Opus files.
// Everything else in the file, including the audio and any other comments, is preserved.
package vorbis

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// Field is a single KEY=value comment. Keys are case-insensitive.
type Field struct {
	Key, Value string
}

type Comments struct {
	Vendor string
	Fields []Field
}

// Get returns the first value for key, or "".
func (c *Comments) Get(key string) string {
	for _, f := range c.Fields {
		if strings.EqualFold(f.Key, key) {
			return f.Value
		}
	}
	return ""
}

// Delete removes all fields whose key satisfies match.
func (c *Comments) Delete(match func(key string) bool) {
	kept := c.Fields[:0]
	for _, f := range c.Fields {
		if !match(f.Key) {
			kept = append(kept, f)
		}
	}
	c.Fields = kept
}

// Set replaces all values of key with value, or just removes the key if value is empty.
func (c *Comments) Set(key, value string) {
	c.Delete(func(k string) bool { return strings.EqualFold(k, key) })
	if value != "" {
		c.Fields = append(c.Fields, Field{key, value})
	}
}

// parse decodes a comment block body: vendor, then the fields. Trailing bytes (framing bit, padding) are ignored.
func parse(b []byte) (*Comments, error) {
	errShort := errors.New("truncated vorbis comment block")
	next := func() ([]byte, bool) {
		if len(b) < 4 {
			return nil, false
		}
		n := binary.LittleEndian.Uint32(b)
		if uint64(n) > uint64(len(b)-4) {
			return nil, false
		}
		s := b[4 : 4+n]
		b = b[4+n:]
		return s, true
	}
	vendor, ok := next()
	if !ok || len(b) < 4 {
		return nil, errShort
	}
	count := binary.LittleEndian.Uint32(b)
	b = b[4:]
	c := &Comments{Vendor: string(vendor)}
	for range count {
		s, ok := next()
		if !ok {
			return nil, errShort
		}
		k, v, found := strings.Cut(string(s), "=")
		if !found {
			continue
		}
		c.Fields = append(c.Fields, Field{k, v})
	}
	return c, nil
}

// encode is the inverse of parse, without any trailing framing.
func (c *Comments) encode() []byte {
	var buf bytes.Buffer
	put := func(s string) {
		binary.Write(&buf, binary.LittleEndian, uint32(len(s)))
		buf.WriteString(s)
	}
	put(c.Vendor)
	binary.Write(&buf, binary.LittleEndian, uint32(len(c.Fields)))
	for _, f := range c.Fields {
		put(f.Key + "=" + f.Value)
	}
	return buf.Bytes()
}

// Read returns the comments of the FLAC or Ogg file at path.
func Read(path string) (*Comments, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r := bufio.NewReader(f)
	magic, err := r.Peek(4)
	if err != nil {
		return nil, err
	}
	switch string(magic) {
	case "fLaC":
		h, err := readFLACHeader(r)
		if err != nil {
			return nil, err
		}
		return h.comments, nil
	case "OggS":
		h, err := readOggHeader(r)
		if err != nil {
			return nil, err
		}
		return h.comments, nil
	}
	return nil, errors.New("not a FLAC or Ogg file")
}

// Update rewrites the file at path with the comments modified by fn. The file is replaced atomically.
func Update(path string, fn func(*Comments) error) error {
	src, err := os.Open(path)
	if err != nil {
		return err
	}
	defer src.Close()
	info, err := src.Stat()
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".vorbis-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name()) // no-op after a successful rename
	defer tmp.Close()

	r := bufio.NewReader(src)
	w := bufio.NewWriter(tmp)
	magic, err := r.Peek(4)
	if err != nil {
		return err
	}
	switch string(magic) {
	case "fLaC":
		err = updateFLAC(r, w, fn)
	case "OggS":
		err = updateOgg(r, w, fn)
	default:
		err = errors.New("not a FLAC or Ogg file")
	}
	if err != nil {
		return err
	}
	if err := w.Flush(); err != nil {
		return err
	}
	if err := tmp.Chmod(info.Mode().Perm()); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

// ---- FLAC ----

const flacVorbisComment = 4

type flacBlock struct {
	typ  byte
	last bool
	data []byte
}

type flacHeader struct {
	blocks   []flacBlock
	comments *Comments // nil if there is no comment block yet
	index    int       // index of the comment block in blocks, or -1
}

// readFLACHeader reads the "fLaC" marker and all metadata blocks, leaving r at the first audio frame.
func readFLACHeader(r io.Reader) (*flacHeader, error) {
	var magic [4]byte
	if _, err := io.ReadFull(r, magic[:]); err != nil || string(magic[:]) != "fLaC" {
		return nil, errors.New("expected 'fLaC'")
	}
	h := &flacHeader{index: -1}
	for {
		var hdr [4]byte
		if _, err := io.ReadFull(r, hdr[:]); err != nil {
			return nil, fmt.Errorf("reading FLAC block header: %w", err)
		}
		b := flacBlock{typ: hdr[0] & 0x7f, last: hdr[0]&0x80 != 0}
		b.data = make([]byte, int(hdr[1])<<16|int(hdr[2])<<8|int(hdr[3]))
		if _, err := io.ReadFull(r, b.data); err != nil {
			return nil, fmt.Errorf("reading FLAC block: %w", err)
		}
		if b.typ == flacVorbisComment && h.index < 0 {
			c, err := parse(b.data)
			if err != nil {
				return nil, err
			}
			h.comments, h.index = c, len(h.blocks)
		}
		h.blocks = append(h.blocks, b)
		if b.last {
			return h, nil
		}
	}
}

func updateFLAC(r *bufio.Reader, w io.Writer, fn func(*Comments) error) error {
	h, err := readFLACHeader(r)
	if err != nil {
		return err
	}
	c := h.comments
	if c == nil {
		c = &Comments{Vendor: "radiogogo"}
	}
	if err := fn(c); err != nil {
		return err
	}
	data := c.encode()
	if len(data) >= 1<<24 {
		return errors.New("comments too large for a FLAC block")
	}
	nb := flacBlock{typ: flacVorbisComment, data: data}
	if h.index >= 0 {
		nb.last = h.blocks[h.index].last
		h.blocks[h.index] = nb
	} else {
		// Insert right after STREAMINFO, which must come first.
		nb.last = h.blocks[0].last
		h.blocks[0].last = false
		h.blocks = append(h.blocks[:1], append([]flacBlock{nb}, h.blocks[1:]...)...)
	}
	if _, err := io.WriteString(w, "fLaC"); err != nil {
		return err
	}
	for _, b := range h.blocks {
		hdr := [4]byte{b.typ, byte(len(b.data) >> 16), byte(len(b.data) >> 8), byte(len(b.data))}
		if b.last {
			hdr[0] |= 0x80
		}
		if _, err := w.Write(hdr[:]); err != nil {
			return err
		}
		if _, err := w.Write(b.data); err != nil {
			return err
		}
	}
	_, err = io.Copy(w, r)
	return err
}

// ---- Ogg ----

type oggPage struct {
	raw      []byte // the page as read, header included
	flags    byte
	granule  uint64
	serial   uint32
	seq      uint32
	segments []byte // lacing values
	body     []byte
}

func readOggPage(r io.Reader) (*oggPage, error) {
	var hdr [27]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return nil, err
	}
	if string(hdr[:4]) != "OggS" || hdr[4] != 0 {
		return nil, errors.New("invalid Ogg page")
	}
	p := &oggPage{
		flags:   hdr[5],
		granule: binary.LittleEndian.Uint64(hdr[6:]),
		serial:  binary.LittleEndian.Uint32(hdr[14:]),
		seq:     binary.LittleEndian.Uint32(hdr[18:]),
	}
	p.segments = make([]byte, hdr[26])
	if _, err := io.ReadFull(r, p.segments); err != nil {
		return nil, err
	}
	n := 0
	for _, s := range p.segments {
		n += int(s)
	}
	p.body = make([]byte, n)
	if _, err := io.ReadFull(r, p.body); err != nil {
		return nil, err
	}
	p.raw = append(append(hdr[:], p.segments...), p.body...)
	return p, nil
}

var crcTable = func() (t [256]uint32) {
	for i := range t {
		c := uint32(i) << 24
		for range 8 {
			if c&0x80000000 != 0 {
				c = c<<1 ^ 0x04c11db7
			} else {
				c <<= 1
			}
		}
		t[i] = c
	}
	return
}()

// finishOggPage stores the checksum into a complete page.
func finishOggPage(page []byte) {
	clear(page[22:26])
	var crc uint32
	for _, b := range page {
		crc = crc<<8 ^ crcTable[byte(crc>>24)^b]
	}
	binary.LittleEndian.PutUint32(page[22:], crc)
}

// packetsOf splits the pages' bodies into packets, reporting whether the last packet is complete.
func packetsOf(pages []*oggPage) (packets [][]byte, complete bool) {
	var cur []byte
	complete = true
	for _, p := range pages {
		off := 0
		for _, s := range p.segments {
			cur = append(cur, p.body[off:off+int(s)]...)
			off += int(s)
			complete = s < 255
			if complete {
				packets = append(packets, cur)
				cur = nil
			}
		}
	}
	return
}

type oggHeader struct {
	first    *oggPage   // identification header page
	headers  []*oggPage // pages holding the comment (and for Vorbis, setup) packets
	packets  [][]byte   // [comment] for Opus, [comment, setup] for Vorbis
	opus     bool
	comments *Comments
}

var (
	vorbisCommentPrefix = []byte("\x03vorbis")
	opusTagsPrefix      = []byte("OpusTags")
)

// readOggHeader reads the header pages of the first logical stream, leaving r at the first audio page.
func readOggHeader(r io.Reader) (*oggHeader, error) {
	h := &oggHeader{}
	var err error
	if h.first, err = readOggPage(r); err != nil {
		return nil, err
	}
	if h.first.flags&0x02 == 0 {
		return nil, errors.New("Ogg stream does not start with a BOS page")
	}
	id, _ := packetsOf([]*oggPage{h.first})
	switch {
	case len(id) == 1 && bytes.HasPrefix(id[0], []byte("\x01vorbis")):
	case len(id) == 1 && bytes.HasPrefix(id[0], []byte("OpusHead")):
		h.opus = true
	default:
		return nil, errors.New("unsupported Ogg codec (only Vorbis and Opus)")
	}
	want := 2 // comment and setup packets
	if h.opus {
		want = 1
	}
	for {
		p, err := readOggPage(r)
		if err != nil {
			return nil, fmt.Errorf("reading Ogg headers: %w", err)
		}
		if p.serial != h.first.serial {
			return nil, errors.New("multiplexed Ogg streams are not supported")
		}
		h.headers = append(h.headers, p)
		packets, complete := packetsOf(h.headers)
		if len(packets) >= want {
			if !complete || len(packets) != want {
				return nil, errors.New("Ogg header packets do not end on a page boundary")
			}
			h.packets = packets
			break
		}
	}
	prefix := vorbisCommentPrefix
	if h.opus {
		prefix = opusTagsPrefix
	}
	if !bytes.HasPrefix(h.packets[0], prefix) {
		return nil, errors.New("missing Ogg comment header")
	}
	h.comments, err = parse(h.packets[0][len(prefix):])
	return h, err
}

func updateOgg(r *bufio.Reader, w io.Writer, fn func(*Comments) error) error {
	h, err := readOggHeader(r)
	if err != nil {
		return err
	}
	if err := fn(h.comments); err != nil {
		return err
	}
	packets := slices.Clone(h.packets)
	if h.opus {
		packets[0] = append(append([]byte{}, opusTagsPrefix...), h.comments.encode()...)
	} else {
		packets[0] = append(append(append([]byte{}, vorbisCommentPrefix...), h.comments.encode()...), 1) // framing bit
	}

	if _, err := w.Write(h.first.raw); err != nil {
		return err
	}
	seq := h.first.seq + 1
	var segments []byte // lacing values of all packets, in order
	var body []byte
	continued := false
	for _, p := range packets {
		for n := len(p); ; n -= 255 {
			if n >= 255 {
				segments = append(segments, 255)
				continue
			}
			segments = append(segments, byte(n))
			break
		}
		body = append(body, p...)
	}
	for len(segments) > 0 {
		n := min(len(segments), 255)
		size := 0
		for _, s := range segments[:n] {
			size += int(s)
		}
		page := make([]byte, 27, 27+n+size)
		copy(page, "OggS")
		if continued {
			page[5] = 0x01
		}
		if segments[n-1] == 255 {
			// The page ends mid-packet: its granule position is -1.
			binary.LittleEndian.PutUint64(page[6:], ^uint64(0))
		}
		binary.LittleEndian.PutUint32(page[14:], h.first.serial)
		binary.LittleEndian.PutUint32(page[18:], seq)
		page[26] = byte(n)
		page = append(page, segments[:n]...)
		page = append(page, body[:size]...)
		finishOggPage(page)
		if _, err := w.Write(page); err != nil {
			return err
		}
		continued = segments[n-1] == 255
		segments, body = segments[n:], body[size:]
		seq++
	}

	delta := seq - (h.headers[len(h.headers)-1].seq + 1)
	if delta == 0 {
		_, err = io.Copy(w, r)
		return err
	}
	for {
		p, err := readOggPage(r)
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		binary.LittleEndian.PutUint32(p.raw[18:], p.seq+delta)
		finishOggPage(p.raw)
		if _, err := w.Write(p.raw); err != nil {
			return err
		}
	}
}
