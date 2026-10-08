# 腾讯云轻量应用服务器独立部署

本目录用于将 AI 短视频质检评估系统独立部署到腾讯云轻量应用服务器。

- Nginx：HTTPS 入口与同源反向代理
- Next.js：前端，仅绑定服务器回环地址
- NestJS：后端 API，仅绑定服务器回环地址
- PostgreSQL：独立数据库，仅在 Docker 内部网络可达
- 本地卷：试运行视频与封面存储；后续切换到腾讯 COS
- 阿里 OSS：仅作为千问读取视频时的临时中转

生产密钥只能写入服务器端 `.env`，不得提交到 Git。

V1.01 必须按 [本地验收与发布手册](../../docs/V1.01-本地验收与发布手册.md) 的维护顺序部署。API 启动入口已取消自动迁移和 seed；`migrate` 为显式 maintenance profile，`bootstrap` 为仅新库初始化的独立 profile。先构建并登记一个 API 镜像和独立 Web 镜像，在 `.env` 指定不可变 `API_IMAGE`、`WEB_IMAGE`（完整 `仓库@sha256:摘要` 或完整本机 image ID，不接受可变标签）。API、worker、迁移、bootstrap 消费同一 `API_IMAGE`；配置缺少引用即拒绝，所有业务服务禁止隐式 build/pull。镜像载入/拉取是发布前另行授权的准备步骤。

启动前必须完成手册的两道镜像门禁：API 之前核对成功迁移容器的实际 Image，worker 之前核对运行 API 的实际 Image，均需等于已登记 API ID。保留迁移容器直到核对结束，发布命令不能加 `--build`，API 先于新版 Web。本地 `local-image-smoke` 实际解析此模板并自动执行上述比对；这不是生产发布已完成的证明。

仅本机可执行的准备与恢复演练：

```sh
node --test deploy/lighthouse/tests/*.spec.mjs
QC_LOCAL_REHEARSAL=1 node deploy/lighthouse/local-release.mjs rehearse
QC_LOCAL_REHEARSAL=1 node deploy/lighthouse/local-release.mjs prepare-tests
QC_LOCAL_REHEARSAL=1 node deploy/lighthouse/verify-local.mjs
QC_LOCAL_REHEARSAL=1 node deploy/lighthouse/local-image-smoke.mjs
QC_LOCAL_REHEARSAL=1 node deploy/lighthouse/local-source-audit.mjs
```

脚本仅使用本机 Unix socket Docker、已安装的 `postgres:16-alpine` 镜像和 `127.0.0.1:55441`，创建带用途标签的独立容器与新数据库。已有演练数据库和备份均保留；`prepare-tests` 拒绝同名库，已经准备的测试库可直接重复跑测试。脚本没有生产模式，不会清库或替换现有数据库。

`verify-local` 清除继承的供应商环境，保存全测试/类型/构建/扫描日志；`local-image-smoke` 还需本机 Node 基础镜像和 Playwright Chromium，镜像只构建到本机、不会推送；`local-source-audit` 使用已缓存 Gitleaks 8.30.1 断网脱敏扫描。所有产物记录在独立 run 目录，原有截图/数据库不被替换。详见 [依赖与安全核对](../../docs/V1.01-依赖与安全核对.md)。
