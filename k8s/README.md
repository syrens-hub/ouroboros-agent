# Kubernetes Deployment

## Quick Start

1. Edit `secret.yaml` and fill in your real API keys and tokens.
2. (Optional) Edit `configmap.yaml` and `ingress.yaml` to match your environment.
3. Deploy:

```bash
kubectl apply -k k8s/
```

## Update Image

Build and tag your image, then update the deployment:

```bash
docker build -t your-registry/ouroboros-agent:v0.1.0 .
kubectl set image deployment/ouroboros-agent ouroboros=your-registry/ouroboros-agent:v0.1.0 -n ouroboros
```

## Check Status

```bash
kubectl get pods -n ouroboros
kubectl logs -n ouroboros -l app=ouroboros-agent
```

## Scaling

An HPA manifest (`hpa.yaml`) is included. It scales the deployment based on CPU and memory utilization. For HPA to work, ensure your cluster has a metrics server installed.

```bash
kubectl apply -f k8s/hpa.yaml
```

## Persistent Storage

- `ouroboros-data` PVC stores the SQLite database and backups.
- `ouroboros-skills` PVC stores dynamically installed skills so they survive pod restarts.

## PostgreSQL Mode

To run in multi-instance mode, set `USE_POSTGRES=1` and `DATABASE_URL` in `secret.yaml` or `configmap.yaml`. When using PostgreSQL, the HPA can safely scale beyond 1 replica.
