# SCH-57 private scanner

This container implements the existing `POST /scan` PDF-bytes contract using
ClamAV 1.4.6 and pikepdf 9.5.2. Its private Worker and baked image were deployed on 2026-10-05 with the scanner
paused and no public endpoint. Private synthetic cloud scans passed. This standalone operations change does not add a student-app binding.
Production uploads stay disabled. No student documents are used in its checks.

Run with 4 GiB RAM, a read-only filesystem/signature mount, no outbound network,
no capabilities, and memory-backed temporary directories. Only its private
Worker service binding may reach port 8080; do not expose a public endpoint.
The ClamAV daemon uses a Unix socket, not a network listener. Scans are serialized. Startup verifies `/tmp` is tmpfs using both mount metadata and `statfs`,
then checks directory access after dropping privileges; when Cloudflare omits
it, a root bootstrap mounts a 64 MiB tmpfs and drops all supplementary groups
and switches to UID/GID 65534 before starting ClamAV or accepting requests.
Startup fails if memory storage or the unprivileged identity cannot be verified.
The HTTP listener uses a fixed server name without resolving the cloud hostname.
Missing/stale signatures, startup, AV errors, timeouts and parsing errors fail
closed. Signatures must be refreshed outside the upload service at least daily;
48-hour age fails closed. Hosting must monitor daemon health/signature freshness
without logging request bodies, filenames, parser errors or antivirus output.

Limits: 5 MiB input, 32 MiB total decoded streams/images, 200 pages, 10,000 PDF
objects, 100,000 visited values, nesting depth 100. The parser runs in a separate
process with 256 MiB address space, three CPU seconds and four wall-clock seconds.
ClamAV has an eight-second scan limit. JPEG images and generalized lossless
filters are supported. Unsupported codecs (including JBIG2/JPX), inline images/PostScript, interactive
forms/actions, links, attachments, encryption and malformed drawing streams
are rejected. Students may need a flattened PDF. This is a conservative upload
policy; it does not promise to detect every possible malicious PDF or prove
that a document's academic content is valid.

The updater handles only public signatures. The scanner receives only bytes,
never a filename, account identity, database credential or encryption key.
Request/AV/parser logs are suppressed. Uploaded bytes are held only in process
memory and `/tmp`, with ClamAV responsible for temporary-file cleanup;
container destruction clears memory-backed files after a crash. The test checks
that successful/rejected requests leave no scan files in `/tmp`.

## Runnable real-engine check

```sh
# Refresh public signatures outside the upload service and bake them into the image.
scanner/update-signatures.sh
docker build -t scholarable-document-scanner:sch57 scanner
docker run --rm --user 65534:65534 --read-only --network none --memory 4g --cpus 0.5 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges --ulimit core=0 \
  scholarable-document-scanner:sch57 python3 test_scanner.py
```

The test uses actual vendor signatures and EICAR, generated clean/JPEG PDFs, a valid PDF near the 5 MiB limit,
malformed/encrypted/active/attached/excessively expanded PDFs, and a local HTTP
request. It never substitutes a clean verdict. This proves the local candidate,
not production placement, private binding, cold-start latency, signature-update
operations, browser acceptance or deletion scheduling.

## Private cloud deployment and pause

The approved pilot uses a fixed `scanner` Durable Object and a `standard-1`
instance with outbound Internet disabled. No Worker route, workers.dev endpoint,
preview URL, container log collection, filesystem snapshot, account credential,
identity, or encryption key is configured. Upload requests are bounded and caller
headers are replaced before proxying. `/health` checks loaded ClamAV and signature
freshness without receiving a PDF. Startup requests fail closed and can be retried;
it does not claim that cold starts fit inside the app's 15-second scan timeout.

The Worker reserves 120 seconds before each container start, at most 180 starts
per UTC month (six reserved runtime hours), sets a 30-second inactivity timeout,
and schedules a shutdown alarm at the end of every window. Counters survive
restarts; failed starts count, and busy requests fail instead of queueing.
Cloudflare alarm delays and shared account charges must still be measured; these
controls are not a provider-enforced monetary cap. `SCANNER_ENABLED=false` pauses
requests. The shutdown/inactivity mechanisms still stop any existing container.
Do not create additional named instances or reset the persisted budget counter.

```sh
node --experimental-vm-modules scanner/test_worker.mjs
npx --yes wrangler@4.136.0 deploy --dry-run --config scanner/wrangler.jsonc
# After account/billing/auth verification, refresh signatures before every deployment.
scanner/update-signatures.sh
npx --yes wrangler@4.136.0 deploy --config scanner/wrangler.jsonc
```

Cloud acceptance also confirmed the 120-second shutdown alarm under 15-second process heartbeats; the persisted counter reached 36 starts without resets.

