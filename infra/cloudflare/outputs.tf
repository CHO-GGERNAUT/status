output "pages_project_name" {
  value = cloudflare_pages_project.status.name
}

output "pages_subdomain" {
  value = cloudflare_pages_project.status.subdomain
}

output "production_database_id" {
  value = cloudflare_d1_database.production.id
}

output "preview_database_id" {
  value = cloudflare_d1_database.preview.id
}

output "custom_domain" {
  value = cloudflare_pages_domain.status.name
}
