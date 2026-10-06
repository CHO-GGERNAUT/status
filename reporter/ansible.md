# Ansible로 리포터 설치

`status.ggernaut.com`은 Cloudflare Pages/Functions/D1에서 실행한다. 홈랩은
장비별 HTTPS heartbeat만 보낸다. Docker·K3S·Authentik·공유 PostgreSQL에
상태 페이지를 의존시키지 않으며, 리포터는 `monitoring` 스택 밖의 systemd 서비스다.
방화벽은 장비의 DNS/HTTPS outbound가 필요하고 인바운드 포트나 Nginx 경로는 추가하지 않는다.

## 책임과 소스

- `status`: 웹/API, Cloudflare Terraform, 감시 항목 등록·토큰 발급과 전송 규약,
  `reporter/` 검사 스크립트·systemd unit·라우터 설치 안내·동작 테스트.
- `homelab`: Linux 설치 역할, 설치할 status 커밋과 관리 PC의 소스 경로.
- `homelab/local`: 실제 감시 항목 목록, 호스트 선택, private inventory/토큰.
- OPNsense/OpenWrt: [status의 리포터 문서](README.md)를 사용. Linux 역할로 관리하지 않는다.

관리 PC에 **homelab과 설치할 버전의 status checkout**을 준비한다. 기본 소스는 sibling `status`다.
다른 위치라면 `status_reporter_source_dir`에 status의 절대 경로를 지정한다.
`status_reporter_revision`에는 설치할 status의 40자리 커밋 SHA를 반드시 지정한다.
설치 전에 HEAD 일치, 리포터 파일 변경 여부, 필요한 파일을 검사하며 `--check`에서도 동일하게 검사한다.
자동 clone/pull/checkout은 하지 않는다. 원하는 status 버전을 관리 PC에서 명시적으로 준비한다.
기존 homelab 소스 override는 status 경로로 변경한다. 새로운 리포터 코드를 커밋한 뒤
그 커밋으로 소스와 revision을 함께 설정하며, 미커밋 리포터는 설치 대상으로 사용하지 않는다.
리포터는 노드 운영 도구이며 `make status-reporters NODE=<호스트 이름>`으로 한 대씩 설치한다.

## 1. 토큰 등록 (Cloudflare 변경은 명시적으로 실행)

먼저 [status의 감시 항목 예제](components.example.json)를 참고하여 Git 제외 `local/status/components.json`을
직접 작성한다. 예제는 자동 복사/적용하지 않으며 실제 목록은 local에만 둔다.
status checkout의 범용 CLI로 감시 항목을 등록한 뒤 장비마다 별도 토큰을 생성한다.

```sh
# status checkout에서 실행. 첫 명령은 SQL 생성만 수행한다.
install -d -m 0700 local
pnpm --silent component:register /absolute/path/to/homelab/local/status/components.json > local/components.sql
# 성공 여부와 SQL을 확인한 뒤 운영 D1에 명시적으로 적용
pnpm exec wrangler d1 execute status-production --remote \
  --config wrangler.production.jsonc --file local/components.sql
```

```sh
pnpm token:create ubuntu-main ubuntu-main-server --output-dir local/ubuntu-main
pnpm token:create k3s-main k3s-api k3s-nodes k3s-dns k3s-ingress --output-dir local/k3s-main
```

첫 명령은 호스트 전용, 두 번째는 클러스터 관측용이다. 각 디렉터리의 `token.env`는 원문,
`register.sql`은 해시/권한만 담고 있다. 디렉터리는 0700, 파일은 0600이며 기존 경로는 덮어쓰지 않는다.
생성된 SQL을 D1 `status-production`에 각각 적용한다:

```sh
pnpm exec wrangler d1 execute status-production --remote \
  --config wrangler.production.jsonc --file local/ubuntu-main/register.sql
pnpm exec wrangler d1 execute status-production --remote \
  --config wrangler.production.jsonc --file local/k3s-main/register.sql
```

이는 운영 DB 쓰기다. 올바른 Cloudflare 계정/DB를 확인하고 한 번만 적용한다.
기존 reporter ID는 INSERT 충돌이 나므로 토큰 교체는 별도 절차다.
운영 토큰을 preview에 재사용하지 않는다. 스키마/Cloudflare 리소스는 재생성하지 않는다.

기존 DB에 감시 항목이 이미 등록돼 있으면 재등록할 필요가 없다. 호스트의 component는 local 설정으로 지정한다.
status의 K3S 검사기는 `k3s-api`, `k3s-nodes`, `k3s-dns`, `k3s-ingress`를 보고하므로
사용할 경우 그 네 항목을 먼저 등록한다. 기존 D1에 이미 있는 항목/토큰은 그대로 쓸 수 있다.
status의 기존 DB 마이그레이션과 등록된 항목은 이번 소스 위치 변경으로 수정하지 않는다.

## 2. 명시적으로 대상 선택

기존 `local/inventory.ini`에 실제 inventory 이름을 넣는다 (IP를 추측하거나 바꾸지 않는다).

```ini
[status_reporters]
server-1
worker-1

[status_k3s_reporters]
server-1
```

