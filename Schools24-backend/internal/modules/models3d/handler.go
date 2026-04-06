package models3d

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// Model3D represents a single 3D anatomical model entry.
type Model3D struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	MedicalName string `json:"medical_name"`
	Description string `json:"description"`
	Category    string `json:"category"` // "organ", "cell", "structure"
	Filename    string `json:"filename"` // e.g. "brain.glb"
	FilePath    string `json:"file_path,omitempty"`
	EmbedURL    string `json:"embed_url,omitempty"`
	Source      string `json:"source"`
	License     string `json:"license"`
	Available   bool   `json:"available"`
}

// Manifest is the on-disk JSON structure listing all configured 3D models.
type Manifest struct {
	Models []Model3D `json:"models"`
}

// Handler serves 3D model metadata from a JSON manifest on disk.
// The actual .glb/.gltf files are served by Gin's r.Static("/uploads", "./uploads").
type Handler struct {
	modelsDir string // absolute or relative path to the 3d-models directory
}

// NewHandler creates a Handler pointing at the given directory
// (typically "./uploads/3d-models").
func NewHandler(modelsDir string) *Handler {
	return &Handler{modelsDir: modelsDir}
}

func (h *Handler) resolveModelsDir() string {
	candidates := []string{
		h.modelsDir,
		"./uploads/3d-models",
		"./Schools24-backend/uploads/3d-models",
		"../uploads/3d-models",
	}

	for _, dir := range candidates {
		if strings.TrimSpace(dir) == "" {
			continue
		}
		manifestPath := filepath.Join(dir, "models.json")
		if _, err := os.Stat(manifestPath); err == nil {
			return dir
		}
	}

	return h.modelsDir
}

// ListModels reads uploads/3d-models/models.json, checks which .glb files
// actually exist on disk, and returns the enriched list.
//
// GET /api/v1/teacher/3d-models
func (h *Handler) ListModels(c *gin.Context) {
	modelsDir := h.resolveModelsDir()
	manifestPath := filepath.Join(modelsDir, "models.json")

	data, err := os.ReadFile(manifestPath)
	if err != nil {
		// Not an error - it means no models are configured yet.
		c.JSON(http.StatusOK, gin.H{
			"models":  []Model3D{},
			"message": "No 3D models configured yet. Place models.json in uploads/3d-models/.",
		})
		return
	}

	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid models.json manifest"})
		return
	}

	// Enrich each entry: check file existence and build serve URL.
	for i := range manifest.Models {
		m := &manifest.Models[i]
		if strings.TrimSpace(m.MedicalName) == "" {
			m.MedicalName = m.Name
		}
		if strings.TrimSpace(m.Category) == "" {
			m.Category = "organ"
		}
		glbPath := filepath.Join(modelsDir, m.Filename)
		if _, err := os.Stat(glbPath); err == nil {
			m.Available = true
		} else {
			m.Available = false
		}
		m.FilePath = "/uploads/3d-models/" + m.Filename
	}

	c.JSON(http.StatusOK, gin.H{"models": manifest.Models})
}

// GetModel returns metadata for a single model by ID.
//
// GET /api/v1/teacher/3d-models/:id
func (h *Handler) GetModel(c *gin.Context) {
	id := c.Param("id")
	modelsDir := h.resolveModelsDir()
	manifestPath := filepath.Join(modelsDir, "models.json")

	data, err := os.ReadFile(manifestPath)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No models configured"})
		return
	}

	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid models manifest"})
		return
	}

	for _, m := range manifest.Models {
		if m.ID == id {
			if strings.TrimSpace(m.MedicalName) == "" {
				m.MedicalName = m.Name
			}
			if strings.TrimSpace(m.Category) == "" {
				m.Category = "organ"
			}
			glbPath := filepath.Join(modelsDir, m.Filename)
			if _, fErr := os.Stat(glbPath); fErr == nil {
				m.Available = true
			}
			m.FilePath = "/uploads/3d-models/" + m.Filename
			c.JSON(http.StatusOK, m)
			return
		}
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "Model not found"})
}
