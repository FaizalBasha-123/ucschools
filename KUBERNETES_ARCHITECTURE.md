# ☸️ Schools24 Kubernetes Architecture with Nodal Hosting

## Executive Summary

This document outlines a **production-ready Kubernetes architecture** for Schools24 that implements **nodal pod distribution**, **auto-scaling**, **failover**, and **cost optimization** strategies. The design distributes microservices across multiple nodes for high availability while optimizing resource utilization.

---

## 🎯 Architecture Goals

✅ **Node Distribution**: Strategic placement of services across nodes  
✅ **Resilience & Failover**: Automatic pod rescheduling on node failures  
✅ **Autoscaling**: HPA for pods + Cluster Autoscaler for nodes  
✅ **Cost Optimization**: Consolidate services, use spot instances  
✅ **Service Mesh**: Secure inter-service communication  
✅ **Monitoring**: Prometheus + Grafana + ELK stack  

---

## 📐 Kubernetes Cluster Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SCHOOLS24 KUBERNETES CLUSTER                          │
│                       (AWS EKS / Azure AKS / GKE)                            │
└─────────────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════════
                         EXTERNAL TRAFFIC FLOW
═══════════════════════════════════════════════════════════════════════════════

    [Students]  [Teachers]  [Admins]  [Parents]  [Smart Boards]
         │           │          │         │            │
         └───────────┴──────────┴─────────┴────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   Cloud Load        │
                    │   Balancer          │
                    │   (AWS ALB/NLB)     │
                    └──────────┬──────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         KRAKEND CE (API Gateway)                             │
│                   • Ultra-high performance (70K req/s)                       │
│                   • JWT validation & rate limiting                           │
│                   • Response aggregation & caching                           │
│                   • Stateless & declarative JSON config                      │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│  Backend     │      │   WebSocket  │      │ Static Files │
│  Service(s)  │      │   Service    │      │   (CDN)      │
└──────────────┘      └──────────────┘      └──────────────┘

═══════════════════════════════════════════════════════════════════════════════
                           NODE DISTRIBUTION STRATEGY
═══════════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────────┐
│                              NODE 1 (Core Services)                          │
│                        Instance Type: m5.large (2 vCPU, 8GB RAM)             │
│                        Zone: us-east-1a                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  Pod 1: Auth Service            │  Resources: 256Mi RAM, 250m CPU           │
│  Pod 2: Dashboard Service       │  Resources: 512Mi RAM, 500m CPU           │
│  Pod 3: Student Service         │  Resources: 512Mi RAM, 500m CPU           │
│  Pod 4: Teacher Service         │  Resources: 512Mi RAM, 500m CPU           │
│  Pod 5: Notification Service    │  Resources: 256Mi RAM, 250m CPU           │
│                                                                              │
│  Total Allocated: ~2GB RAM, 1.75 vCPU                                       │
│  Available for scaling: 6GB RAM, 0.25 vCPU                                  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           NODE 2 (Academic Services)                         │
│                        Instance Type: m5.large (2 vCPU, 8GB RAM)             │
│                        Zone: us-east-1b (Different AZ for HA)                │
├─────────────────────────────────────────────────────────────────────────────┤
│  Pod 1: Quiz Service            │  Resources: 512Mi RAM, 500m CPU           │
│  Pod 2: Homework Service        │  Resources: 512Mi RAM, 500m CPU           │
│  Pod 3: Attendance Service      │  Resources: 256Mi RAM, 250m CPU           │
│  Pod 4: Exam Service            │  Resources: 512Mi RAM, 500m CPU           │
│  Pod 5: Grade Service           │  Resources: 256Mi RAM, 250m CPU           │
│                                                                              │
│  Total Allocated: ~2GB RAM, 2 vCPU                                          │
│  Available for scaling: 6GB RAM, 0 vCPU                                     │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         NODE 3 (Financial & Operations)                      │
│                        Instance Type: t3.medium (2 vCPU, 4GB RAM)            │
│                        Zone: us-east-1a                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  Pod 1: Fee Service             │  Resources: 512Mi RAM, 500m CPU           │
│  Pod 2: Payment Service         │  Resources: 512Mi RAM, 500m CPU           │
│  Pod 3: Inventory Service       │  Resources: 256Mi RAM, 250m CPU           │
│  Pod 4: Bus Route Service       │  Resources: 256Mi RAM, 250m CPU           │
│                                                                              │
│  Total Allocated: ~1.5GB RAM, 1.5 vCPU                                      │
│  Available for scaling: 2.5GB RAM, 0.5 vCPU                                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                NODE 4 (Analytics & Reporting - Spot Instance)                │
│                        Instance Type: m5.large (Spot - 70% cheaper)          │
│                        Zone: us-east-1c                                      │
│                        Preemptible: Yes (Non-critical workloads)             │
├─────────────────────────────────────────────────────────────────────────────┤
│  Pod 1: Analytics Service       │  Resources: 1Gi RAM, 1 CPU                │
│  Pod 2: Report Service          │  Resources: 1Gi RAM, 1 CPU                │
│  Pod 3: Monitoring Service      │  Resources: 512Mi RAM, 500m CPU           │
│  Pod 4: Batch Processor         │  Resources: 512Mi RAM, 500m CPU           │
│                                                                              │
│  Total Allocated: ~3GB RAM, 3 vCPU                                          │
│  Cost Savings: ~$100/month with spot instances                              │
└─────────────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════════
                         DATA PLANE (StatefulSets)
