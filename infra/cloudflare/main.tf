resource "cloudflare_d1_database" "production" {
  account_id            = var.cloudflare_account_id
  name                  = "status-production"
  primary_location_hint = "apac"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_d1_database" "preview" {
  account_id            = var.cloudflare_account_id
  name                  = "status-preview"
  primary_location_hint = "apac"
}

resource "cloudflare_pages_project" "status" {
  account_id        = var.cloudflare_account_id
  name              = var.pages_project_name
  production_branch = var.production_branch

  # Runtime secrets are configured with Wrangler and kept out of Terraform input/state.
  lifecycle {
    ignore_changes = [
      deployment_configs.production.env_vars,
      deployment_configs.preview.env_vars,
    ]
  }

  build_config = {
    build_command   = "pnpm check"
    destination_dir = "dist"
    root_dir        = ""
  }

  source = {
    type = "github"
    config = {
      owner                          = "CHO-GGERNAUT"
      repo_name                      = "status"
      production_branch              = var.production_branch
      production_deployments_enabled = true
      preview_deployment_setting     = "all"
      preview_branch_includes        = ["*"]
      preview_branch_excludes        = []
      path_includes                  = ["*"]
      path_excludes                  = []
      pr_comments_enabled            = true
    }
  }

  deployment_configs = {
    preview = {
      compatibility_date = var.compatibility_date
      fail_open          = false
      d1_databases = {
        STATUS_DB = {
          id = cloudflare_d1_database.preview.id
        }
      }
    }
    production = {
      compatibility_date = var.compatibility_date
      fail_open          = false
      d1_databases = {
        STATUS_DB = {
          id = cloudflare_d1_database.production.id
        }
      }
    }
  }
}

resource "cloudflare_pages_domain" "status" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.status.name
  name         = var.custom_domain
}
