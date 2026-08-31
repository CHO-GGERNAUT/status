.PHONY: install check dev migrate-local terraform-init terraform-validate

install:
	pnpm install

check:
	pnpm check

migrate-local:
	pnpm db:migrate:local

dev: migrate-local
	pnpm dev

terraform-init:
	terraform -chdir=infra/cloudflare init

terraform-validate:
	terraform -chdir=infra/cloudflare fmt -check
	terraform -chdir=infra/cloudflare validate