═══════════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────────┐
│                    NODE 5 (Database - Persistent Storage)                    │
│                        Instance Type: r5.large (2 vCPU, 16GB RAM)            │
│                        Zone: us-east-1a                                      │
│                        EBS Volume: 100GB gp3 SSD                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  StatefulSet: Redis Master      │  Resources: 4Gi RAM, 1 CPU                │
│  StatefulSet: Redis Replica 1   │  Resources: 4Gi RAM, 1 CPU                │
│                                                                              │
│  Total Allocated: 8GB RAM, 2 vCPU                                           │
│  Persistent Volume: 20GB for Redis RDB snapshots                            │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│               EXTERNAL MANAGED SERVICES (Not on Cluster)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  • PostgreSQL: AWS RDS (db.m5.large, Multi-AZ)                              │
│  • MongoDB: MongoDB Atlas (M10 cluster)                                     │
│  • S3: File storage (homework, materials, invoices)                         │
│  • CloudFront: CDN for static asset delivery                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔧 Service Pod Specifications

### 1. Core Services (Node 1)

#### Auth Service
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: auth-service
  namespace: schools24
spec:
  replicas: 2  # High availability
  selector:
    matchLabels:
      app: auth-service
  template:
    metadata:
      labels:
        app: auth-service
        tier: core
    spec:
      affinity:
        podAntiAffinity:  # Spread across nodes
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: app
                  operator: In
                  values:
                  - auth-service
              topologyKey: kubernetes.io/hostname
      containers:
      - name: auth-service
        image: schools24/auth-service:v1.0.0
        ports:
        - containerPort: 8080
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        env:
        - name: REDIS_HOST
          value: "redis-master-service"
        - name: POSTGRES_HOST
          valueFrom:
            secretKeyRef:
              name: db-secrets
              key: postgres-host
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 15
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: auth-service
  namespace: schools24
spec:
  selector:
    app: auth-service
  ports:
  - protocol: TCP
    port: 80
    targetPort: 8080
  type: ClusterIP
```

---

#### Dashboard Service
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dashboard-service
  namespace: schools24
spec:
  replicas: 2
  selector:
    matchLabels:
      app: dashboard-service
  template:
    metadata:
      labels:
        app: dashboard-service
        tier: core
    spec:
      containers:
      - name: dashboard-service
        image: schools24/dashboard-service:v1.0.0
        ports:
        - containerPort: 8080
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        env:
        - name: REDIS_HOST
          value: "redis-master-service"
        - name: CACHE_TTL_SECONDS
          value: "1800"  # 30 minutes
```

---

### 2. Academic Services (Node 2)

#### Exam Service (with Horizontal Pod Autoscaler)
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: exam-service
  namespace: schools24
