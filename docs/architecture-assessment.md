# Architecture Assessment — Readiness for Multi-Institution Deployment

**Scope of this review:** the system as it exists today (post-Milestone-11 + the LiDAR feature + the security hardening pass), assessed against a stated future: deployment across many schools, colleges, and universities.

**Method:** every finding below is traced to actual code, with file and line references. Nothing here is inferred from the docs — where this document disagrees with an existing doc, the code was checked directly.

**The one-line verdict:** this is an unusually well-built **single-tenant** system. It is **not yet a multi-tenant product**, and the distance between those two things is the entire subject of this document. The good news is that the gap is *additive* — the foundations are sound enough that closing it is a matter of building on top, not tearing down. The bad news is that one of the gaps (tenancy) gets exponentially more expensive to close with every month of deployed data, which is exactly why you're right to be asking now.

---

## Scorecard

Rated twice, because the same system scores very differently against the two questions:

| Dimension | As a single-institution / lab system | As a multi-institution platform |
|---|---|---|
| **Modularity & separation of concerns** | 9 / 10 | 8 / 10 |
| **Documentation & knowledge transfer** | 9 / 10 | 9 / 10 |
| **Safety engineering** | 8 / 10 | 7 / 10 |
| **Security — perimeter & transport** | 7 / 10 | 4 / 10 |
| **Security — identity, tenancy, isolation** | 6 / 10 | **2 / 10** |
| **Scalability** | 6 / 10 | **3 / 10** |
| **Data integrity & durability** | 6 / 10 | 5 / 10 |
| **Operational readiness (CI, HA, migrations)** | 3 / 10 | **2 / 10** |
| **Overall** | **7 / 10** | **3.5 / 10** |

Read that as: *the engineering quality is high; the product scope is narrow.* Most projects at this stage have the opposite problem — a broad feature surface built on mush. This one is the better problem to have, because good foundations can carry new requirements, while bad foundations cannot carry any.

---

## What is genuinely excellent (and must be protected)

These are not participation trophies. Each of these is a decision that most teams get wrong, and each one is *why* the roadmap below is feasible at all.

**1. The two-container boundary is the right boundary, enforced for the right reasons.**
`robot-container/` speaks ROS2 internally and MQTT externally; `cloud-container/` never speaks ROS2. This isn't stylistic — it's what makes the robot fleet's internals replaceable and what makes the cloud side horizontally scalable *in principle*. Crucially, the boundary is enforced by the broker's ACL ([`cloud-container/mosquitto/aclfile`](../cloud-container/mosquitto/aclfile)), not merely by convention: the backend is explicitly denied write access to `telemetry`/`health`/`status`, so a compromised backend cannot forge a robot's self-reported state. That is a real security property, designed in deliberately.

**2. The dependency-injection + fakes pattern is textbook.**
[`robot-container/robot_agent/interfaces.py`](../robot-container/robot_agent/interfaces.py) plus the `fake_*.py` test doubles mean the entire business-logic test suite runs with no live Postgres, Redis, or broker. This is why 35 backend tests execute in under a second, and it's why the security hardening pass could be verified quickly. Most teams discover they need this after it's too expensive to retrofit.

**3. `FleetManager` as a single composition point.**
[`cloud-container/backend/app/fleet/manager.py`](../cloud-container/backend/app/fleet/manager.py) means "what does it take to command a robot" has exactly one implementation, used identically by the REST endpoint and the teleop WebSocket. When the security pass added rate limiting and audit logging, they went in *once* and both transports inherited them. That is modularity paying rent.

**4. Genuine safety judgment.**
`stop` deliberately bypasses both the session-ownership check *and* the command rate limit. Somebody thought carefully about the failure mode where a safety override gets throttled out of delivery by the very flood it exists to interrupt. That instinct is rarer than it should be, and it's the right instinct for a system that moves physical hardware near people.

**5. Config-over-hardcoding, audited rather than assumed.**
[`docs/11-aws-migration.md`](11-aws-migration.md) doesn't just claim no service address is hardcoded — it ships the `grep` that proves it. This is the discipline that makes a migration a config change instead of a rewrite.