The source configuration deliberately deploys paused. Enable the scanner only for
private synthetic acceptance checks first. After cloud verification, add a service
binding named `SCHOLARABLE_DOCUMENT_SCANNER` targeting
`scholarable-document-scanner` to the authorized student-app deployment. Keep the
student document flags false until the remaining activation gates pass.

Signatures are baked into the image, not fetched by the PDF-processing container.
Rebuild/redeploy at least daily and test the remote `/health` and a real scan after
each update. If operations cannot supply fresh images, uploads must remain paused;
stale images reject after 48 hours. The GitHub deployment credential is provisioned
and manually tested; scheduled refresh remains disabled pending alert verification.
No personal OAuth grant may be copied into CI.
Private cloud tests confirmed clean and near-limit PDF acceptance, rejection of encrypted/active/EICAR/expanded PDFs, real antivirus detection, verified tmpfs cleanup, UID/GID 65534 and blocked outbound Internet. Cold startup needed retries (about 23 seconds); a warm near-limit scan took 3 seconds. Measured billing, processing placement, daily updates and operational alerts remain activation checks.

The wrapper test uses a fake Cloudflare control plane only to check admission,
header stripping and lifecycle/budget branches. The separate container test uses
real ClamAV signatures and the real PDF parser; neither is proof of deployment.

## Daily update workflow — prepared, disabled

`.github/workflows/refresh-document-scanner.yml` refreshes public definitions,
builds and checks the real engine offline, then deploys the scanner **paused**.
Scheduled runs require `SCHOLARABLE_SCANNER_REFRESH_ENABLED=true`. Manual
`workflow_dispatch` runs can test deployment with that variable unset. Both paths
require `main`.
The `document-scanner` GitHub environment holds only
`SCHOLARABLE_SCANNER_DEPLOY_TOKEN`; no database, identity or encryption secrets
are supplied. The approved deployment token is now stored in that environment;
only `main` can deploy to it. The refresh enable variable remains unset.