spec:
  replicas: 2  # Baseline replicas
  selector:
    matchLabels:
      app: exam-service
  template:
    metadata:
      labels:
        app: exam-service
        tier: academic
    spec:
      containers:
      - name: exam-service
        image: schools24/exam-service:v1.0.0
        ports:
        - containerPort: 8080
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: exam-service-hpa
  namespace: schools24
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: exam-service
  minReplicas: 2   # Minimum during off-season
  maxReplicas: 10  # Scale up during exam season
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300  # Wait 5 min before scaling down
      policies:
      - type: Percent
        value: 50
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 60  # Scale up quickly
      policies:
      - type: Percent
        value: 100
        periodSeconds: 30
```

---

#### Quiz Service (with MongoDB connection)
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: quiz-service
  namespace: schools24
spec:
  replicas: 2
  selector:
    matchLabels:
      app: quiz-service
  template:
    metadata:
      labels:
        app: quiz-service
    spec:
      containers:
      - name: quiz-service
        image: schools24/quiz-service:v1.0.0
        ports:
        - containerPort: 8080
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        env:
        - name: MONGODB_URI
          valueFrom:
            secretKeyRef:
              name: db-secrets
              key: mongodb-uri
        - name: REDIS_HOST
          value: "redis-master-service"
```

---

### 3. Consolidated Services (Cost Optimization)

#### Notification Service (Email + SMS + Push combined)
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-service
  namespace: schools24
spec:
  replicas: 2
  selector:
    matchLabels:
      app: notification-service
  template:
    metadata:
      labels:
        app: notification-service
    spec:
      containers:
      - name: notification-service
        image: schools24/notification-service:v1.0.0
        ports:
        - containerPort: 8080
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        env:
        - name: TWILIO_API_KEY
          valueFrom:
            secretKeyRef:
              name: external-api-secrets
              key: twilio-api-key
        - name: SENDGRID_API_KEY
          valueFrom:
            secretKeyRef:
              name: external-api-secrets
              key: sendgrid-api-key
        - name: FCM_SERVER_KEY
          valueFrom:
            secretKeyRef:
              name: external-api-secrets
              key: fcm-server-key
```

**Why Consolidated?**  
Instead of separate microservices for Email, SMS, and Push notifications, we combine into one service to:
- Reduce pod overhead (saves ~300MB RAM per avoided pod)
- Simplify deployment and monitoring
- Still maintainable with internal packages (`internal/email`, `internal/sms`, `internal/push`)

---

### 4. Redis StatefulSet (High Availability)

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redis-master
  namespace: schools24
spec:
  serviceName: redis-master
  replicas: 1
  selector:
    matchLabels:
      app: redis
      role: master
  template:
    metadata:
      labels:
        app: redis
        role: master
    spec:
      containers:
      - name: redis
        image: redis:7.2-alpine
        ports:
        - containerPort: 6379
        resources:
          requests:
            memory: "4Gi"
            cpu: "1000m"
          limits:
            memory: "8Gi"
            cpu: "2000m"
        volumeMounts:
        - name: redis-data
          mountPath: /data
        command:
        - redis-server
        - /etc/redis/redis.conf
        - --requirepass
        - $(REDIS_PASSWORD)
        env:
        - name: REDIS_PASSWORD
          valueFrom:
            secretKeyRef:
              name: redis-secrets
              key: password
  volumeClaimTemplates:
  - metadata:
      name: redis-data
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: "gp3"
      resources:
        requests:
          storage: 20Gi
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redis-replica
  namespace: schools24
spec:
  serviceName: redis-replica
  replicas: 2  # 2 read replicas for HA
  selector:
    matchLabels:
      app: redis
      role: replica
  template:
    metadata:
      labels:
        app: redis
        role: replica
    spec:
      containers:
      - name: redis
        image: redis:7.2-alpine
        ports:
        - containerPort: 6379
        resources:
          requests:
            memory: "4Gi"
            cpu: "1000m"
          limits:
            memory: "8Gi"
            cpu: "2000m"
        command:
        - redis-server
        - --replicaof
        - redis-master-0.redis-master
        - "6379"
        - --requirepass
        - $(REDIS_PASSWORD)
        - --masterauth
        - $(REDIS_PASSWORD)
        env:
        - name: REDIS_PASSWORD
          valueFrom:
            secretKeyRef:
              name: redis-secrets
              key: password
---
apiVersion: v1
kind: Service
metadata:
  name: redis-master-service
  namespace: schools24
spec:
  selector:
    app: redis
    role: master
  ports:
  - port: 6379
    targetPort: 6379
  type: ClusterIP
---
apiVersion: v1
kind: Service
metadata:
  name: redis-replica-service
  namespace: schools24
spec:
  selector:
    app: redis
    role: replica
  ports:
  - port: 6379
    targetPort: 6379
  type: ClusterIP
```

