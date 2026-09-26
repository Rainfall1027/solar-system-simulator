# GitHub → Vercel 自动部署

- GitHub：`Rainfall1027/solar-system-simulator`
- Vercel 工作空间：`ylcc1`；项目：`solar-system-stimulator`
- `main` 推送触发 Production；其他分支推送与 Pull Request 触发 Preview。
- 构建根目录为仓库根目录，Node.js 24.x，`npm ci` → `npm run build`，输出 `web/dist`。
- 当前网页为静态站点，不需要服务器 API 或生产环境密钥。

## 发布修改

先运行 `npm run build`，检查 `git diff`，然后提交所需文件并执行 `git push`。
Vercel 的 GitHub 集成自动部署，不需要额外 GitHub Actions 或仓库 Token。

## 查看部署与日志

打开 https://vercel.com/ylcc1/solar-system-stimulator 的 Deployments：
选择 Production 查看线上版本，选择 Preview 查看分支预览；点击部署查看 Build Logs。
GitHub Pull Request 中的 Vercel 检查和评论也提供 Preview 链接。
构建失败时读取日志、修复、本地构建、提交并推送即可重新触发。

环境变量仅在 Vercel 项目的 Settings → Environment Variables 中配置。
本地 `.env*`、`.vercel/`、依赖目录、构建产物和三份开发示例文档不提交。
