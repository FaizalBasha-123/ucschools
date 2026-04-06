# Schools24 Oracle Cloud (Seamless Deployment)

This guide gets your backend running on Oracle Cloud Always Free (ARM) in 5 minutes.

## Prerequisite
- Oracle Cloud Account (Free Tier) with **Ubuntu 22.04** or **Oracle Linux 8** instance.
- SSH Access to the VM.

## 1. One-Command Setup (Run on VM)

Connect to your VM and run this block. It installs Docker, Firewall rules, and gets ready.

```bash
# Ubuntu
sudo apt update && sudo apt install -y docker.io docker-compose git
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
sudo ufw allow 8080/tcp
exit
# (Now login again to apply group changes)
```

## 2. Deploy Code

On your **Local Machine**, build the ARM binary and send it (faster than building on server).

```powershell
# In d:\Schools24-Workspace\schools24-backend
# 1. Build linux arm64 binary
$Env:GOOS = "linux"; $Env:GOARCH = "arm64"; go build -o backend-arm64 ./cmd/server/main.go

# 2. Copy binary and .env to server
scp backend-arm64 ubuntu@<YOUR_VM_IP>:~/schools24-backend
scp .env ubuntu@<YOUR_VM_IP>:~/schools24-backend/.env
```

## 3. Start Service (On VM)

```bash
ssh ubuntu@<YOUR_VM_IP>

# Create systemd service for auto-restart
sudo nano /etc/systemd/system/schools24.service
```

Paste this into the file:
```ini
[Unit]
Description=Schools24 Backend
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu
ExecStart=/home/ubuntu/schools24-backend
Restart=always
EnvironmentFile=/home/ubuntu/.env
Environment=GIN_MODE=release

[Install]
WantedBy=multi-user.target
```

**Enable and Start:**
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now schools24
```

## 4. Verify
```bash
curl http://localhost:8080/health
# {"status":"healthy"}
```

## why this method?
- **No Docker Overhead**: We run the binary directly. Saves ~100MB RAM.
- **Fast Deploy**: You compile locally, so the server never freezes trying to compile Go code.
- **Auto-Restart**: Systemd handles restarts automatically.
