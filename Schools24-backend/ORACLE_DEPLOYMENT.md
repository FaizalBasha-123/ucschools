# Schools24 - Oracle Cloud Deployment Guide

Deploy to **Oracle Cloud Always Free** ARM VM. Zero cost, high performance.

---

## VM Specs (Free Forever)
| Resource | Value |
|----------|-------|
| CPU | 4 OCPU (ARM Ampere A1) |
| RAM | 24 GB |
| Storage | 200 GB |
| Network | 480 Mbps |
| **Cost** | **$0/month** |

---

## Step 1: Create VM (5 minutes)

1. Login to [cloud.oracle.com](https://cloud.oracle.com)
2. Go to **Compute → Instances → Create Instance**
3. Configure:
   - **Name**: `schools24-server`
   - **Image**: Ubuntu 22.04 (Canonical)
   - **Shape**: VM.Standard.A1.Flex
   - **OCPU**: 4 | **Memory**: 24 GB
   - **Add SSH Key**: Paste your public key
4. Click **Create**
5. Note the **Public IP** once created

---

## Step 2: Setup Server (Run on VM)

SSH into your server:
```bash
ssh ubuntu@<YOUR_PUBLIC_IP>
```

Run this setup script:
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install essentials
sudo apt install -y git nano htop

# Open firewall
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8080/tcp
sudo ufw --force enable

# Create app directory
mkdir -p ~/schools24
```

---

## Step 3: Build Binary Locally (On Your PC)

Open PowerShell in `d:\Schools24-Workspace\schools24-backend`:

```powershell
# Set cross-compile for Linux ARM64
$Env:GOOS = "linux"
$Env:GOARCH = "arm64"
$Env:CGO_ENABLED = "0"

# Build optimized binary
go build -ldflags="-s -w" -o schools24-server ./cmd/server/main.go

# Check it was created
dir schools24-server
# Should show ~15-20 MB file
```

---

## Step 4: Upload to Server

```powershell
# Upload binary
scp schools24-server ubuntu@<YOUR_PUBLIC_IP>:~/schools24/

# Upload env file (EDIT THIS FIRST!)
scp .env ubuntu@<YOUR_PUBLIC_IP>:~/schools24/.env
```

---

## Step 5: Create Environment File

Create `.env` file with your credentials:

```bash
# On server: ~/schools24/.env

# === APP ===
APP_NAME=schools24-backend
APP_ENV=production
APP_PORT=8080
GIN_MODE=release

# === DATABASE (Neon PostgreSQL) ===
DATABASE_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require

# === CLOUDFLARE R2 (Object Storage) ===
R2_ENABLED=true
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
R2_BUCKET_NAME=schools24-documents
R2_REGION=auto

# === JWT ===
JWT_SECRET=your-super-secret-key-at-least-32-characters-long
JWT_EXPIRATION_HOURS=24

# === RATE LIMITING ===
RATE_LIMIT_REQUESTS_PER_MIN=100
RATE_LIMIT_BURST=50

# === CORS ===
CORS_ALLOWED_ORIGINS=*
CORS_ALLOWED_METHODS=GET,POST,PUT,DELETE,OPTIONS
CORS_ALLOWED_HEADERS=Content-Type,Authorization
```

---

## Step 6: Create Systemd Service

```bash
sudo nano /etc/systemd/system/schools24.service
```

Paste this:
```ini
[Unit]
Description=Schools24 Backend API
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/schools24
ExecStart=/home/ubuntu/schools24/schools24-server
Restart=always
RestartSec=5
EnvironmentFile=/home/ubuntu/schools24/.env

# Security
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/ubuntu/schools24

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable schools24
sudo systemctl start schools24
```

---

## Step 7: Verify

```bash
# Check status
sudo systemctl status schools24

# Check logs
sudo journalctl -u schools24 -f

# Test endpoint
curl http://localhost:8080/health
# {"status":"healthy","service":"schools24-backend"}
```

---

## Step 8: Setup Domain + HTTPS (Optional)

### Install Caddy (Auto SSL)
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

### Configure Caddy
```bash
sudo nano /etc/caddy/Caddyfile
```

```
api.yourschool.com {
    reverse_proxy localhost:8080
}
```

```bash
sudo systemctl restart caddy
```

Your API is now at: `https://api.yourschool.com`

---

## Quick Commands

```bash
# View live logs
sudo journalctl -u schools24 -f

# Restart service
sudo systemctl restart schools24

# Check memory usage
htop

# Update binary (from local PC)
scp schools24-server ubuntu@<IP>:~/schools24/
sudo systemctl restart schools24
```

---

## Resource Usage

| Metric | Value |
|--------|-------|
| RAM (Idle) | ~30-50 MB |
| RAM (Load) | ~100-200 MB |
| CPU | <1% idle |
| Disk | ~20 MB |
