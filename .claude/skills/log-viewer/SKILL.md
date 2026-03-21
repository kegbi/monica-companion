---
name: log-viewer
description: >
  Debug Monica Companion services using the observability stack. Query Loki for
  structured logs, Tempo for distributed traces, and Prometheus for metrics.
  Use when investigating errors, debugging message flow, or checking service
  health. Requires the Docker Compose observability profile to be running.
user-invocable: true
---

# Log Viewer & Debugging Skill

Query the Monica Companion observability stack to investigate errors, trace message flow, and diagnose issues.

## Invocation

```
/log-viewer [query]
```

- `query` can be a free-text description like "why did the note not get created" or a specific service/keyword
- If no query is given, show recent logs from all services

## Prerequisites

The observability stack must be running:

```bash
docker compose --profile app --profile observability up -d
```

This starts:
- **Loki** (port 3100) — log aggregation
- **Tempo** (port 3200) — distributed tracing
- **Prometheus** (port 9090) — metrics
- **Grafana** (port 3000) — dashboards (admin/admin)
- **OTel Collector** (port 4318) — receives telemetry from all services

## Where Logs Go

Service logs do NOT appear in `docker logs` or stdout. All services use `createLogger()` from `@monica-companion/observability` which sends structured logs via OpenTelemetry to the OTel Collector, which forwards to Loki.

To see logs, you MUST query Loki directly or use Grafana.

## Architecture: Service Names

| Service | `service_name` label | Port |
|---------|---------------------|------|
| telegram-bridge | `telegram-bridge` | 3001 |
| ai-router | `ai-router` | 3002 |
| voice-transcription | `voice-transcription` | 3003 |
| monica-integration | `monica-integration` | 3004 |
| scheduler | `scheduler` | 3005 |
| delivery | `delivery` | 3006 |
| user-management | `user-management` | 3007 |
| web-ui | `web-ui` | 4321 |

Logger scope names use `service:component` format (e.g. `ai-router:execute-action`, `telegram-bridge:voice-handler`).

## Querying Loki (Logs)

### All logs from all services (last 30 minutes)

```bash
curl -sG 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={service_name=~".+"}' \
  --data-urlencode 'limit=100' \
  --data-urlencode "start=$(date -d '30 minutes ago' +%s)000000000" \
  --data-urlencode "end=$(date +%s)000000000" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
const lines=[];
(d.data?.result||[]).forEach(s=>{
  const svc=s.stream.service_name||'?';
  const lvl=s.stream.detected_level||'';
  s.values.forEach(([ts,line])=>{
    lines.push([Number(ts),svc,lvl,line]);
  });
});
lines.sort((a,b)=>a[0]-b[0]);
lines.forEach(([ts,svc,lvl,l])=>{
  const t=new Date(ts/1e6).toISOString().slice(11,19);
  console.log(t,'['+svc+']','['+lvl+']',l.substring(0,300));
});
"
```

### Logs from a specific service

```bash
curl -sG 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={service_name="ai-router"}' \
  --data-urlencode 'limit=50' \
  --data-urlencode "start=$(date -d '30 minutes ago' +%s)000000000" \
  --data-urlencode "end=$(date +%s)000000000"
```

### Errors only

```bash
curl -sG 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={service_name=~".+",detected_level="ERROR"}' \
  --data-urlencode 'limit=50' \
  --data-urlencode "start=$(date -d '1 hour ago' +%s)000000000" \
  --data-urlencode "end=$(date +%s)000000000"
```

### Search by keyword in log body

```bash
curl -sG 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={service_name=~".+"} |= "scheduler"' \
  --data-urlencode 'limit=50' \
  --data-urlencode "start=$(date -d '1 hour ago' +%s)000000000" \
  --data-urlencode "end=$(date +%s)000000000"
```

### Reading structured attributes

Log entries have attributes stored as Loki stream labels, not in the body. To see them:

```bash
curl -sG 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={service_name="telegram-bridge",detected_level="ERROR"}' \
  --data-urlencode 'limit=5' \
  --data-urlencode "start=$(date -d '1 hour ago' +%s)000000000" \
  --data-urlencode "end=$(date +%s)000000000" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
(d.data?.result||[]).forEach(s=>{
  // Key attributes are in s.stream — filter out noise
  const attrs=Object.entries(s.stream).filter(([k])=>
    !k.startsWith('process_')&&!k.startsWith('host_')&&
    k!=='observed_timestamp'&&k!=='deployment_environment'
  );
  console.log('ATTRIBUTES:', JSON.stringify(Object.fromEntries(attrs), null, 2));
  s.values.forEach(([ts,line])=>console.log('BODY:', line));
});
"
```

Key attributes to look for:
- `correlationId` — traces a request across all services
- `userId` — which user triggered the action
- `error` — error message (for error-level logs)
- `scope_name` — which component logged it (e.g. `ai-router:execute-action`)
- `detected_level` — ERROR, WARN, INFO, DEBUG

## Querying Tempo (Traces)

### Find traces for a service

```bash
curl -sG 'http://localhost:3200/api/search' \
  --data-urlencode 'tags=service.name=ai-router' \
  --data-urlencode 'limit=20' \
  --data-urlencode "start=$(date -d '1 hour ago' +%s)" \
  --data-urlencode "end=$(date +%s)" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
(d.traces||[]).forEach(t=>{
  const ts=t.startTimeUnixNano?new Date(Number(BigInt(t.startTimeUnixNano)/1000000n)).toISOString().slice(11,19):'?';
  console.log(ts, t.rootTraceName, 'Duration:'+t.durationMs+'ms', 'TraceID:'+t.traceID);
});
"
```

