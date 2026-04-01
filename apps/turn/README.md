# coturn

`turnserver.conf` already includes a production-like baseline:
- long-term auth + shared secret (`use-auth-secret`)
- UDP/TCP/TLS listener ports
- SSRF protections for private ranges
- relay bandwidth and quota guards

Before running real calls, update:
- `static-auth-secret` in `turnserver.conf` so it matches server `TURN_SECRET`
- `realm` and `TURN_REALM` to the same domain
- `relay-ip` for public deployments (leave commented for local sandbox)
