# 静态重定向服务 (Static Redirect Service)

这是一个基于 Cloudflare Worker 的全功能短链服务。它无需服务器，利用 Cloudflare Worker 同时托管静态页面（前端）和 API（后端），并使用 GitHub 仓库作为“数据库”存储重定向规则。

## 功能特性

*   **完全免费**: 依托 Cloudflare Workers 免费额度。
*   **零成本托管**: 无需购买服务器，无需 GitHub Pages，一个 Worker 搞定所有。
*   **两种重定向模式**:
    *   **直接跳转**: 访问短链直接跳转到目标地址。
    *   **中间页跳转**: 显示一个安全提示卡片，用户需点击“继续访问”才跳转（适合外部或敏感链接，防止误触）。
*   **自助创建**: 提供 `/_url` 界面，允许访客自助创建短链。
*   **安全防护**:
    *   防 XSS、防 HTML 注入。
    *   防循环重定向（禁止套娃）。
    *   CSRF 保护。
    *   目标 URL 有效性检查（死链无法创建）。
*   **自动过期**: 支持设置短链有效期（最长7天），过期自动清理。

## ❤️ 赞助
如果这个项目对你有帮助，欢迎 [赞助我](https://2x.nz/sponsors) 或给一个 Star ⭐️！

## 搭建你的短链
> 本来想让AI写的，但是它写的太煞笔了，这里就给一个简单的部署教程，之后会写一篇文章详细教你部署，请关注我的博客！ https://2x.nz

1. Fork本仓库

2. 创建Cloudflare Worker，连接本仓库

3. 更改静态HTML内硬编码的内容

4. 清理短链。并创建你需要的短链（此时，静态重定向功能已经完全可用）

5. 创建GithubToken

6. 绑定各个机密环境变量

7. 访问 /_url 即可创建短链（此时，动态创建短链功能已经完全可用）

## 详细部署教程

### 0. 准备工作

- 需要一个 Cloudflare 账号和 GitHub 账号
- 如果要使用自定义域名，先把域名托管到 Cloudflare（非必须）

### 1. Fork 仓库并清理规则

1. Fork 本仓库到你自己的 GitHub 账号
2. 打开 `js/rules_intermediate.js` 和 `js/rules_direct.js`
3. 删除示例规则，只保留空对象，例如：
   ```js
   window.RULES_INTERMEDIATE = {};
   ```
4. 如需修改默认跳转域名，可改 `js/config.js` 中的 `fallback`

### 2. 修改前端文案与链接（可选但建议）

编辑 `_url.html` 和 `404.html`，把页面标题、赞助链接、页脚链接等换成你的信息。

### 3. 创建 Cloudflare Worker（连接 GitHub）

1. 进入 Cloudflare 控制台 → **Workers & Pages**
2. 点击 **Create** → 选择 **Workers** → **Connect to Github**
3. 选择你 Fork 的仓库，创建新 Worker
4. 部署完成后，Cloudflare 会自动使用 `wrangler.jsonc` 配置并托管静态资源

### 4. 绑定自定义域名或路由

在 Worker 详情页：

- **Settings → Triggers → Custom Domains** 绑定你的域名，或
- **Routes** 里绑定路由，例如 `example.com/*`

访问根域名能看到 404 页即说明静态资源部署成功。

### 5. 创建 GitHub Token

需要一个能写入仓库文件的 Token。推荐 **Fine-grained PAT**：

1. GitHub → **Settings → Developer settings → Personal access tokens**
2. 选择 **Fine-grained**，仅授权你的这个仓库
3. 权限至少需要：
   - **Contents: Read and write**
   - **Metadata: Read**

### 6. 配置 Worker 环境变量（Secrets）

进入 Worker → **Settings → Variables**，添加以下变量（注意区分普通变量与 Secrets）：

- `GITHUB_OWNER`：你的 GitHub 用户名
- `GITHUB_REPO`：仓库名
- `GITHUB_BRANCH`：分支名（可选，默认 `main`）
- `GITHUB_TOKEN`：上一步创建的 Token（建议用 **Secret**）
- `BASE_DOMAIN`：你的短链域名，例如 `2x.nz`（用于 CSRF 校验与短链拼接）

### 7. 验证静态重定向

打开 `js/rules_direct.js` 或 `js/rules_intermediate.js` 手动写入一条规则，然后等部署完成：

```
https://你的域名/你的短链路径
```

能正常跳转说明静态功能已可用。

### 8. 验证动态创建

访问：

```
https://你的域名/_url
```

填写表单提交，如果能看到成功提示并生成 GitHub 提交记录，说明动态创建已可用。

### 9. 清理过期短链（可选）

本仓库提供 `cleanup_expired.js`，你可以：

- 本地定时运行（Node.js）
- 或用 GitHub Actions 定时触发（需要自行添加 workflow）

完成后会自动清理过期规则。
