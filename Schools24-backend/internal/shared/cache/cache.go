package cache

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/go-redis/redis/v8"
)

// Cache provides a distributed cache using Redis / Valkey.
// All methods are nil-safe and noop when disabled (graceful degradation).
type Cache struct {
	client  *redis.Client
	enabled bool
	hits    uint64
	misses  uint64
}

// CacheStats provides basic cache usage metrics.
type CacheStats struct {
	Hits   uint64
	Misses uint64
}

// Config holds cache configuration for direct addr/password connection.
type Config struct {
	Address  string
	Password string
	DB       int
	PoolSize int
}

// maxPoolSize is the upper bound enforced for all Redis/Valkey connections.
// Render's hosted Valkey allows at most 25 concurrent connections.
const maxPoolSize = 25

func clampPoolSize(n int) int {
	if n <= 0 {
		return 5
	}
	if n > maxPoolSize {
		return maxPoolSize
	}
	return n
}

// New creates a new Redis/Valkey cache client from individual config values.
func New(cfg Config) (*Cache, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     cfg.Address,
		Password: cfg.Password,
		DB:       cfg.DB,
		PoolSize: clampPoolSize(cfg.PoolSize),
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to redis/valkey: %w", err)
	}

	return &Cache{client: client, enabled: true}, nil
}

// NewFromURL creates a cache from a Redis/Valkey connection URL.
//
// Render provides Valkey URLs in the format:
//
//	redis://red-xxxx:6379            (no auth)
//	redis://:password@red-xxxx:6379  (with auth)
//	rediss://...                      (TLS)
//
// This is the recommended constructor for Render-hosted Valkey.
func NewFromURL(rawURL string) (*Cache, error) {
	if rawURL == "" {
		return nil, fmt.Errorf("cache URL is empty")
	}

	opts, err := parseRedisURL(rawURL)
	if err != nil {
		return nil, fmt.Errorf("invalid cache URL: %w", err)
	}

	client := redis.NewClient(opts)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		client.Close()
		return nil, fmt.Errorf("failed to connect to valkey at %s: %w", opts.Addr, err)
	}

	log.Printf("Connected to Valkey/Redis at %s (DB: %d, Pool: %d)", opts.Addr, opts.DB, opts.PoolSize)
	return &Cache{client: client, enabled: true}, nil
}

// parseRedisURL parses a redis:// or rediss:// URL into redis.Options.
func parseRedisURL(rawURL string) (*redis.Options, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}

	if u.Scheme != "redis" && u.Scheme != "rediss" {
		return nil, fmt.Errorf("unsupported scheme %q, expected redis:// or rediss://", u.Scheme)
	}

	opts := &redis.Options{
		Addr:     u.Host,
		PoolSize: maxPoolSize,
	}

	// Password
	if u.User != nil {
		if pw, ok := u.User.Password(); ok {
			opts.Password = pw
		}
	}

	// DB number from path (e.g. /0, /1)
	if u.Path != "" && u.Path != "/" {
		dbStr := strings.TrimPrefix(u.Path, "/")
		if db, err := strconv.Atoi(dbStr); err == nil {
			opts.DB = db
		}
	}

	// TLS for rediss://
	if u.Scheme == "rediss" {
		opts.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	}

	return opts, nil
}

// NewNoop returns a cache that performs no operations (Valkey/Redis optional).
func NewNoop() *Cache {
	return &Cache{enabled: false}
}

// IsEnabled returns whether the cache is connected and operational.
func (c *Cache) IsEnabled() bool {
	return c != nil && c.enabled && c.client != nil
}

// Ping checks if the cache server is reachable.
func (c *Cache) Ping(ctx context.Context) error {
	if !c.IsEnabled() {
		return fmt.Errorf("cache is disabled")
	}
	return c.client.Ping(ctx).Err()
}

// --- Data operations ---