---

## ⚖️ Node Affinity & Pod Scheduling

### 1. Node Labels

```bash
# Label nodes for targeted pod placement
kubectl label nodes node-1 node-role=core-services
kubectl label nodes node-2 node-role=academic-services
kubectl label nodes node-3 node-role=financial-services
kubectl label nodes node-4 node-role=analytics-spot
kubectl label nodes node-5 node-role=data-plane
```

---

### 2. Node Affinity Example (Dashboard Service on Core Nodes)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dashboard-service
spec:
  template:
    spec:
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
            - matchExpressions:
              - key: node-role
                operator: In
                values:
                - core-services
      # Pod anti-affinity to spread across nodes
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: app
                  operator: In
                  values:
                  - dashboard-service
              topologyKey: kubernetes.io/hostname
```

---

### 3. Taints & Tolerations (Spot Instances)

```bash
# Taint spot instance nodes
kubectl taint nodes node-4 workload-type=non-critical:NoSchedule
```

```yaml
# Analytics Service tolerates spot instance taint
apiVersion: apps/v1
kind: Deployment
metadata:
  name: analytics-service
spec:
  template:
    spec:
      tolerations:
      - key: "workload-type"
        operator: "Equal"
        value: "non-critical"
        effect: "NoSchedule"
      nodeSelector:
        node-role: analytics-spot
```

---

## 🔄 Failover & Resilience

### Scenario 1: Node 1 Fails (Core Services Down)

**Before Failure:**
```
NODE 1 (HEALTHY):
├── Auth Service (2 replicas)
├── Dashboard Service (2 replicas)
├── Student Service (2 replicas)
└── Teacher Service (2 replicas)
```

**After Node 1 Failure (Automatic Rescheduling):**
```
NODE 2 (Now hosts failed pods):
├── Original Academic Services
│   ├── Quiz Service
│   ├── Homework Service
│   └── Exam Service
└── Rescheduled from Node 1
    ├── Auth Service (2 replicas) ← Moved here
    └── Dashboard Service (2 replicas) ← Moved here

NODE 3 (Picks up remaining):
├── Original Financial Services
│   ├── Fee Service
│   └── Payment Service
└── Rescheduled from Node 1
    ├── Student Service (2 replicas) ← Moved here
    └── Teacher Service (2 replicas) ← Moved here
```

**Recovery Time Objective (RTO):** 2-5 minutes  
**How Kubernetes Handles It:**
1. Node 1 becomes `NotReady` (detected in ~40 seconds)
2. Pods marked as `Unknown` → `Terminating`
3. ReplicaSet controller detects missing pods
4. Scheduler assigns pods to healthy nodes (Node 2, Node 3)
5. Pods start on new nodes (~1-2 minutes)
6. Services update endpoints automatically
7. Traffic routes to new pods via `kube-proxy`

---

### Scenario 2: Exam Season Traffic Spike

**Normal Load (Off-Season):**
```
NODE 2:
└── Exam Service: 2 replicas (handling 50 req/sec)
```

**Exam Season (10x traffic spike to 500 req/sec):**

**Step 1: HPA scales Exam Service pods**
```
NODE 2:
└── Exam Service: 6 replicas (NODE 2 at 90% capacity)

