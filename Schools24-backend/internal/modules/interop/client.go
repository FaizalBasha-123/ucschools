package interop

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/schools24/backend/internal/config"
)

type Client struct {
	httpClient *http.Client
	signer     *Signer
	cfg        config.InteropConfig
}

func NewClient(cfg config.InteropConfig, signer *Signer) *Client {
	timeout := time.Duration(cfg.RequestTimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	return &Client{
		httpClient: &http.Client{Timeout: timeout},
		signer:     signer,
		cfg:        cfg,
	}
}

func (c *Client) endpointFor(system ExternalSystem) string {
	switch system {
	case SystemDIKSHA:
		return strings.TrimSpace(c.cfg.DIKSHAEndpoint)
	case SystemDigiLocker:
		return strings.TrimSpace(c.cfg.DigiLockerEndpoint)
	case SystemABC:
		return strings.TrimSpace(c.cfg.ABCEndpoint)
	default:
		return ""
	}
}

func (c *Client) Post(ctx context.Context, system ExternalSystem, operation Operation, payload map[string]any) (ProviderResult, error) {
	endpoint := c.endpointFor(system)
	if endpoint == "" {
		return ProviderResult{}, fmt.Errorf("%s endpoint is not configured", system)
	}

	fullURL := strings.TrimRight(endpoint, "/") + "/interop/" + string(operation)
	body, err := json.Marshal(payload)
	if err != nil {
		return ProviderResult{}, fmt.Errorf("marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fullURL, bytes.NewReader(body))
	if err != nil {
		return ProviderResult{}, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Interop-System", string(system))
	req.Header.Set("X-Client-Id", c.cfg.ClientID)

	ts := time.Now().UTC()
	nonce, err := GenerateNonce(16)
	if err != nil {
		return ProviderResult{}, fmt.Errorf("generate nonce: %w", err)
	}
	req.Header.Set("X-Timestamp", ts.Format(time.RFC3339))
	req.Header.Set("X-Nonce", nonce)

	if c.signer != nil && c.signer.Enabled() {
		signature, signErr := c.signer.Sign(body, ts, nonce)
		if signErr != nil {
			return ProviderResult{}, signErr
		}
		req.Header.Set("X-Signature", signature)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return ProviderResult{}, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	result := ProviderResult{StatusCode: resp.StatusCode, Body: string(respBody)}

	if resp.StatusCode >= http.StatusBadRequest {
		return result, fmt.Errorf("provider returned status %d", resp.StatusCode)
	}
	return result, nil
}