// GetJSON retrieves a JSON-serialized value from cache.
func (c *Cache) GetJSON(ctx context.Context, key string, dest interface{}) error {
	if !c.IsEnabled() {
		atomic.AddUint64(&c.misses, 1)
		return fmt.Errorf("cache miss")
	}
	val, err := c.client.Get(ctx, key).Result()
	if err == redis.Nil {
		atomic.AddUint64(&c.misses, 1)
		return fmt.Errorf("cache miss")
	} else if err != nil {
		return err
	}

	if err := json.Unmarshal([]byte(val), dest); err != nil {
		return fmt.Errorf("failed to unmarshal cached value: %w", err)
	}

	atomic.AddUint64(&c.hits, 1)
	return nil
}

// SetJSON stores a JSON-serialized value in cache with the given TTL.
func (c *Cache) SetJSON(ctx context.Context, key string, value interface{}, ttl time.Duration) error {
	if !c.IsEnabled() {
		return nil
	}
	jsonBytes, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("failed to marshal value: %w", err)
	}
	return c.client.Set(ctx, key, jsonBytes, ttl).Err()
}

// CompressAndStore stores the value (backward compat alias for SetJSON).
func (c *Cache) CompressAndStore(ctx context.Context, key string, value interface{}, ttl time.Duration) error {
	return c.SetJSON(ctx, key, value, ttl)
}

// FetchAndDecompress retrieves the value (backward compat alias for GetJSON).
func (c *Cache) FetchAndDecompress(ctx context.Context, key string, dest interface{}) error {
	return c.GetJSON(ctx, key, dest)
}

// Get retrieves a raw string value.
func (c *Cache) Get(ctx context.Context, key string) (string, error) {
	if !c.IsEnabled() {
		atomic.AddUint64(&c.misses, 1)
		return "", fmt.Errorf("cache miss")
	}
	val, err := c.client.Get(ctx, key).Result()
	if err == redis.Nil {
		atomic.AddUint64(&c.misses, 1)
		return "", fmt.Errorf("cache miss")
	}
	if err == nil {
		atomic.AddUint64(&c.hits, 1)
	}
	return val, err
}

// Set stores a raw value.
func (c *Cache) Set(ctx context.Context, key string, value interface{}, ttl time.Duration) error {
	if !c.IsEnabled() {
		return nil
	}
	return c.client.Set(ctx, key, value, ttl).Err()
}

// SetIfNotExists sets a key only if it does not already exist.
// Returns true when the key was set by this call.
func (c *Cache) SetIfNotExists(ctx context.Context, key string, value interface{}, ttl time.Duration) (bool, error) {
	if !c.IsEnabled() {
		return false, nil
	}
	return c.client.SetNX(ctx, key, value, ttl).Result()
}

// Expire updates a key TTL.
func (c *Cache) Expire(ctx context.Context, key string, ttl time.Duration) error {
	if !c.IsEnabled() {
		return nil
	}
	return c.client.Expire(ctx, key, ttl).Err()
}

// ZAdd adds a member with score to a sorted set.
func (c *Cache) ZAdd(ctx context.Context, key string, score float64, member string) error {
	if !c.IsEnabled() {
		return nil
	}
	return c.client.ZAdd(ctx, key, &redis.Z{Score: score, Member: member}).Err()
}

// ZRangeByScore returns members with scores in [minScore, maxScore], ascending.
// If count <= 0, Redis will return all matches.
func (c *Cache) ZRangeByScore(ctx context.Context, key string, minScore, maxScore int64, count int64) ([]string, error) {
	if !c.IsEnabled() {
		return []string{}, nil
	}
	by := &redis.ZRangeBy{
		Min: strconv.FormatInt(minScore, 10),
		Max: strconv.FormatInt(maxScore, 10),
	}
	if count > 0 {
		by.Offset = 0
		by.Count = count
	}
	return c.client.ZRangeByScore(ctx, key, by).Result()
}

// ZRem removes members from a sorted set and returns the number removed.
func (c *Cache) ZRem(ctx context.Context, key string, members ...string) (int64, error) {
	if !c.IsEnabled() || len(members) == 0 {
		return 0, nil
	}
	args := make([]interface{}, 0, len(members))
	for _, m := range members {
		args = append(args, m)
	}
	return c.client.ZRem(ctx, key, args...).Result()
}

