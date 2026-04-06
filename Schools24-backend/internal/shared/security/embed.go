package security

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"time"
)

var (
	ErrEmbedExpired   = errors.New("embed_link_expired")
	ErrEmbedInvalid   = errors.New("invalid_embed_signature")
	ErrEmbedMalformed = errors.New("invalid_embed_parameters")
)

func BuildEmbedSignature(secret, formType, slug string, expiresAt time.Time) (int64, string) {
	expiresUnix := expiresAt.UTC().Unix()
	payload := fmt.Sprintf("%s|%s|%d", formType, slug, expiresUnix)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	sum := mac.Sum(nil)
	return expiresUnix, base64.RawURLEncoding.EncodeToString(sum)
}

func VerifyEmbedSignature(secret, formType, slug, expiresRaw, signature string, now time.Time) error {
	if expiresRaw == "" || signature == "" {
		return ErrEmbedMalformed
	}

	expiresUnix, err := strconv.ParseInt(expiresRaw, 10, 64)
	if err != nil {
		return ErrEmbedMalformed
	}
	if now.UTC().Unix() > expiresUnix {
		return ErrEmbedExpired
	}

	payload := fmt.Sprintf("%s|%s|%d", formType, slug, expiresUnix)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	expected := mac.Sum(nil)

	actual, err := base64.RawURLEncoding.DecodeString(signature)
	if err != nil {
		return ErrEmbedMalformed
	}
	if subtle.ConstantTimeCompare(expected, actual) != 1 {
		return ErrEmbedInvalid
	}

	return nil
}
