package util

import (
	"crypto/rand"
	"encoding/base32"
	"strings"
)

func NewToken(n int) string {
	buf := make([]byte, n)
	_, _ = rand.Read(buf)
	encoded := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf)
	return strings.ToLower(encoded)[:n]
}

func NewCode(n int) string {
	buf := make([]byte, n)
	_, _ = rand.Read(buf)
	encoded := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf)
	return strings.ToUpper(encoded)[:n]
}
