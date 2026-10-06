variable "cloudflare_account_id" {
  description = "Cloudflare account ID that owns Pages and D1."
  type        = string
}

variable "pages_project_name" {
  description = "Cloudflare Pages project name."
  type        = string
}

variable "github_owner" {
  description = "GitHub user or organization that owns the source repository."
  type        = string
}

variable "github_repository" {
  description = "GitHub source repository name."
  type        = string
  default     = "status"
}

variable "production_branch" {
  description = "Branch treated as production by Pages."
  type        = string
  default     = "main"
}

variable "custom_domain" {
  description = "Public status page domain."
  type        = string
}

variable "compatibility_date" {
  description = "Cloudflare Pages Functions compatibility date."
  type        = string
  default     = "2026-08-31"
}