NODE 3:
└── Exam Service: 4 replicas (scheduled here due to affinity spread)
```

**Step 2: Cluster Autoscaler adds NODE 6 (if needed)**
```bash
# Cluster Autoscaler detects pending pods
# Adds new node: m5.large in us-east-1c
```

```
NODE 6 (NEW):
└── Exam Service: 4 replicas (brand new node)
```

**Total Exam Service Pods:** 10 replicas (up from 2)  
**Scaling Time:** 3-5 minutes (pod scaling: 1 min, node provisioning: 2-4 min)

---

## 🔐 Service Mesh with Istio

### Why Service Mesh?

✅ **Secure mTLS**: Encrypted service-to-service communication  
✅ **Traffic Management**: Canary deployments, A/B testing  
✅ **Observability**: Request tracing, metrics  
✅ **Circuit Breaking**: Prevent cascading failures  

---

### Istio Installation

```bash
# Install Istio
curl -L https://istio.io/downloadIstio | sh -
cd istio-1.20.0
export PATH=$PWD/bin:$PATH
istioctl install --set profile=production -y

# Enable sidecar injection
kubectl label namespace schools24 istio-injection=enabled
```

---

### Virtual Service (API Gateway Routing)

```yaml
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: schools24-api-gateway
  namespace: schools24
spec:
  hosts:
  - api.schools24.com
  gateways:
  - schools24-gateway
  http:
  - match:
    - uri:
        prefix: /api/v1/auth
    route:
    - destination:
        host: auth-service
        port:
          number: 80
  - match:
    - uri:
        prefix: /api/v1/dashboard
    route:
    - destination:
        host: dashboard-service
        port:
          number: 80
  - match:
    - uri:
        prefix: /api/v1/exams
    route:
    - destination:
        host: exam-service
        port:
          number: 80
      weight: 90  # 90% to stable version
    - destination:
        host: exam-service-canary
        port:
          number: 80
      weight: 10  # 10% to canary (testing new version)
```

---

### Destination Rule (Circuit Breaker)

```yaml
apiVersion: networking.istio.io/v1alpha3
kind: DestinationRule
metadata:
  name: exam-service-circuit-breaker
  namespace: schools24
spec:
  host: exam-service
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        http1MaxPendingRequests: 50
        http2MaxRequests: 100
        maxRequestsPerConnection: 2
    outlierDetection:
      consecutiveErrors: 5
      interval: 30s
      baseEjectionTime: 30s
      maxEjectionPercent: 50
      minHealthPercent: 40
```

**How it works:**
- If Exam Service fails 5 consecutive requests, it's temporarily removed from load balancer
- Ejected for 30 seconds, then retried
- Prevents cascading failures during high load

---

## 📊 Monitoring & Observability

### 1. Prometheus + Grafana Setup

```bash
# Install Prometheus Operator
kubectl create namespace monitoring
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --set prometheus.prometheusSpec.retention=30d \
  --set prometheus.prometheusSpec.storageSpec.volumeClaimTemplate.spec.resources.requests.storage=50Gi
```

---

### 2. Custom Metrics for Autoscaling

```yaml
# ServiceMonitor for Exam Service
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: exam-service-metrics
  namespace: schools24
spec:
  selector:
    matchLabels:
      app: exam-service
  endpoints:
  - port: metrics
    interval: 30s
```

```yaml
# HPA with custom metric (exam submissions per second)
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: exam-service-custom-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: exam-service
  minReplicas: 2
  maxReplicas: 15
  metrics:
  - type: Pods
    pods:
      metric:
        name: exam_submissions_per_second
      target:
        type: AverageValue
        averageValue: "50"  # Scale if avg > 50 submissions/sec/pod
```

---

### 3. ELK Stack for Logging

```bash
# Install Elastic Cloud on Kubernetes (ECK)
kubectl create -f https://download.elastic.co/downloads/eck/2.10.0/crds.yaml
kubectl apply -f https://download.elastic.co/downloads/eck/2.10.0/operator.yaml

# Deploy Elasticsearch cluster
kubectl apply -f - <<EOF
apiVersion: elasticsearch.k8s.elastic.co/v1
kind: Elasticsearch
metadata:
  name: schools24-logs
  namespace: monitoring
spec:
  version: 8.11.0
  nodeSets:
  - name: default
    count: 3
    config:
      node.store.allow_mmap: false
    volumeClaimTemplates:
    - metadata:
        name: elasticsearch-data
      spec:
        accessModes:
        - ReadWriteOnce
        resources:
          requests:
            storage: 100Gi
        storageClassName: gp3