// ZPopByScore atomically fetches and removes up to count members whose score is <= maxScore.
func (c *Cache) ZPopByScore(ctx context.Context, key string, maxScore int64, count int64) ([]string, error) {
	if !c.IsEnabled() {
		return []string{}, nil
	}
	if count <= 0 {
		count = 1
	}

	// Atomic read+remove to avoid duplicate processing across concurrent workers.
	const script = `
local key = KEYS[1]
local maxScore = ARGV[1]
local count = tonumber(ARGV[2])
local members = redis.call('ZRANGEBYSCORE', key, '-inf', maxScore, 'LIMIT', 0, count)
if #members > 0 then
  redis.call('ZREM', key, unpack(members))
end
return members
`

	res, err := c.client.Eval(ctx, script, []string{key}, strconv.FormatInt(maxScore, 10), strconv.FormatInt(count, 10)).Result()
	if err != nil {
		return nil, err
	}

	items, ok := res.([]interface{})
	if !ok {
		return []string{}, nil
	}
	out := make([]string, 0, len(items))
	for _, v := range items {
		s, castOK := v.(string)
		if castOK {
			out = append(out, s)
		}
	}
	return out, nil
}

// SAdd adds values to a set.
func (c *Cache) SAdd(ctx context.Context, key string, members ...string) error {
	if !c.IsEnabled() || len(members) == 0 {
		return nil
	}
	args := make([]interface{}, 0, len(members))
	for _, m := range members {
		args = append(args, m)
	}
	return c.client.SAdd(ctx, key, args...).Err()
}

// SMembers returns all members in a set.
func (c *Cache) SMembers(ctx context.Context, key string) ([]string, error) {
	if !c.IsEnabled() {
		return []string{}, nil
	}
	return c.client.SMembers(ctx, key).Result()
}

// SRem removes values from a set.
func (c *Cache) SRem(ctx context.Context, key string, members ...string) error {
	if !c.IsEnabled() || len(members) == 0 {
		return nil
	}
	args := make([]interface{}, 0, len(members))
	for _, m := range members {
		args = append(args, m)
	}
	return c.client.SRem(ctx, key, args...).Err()
}

// Delete removes keys from cache.
func (c *Cache) Delete(ctx context.Context, keys ...string) error {
	if !c.IsEnabled() {
		return nil
	}
	return c.client.Del(ctx, keys...).Err()
}

// DeleteByPrefix removes all keys matching the prefix pattern using SCAN.
func (c *Cache) DeleteByPrefix(ctx context.Context, prefix string) error {
	if prefix == "" || !c.IsEnabled() {
		return nil
	}

	var cursor uint64
	pattern := prefix + "*"
	for {
		keys, nextCursor, err := c.client.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			return err
		}
		if len(keys) > 0 {
			if err := c.client.Del(ctx, keys...).Err(); err != nil {
				return err
			}
		}
		if nextCursor == 0 {
			break
		}
		cursor = nextCursor
	}

	return nil
}

// ListKeysByPrefix returns all keys matching the prefix pattern using SCAN.
// This is used by background maintenance flows that need to process keys in bulk.
func (c *Cache) ListKeysByPrefix(ctx context.Context, prefix string) ([]string, error) {
	if prefix == "" || !c.IsEnabled() {
		return []string{}, nil
	}

	keys := make([]string, 0, 64)
	var cursor uint64
	pattern := prefix + "*"

	for {
		batch, nextCursor, err := c.client.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			return nil, err
		}
		if len(batch) > 0 {
			keys = append(keys, batch...)
		}
		if nextCursor == 0 {
			break
		}
		cursor = nextCursor
	}

	return keys, nil
}

// Close closes the cache connection.
func (c *Cache) Close() error {
	if c == nil || c.client == nil {
		return nil
	}
	return c.client.Close()
}

// Stats returns cache hit/miss metrics.
func (c *Cache) Stats() CacheStats {
	if c == nil {
		return CacheStats{}
	}
	return CacheStats{
		Hits:   atomic.LoadUint64(&c.hits),
		Misses: atomic.LoadUint64(&c.misses),
	}
}

// Len returns an approximate number of keys in the cache store.
func (c *Cache) Len() int {
	if !c.IsEnabled() {
		return 0
	}
	count, err := c.client.DBSize(context.Background()).Result()
	if err != nil {
		return 0
	}
	return int(count)
}