`status_k3s_reporters`는 `k3s_server` 소속 **한 대만** 선택한다. 여러 리포터가 같은
component를 갱신하면 마지막 관측이 서로를 덮어쓴다. 호스트 component/토큰도 장비별로
중복 없이 배정한다. 같은 서버에서 host와 K3S 리포터를 함께 실행할 수 있다.

[homelab의 호스트 설정 예제](https://github.com/CHO-GGERNAUT/homelab/blob/main/config/status-reporter-host.example.yml)를 참고하여
`local/host_vars/server-1.yml`에 병합한다. 기존 파일을 덮어쓰지 않는다.

```yaml
status_reporter_component: ubuntu-main-server
status_reporter_source_dir: /absolute/path/to/status
status_reporter_revision: <설치할 status의 40자리 커밋 SHA>
vault_status_reporter_token: <등록한 호스트 토큰>
vault_status_k3s_reporter_token: <등록한 별도 K3S 토큰>
status_k3s_dns_namespace: kube-system
status_k3s_dns_workload: coredns
status_k3s_ingress_namespace: platform-system
status_k3s_ingress_workload: traefik
```

worker-1은 별도 `ubuntu-sub-server` component와 토큰을 설정한다.
생성된 token.env의 토큰 값을 각 host_vars에 안전하게 전달한다. 파일 권한은 0600, `local/`은 Git 제외다.
가능하면 Ansible Vault로 암호화하고
`ANSIBLE_ARGS='--ask-vault-pass'` 또는 별도의 vault-id를 사용한다. **vault_라는 변수명만으로
암호화되지는 않는다.** 로컬 설정 백업도 암호화하고 실제 복구 가능 여부를 확인한다.
SSH 사용자/키와 become 권한은 기존 inventory 방식 그대로 쓴다.

## 3. 설치

homelab checkout에서 실행한다:

```sh
make status-reporters NODE=server-1
```

동일 역할이 `make prepare-servers`의 마지막에 host reporter를 설치하고,
`make install-k3s`에서는 K3S 설치·확인 후 K3S reporter를 설치한다.
새 inventory 그룹은 기본적으로 비어 있으므로 기존 서버에 자동 활성화하지 않는다.

역할은 curl/CA, `status-reporter` 시스템 계정, 스크립트, root 소유 0600 env,
systemd service/timer를 설치한다. host 서비스는 비특권 사용자로 실행하며, systemd가
root 권한으로 EnvironmentFile을 읽는다. K3S 서비스만 root로 명시한 로컬 kubeconfig를 읽는다.
기본 kubeconfig는 `/etc/rancher/k3s/k3s.yaml`; ambient KUBECONFIG는 사용하지 않는다.

K3S namespace/Deployment 이름은 실제 클러스터와 일치해야 한다. 현재 차트 기본은
CoreDNS=`kube-system/coredns`, Traefik=`platform-system/traefik`이다. readiness replica 검사는
실제 DNS 질의나 외부 ingress HTTP 요청의 성공까지 보장하지 않는다.

## 4. 운영 확인

대상 서버에서:

```sh
systemctl list-timers 'status-*-reporter.timer'
systemctl status status-host-reporter.service
journalctl -u status-host-reporter.service -n 20 --no-pager
# K3S reporter가 설치된 서버만
journalctl -u status-k3s-reporter.service -n 20 --no-pager
```

oneshot 서비스가 성공 후 inactive인 것은 정상이다. timer가 active인지와 최근 실행
exit code/journal의 `Heartbeat accepted (HTTP 202)`를 확인한다. API
`https://status.ggernaut.com/api/v1/status`의 해당 `lastReceivedAt`도 확인한다.
약 1분마다 전송하고 180초 미수신이면 outage가 되며 공개 API 캐시 때문에 표시가 더 늦을 수 있다.

- HTTP 401/403: 토큰 등록, 운영/preview DB 구분, component 권한 확인.
- HTTP 409: 같은 토큰 중복 실행 또는 시스템 시간 역행 확인. 장비 NTP를 유지한다.
- transport failed: DNS, CA, 방화벽, 인터넷 연결 확인. 다음 timer에서 새 heartbeat를 전송한다.
- K3S만 outage: 경로, root kubeconfig 권한, namespace/Deployment 이름과 실제 readiness 확인.

Docker/DB 건강 상태는 host heartbeat 범위가 아니다. 호스트·리포터·인터넷 중 어느 경로가
끊겼는지는 미수신만으로 구분할 수 없다. 아직 설치하지 않은 component도 현재 API에서는 outage다.

## 검증 범위

`homelab`의 `make check`는 설치 설정과 커밋 검증을 임시 status checkout으로 검사한다.
`status`의 `pnpm check`는 fake curl/K3S로 리포터 동작과 API 규약을 검사한다.
실제 운영 D1 토큰 등록, SSH 설치, 첫 heartbeat 수신은 별도다. Terraform apply나 DB 변경은
`make status-reporters`에 포함되지 않는다. 리포터는 자체 DB/볼륨 백업이 필요 없고,
재설치용 private 설정과 status의 Terraform state/D1 기록 보존은 별도로 관리한다.
