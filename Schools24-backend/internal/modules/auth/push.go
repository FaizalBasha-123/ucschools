package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/oauth2/google"
)

// fcmV1Scope is the OAuth2 scope required for the FCM HTTP v1 API.
const fcmV1Scope = "https://www.googleapis.com/auth/firebase.messaging"

func (s *Service) RegisterPushToken(ctx context.Context, userID uuid.UUID, schoolID *uuid.UUID, role string, req *RegisterPushTokenRequest) error {
	if strings.TrimSpace(req.Token) == "" {
		return fmt.Errorf("token is required")
	}

	now := time.Now()
	device := &PushDeviceToken{
		ID:         uuid.New(),
		UserID:     userID,
		SchoolID:   schoolID,
		Role:       role,
		Platform:   strings.TrimSpace(strings.ToLower(req.Platform)),
		Token:      strings.TrimSpace(req.Token),
		LastSeenAt: now,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if value := strings.TrimSpace(req.DeviceID); value != "" {
		device.DeviceID = &value
	}
	if value := strings.TrimSpace(req.DeviceName); value != "" {
		device.DeviceName = &value
	}
	if value := strings.TrimSpace(req.AppVersion); value != "" {
		device.AppVersion = &value
	}
	return s.repo.UpsertPushDeviceToken(ctx, device)
}

func (s *Service) DeletePushToken(ctx context.Context, userID uuid.UUID, req *DeletePushTokenRequest) error {
	return s.repo.DeletePushDeviceToken(ctx, userID, req.Token, req.DeviceID)
}

func (s *Service) SendTestPush(ctx context.Context, userID uuid.UUID, req *SendTestPushRequest) error {
	devices, err := s.repo.ListPushDeviceTokensByUser(ctx, userID)
	if err != nil {
		return err
	}
	tokens := make([]string, 0, len(devices))
	for _, device := range devices {
		if strings.TrimSpace(device.Token) != "" {
			tokens = append(tokens, device.Token)
		}
	}
	if len(tokens) == 0 {
		return fmt.Errorf("no_registered_devices")
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "Schools24"
	}
	body := strings.TrimSpace(req.Body)
	if body == "" {
		body = "Push notifications are configured for this device."
	}
	return s.SendFCMNotification(ctx, tokens, title, body, nil)
}

// SendFCMNotification sends a push notification via the FCM HTTP v1 API to one
// or more device tokens. It honours the FCM v1 per-message model: one HTTP
// request per token (Google removed batch send from the v1 API).
//
// extra holds optional additional key/value pairs merged into the data payload.
// Pass nil when not needed.
func (s *Service) SendFCMNotification(ctx context.Context, tokens []string, title, body string, extra map[string]string) error {
	saJSON := strings.TrimSpace(s.config.FCM.ServiceAccountJSON)
	configuredProjectID := strings.TrimSpace(s.config.FCM.ProjectID)
	projectID := configuredProjectID

	if saJSON == "" {
		return fmt.Errorf("fcm_service_account_not_configured")
	}

	// Derive project_id directly from the service account JSON when available.
	// This avoids subtle production failures when FCM_PROJECT_ID points to a
	// different project than the uploaded service-account credentials.
	var saMeta struct {
		ProjectID    string `json:"project_id"`
		ClientEmail  string `json:"client_email"`
		PrivateKeyID string `json:"private_key_id"`
	}
	if err := json.Unmarshal([]byte(saJSON), &saMeta); err == nil {
		saProjectID := strings.TrimSpace(saMeta.ProjectID)
		if saProjectID != "" {
			if projectID == "" {
				projectID = saProjectID
			} else if !strings.EqualFold(projectID, saProjectID) {
				log.Printf("auth: FCM_PROJECT_ID (%s) mismatches service-account project_id (%s); using service-account project_id", projectID, saProjectID)
				projectID = saProjectID
			}
		}
	}
	if projectID == "" {
		return fmt.Errorf("fcm_project_id_not_configured")
	}

	// Obtain an OAuth2 access token from the service account credentials.
	creds, err := google.CredentialsFromJSON(ctx, []byte(saJSON), fcmV1Scope)
	if err != nil {
		return fmt.Errorf("failed to parse fcm service account: %w", err)
	}
	oauthToken, err := creds.TokenSource.Token()
	if err != nil {
		return fmt.Errorf("failed to obtain fcm oauth token: %w", err)
	}

	fcmURL := fmt.Sprintf("https://fcm.googleapis.com/v1/projects/%s/messages:send", projectID)

	// Build the data map for the notification.
	data := map[string]string{
		"title": title,
		"body":  body,
	}
	for k, v := range extra {
		data[k] = v
	}

	var lastErr error
	for _, token := range tokens {
		if err := s.sendOneFCMMessage(ctx, fcmURL, oauthToken.AccessToken, token, title, body, data); err != nil {
			lastErr = err
		}
	}
	return lastErr
}

// sendOneFCMMessage sends a single FCM v1 message to one device token.
func (s *Service) sendOneFCMMessage(ctx context.Context, fcmURL, accessToken, token, title, body string, data map[string]string) error {
	payload := map[string]any{
		"message": map[string]any{
			"token": token,
			"notification": map[string]string{
				"title": title,
				"body":  body,
			},
			"data": data,
			"android": map[string]any{
				"priority": "HIGH",
				"notification": map[string]any{
					"sound":                 "default",
					"click_action":          "FCM_PLUGIN_ACTIVITY",
					"channel_id":            "schools24_general",
					"icon":                  "ic_stat_notify",
					"color":                 "#1B2A5E",
					"notification_priority": "PRIORITY_HIGH",
					"visibility":            "PUBLIC",
				},
			},
			"apns": map[string]any{
				"payload": map[string]any{
					"aps": map[string]any{
						"sound": "default",
						"badge": 1,
					},
				},
			},
		},
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal fcm payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fcmURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return fmt.Errorf("failed to create fcm request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send fcm request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("fcm request failed with status %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}
