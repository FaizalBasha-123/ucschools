package objectstore

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
)

var validR2Regions = map[string]struct{}{
	"auto": {},
	"apac": {},
	"wnam": {},
	"enam": {},
	"weur": {},
	"eeur": {},
	"oc":   {},
}

// R2Config holds Cloudflare R2 storage configuration
type R2Config struct {
	Enabled         bool
	AccountID       string
	AccessKeyID     string
	SecretAccessKey string
	BucketName      string
	Region          string
	Endpoint        string
}

// R2Store represents a Cloudflare R2 object storage implementation
type R2Store struct {
	client     *s3.Client
	bucketName string
}

// NewR2Store creates a Cloudflare R2-backed object store.
func NewR2Store(ctx context.Context, cfg R2Config) (Store, error) {
	region := strings.TrimSpace(cfg.Region)
	if region == "" {
		region = "auto"
	} else {
		region = strings.ToLower(region)
		if _, ok := validR2Regions[region]; !ok {
			region = "auto"
		}
	}

	endpoint := strings.TrimSpace(cfg.Endpoint)
	if endpoint == "" && strings.TrimSpace(cfg.AccountID) != "" {
		endpoint = fmt.Sprintf("https://%s.r2.cloudflarestorage.com", strings.TrimSpace(cfg.AccountID))
	}

	bucket := strings.TrimSpace(cfg.BucketName)
	if bucket == "" {
		return nil, fmt.Errorf("r2 bucket name is required")
	}

	awsCfg, err := config.LoadDefaultConfig(
		ctx,
		config.WithRegion(region),
		config.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(
				strings.TrimSpace(cfg.AccessKeyID),
				strings.TrimSpace(cfg.SecretAccessKey),
				"",
			),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load aws config for r2: %w", err)
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.UsePathStyle = true
		if endpoint != "" {
			o.BaseEndpoint = aws.String(endpoint)
		}
	})

	return &R2Store{
		client:     client,
		bucketName: bucket,
	}, nil
}

func (s *R2Store) Put(ctx context.Context, key, contentType string, body []byte) error {
	if strings.TrimSpace(key) == "" {
		return fmt.Errorf("object key is required")
	}
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucketName),
		Key:         aws.String(key),
		Body:        bytes.NewReader(body),
		ContentType: aws.String(strings.TrimSpace(contentType)),
	})
	if err != nil {
		return fmt.Errorf("failed to put object %q: %w", key, err)
	}
	return nil
}

func (s *R2Store) Get(ctx context.Context, key string) ([]byte, error) {
	if strings.TrimSpace(key) == "" {
		return nil, ErrObjectNotFound{Key: key}
	}
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucketName),
		Key:    aws.String(key),
	})
	if err != nil {
		var apiErr smithy.APIError
		if errors.As(err, &apiErr) {
			if apiErr.ErrorCode() == "NoSuchKey" || apiErr.ErrorCode() == "NotFound" {
				return nil, ErrObjectNotFound{Key: key}
			}
		}
		return nil, fmt.Errorf("failed to get object %q: %w", key, err)
	}
	defer out.Body.Close()

	content, readErr := io.ReadAll(out.Body)
	if readErr != nil {
		return nil, fmt.Errorf("failed to read object %q: %w", key, readErr)
	}
	return content, nil
}

func (s *R2Store) Delete(ctx context.Context, key string) error {
	if strings.TrimSpace(key) == "" {
		return nil
	}
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucketName),
		Key:    aws.String(key),
	})
	if err != nil {
		var apiErr smithy.APIError
		if errors.As(err, &apiErr) {
			if apiErr.ErrorCode() == "NoSuchKey" || apiErr.ErrorCode() == "NotFound" {
				return ErrObjectNotFound{Key: key}
			}
		}
		return fmt.Errorf("failed to delete object %q: %w", key, err)
	}
	return nil
}

func (s *R2Store) List(ctx context.Context, prefix string) ([]ObjectInfo, error) {
	paginator := s3.NewListObjectsV2Paginator(s.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(s.bucketName),
		Prefix: aws.String(strings.TrimSpace(prefix)),
	})

	items := make([]ObjectInfo, 0)
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			var apiErr smithy.APIError
			if errors.As(err, &apiErr) {
				if apiErr.ErrorCode() == "NoSuchBucket" || apiErr.ErrorCode() == "NotFound" {
					return nil, ErrObjectNotFound{Key: prefix}
				}
			}
			return nil, fmt.Errorf("failed to list objects with prefix %q: %w", prefix, err)
		}
		for _, object := range page.Contents {
			if object.Key == nil {
				continue
			}
			items = append(items, ObjectInfo{
				Key:  aws.ToString(object.Key),
				Size: objectSize(object),
			})
		}
	}
	return items, nil
}

func objectSize(object types.Object) int64 {
	if object.Size == nil {
		return 0
	}
	return *object.Size
}
