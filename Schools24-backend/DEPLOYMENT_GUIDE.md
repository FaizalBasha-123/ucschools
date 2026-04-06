# Schools24 Deployment Guide
## Local Dev (K3d) → Testing (Kind) → Production (Oracle Cloud OKE)

---

## 1. Local Development with K3d

### Prerequisites
```powershell
# Install K3d
choco install k3d -y
# OR: winget install k3d

# Install kubectl
choco install kubernetes-cli -y
```

### Create Cluster
```powershell
# Create Schools24 cluster
k3d cluster create schools24 \
  --api-port 6550 \
  -p "8080:80@loadbalancer" \
  -p "8443:443@loadbalancer" \
  --agents 2

# Verify
kubectl get nodes
```

### Deploy Application
```powershell
cd schools24-backend

# Create namespace
kubectl create namespace schools24

# Create secrets
kubectl create secret generic db-secrets \
  --from-literal=database-url="your_supabase_url" \
  --from-literal=r2-account-id="your_cloudflare_account_id" \
  --from-literal=r2-access-key-id="your_r2_access_key_id" \
  --from-literal=r2-secret-access-key="your_r2_secret_access_key" \
  --from-literal=r2-bucket-name="schools24-documents" \
  -n schools24

# Deploy
kubectl apply -f deployments/kubernetes/ -n schools24

# Verify
kubectl get pods -n schools24
```

### Access
- KrakenD Gateway: `http://localhost:8080`
- Health check: `curl http://localhost:8080/health`

---

## 2. Testing with Kind

### Setup
```powershell
# Install Kind
choco install kind -y

# Create cluster config
```

### kind-config.yaml
```yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
  extraPortMappings:
  - containerPort: 30080
    hostPort: 8080
    protocol: TCP
- role: worker
- role: worker
```

### Create & Deploy
```powershell
# Create cluster
kind create cluster --name schools24-test --config kind-config.yaml

# Load local images (faster than pulling)
kind load docker-image schools24/backend:latest --name schools24-test

# Deploy with Istio
istioctl install --set profile=demo -y
kubectl label namespace schools24 istio-injection=enabled
kubectl apply -f deployments/kubernetes/ -n schools24

# Run tests
kubectl exec -it deploy/backend -n schools24 -- /app/backend --test
```

---

## 3. Production: Oracle Cloud OKE

### Prerequisites
1. Oracle Cloud account with OKE access
2. OCI CLI installed: `choco install oci-cli -y`
3. Configure: `oci setup config`

### Create OKE Cluster (via Terraform or Console)
```hcl
# terraform/oci-oke.tf (example)
resource "oci_containerengine_cluster" "schools24" {
  compartment_id     = var.compartment_id
  kubernetes_version = "v1.28.2"
  name               = "schools24-cluster"
  vcn_id             = oci_core_vcn.schools24_vcn.id

  options {
    kubernetes_network_config {
      pods_cidr     = "10.244.0.0/16"
      services_cidr = "10.96.0.0/16"
    }
  }
}
```

### Connect to OKE
```powershell
# Get kubeconfig
oci ce cluster create-kubeconfig \
  --cluster-id <cluster-ocid> \
  --file $HOME/.kube/config \
  --region <region> \
  --token-version 2.0.0

# Verify
kubectl get nodes
```

### Deploy to OKE
```powershell
# Create namespace
kubectl create namespace schools24

# Create secrets from OCI Vault (recommended) or directly
kubectl create secret generic db-secrets \
  --from-literal=database-url="$SUPABASE_URL" \
  --from-literal=r2-account-id="$R2_ACCOUNT_ID" \
  --from-literal=r2-access-key-id="$R2_ACCESS_KEY_ID" \
  --from-literal=r2-secret-access-key="$R2_SECRET_ACCESS_KEY" \
  --from-literal=r2-bucket-name="$R2_BUCKET_NAME" \
  -n schools24

# Install Istio
istioctl install --set profile=production -y
kubectl label namespace schools24 istio-injection=enabled

# Deploy application
kubectl apply -f deployments/kubernetes/ -n schools24

# Setup Ingress (OCI Load Balancer)
kubectl apply -f deployments/kubernetes/oci-ingress.yaml
```

---

## 4. OCI-Specific Manifests

### deployments/kubernetes/oci-ingress.yaml
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: schools24-ingress
  namespace: schools24
  annotations:
    kubernetes.io/ingress.class: "nginx"
    oci.oraclecloud.com/load-balancer-type: "lb"
    service.beta.kubernetes.io/oci-load-balancer-shape: "flexible"
    service.beta.kubernetes.io/oci-load-balancer-shape-flex-min: "10"
    service.beta.kubernetes.io/oci-load-balancer-shape-flex-max: "100"
spec:
  rules:
  - host: api.schools24.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: krakend
            port:
              number: 80
```

### OCI Container Registry
```powershell
# Login to OCI Registry
docker login <region>.ocir.io -u <tenancy>/<username>

# Tag and push
docker tag schools24/backend:latest <region>.ocir.io/<tenancy>/schools24/backend:latest
docker push <region>.ocir.io/<tenancy>/schools24/backend:latest

# Update deployment to use OCI Registry
# image: <region>.ocir.io/<tenancy>/schools24/backend:latest
```

---

## 5. Environment-Specific Configs

| Environment | Config Source | PostgreSQL | Object Storage | Redis |
|-------------|---------------|------------|----------------|-------|
| **K3d (Dev)** | `.env` file | Supabase/Neon | Cloudflare R2 | Local container |
| **Kind (Test)** | K8s ConfigMap | Supabase/Neon | Cloudflare R2 | Local container |
| **OKE (Prod)** | OCI Vault Secrets | Supabase/Neon | Cloudflare R2 | OCI Cache (Redis) |

---

## 6. Quick Commands Reference

```powershell
# === K3d (Dev) ===
k3d cluster create schools24 -p "8080:80@loadbalancer"
k3d cluster delete schools24

# === Kind (Test) ===
kind create cluster --name schools24-test
kind delete cluster --name schools24-test

# === OKE (Prod) ===
oci ce cluster create-kubeconfig --cluster-id <ocid>
kubectl config use-context <oke-context>
```
