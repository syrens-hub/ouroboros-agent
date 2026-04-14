# Ouroboros Agent Helm Chart

## Prerequisites

- Kubernetes 1.24+
- Helm 3.12+

## Install

```bash
helm install ouroboros ./helm/ouroboros-agent \
  --namespace ouroboros --create-namespace \
  --set secrets.WEB_API_TOKEN=$(openssl rand -hex 32) \
  --set secrets.LLM_API_KEY=your-key
```

## Upgrade

```bash
helm upgrade ouroboros ./helm/ouroboros-agent --namespace ouroboros
```

## Uninstall

```bash
helm uninstall ouroboros --namespace ouroboros
```

## Configuration

See `values.yaml` for all available options.

### Common Overrides

| Parameter | Description |
|-----------|-------------|
| `image.repository` | Docker image repository |
| `image.tag` | Docker image tag |
| `ingress.enabled` | Enable ingress |
| `ingress.hosts[0].host` | Ingress hostname |
| `persistence.size` | PVC size for SQLite data |
| `secrets.WEB_API_TOKEN` | API authentication token |
| `secrets.LLM_API_KEY` | Primary LLM API key |
| `secrets.FALLBACK_LLM_API_KEY` | Fallback LLM API key |