**6. The documentation is exceptional.**
For a system destined for institutions where the maintainers will be rotating students and staff, docs of this quality are a load-bearing architectural asset, not a nicety. Preserve this standard; it will do more for long-term success than most code you write.

---

## Critical finding: there is no tenancy model

**This is the single most important thing in this document.**

The system has no concept of an organization, tenant, school, or customer. This was verified by exhaustive search across the backend, the robot agent, and the deployment config — there is no `tenant_id`, `org_id`, `school_id`, or equivalent anywhere in the codebase.

The concrete consequences, today:

| Component | Current behavior | Consequence across institutions |
|---|---|---|
| `robots` table ([`db/postgres.py`](../cloud-container/backend/app/db/postgres.py)) | Columns: `robot_id`, `display_name`, `model`, `registered_at` | One flat global fleet. No column can express "this robot belongs to St. Xavier's." |
| `list_robots()` ([`registry/store.py:83-86`](../cloud-container/backend/app/registry/store.py#L83-L86)) | `SELECT robot_id, display_name FROM robots` — no `WHERE` clause | **Every operator sees every robot in every institution.** |
| Emergency stop ([`api/robots.py`](../cloud-container/backend/app/api/robots.py)) | Any authenticated operator, any robot, by design | **Any user at School A can halt every robot at School B.** A cross-tenant denial-of-service primitive, reachable by design, not by bug. |
| Operator identity ([`config.py`](../cloud-container/backend/app/config.py)) | One shared `OPERATOR_USERNAME` / `OPERATOR_PASSWORD` for the whole deployment | No per-user attribution. The audit log records *which username* acted — but there is only one username. |
| MQTT topics | `robots/{robot_id}/...` | Flat namespace. The ACL scopes a robot to its own `robot_id`, but there is no level at which one institution's traffic is separable from another's. |
| Robot registration ([`registry/store.py:68-80`](../cloud-container/backend/app/registry/store.py#L68-L80)) | First-seen auto-registration: publish a status message, join the fleet | A robot joins the *global* fleet with no ownership assignment and no approval step. |

**Why this cannot be deferred.** Tenancy is not a feature you bolt on; it is a property of your data model, your topic hierarchy, and every query you have written. Retrofitting it later means a backfill migration across live institutional data, a topic-hierarchy change requiring simultaneous re-provisioning of every deployed robot, and an audit of every query in the codebase — executed while real schools are depending on the system. Doing it now costs perhaps two to three weeks. Doing it after twenty institutions are live costs a quarter and a trust-destroying incident.

**Recommended shape:**

- Add `tenant_id` to `robots`, `control_sessions`, `audit_log`, and a new `users` table. Enforce it in Postgres with row-level security so a missing `WHERE` clause fails closed rather than leaking.
- Change the MQTT hierarchy to `tenants/{tenant_id}/robots/{robot_id}/...`. The ACL already demonstrates the exact pattern needed — `%u` substitution — so this is an extension of a mechanism that already works, not a new one.
- Put `tenant_id` in the JWT claims and derive every query's scope from the token, never from a client-supplied parameter.
- Scope `stop` to the caller's tenant. It should remain an override *within* a tenant and be impossible across tenants.

---

## Scalability

### Three hard blockers to running more than one backend instance

The system currently cannot be horizontally scaled at all. Not "scales poorly" — will actively malfunction. Three specific causes:

**1. WebRTC signalling state lives in process memory.**
[`webrtc/relay.py:34`](../cloud-container/backend/app/webrtc/relay.py#L34) holds `self._pending: dict[str, asyncio.Future]`. The flow is: a browser's offer arrives at backend replica A, which publishes to MQTT and awaits a Future; the robot's answer arrives over MQTT at whichever replica happens to receive it. If that's replica B, the `request_id` matches no local Future, the answer is discarded with a warning, and **video silently never connects**. With two replicas this fails roughly half the time. Fix: move correlation into Redis pub/sub so any replica can complete any request.

**2. The MQTT client ID is a hardcoded constant.**
[`mqtt/service.py:49`](../cloud-container/backend/app/mqtt/service.py#L49) defaults `client_id="backend"`. MQTT brokers enforce client-ID uniqueness by *disconnecting the existing session* when a duplicate connects. Two replicas will therefore knock each other offline in a continuous reconnect loop, taking the entire fleet's telemetry with them. Fix: unique per-replica IDs, and MQTT 5 shared subscriptions (`$share/`) so replicas split the message stream rather than each processing all of it.

**3. Every replica would do all the work anyway.**
Even with the above fixed, [`mqtt/service.py:130-138`](../cloud-container/backend/app/mqtt/service.py#L130-L138) subscribes every replica to `robots/+/...` wildcards. Without shared subscriptions, adding replicas multiplies total work rather than dividing it.

### The arithmetic does not close

Take a modest target: **500 institutions × 5 robots = 2,500 robots**, with **10 concurrent dashboards each = 5,000 concurrent viewers**.

**Ingest.** Each robot publishes heartbeat, telemetry, health, and LiDAR — call it ~6 messages/second. That is **~15,000 messages/second**, all arriving at a single `MQTTService`, decoded on one paho background thread, marshalled onto **one asyncio event loop** ([`_handle_message`](../cloud-container/backend/app/mqtt/service.py#L146-L162)), each handler performing one to two Redis writes — roughly **25,000 Redis operations/second from a single Python process**. A CPython event loop doing real I/O per message sustains low thousands of these. This is an order of magnitude over budget, and today it cannot be relieved by adding processes.

**LiDAR bandwidth.** A 360-point scan serialised as JSON floats is roughly 4–8 KB. At 5 Hz across 2,500 robots that is **~75 MB/s (600 Mbps) sustained through a single Mosquitto process**, with every byte also written to Redis. Mosquitto routes messages on a single thread. This will not hold.

**Dashboard fan-out — the worst of the three.** `/ws/status` re-queries everything every 2 seconds, *per connected client* ([`ws/status.py`](../cloud-container/backend/app/ws/status.py)). Each poll runs one unbounded `SELECT` returning all 2,500 robots, then per robot performs three Redis `GET`s in `_summarize()` plus one `get_holder()` — **four round-trips per robot, per client, per poll**. That is 10,000 Redis operations per client per push; at 5,000 clients, **~25 million Redis operations per second**. Even after correct tenant scoping reduces it to five robots per view, it remains ~50,000 ops/second of pure polling overhead for data that mostly hasn't changed.

The polling design is called out as a deliberate simplification in [`ws/status.py`](../cloud-container/backend/app/ws/status.py)'s own docstring, and it was the right call for one robot. It does not survive contact with a fleet.

**Fixes, in order of leverage:** event-driven push (broadcast on registry change instead of polling) → per-tenant fan-out so one snapshot serves many viewers → collapse the four round-trips into a single Redis hash per robot (`HGETALL`) or a pipelined `MGET` → move LiDAR off MQTT entirely, or binary-encode and downsample it (a browser canvas cannot use 5 Hz × 360 points anyway).

### Single points of failure

Every stateful component is a singleton with `restart: unless-stopped`: one Mosquitto, one Postgres, one Redis, one coturn, one backend. `restart:` is not high availability — it is a reboot with extra steps. For institutional deployments where a robotics class is scheduled at a fixed hour, an outage isn't degraded service; it's a cancelled lesson. Managed, replicated equivalents (or AWS IoT Core / RDS Multi-AZ / ElastiCache with failover, per the existing migration guide) are the answer, and the migration guide already maps them correctly.

### The unasked architectural question: what happens when the internet drops?

Today, a robot is controllable only via the cloud. A school with a flaky connection has an unusable robot. For education specifically, consider whether a **local fallback mode** — the operator console reaching the robot over the campus LAN when the cloud is unreachable — is a requirement. The current boundary makes this feasible (the Robot Cloud Agent is already the only thing that speaks both protocols), but it must be designed for, not discovered later.

---

## Security

The recent hardening pass genuinely closed the acute problems: Redis is authenticated and loopback-bound, tokens are revocable, WebSocket credentials are single-use, login is rate-limited, containers run unprivileged, and there is a tamper-evident audit trail. Against a single-tenant threat model, the posture is now reasonable.

Against a multi-institution threat model, four issues remain, and the first two are serious.

**1. All robots share one credential — enabling fleet-wide impersonation.**
[`docker-entrypoint-wrapper.sh`](../cloud-container/mosquitto/docker-entrypoint-wrapper.sh) provisions exactly two identities: `backend`, and one robot whose username is `ROBOT_ID` with password `MQTT_ROBOT_PASSWORD`. Scaling this means every robot sharing a single password. The ACL scopes each robot to its own namespace via `%u` — but `%u` is *whatever username the client authenticated as*, and with a shared password any robot can authenticate as any other. Physical robots in schools are accessible to students; one extracted credential compromises the entire fleet: forged telemetry, forged LiDAR, and interception of another robot's commands.
**Fix:** per-device credentials, ideally x509 client certificates provisioned per robot. This is precisely the model AWS IoT Core expects, so it is also migration work you would do anyway.

**2. MQTT is plaintext, and the TURN credential is a public shared secret.**
The broker listens on `1883` with no TLS. Once robots connect from campus networks rather than a Docker bridge, credentials and telemetry cross real networks in the clear. Separately, `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` are injected into the browser bundle — a static, shared, long-lived credential that anyone who opens DevTools can extract and use to relay arbitrary traffic through your infrastructure at your bandwidth cost. **Fix:** MQTT over TLS (8883) with per-device certs; time-limited ephemeral TURN credentials (the standard REST-based scheme) instead of a static pair.

**3. No authorization model — only authentication.**
The system knows *whether* you are logged in, never *what you may do*. A university deployment needs at least: student (drive assigned robots), instructor (assign, override, view class activity), institution admin (manage users and robots), platform operator (cross-tenant support). Today, everyone who can log in can do everything to everything.

**4. Tokens live in `localStorage`.**
[`auth/AuthContext.tsx`](../cloud-container/frontend/src/auth/AuthContext.tsx) persists the JWT to `localStorage`, which is readable by any successful XSS. The new CSP reduces XSS likelihood but doesn't change the blast radius. The stronger pattern is an `httpOnly`, `Secure`, `SameSite` cookie plus a CSRF token. Shortened token lifetime and revocation have reduced the impact; they haven't eliminated it.

---

## Data integrity

**Strong:** the hash-chained `audit_log` is a real integrity control, not decoration — it was verified by corrupting a row and confirming detection. The Redis-vs-Postgres split (ephemeral cache vs. system of record) is correctly reasoned. Command payloads are a closed enum validated by Pydantic, so the command channel has no injection surface.

**Weak, and material at scale:**

- **No schema migrations.** `CREATE TABLE IF NOT EXISTS` ([`db/postgres.py`](../cloud-container/backend/app/db/postgres.py)) cannot evolve a column, and the file says so honestly. Adding `tenant_id` to tables holding live institutional data without a migration tool is the kind of task that produces a bad weekend. **Adopt Alembic before there is production data**, not after.
- **No backup or recovery story.** Docker volumes with no documented backup, no tested restore, no RPO/RTO target. The audit log is only tamper-evident if it still exists.
- **Redis has no persistence configured** and no replica. Session locks and cached fleet state vanish on restart. This is defensible by design (everything is re-derivable), but combined with no HA it means a Redis restart drops every active control session across every institution simultaneously.
- **Audit completeness is best-effort by design.** `record_safe()` deliberately swallows failures so an audit write can never block an emergency stop — the right call for safety, but it means the log is not a *complete* record under failure. For a system of record, pair it with an outbox pattern or at minimum alert loudly on audit-write failures.

---

## Compliance — the risk that is easiest to overlook and most expensive to discover late

You are describing deployment into schools. That means **data about minors**, and cameras pointed at children. This is a regulated context, not merely a sensitive one — India's DPDP Act 2023 (with specific children's-data provisions and verifiable parental consent requirements), GDPR (where children's data is treated with heightened protection), and FERPA in US institutions.

What the current design gets *right*, and should be preserved as an explicit commitment: **video is peer-to-peer and never recorded or stored.** The backend relays SDP text and never touches a video byte. That is a genuinely strong privacy property. Write it down as a design constraint, because the first person who asks for "session recording for grading" will be crossing a major regulatory boundary, and the team should know that before saying yes.

What is missing: no data retention or deletion policy; no consent model; no data-residency consideration; no defined data-subject-erasure path. And note the tension I introduced with the audit log — an append-only, tamper-evident chain is excellent for integrity and directly awkward under a right-to-erasure request. That is solvable (store user identifiers as pseudonymous IDs in the chain, with the mapping separately erasable), but it must be solved deliberately.

Get a privacy review before the first pilot, not before the fiftieth.

---

## Prioritized roadmap

Ordered by *cost of delay*, which is not the same as ordered by difficulty.

### P0 — before the first multi-institution pilot

These are the items that get dramatically more expensive once real data exists in real institutions.

1. **Multi-tenancy** — `tenant_id` through schema, JWT claims, and MQTT topic hierarchy; row-level security so unscoped queries fail closed; `stop` scoped to tenant. *Everything else on this list is cheaper after this is done.*
2. **Per-device robot credentials** (x509 preferred) replacing the shared password.
3. **Real user accounts + RBAC** — hashed passwords (argon2/bcrypt), the four-role model above, per-user audit attribution.
4. **TLS everywhere** — MQTT on 8883, HTTPS termination, ephemeral TURN credentials.
5. **Alembic migrations** — adopt before production data exists, which is the only cheap moment.
6. **Backup and tested restore** — with a written RPO/RTO. An untested restore is not a backup.

### P1 — before scaling past the pilot

7. Fix the three horizontal-scaling blockers (WebRTC relay state → Redis; unique MQTT client IDs; shared subscriptions).
8. Replace `/ws/status` polling with event-driven, per-tenant fan-out.
9. Eliminate the N+1 read pattern (single Redis hash per robot, or pipelining).
10. Move LiDAR off the MQTT hot path; downsample and binary-encode.
11. CI/CD running the existing test suite plus `make security-audit` on every commit — the suite exists and nothing invokes it automatically.
12. Observability: metrics, tracing, alerting. You cannot operate 500 sites from logs.
13. High availability for every current singleton.

### P2 — platform maturity

14. Per-tenant quotas, metering, and cost attribution.
15. Data retention, consent, and erasure mechanisms.
16. Load and chaos testing against realistic fleet sizes — the arithmetic above should be validated empirically, not trusted.
17. Independent penetration test.
18. Local/offline fallback mode, if the connectivity analysis says schools need it.

---

## Closing judgement

If this were presented as a finished platform ready for institutional rollout, the assessment would be a straightforward *no* — the tenancy gap alone makes it unsafe to put two institutions on one deployment.

But that is not what it is. It is a very well-engineered proof of the hard parts: the protocol split between control and media is correct, the container boundary is correct and enforced by the broker rather than by convention, the safety reasoning is genuinely thoughtful, the testing discipline is real, and the documentation is better than most funded products. Those are the things that are painful to retrofit, and they are already right.

What remains is largely the *product* layer — tenancy, identity, roles, scale-out plumbing, operational maturity. That work is substantial, but it is additive, and it lands cleanly on top of what exists precisely because the boundaries were drawn well.

The single most valuable decision available right now is to **build multi-tenancy before the first two institutions share a deployment**. Everything else on the roadmap can be sequenced, deferred, or bought. That one cannot — its cost curve is the steepest, and it is currently at its lowest point.