The owner approved GitHub Actions as a new holder of Cloudflare deployment
authority on 2026-10-05. Use the [existing Worker Editor scope](https://developers.cloudflare.com/workers/authorization/workers/)
plus the necessary container/image permissions; verify the actual
token scope before storing it, and never reuse the local OAuth grant. Configure
GitHub failed-workflow notifications and prove receipt with a controlled failure.
A disabled or missed schedule produces no job failure: freshness rejects scans
after 48 hours, but independent missed-run monitoring remains required.

This staging workflow deliberately pauses every deployment. Before pilot launch,
replace that staging behavior with a verified update/remote synthetic acceptance
procedure that preserves the approved operating state. The daily production
operations gate remains open until a real scheduled run, private cloud acceptance
and alert delivery are verified. Do not enable uploads just because this file exists.

Credential receipt: `scholarable-sch57-scanner-github`, account-owned token ID
`b87f29f08fb4bbd0d4d64bba7ae81354`, expires November 5, 2026 (provider's
30-day selection). Read-back confirmed Individual Workers Editor only for
`scholarable-document-scanner`, plus account-level Workers Containers Write,
Cloudchamber Write and Artifacts Write. GitHub secret metadata and `main`-only
environment admission were independently verified. Token value was transferred
directly from the provider's one-time UI to GitHub's encrypted environment
secret, never printed or saved to a repo/local file. Deployment using this token passed in
[manual GitHub run 37279038220](https://github.com/FlamurMaliqi/Scholarable/actions/runs/37279038220)
(attempt 2) after scanner-only PR #41 merged. Attempt 1 failed at `/containers/me`;
the same credential and permissions succeeded on retry. The initial failure's
cause was not established; no permissions were widened. The run refreshed public
signatures, passed real scanner tests and deployed paused. Version read-back
confirmed `SCANNER_ENABLED=false`; a private binding request returned HTTP 503.
No draft app feature was merged and environment admission remains `main` only. Rotate before expiry; expiry pauses
updates and stale signatures subsequently reject scans.

## Independent operations deployment

Scanner operations were merged independently in PR #41 on 2026-10-05. The
student-document feature remains staged in PR #40 with its own activation gates.
Neither merging scanner operations nor a manual paused deployment enables
student uploads, cleanup or scheduled refresh. A manual credential deployment
check can run from `main` while the refresh enable variable remains unset.

Latest paused deployment: `40ee38d8-cb25-49e5-a48a-b8017e5a584f`. The CI deployment
baked image `sha256:d9eb12f0862185eb0e9358f3066da16f42e88084b780401a6258dcdef62f8ab4`.
A subsequent private synthetic suite accepted clean and near-limit PDFs and rejected
encrypted, active, EICAR, expanded and malformed PDFs. Empty, wrong-type and oversized
requests returned 400, 415 and 413. Cold acceptance took 38.49 seconds with retries;
a warm near-limit scan took 3.821 seconds. A second synthetic suite independently inspected the running native container and
confirmed its image exactly matched the CI digest above. It accepted clean and
near-limit PDFs and rejected encrypted, active, EICAR and expanded PDFs. Cold
acceptance took 27.58 seconds; the warm near-limit scan took 5.256 seconds. The
persisted monthly counter reached 38 starts without resets. The temporary private
image diagnostic was removed and the original worker restored before pausing.
The daily refresh enable variable remains unset. Failure-only GitHub Actions email
notifications were enabled with owner approval on 2026-10-05. A labeled, isolated
[receipt test](https://github.com/FlamurMaliqi/Scholarable/actions/runs/37281681969)
failed intentionally without checkout, deployment credentials or document access;
the refresh job was skipped. Its matching failure email arrived in the owner
mailbox at 08:07:59 UTC. The test used branch `codex/sch-57-alert-receipt` and was
not merged into operations. The scheduled workflow cron author is the same GitHub
account as the recipient. Missed-run alerts and actual scheduled delivery remain
unverified.
Measured billing/placement, unattended remote acceptance after each refresh and
production activation gates remain open.

## Read-only missed-refresh check

Run `python3 scanner/check_refresh.py` using the existing GitHub CLI login.
It reads only this repository's workflow, variable, run and job metadata. It
never reads environment secrets, deploys, starts a scanner or sends an alert.
`python3 scanner/check_refresh.py --self-test` checks the freshness boundaries.

When refresh is enabled, the check requires a successful `refresh` job and its
successful deployment step on `main`, within the last 30 hours. Skipped runs,
notification-test jobs and other branches cannot certify freshness. It uses the
deployment step completion time rather than run update time, so a rerun cannot
make an old deployment appear fresh. Missing, stale, disabled and unavailable
states require action; an unset enable variable reports `paused` explicitly.
The bounded ten-run lookback fails missing if activity hides the last deployment.
The report contains only state, timestamps and age; raw API diagnostics are omitted.

On 2026-10-05 the real read-only check reported `paused`. An enabled-mode evaluation
against real run/job metadata, overriding only the in-memory enable flag, verified
the previously successful deployment receipt. No repository setting was changed.
The older hourly trust monitor described in `docs/combined-trust-status.md` was
not found among current local automation configuration files. This command does
not establish scheduled execution or alert delivery. A Mac-hosted schedule also
cannot cover host absence; keep uploads paused until the operating policy and
remaining activation gates are satisfied.

Hourly check receipt: owner-approved heartbeat `scholarable-scanner-refresh-checks`
was created ACTIVE in the current chat on 2026-10-05. Saved configuration verifies
the hourly recurrence and absolute checker path above. It reports only new
actionable states, meaningful recovery or required action; unchanged/fresh/paused
results stay quiet. The manual baseline at 08:21:47 UTC reported `paused`. First
unattended execution and change-notification receipt remain unverified. Preserve
this attached worktree while the automation uses it; update its path before cleanup.

## Placement and billing receipt — 2026-10-05

Signed-in scanner instance metadata confirms the refreshed-image test instance
ran in **Amsterdam, Netherlands**, started at 08:09:55 UTC and was stopped by
08:11:28 UTC. It reports the expected 0.5 vCPU, 4 GiB memory, 8 GB disk and CI
image digest. This is observed placement, not a future EU-residency guarantee.
The native `durable_object` policy rejects application placement constraints;
its startup API does not provide a documented placement selector. Do not infer
scanner residency from the Neon Frankfurt region. See the official
[configuration reference](https://developers.cloudflare.com/workers/wrangler/configuration/#durable_object-scheduling-policy).

The Containers account dashboard reports **USD0.00 current billable usage**,
6.14k GiB-seconds memory, 12.29k GB-seconds disk, 100.2 CPU seconds and rounded
0 GB egress for September 10–October 10. These rounded totals include the other
account workload; they are not scanner-only charges or a final invoice. The
scanner's own metrics show resource activity and its instance is stopped.

At published rates, six hours with no included allowance is USD0.444096 for
container memory, full 0.5-vCPU use and disk. The UTC calendar-month counter and
provider billing cycle differ: one provider cycle can overlap two monthly
limits (twelve reserved hours, USD0.888192 on the same assumptions). Worker/DO,
network, tax/FX and shutdown-alarm overruns remain separate. This arithmetic
and the current USD0 charge do not establish a hard monetary cap.

Workers AI currently shows USD7.85 usage, projected USD9.06 for the current
cycle, separate from the USD5 subscription. The existing approved planning
split was fully allocated. Owner approved the revised EUR5 base hosting + EUR2
scanner + EUR3 tax/FX buffer + USD10 AI split on 2026-10-05. The allocation
validator accepts that EUR20 split. The supported local launcher now reads
`~/.local/share/scholarable-infrastructure/lane4-budget-inventory.json`, defaults
to USD10, and rejects USD12. The pinned runner release and existing ledger are
unchanged. The pilot caller requests USD10. Direct adapter calls outside the
supported launcher do not inherit this allocation; this is not provider-wide
enforcement. All launch gates remain in force.