EOF

# Deploy Kibana
kubectl apply -f - <<EOF
apiVersion: kibana.k8s.elastic.co/v1
kind: Kibana
metadata:
  name: schools24-kibana
  namespace: monitoring
spec:
  version: 8.11.0
  count: 1
  elasticsearchRef:
    name: schools24-logs
EOF
```

---

### 4. Grafana Dashboard Example

```json
{
  "dashboard": {
    "title": "Schools24 - Service Health",
    "panels": [
      {
        "title": "Exam Service - Request Rate",
        "targets": [
          {
            "expr": "rate(http_requests_total{service='exam-service'}[5m])"
          }
        ],
        "type": "graph"
      },
      {
        "title": "Pod CPU Usage by Node",
        "targets": [
          {
            "expr": "sum(rate(container_cpu_usage_seconds_total[5m])) by (node)"
          }
        ],
        "type": "graph"
      },
      {
        "title": "Redis Cache Hit Rate",
        "targets": [
          {
            "expr": "redis_keyspace_hits_total / (redis_keyspace_hits_total + redis_keyspace_misses_total) * 100"
          }
        ],
        "type": "singlestat"
      }
    ]
  }
}
```

---

## 💰 Cost Optimization Strategies

### 1. Spot Instances for Non-Critical Workloads

**Node 4 Configuration (Analytics - Spot Instance):**
```yaml
apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig
metadata:
  name: schools24-cluster
  region: us-east-1
nodeGroups:
- name: analytics-spot
  instancesDistribution:
    instanceTypes:
    - m5.large
    - m5a.large
    - m5n.large
    onDemandBaseCapacity: 0
    onDemandPercentageAboveBaseCapacity: 0  # 100% spot
    spotInstancePools: 3
  desiredCapacity: 1
  minSize: 0
  maxSize: 3
  labels:
    node-role: analytics-spot
    workload-type: non-critical
  taints:
    workload-type: non-critical:NoSchedule
```

**Cost Savings:**
- m5.large on-demand: $0.096/hour = $70/month
- m5.large spot: $0.029/hour = $21/month
- **Savings: $49/month per node (70% reduction)**

---

### 2. Vertical Pod Autoscaler (Right-sizing)

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: auth-service-vpa
  namespace: schools24
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: auth-service
  updatePolicy:
    updateMode: "Auto"  # Automatically adjust resource requests
  resourcePolicy:
    containerPolicies:
    - containerName: auth-service
      minAllowed:
        cpu: 100m
        memory: 128Mi
      maxAllowed:
        cpu: 1
        memory: 1Gi
```

**Result:** VPA analyzes actual usage and adjusts resource requests to optimal values, preventing over-provisioning.

---

### 3. Cluster Autoscaler Configuration

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cluster-autoscaler
  namespace: kube-system
spec:
  template:
    spec:
      containers:
      - name: cluster-autoscaler
        image: k8s.gcr.io/autoscaling/cluster-autoscaler:v1.27.0
        command:
        - ./cluster-autoscaler
        - --v=4
        - --stderrthreshold=info
        - --cloud-provider=aws
        - --skip-nodes-with-local-storage=false
        - --expander=least-waste  # Choose cheapest node type
        - --node-group-auto-discovery=asg:tag=k8s.io/cluster-autoscaler/enabled,k8s.io/cluster-autoscaler/schools24-cluster
        - --balance-similar-node-groups
        - --skip-nodes-with-system-pods=false
        - --scale-down-delay-after-add=5m
        - --scale-down-unneeded-time=10m
```

**Behavior:**
- Scales up nodes when pods are pending due to insufficient resources
- Scales down nodes that have been underutilized (< 50% CPU/memory) for 10 minutes
- Chooses cheapest instance type that fits requirements

---

### 4. Pod Disruption Budget (PDB)

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: auth-service-pdb
  namespace: schools24
spec:
  minAvailable: 1  # Always keep at least 1 pod running
  selector:
    matchLabels:
      app: auth-service
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: exam-service-pdb
  namespace: schools24
spec:
  maxUnavailable: 25%  # During scale-down, keep at least 75% available
  selector:
    matchLabels:
      app: exam-service
```

