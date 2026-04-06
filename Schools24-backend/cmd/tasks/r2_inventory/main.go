package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/schools24/backend/internal/config"
)

type node struct {
	name     string
	children map[string]*node
	files    int
}

func newNode(name string) *node {
	return &node{name: name, children: map[string]*node{}}
}

func (n *node) addPath(parts []string) {
	if len(parts) == 0 {
		n.files++
		return
	}
	head := parts[0]
	child, ok := n.children[head]
	if !ok {
		child = newNode(head)
		n.children[head] = child
	}
	child.addPath(parts[1:])
}

func (n *node) writeTree(w *bufio.Writer, prefix string, depth int, maxDepth int) {
	if depth > maxDepth {
		return
	}

	keys := make([]string, 0, len(n.children))
	for k := range n.children {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, k := range keys {
		c := n.children[k]
		line := fmt.Sprintf("%s%s/", prefix, c.name)
		if c.files > 0 {
			line = fmt.Sprintf("%s (%d files)", line, c.files)
		}
		_, _ = w.WriteString(line + "\n")
		c.writeTree(w, prefix+"  ", depth+1, maxDepth)
	}
}

func buildClient(ctx context.Context, cfg *config.Config) (*s3.Client, string, error) {
	region := strings.TrimSpace(cfg.R2.Region)
	if region == "" {
		region = "auto"
	}
	endpoint := strings.TrimSpace(cfg.R2.Endpoint)
	if endpoint == "" && strings.TrimSpace(cfg.R2.AccountID) != "" {
		endpoint = fmt.Sprintf("https://%s.r2.cloudflarestorage.com", strings.TrimSpace(cfg.R2.AccountID))
	}
	bucket := strings.TrimSpace(cfg.R2.BucketName)
	if bucket == "" {
		return nil, "", fmt.Errorf("R2 bucket name is empty")
	}

	awsCfg, err := awsconfig.LoadDefaultConfig(
		ctx,
		awsconfig.WithRegion(region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			strings.TrimSpace(cfg.R2.AccessKeyID),
			strings.TrimSpace(cfg.R2.SecretAccessKey),
			"",
		)),
	)
	if err != nil {
		return nil, "", fmt.Errorf("load aws config: %w", err)
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.UsePathStyle = true
		if endpoint != "" {
			o.BaseEndpoint = aws.String(endpoint)
		}
	})
	return client, bucket, nil
}

func main() {
	limit := flag.Int("limit", 0, "max number of keys to print into keys file (0 = all)")
	maxDepth := flag.Int("depth", 8, "max folder depth to render in tree")
	prefix := flag.String("prefix", "", "optional key prefix filter")
	flag.Parse()

	cfg := config.Load()
	if !cfg.R2.Enabled {
		fmt.Println("R2 is disabled (R2_ENABLED=false)")
		os.Exit(1)
	}

	ctx := context.Background()
	client, bucket, err := buildClient(ctx, cfg)
	if err != nil {
		fmt.Printf("Failed to init R2 client: %v\n", err)
		os.Exit(1)
	}

	cwd, _ := os.Getwd()
	keysPath := filepath.Join(cwd, "r2_inventory_keys.txt")
	treePath := filepath.Join(cwd, "r2_inventory_tree.txt")

	keysFile, err := os.Create(keysPath)
	if err != nil {
		fmt.Printf("Failed to create keys output file: %v\n", err)
		os.Exit(1)
	}
	defer keysFile.Close()
	keysWriter := bufio.NewWriter(keysFile)
	defer keysWriter.Flush()

	treeRoot := newNode("/")
	total := 0
	written := 0

	paginator := s3.NewListObjectsV2Paginator(client, &s3.ListObjectsV2Input{
		Bucket: aws.String(bucket),
		Prefix: aws.String(strings.TrimSpace(*prefix)),
	})

	for paginator.HasMorePages() {
		page, pageErr := paginator.NextPage(ctx)
		if pageErr != nil {
			fmt.Printf("ListObjectsV2 failed: %v\n", pageErr)
			os.Exit(1)
		}

		for _, obj := range page.Contents {
			if obj.Key == nil || strings.TrimSpace(*obj.Key) == "" {
				continue
			}
			key := *obj.Key
			total++

			parts := strings.Split(strings.Trim(key, "/"), "/")
			treeRoot.addPath(parts)

			if *limit == 0 || written < *limit {
				_, _ = keysWriter.WriteString(key + "\n")
				written++
			}
		}
	}

	treeFile, err := os.Create(treePath)
	if err != nil {
		fmt.Printf("Failed to create tree output file: %v\n", err)
		os.Exit(1)
	}
	defer treeFile.Close()
	treeWriter := bufio.NewWriter(treeFile)
	defer treeWriter.Flush()

	_, _ = treeWriter.WriteString(fmt.Sprintf("Bucket: %s\n", bucket))
	_, _ = treeWriter.WriteString(fmt.Sprintf("Prefix: %s\n", strings.TrimSpace(*prefix)))
	_, _ = treeWriter.WriteString(fmt.Sprintf("Total objects: %d\n\n", total))
	treeRoot.writeTree(treeWriter, "", 0, *maxDepth)

	fmt.Printf("R2 inventory complete. Bucket=%s TotalObjects=%d\n", bucket, total)
	fmt.Printf("Keys file: %s (written=%d limit=%d)\n", keysPath, written, *limit)
	fmt.Printf("Tree file: %s (depth=%d)\n", treePath, *maxDepth)
}
