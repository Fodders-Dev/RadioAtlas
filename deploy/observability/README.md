# Observability

This folder contains a minimal external observability setup for the API.

## What it expects

- API exposes `/observability/prometheus`
- Optional alert fan-out webhook is configured via `OBSERVABILITY_ALERT_WEBHOOK`
- Persisted local metrics store is configured via `OBSERVABILITY_STORE_PATH`

## Files

- `prometheus.yml`: scrape config for the API plus alertmanager wiring
- `alerts.yml`: rules for request errors, fallback spikes and slow request buildup
- `grafana-dashboard.json`: starter dashboard for request counters and fallback metrics
- `radioatlas_observability_gauge{key="runtime_process_cpu_percent"}` tracks process CPU sampled inside the API
- `radioatlas_observability_gauge{key="media_inflight_shared"}` tracks shared in-flight `/metadata` + `/fetch` work
- `radioatlas_request_latency_ms{route="get_metadata",quantile="0.95"}` and `...get_fetch...` expose latency percentiles for the protected media routes

## Notes

- Replace `radioatlas.duckdns.org` with your real API origin or private service DNS name.
- If Prometheus runs on the same host, prefer scraping the internal service URL instead of the public domain.
- The webhook configured in `OBSERVABILITY_ALERT_WEBHOOK` can point to Telegram, Slack, or any internal relay.
