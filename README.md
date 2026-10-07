# Status

기기의 상태를 Reporter의 heartbeat로 확인하는 상태 페이지입니다.
첫 heartbeat 수신부터 가동률을 계산하며, 수집 전 기간은 회색으로 표시하고 계산에서 제외합니다.

## 로컬 실행

Node.js 22.13 이상, pnpm 9가 필요합니다.

```bash
pnpm install
pnpm db:migrate:local
pnpm dev
```

Wrangler가 출력한 주소로 접속합니다.

## 배포

본인 GitHub 계정에 fork하고 Cloudflare에 해당 저장소의 접근 권한을 연결합니다.
Cloudflare API 토큰을 `CLOUDFLARE_API_TOKEN`에 설정합니다.

```bash
cp infra/cloudflare/example.tfvars infra/cloudflare/terraform.tfvars
```

파일에 본인의 계정 ID, GitHub 계정·저장소, Pages 프로젝트 이름, 사용할 도메인을 입력합니다.

```bash
terraform -chdir=infra/cloudflare init
terraform -chdir=infra/cloudflare plan
terraform -chdir=infra/cloudflare apply
cp wrangler.production.example.jsonc wrangler.production.jsonc
cp wrangler.preview.example.jsonc wrangler.preview.jsonc
```

두 Wrangler 파일의 `database_id`에 Terraform 출력의 운영·preview DB ID를 각각 입력합니다.
도메인 DNS는 생성된 Pages 프로젝트의 `<프로젝트>.pages.dev`를 가리키도록 설정합니다.

```bash
pnpm db:migrate:production
pnpm db:migrate:preview
STATUS_ADMIN_URL=https://status.example.com STATUS_PAGES_PROJECT=your-status-project pnpm admin:secret:create
pnpm admin:secret:deploy production
```

URL과 프로젝트 이름은 본인 것으로 바꿉니다. 관리 설정은 Git 제외 `local/admin.env`에 저장됩니다.
설정 후 Cloudflare Pages를 재배포합니다. 이후 `main` push 시 자동 배포됩니다.

## Reporter 등록

관리 토큰으로 장비 추가 API를 호출하면 장비 토큰이 반환됩니다.

```http
POST /api/v1/admin/reporters
Authorization: Bearer <admin-token>
Content-Type: application/json

{ "id": "nas", "name": "NAS" }
```

응답: `{ "reporterId": "nas", "token": "<device-token>" }`.
CLI로 호출하면 토큰을 파일에 저장합니다.

```bash
pnpm token:create nas --name NAS --output-dir local/nas
```

Reporter를 설치할 장비의 ENV에 응답 토큰과 장비 ID를 설정합니다.

```dotenv
STATUS_REPORTER_URL=https://status.example.com/api/v1/heartbeat
STATUS_REPORTER_TOKEN=<device-token>
STATUS_COMPONENT=nas
```

설치: [Linux](reporter/README.md#linux-debianubuntu-systemd) · [OPNsense](reporter/opnsense/README.md) · [OpenWrt](reporter/openwrt/README.md)

## Reporter 관리

`local/update.json`에 변경할 값을 작성합니다. 예: `{ "enabled": false }`.

```bash
pnpm reporter:update nas local/update.json
pnpm token:rotate nas --output-dir local/nas-rotated
```

재발급하면 이전 토큰은 즉시 폐기됩니다. 새 토큰을 장비에도 반영합니다.
관리 Secret은 관리 PC에, Reporter 토큰은 해당 장비에 보관합니다.

검증은 `pnpm check`로 실행합니다.
