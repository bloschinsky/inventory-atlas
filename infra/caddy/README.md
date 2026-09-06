# Caddy

`web.Caddyfile` serves the Vue history-mode application on the private network.
The public `Caddyfile` proxies `/api/*` and `/health/*` to the API and all other
requests to the static-web service. The gateway runs as a non-root user and
binds the standard HTTP/HTTPS ports exposed by Compose. Caddy obtains and stores
certificates when `APP_BASE_URL` uses an eligible HTTPS hostname.