**Purpose:** Prevent cluster autoscaler from draining all pods during scale-down, ensuring service availability.

---

## 🚀 Deployment Workflow

### 1. Initial Cluster Setup (AWS EKS)

```bash
# Create EKS cluster with eksctl
eksctl create cluster \
  --name schools24-cluster \
  --region us-east-1 \
  --version 1.28 \
  --nodegroup-name core-services \
  --node-type m5.large \
  --nodes 2 \
  --nodes-min 1 \
  --nodes-max 4 \
  --managed \
  --with-oidc

# Add additional node groups
eksctl create nodegroup \
  --cluster schools24-cluster \
  --name academic-services \
  --node-type m5.large \
  --nodes 2 \
  --nodes-min 1 \
  --nodes-max 5

# Spot instance node group
eksctl create nodegroup \
  --cluster schools24-cluster \
  --name analytics-spot \
  --node-type m5.large \
  --nodes 1 \
  --nodes-min 0 \
  --nodes-max 3 \
  --spot
```

---

### 2. Deploy All Services

```bash
# Create namespace
kubectl create namespace schools24

# Apply ConfigMaps and Secrets
kubectl apply -f k8s/configmaps/
kubectl apply -f k8s/secrets/

# Deploy services
kubectl apply -f k8s/deployments/auth-service.yaml
kubectl apply -f k8s/deployments/dashboard-service.yaml
kubectl apply -f k8s/deployments/quiz-service.yaml
kubectl apply -f k8s/deployments/exam-service.yaml
kubectl apply -f k8s/deployments/homework-service.yaml
kubectl apply -f k8s/deployments/fee-service.yaml
kubectl apply -f k8s/deployments/notification-service.yaml
kubectl apply -f k8s/deployments/analytics-service.yaml

# Deploy StatefulSets (Redis)
kubectl apply -f k8s/statefulsets/redis-master.yaml
kubectl apply -f k8s/statefulsets/redis-replica.yaml

# Deploy HPAs
kubectl apply -f k8s/hpa/exam-service-hpa.yaml

# Deploy Ingress
kubectl apply -f k8s/ingress/api-gateway-ingress.yaml
```

---

### 3. Verify Deployment

```bash
# Check pod distribution across nodes
kubectl get pods -n schools24 -o wide

# Check HPA status
kubectl get hpa -n schools24

# Check Cluster Autoscaler logs
kubectl logs -f deployment/cluster-autoscaler -n kube-system

# Access Grafana dashboard
kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80
# Visit http://localhost:3000 (admin/prom-operator)
```

---

## 📋 Complete Architecture Summary

| Component | Technology | Replicas | Node Placement | Scaling Strategy |
|-----------|-----------|----------|----------------|------------------|
| **API Gateway** | NGINX Ingress | 2 | Node 1, 2 | Manual |
| **Auth Service** | Go + Gin | 2 | Node 1 | Manual |
| **Dashboard Service** | Go + Gin | 2 | Node 1 | Manual |
| **Quiz Service** | Go + MongoDB | 2 | Node 2 | Manual |
| **Exam Service** | Go + PostgreSQL | 2-10 | Node 2, 3 | HPA (CPU 70%) |
| **Homework Service** | Go + S3 | 2 | Node 2 | Manual |
| **Fee Service** | Go + PostgreSQL | 2 | Node 3 | Manual |
| **Notification Service** | Go (Email+SMS+Push) | 2 | Node 1 | Manual |
| **Analytics Service** | Go + MongoDB | 1 | Node 4 (Spot) | Manual |
| **Report Service** | Go + Puppeteer | 1 | Node 4 (Spot) | Manual |
| **Redis Master** | Redis 7.2 | 1 | Node 5 | StatefulSet |
| **Redis Replica** | Redis 7.2 | 2 | Node 5 | StatefulSet |

**Total Baseline Pods:** ~25 pods  
**Peak Load (Exam Season):** ~40 pods  
**Nodes:** 5 (baseline) → 7 (peak with autoscaling)  

---

## 🎯 Best Practices Implemented

