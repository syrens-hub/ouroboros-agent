# 部署自动化

## 支持平台

| 平台 | CLI | 特点 |
|------|-----|------|
| Vercel | `vercel` | 前端部署，全球CDN |
| Fly.io | `fly` | 后端部署，边缘计算 |
| Railway | `railway` | 全栈部署，容器化 |

## 安装CLI

```bash
# Vercel
npm install -g vercel

# Fly.io  
brew install flyctl

# Railway
npm install -g @railway/cli
```

## 认证配置

```bash
# Vercel
vercel login

# Fly.io
fly auth login

# Railway
railway login
```

## 工具清单

| 工具 | 描述 | 平台 |
|------|------|------|
| `deploy_frontend` | 部署前端应用 | Vercel/Fly.io/Railway |
| `deploy_backend` | 部署后端服务 | Vercel/Fly.io/Railway |
| `get_deploy_status` | 获取部署状态 | 三平台 |
| `list_deployments` | 列出部署历史 | 三平台 |
| `rollback_deploy` | 回滚部署 | 三平台 |

## 使用示例

```typescript
import { deployFrontend, deployBackend, getDeployStatus } from "./core/deployment";

// 部署前端到 Vercel
const frontendResult = await deployFrontend({
  platform: "vercel",
  projectPath: "./dist",
  token: process.env.VERCEL_TOKEN
});

// 部署后端到 Fly.io
const backendResult = await deployBackend({
  platform: "flyio",
  projectPath: "./api",
  token: process.env.FLY_API_TOKEN
});

// 查看部署状态
const status = await getDeployStatus({
  platform: "vercel",
  deployId: frontendResult.deployId,
  token: process.env.VERCEL_TOKEN
});
```

## 环境变量

在 `deploy/config.ts` 中配置：

```typescript
export const deploymentConfig = {
  vercel: {
    token: process.env.VERCEL_TOKEN,
    teamId: process.env.VERCEL_TEAM_ID
  },
  flyio: {
    token: process.env.FLY_API_TOKEN,
    org: "personal"
  },
  railway: {
    token: process.env.RAILWAY_TOKEN,
    projectId: process.env.RAILWAY_PROJECT_ID
  }
};
```

## 回滚操作

```typescript
import { rollbackDeploy } from "./core/deployment";

await rollbackDeploy({
  platform: "vercel",
  deployId: "deploy_id",
  token: process.env.VERCEL_TOKEN
});
```
