package demo

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"

	"github.com/schools24/backend/internal/modules/school"
)

func deriveEncryptionKey(secret string) []byte {
	sum := sha256.Sum256([]byte(secret + "::demo-requests"))
	return sum[:]
}

func encryptAdmins(secret string, admins []school.AdminRequest) ([]byte, error) {
	plaintext, err := json.Marshal(admins)
	if err != nil {
		return nil, err
	}

	block, err := aes.NewCipher(deriveEncryptionKey(secret))
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	ciphertext := gcm.Seal(nil, nonce, plaintext, nil)
	return append(nonce, ciphertext...), nil
}

func decryptAdmins(secret string, payload []byte) ([]school.AdminRequest, error) {
	block, err := aes.NewCipher(deriveEncryptionKey(secret))
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(payload) < gcm.NonceSize() {
		return nil, fmt.Errorf("invalid encrypted payload")
	}

	nonce := payload[:gcm.NonceSize()]
	ciphertext := payload[gcm.NonceSize():]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, err
	}

	var admins []school.AdminRequest
	if err := json.Unmarshal(plaintext, &admins); err != nil {
		return nil, err
	}
	return admins, nil
}

func makeAdminViews(admins []school.AdminRequest) []DemoRequestAdminView {
	views := make([]DemoRequestAdminView, 0, len(admins))
	for _, admin := range admins {
		views = append(views, DemoRequestAdminView{
			Name:  admin.Name,
			Email: admin.Email,
		})
	}
	return views
}

func marshalAdminViews(admins []DemoRequestAdminView) ([]byte, error) {
	return json.Marshal(admins)
}

func unmarshalAdminViews(raw []byte) ([]DemoRequestAdminView, error) {
	if len(raw) == 0 {
		return []DemoRequestAdminView{}, nil
	}
	var admins []DemoRequestAdminView
	if err := json.Unmarshal(raw, &admins); err != nil {
		return nil, err
	}
	return admins, nil
}

func cloneContext(ctx context.Context) context.Context { return ctx }