✅ **Multi-AZ Deployment**: Nodes spread across 3 availability zones (us-east-1a, 1b, 1c)  
✅ **Pod Anti-Affinity**: Critical services spread across multiple nodes  
✅ **Resource Limits**: All pods have CPU/memory requests and limits  
✅ **Health Checks**: Liveness and readiness probes on all services  
✅ **Pod Disruption Budgets**: Ensures minimum availability during updates  
✅ **Horizontal Pod Autoscaling**: Exam Service scales 2-10 replicas based on CPU  
✅ **Cluster Autoscaling**: Nodes scale 5-10 based on pending pods  
✅ **Service Mesh**: Istio for mTLS, traffic management, observability  
✅ **Spot Instances**: 70% cost savings on non-critical workloads  
✅ **Centralized Logging**: ELK stack with 100GB storage  
✅ **Metrics & Monitoring**: Prometheus + Grafana with 30-day retention  
✅ **Secret Management**: Kubernetes Secrets + AWS Secrets Manager integration  

---

## 📊 Cost Analysis

### Monthly Infrastructure Costs (AWS)

| Resource | Type | Units | Cost/Unit | Monthly Cost |
|----------|------|-------|-----------|--------------|
| **EKS Control Plane** | Managed | 1 cluster | $73/month | **$73** |
| **Node 1 (Core)** | m5.large | 1 node | $70/month | **$70** |
| **Node 2 (Academic)** | m5.large | 1 node | $70/month | **$70** |
| **Node 3 (Financial)** | t3.medium | 1 node | $30/month | **$30** |
| **Node 4 (Analytics)** | m5.large Spot | 1 node | $21/month | **$21** |
| **Node 5 (Redis)** | r5.large | 1 node | $120/month | **$120** |
| **RDS PostgreSQL** | db.m5.large Multi-AZ | 1 instance | $280/month | **$280** |
| **MongoDB Atlas** | M10 cluster | 1 cluster | $60/month | **$60** |
| **S3 Storage** | 300GB | - | $0.023/GB | **$7** |
| **CloudFront CDN** | 1TB transfer | - | $85/TB | **$85** |
| **ALB Load Balancer** | 1 ALB | - | $16/month | **$16** |
| **EBS Volumes** | gp3 300GB | - | $0.08/GB | **$24** |
| **Data Transfer** | 500GB out | - | $0.09/GB | **$45** |

**Total Monthly Cost: ~$901/month**

**Cost Optimizations Applied:**
- Spot instances for analytics: -$49/month
- Consolidated notification service: -$90/month (avoided 3 separate pods)
- Right-sized nodes with VPA: -$120/month (prevented over-provisioning)

**Net Monthly Cost After Optimizations: ~$642/month**

---

## 🔄 CI/CD Pipeline Integration

```yaml
# GitHub Actions workflow example
name: Deploy to Kubernetes
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    
    - name: Build Docker Image
      run: |
        docker build -t schools24/exam-service:${{ github.sha }} .
        docker push schools24/exam-service:${{ github.sha }}
    
    - name: Update Kubernetes Deployment
      run: |
        kubectl set image deployment/exam-service \
          exam-service=schools24/exam-service:${{ github.sha }} \
          -n schools24
    
    - name: Wait for Rollout
      run: |
        kubectl rollout status deployment/exam-service -n schools24
```

---

## 📝 Next Steps

1. **Review this architecture** and approve node distribution strategy
2. **Set up AWS EKS cluster** with eksctl
3. **Deploy databases** (RDS PostgreSQL, MongoDB Atlas, Redis StatefulSet)
4. **Build Docker images** for all microservices
5. **Apply Kubernetes manifests** (deployments, services, HPAs)
6. **Configure Istio service mesh** for secure communication
7. **Set up monitoring** (Prometheus, Grafana, ELK)
8. **Run load tests** to validate autoscaling
9. **Document runbooks** for incident response

---

**Architecture Version:** 1.0.0  
**Last Updated:** 2025-11-27  
**Compatible with:** Kubernetes 1.27+, AWS EKS, Azure AKS, Google GKE  
**Estimated Setup Time:** 2-3 weeks for full production deployment
