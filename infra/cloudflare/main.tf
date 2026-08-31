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
