package interop

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"
)

type Signer struct {
	secret string
}

func NewSigner(secret string) *Signer {
	return &Signer{secret: secret}
}

func (s *Signer) Enabled() bool {
	return s != nil && s.secret != ""
}

func (s *Signer) Sign(body []byte, ts time.Time, nonce string) (string, error) {
	if !s.Enabled() {
		return "", fmt.Errorf("interop signer is not configured")
	}
	payload := fmt.Sprintf("%s|%s|%s", string(body), ts.UTC().Format(time.RFC3339), nonce)
	mac := hmac.New(sha256.New, []byte(s.secret))
	_, _ = mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil)), nil
}

func GenerateNonce(length int) (string, error) {
	if length < 16 {
		length = 16
	}
	b := make([]byte, length)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
