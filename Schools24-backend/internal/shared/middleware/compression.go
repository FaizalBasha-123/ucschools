package middleware

import (
	"compress/gzip"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
)

// gzipWriterPool is a pool of gzip writers for reuse
var gzipWriterPool = sync.Pool{
	New: func() interface{} {
		gz, _ := gzip.NewWriterLevel(io.Discard, gzip.BestSpeed)
		return gz
	},
}

type gzipWriter struct {
	gin.ResponseWriter
	writer *gzip.Writer
}

func (g *gzipWriter) WriteHeader(code int) {
	// Content length is unknown once gzip is applied.
	g.Header().Del("Content-Length")
	g.ResponseWriter.WriteHeader(code)
}

func (g *gzipWriter) WriteString(s string) (int, error) {
	g.Header().Del("Content-Length")
	return g.writer.Write([]byte(s))
}

func (g *gzipWriter) Write(data []byte) (int, error) {
	g.Header().Del("Content-Length")
	return g.writer.Write(data)
}

// Gzip returns a middleware that compresses HTTP responses using gzip
// This significantly reduces response sizes and improves load times
func Gzip() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Skip compression for:
		// 1. WebSocket connections
		// 2. Clients that don't accept gzip
		// 3. Already compressed content (images, videos, etc.)
		if !shouldCompress(c.Request) {
			c.Next()
			return
		}

		// Get gzip writer from pool
		gz := gzipWriterPool.Get().(*gzip.Writer)
		defer gzipWriterPool.Put(gz)

		gz.Reset(c.Writer)
		defer gz.Close()

		// Set headers
		c.Header("Content-Encoding", "gzip")
		c.Header("Vary", "Accept-Encoding")

		// Wrap response writer
		c.Writer = &gzipWriter{
			ResponseWriter: c.Writer,
			writer:         gz,
		}

		c.Next()
	}
}

func shouldCompress(req *http.Request) bool {
	// Check if client accepts gzip
	if !strings.Contains(req.Header.Get("Accept-Encoding"), "gzip") {
		return false
	}

	// Skip for WebSocket upgrade requests
	if req.Header.Get("Upgrade") == "websocket" {
		return false
	}

	// Skip for already compressed content types
	contentType := req.Header.Get("Content-Type")
	excludedTypes := []string{
		"image/",
		"video/",
		"audio/",
		"application/zip",
		"application/gzip",
		"application/x-compressed",
	}

	for _, excluded := range excludedTypes {
		if strings.HasPrefix(contentType, excluded) {
			return false
		}
	}

	return true
}
