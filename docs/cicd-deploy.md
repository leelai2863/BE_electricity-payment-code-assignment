# CI/CD: Assign-refu-manager-service (GHCR + SSH)

**Repo chuẩn triển khai:** [github.com/Trung-Nam-2512/Assign-refu-manager-service](https://github.com/Trung-Nam-2512/Assign-refu-manager-service)

Luồng chuẩn (cùng tinh thần `fe-gateway` / `tool-check-bill`):

1. **PR → `main`**: workflow **CI** — `npm ci` + `npm run build` (TypeScript `--noEmit`).
2. **Push `main`**: **Deploy (SSH + GHCR)** — chạy CI → build image trên GitHub → push `ghcr.io/trung-nam-2512/assign-refu-manager-service:<sha>` và `:latest` → SSH vào server → `git pull` (nếu thư mục là clone git) → `docker compose -f docker-compose.deploy.yml pull` + `up -d`.
3. **Server không `docker build`** service này trong pipeline; chỉ **pull** image đã đóng gói.

**Push image lên GHCR** dùng **`GITHUB_TOKEN`** của workflow (không cần secret riêng). Workflow đã khai báo `permissions: packages: write`.

Compose triển khai: `docker-compose.deploy.yml` (backend từ registry + Mongo `mongo:7`). Biến nhạy cảm đặt trong **`.env` trên server** (không commit).

---

## Checklist secrets (Repository → Settings → Secrets and variables → Actions)

Các secret sau đã được thiết kế để khớp workflow; khi đủ là sẵn sàng deploy:

| Secret | Workflow dùng | Ghi chú |
|--------|-----------------|--------|
| `SSH_HOST` | `deploy-ssh.yml`, `rollback.yml` | Hostname/IP |
| `SSH_PORT` | Cùng | Nên set rõ (vd. `22` hoặc cổng custom); tránh để trống |
| `SSH_USER` | Cùng | User SSH |
| `SSH_PRIVATE_KEY` | Cùng | Private key PEM/ed25519 (khóa A: Actions → server) |
| `DEPLOY_PATH` | Cùng | Đường dẫn tuyệt đối tới thư mục có `docker-compose.deploy.yml` + `.env` |
| `GHCR_PULL_USERNAME` | Cùng | Thường là username GitHub (kéo image private) |
| `GHCR_PULL_TOKEN` | Cùng | PAT có `read:packages` (và `write:packages` nếu policy yêu cầu) |
| `HEALTH_CHECK_PORT` | Cùng | **Phải trùng cổng host backend** — tức cùng giá trị với `BACKEND_HOST_PORT` trong `.env` trên server (mặc định compose `1389`). Script dùng biến này cho `curl http://127.0.0.1:$PORT/health` sau deploy/rollback |
| `GIT_PULL_TOKEN` | **Khuyến nghị nếu repo private** | Classic PAT: quyền **`repo`** (đọc code để `git pull`). Workflow gán tạm `origin` dạng `https://x-access-token:...@github.com/<repo>.git` trên server. Có thể dùng cùng một PAT với quyền `read:packages` nếu bạn gộp scope. Repo **public** có thể bỏ qua nếu `git pull` không cần login. |

---

## Đồng bộ cổng health (quan trọng)

- Trên server, `docker-compose.deploy.yml` map `BACKEND_HOST_PORT` (trong `.env`) → container `3001`.
- Secret **`HEALTH_CHECK_PORT`** phải bằng **cổng host** đó (vd. cả hai là `1389`). Nếu lệch, bước kiểm tra cuối workflow sẽ fail dù container vẫn chạy.

---

## Trên server Ubuntu

1. Clone repo vào `DEPLOY_PATH` (hoặc copy ít nhất `docker-compose.deploy.yml`, `mongo-seed/`, `Dockerfile` không bắt buộc cho runtime).
2. Tạo `.env`: `CORS_ORIGIN`, `OPENAI_*`, `BACKEND_HOST_PORT` (khớp `HEALTH_CHECK_PORT`), v.v.
3. Volume Mongo `mongo-seed` như môi trường hiện có.
4. **Git pull:** user SSH phải có quyền `git pull` (deploy key read + write hoặc token); nếu chỉ copy file không dùng git, workflow vẫn chạy nhưng in cảnh báo và chỉ `compose pull/up`.
5. **GHCR:** nếu package image **private**, `docker login` qua `GHCR_PULL_*` là bắt buộc (đã có trong script).

---

## Lần đầu & GitHub

- Tab **Actions**: bật workflow nếu repo mới.
- **Packages:** image xuất hiện dưới `https://github.com/Trung-Nam-2512?tab=packages` (hoặc org). Nếu private, thêm quyền đọc cho deploy account.
- **Branch protection (khuyến nghị):** nhánh `main` — bật “Require status checks” và chọn job **CI / quality** để merge chỉ khi typecheck xanh.

---

## Rollback

Actions → **Rollback deploy** → nhập `target_sha` (tag image đã từng push) → chạy. Job SSH `docker pull` đúng tag và `compose up` lại.

---

## Local (không registry)

Dùng `docker-compose.yml` hoặc `docker-compose.prod.yml` với `docker compose up -d --build` trên máy dev.