### Inspect a specific trace (get all spans and attributes)

```bash
TRACE_ID=<paste-trace-id-here>
curl -s "http://localhost:3200/api/traces/$TRACE_ID" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
(d.batches||[]).forEach(b=>{
  const svc=b.resource?.attributes?.find(a=>a.key==='service.name')?.value?.stringValue||'?';
  (b.scopeSpans||[]).forEach(ss=>{
    (ss.spans||[]).forEach(s=>{
      console.log('['+svc+']', s.name, 'Status:', JSON.stringify(s.status));
      (s.attributes||[]).forEach(a=>{
        const v=a.value?.stringValue||a.value?.intValue||a.value?.boolValue||'';
        console.log('  ', a.key, '=', v);
      });
    });
  });
});
"
```

### Key trace span names to look for

| Span Name | Service | What It Tells You |
|-----------|---------|------------------|
| `POST /internal/process` | ai-router | Full LangGraph pipeline invocation |
| `ai-router.graph.classify_intent` | ai-router | LLM intent classification (check `ai-router.intent` attribute) |
| `ai-router.graph.resolve_contact_ref` | ai-router | Contact matching (check `ai-router.resolution_outcome`) |
| `ai-router.graph.execute_action` | ai-router | Command lifecycle (check `ai-router.action_outcome`) |
| `ai-router.graph.deliver_response` | ai-router | Delivery to user (check `ai-router.delivery_failed`) |
| `POST /internal/execute` | scheduler | Command execution ingress (check `http.status_code`) |
| `scheduler.execute_command` | scheduler | BullMQ job processing |
| `scheduler.poll_reminders` | scheduler | Reminder polling cycle |

### Key span attributes

- `ai-router.intent` — classified intent: `mutating_command`, `read_query`, `clarification_response`, `greeting`, `out_of_scope`
- `ai-router.action_outcome` — what happened: `pending_created`, `confirmed`, `auto_confirmed`, `cancelled`, `stale_rejected`, `edit_draft`, `read_through`, `passthrough`
- `ai-router.resolution_outcome` — contact match: `resolved`, `ambiguous`, `no_match`, `skipped`, `fetch_error`
- `ai-router.llm_error` — `true` when LLM call failed
- `ai-router.delivery_failed` — `true` when delivery service call failed
- `scheduler.command_type` — which command type was executed
- `scheduler.validation_error` — `true` when payload validation failed
- `http.status_code` — HTTP response status

## Debugging Common Issues

### "User got error message but the action worked" (double message)
1. Check telegram-bridge logs for timeout errors:
   ```
   {service_name="telegram-bridge"} |= "timeout"
   ```
2. If `AI_ROUTER_TIMEOUT_MS` is too low, the handler errors out but ai-router continues processing and delivers via delivery service.

### "User confirmed but nothing happened" (command not executed)
1. Check ai-router execute_action traces for `action_outcome`:
   ```
   tags=service.name=ai-router → find execute_action spans → check ai-router.action_outcome
   ```
2. If outcome is `confirmed`, check scheduler traces for `POST /internal/execute`:
   ```
   tags=service.name=scheduler → check http.status_code
   ```
3. If scheduler returned 400, check scheduler logs for validation errors:
   ```
   {service_name="scheduler"} |= "validation failed"
   ```

### "Bot doesn't respond at all"
1. Check if telegram-bridge is polling:
   ```bash
   curl -s "https://api.telegram.org/bot$TOKEN/getWebhookInfo"
   ```
   If `url` is empty → polling mode. If `pending_update_count` > 0 → bot isn't consuming updates.
2. Check telegram-bridge handler errors:
   ```
   {service_name="telegram-bridge",detected_level="ERROR"}
   ```

### "Contact disambiguation shows wrong labels"
1. Check ai-router resolution logs:
   ```
   {service_name="ai-router"} |= "disambiguation"
   ```
   This shows the full options list with labels and values.
2. Labels come from Monica's relationship data via monica-integration.

### "Voice message fails"
1. Check voice-transcription logs:
   ```
   {service_name="voice-transcription"}
   ```
2. Check for timeout in telegram-bridge:
   ```
   {service_name="telegram-bridge"} |= "voice"
   ```

## Grafana UI

Open `http://localhost:3000` (admin/admin):

- **Explore** (compass icon in sidebar):
  - Select **Loki** datasource → LogQL queries (same syntax as above)
  - Select **Tempo** datasource → search by service name, trace ID
  - Select **Prometheus** datasource → PromQL for metrics
- **Dashboards** (hamburger menu → Dashboards):
  - Pre-provisioned dashboards for service health, HTTP latency, OpenAI budget, queue depth

## Health Checks

Quick check that all services are running:

```bash
for svc in telegram-bridge:3001 ai-router:3002 voice-transcription:3003 \
  monica-integration:3004 scheduler:3005 delivery:3006 user-management:3007; do
  name=${svc%%:*}; port=${svc##*:}
  echo -n "$name: "
  docker exec monica-project-${name}-1 node -e \
    "fetch('http://localhost:${port}/health').then(r=>r.text()).then(console.log).catch(e=>console.log('ERR:'+e.message))"
done
```
