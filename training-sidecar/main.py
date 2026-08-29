"""Training sidecar — FastAPI server for managing LoRA training jobs."""

import argparse
import asyncio
import os
import re
import sys
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from captioning.batch_manager import CaptionBatchManager
from captioning.provider import get_provider as get_caption_provider
from captioning.provider import unload_provider as unload_caption_provider
from config import SidecarConfig, load_config, read_hf_token, read_keep_awake
from downloads.manager import DownloadManager
from job_manager import JobManager
from job_registry import JobKind, JobRegistry, LifecycleStatus, run_worker
from models import (
    CaptionBatchRequest,
    CaptionBatchResponse,
    CaptionRequest,
    CaptionResponse,
    HealthResponse,
    HeartbeatRequest,
    StartDownloadRequest,
    StartDownloadResponse,
    StartJobRequest,
    SystemStats,
)
import power
from ai_toolkit_server import AiToolkitServer
from providers.ai_toolkit_ui import AiToolkitUiProvider
from providers.fizgig import FizgigProvider
from providers.kohya import KohyaProvider
from providers.mock import MockProvider
from providers.musubi import MusubiProvider
import safe_stdio
from sample_archive import configure as configure_sample_archive
from system_stats import collect as collect_system_stats
from system_stats import prime as prime_system_stats
from validation import RequestValidationError
from ws_manager import WebSocketManager

# Origins allowed to open WebSocket connections or issue mutating (POST/
# DELETE) HTTP requests. Used both by the CORS middleware's allow_origin_regex
# below and by the manual check further down — kept as one pattern (rather
# than two lists that have to be kept in sync) because Starlette's CORS
# middleware doesn't run for WebSocket upgrades, and doesn't gate "simple"
# cross-origin POSTs either (no preflight is triggered for those), so without
# an explicit check any web page could fire requests at this listening
# localhost port.
#
# This used to be a fixed ("http://localhost:3000", "http://127.0.0.1:3000")
# allow-list. That broke in two ways that both silently killed every live
# WebSocket (training/caption/download progress) while leaving the Node API
# routes — which don't go through this check — working fine, so the failure
# was invisible until someone noticed progress bars had stopped moving:
#   1. `next dev` moves to 3001+ whenever 3000 is already taken (a second dev
#      server, or a stale process holding the port), so the page's real
#      origin silently stops matching.
#   2. The sidecar is spawned detached and can be reconnected to as an orphan
#      across a Node restart (see sidecar-manager.ts `tryReconnect`) — by a
#      Node process that may be listening on a *different* port than whoever
#      spawned it. A value baked in at spawn time (an env var or CLI arg) can
#      go stale the moment that happens, with no signal to the sidecar that
#      it should stop trusting its old origin.
#
# Rather than chase the real port through spawn-time plumbing that can still
# go stale, this matches any loopback origin — localhost/127.0.0.1 on any
# port. That's a deliberately weaker check, but it doesn't weaken the thing
# the check actually defends against: a browser sets the `Origin` header to
# the requesting page's own origin and cannot forge it, so a page served from
# anywhere other than this machine can never present a loopback Origin — the
# remote-attacker case the check exists for stays blocked. What it newly
# allows is a *local* process serving a page on some other loopback port
# reaching this sidecar, which is an acceptable trade for a single-user,
# local-only app (see "Local app only; No over-the-network" in CLAUDE.md).
# `[::1]` is in there because a browser pointed at the IPv6 loopback sends
# `http://[::1]:3000` as its Origin, which is the same machine by any measure
# — leaving it out would reproduce the exact silent-4403 failure this pattern
# exists to cure, just for a different way of typing "localhost".
_LOOPBACK_ORIGIN_RE = re.compile(
    r"^http://(?:localhost|127\.0\.0\.1|\[::1\]):\d+$"
)


def _is_allowed_origin(origin: str) -> bool:
    """Whether `origin` may open a WebSocket or issue a mutating request.

    Pulled out as a pure function (rather than inlined at each call site) so
    the matching rule is unit-testable without spinning up FastAPI/Starlette.

    `fullmatch` rather than `match` so the whole header has to be a loopback
    origin — and so this agrees with Starlette's CORS middleware, which
    fullmatches the same pattern. (`$` alone would also accept a trailing
    newline, which is not a distinction worth relying on in a security check.)
    """
    return _LOOPBACK_ORIGIN_RE.fullmatch(origin) is not None

# --- Globals initialised at startup ---
ws_manager = WebSocketManager()
caption_ws_manager = WebSocketManager()
download_ws_manager = WebSocketManager()
job_registry = JobRegistry()
job_manager: JobManager
caption_manager: CaptionBatchManager
download_manager: DownloadManager
sidecar_config: SidecarConfig
# Tracks any ai-toolkit UI server we spawn so we can stop it on shutdown.
aitk_server: Optional["AiToolkitServer"] = None
# Worker task(s) that pull jobs from the registry queue. Phase 2 runs one.
worker_tasks: list[asyncio.Task] = []

# --- Idle-shutdown watchdog ---
#
# The sidecar is spawned detached so it survives Node HMR restarts, but that
# means a plain Node shutdown would leave it orphaned (holding the port + any
# resident models). To clean up, Node sends a periodic heartbeat while it's
# alive; if the heartbeat stops AND nothing is running/queued, the sidecar
# exits itself. The watchdog only arms once a heartbeat has been seen, so a
# standalone/old-Node run is never auto-killed.
_last_activity_at: float = time.monotonic()
_heartbeat_seen: bool = False
# uvicorn server handle, set in __main__ so the watchdog can request a graceful
# exit cross-platform (Windows signal handling is unreliable).
_server: Optional["uvicorn.Server"] = None  # noqa: F821 (uvicorn imported lazily)
# Node heartbeats ~every 30s; give ~2 min of grace so a manual dev-server
# restart doesn't kill an otherwise-idle sidecar.
_IDLE_SHUTDOWN_GRACE_S = 120.0
_WATCHDOG_INTERVAL_S = 30.0


# --- Keep-awake ticker ---
#
# Windows (and every other desktop OS) idle-sleeps happily through a six-hour
# training run. The run resumes on wake, but the wall clock is gone and any
# download mid-transfer usually isn't coming back. When the user has the toggle
# on and there's work in flight, we hold a sleep inhibition; see power.py.
#
# Faster than the watchdog's tick because it's what decides whether the machine
# is allowed to drop off — a lock taken a minute late is a minute of sleeping
# through a run.
_POWER_TICK_S = 10.0
# Node reports the work only it can see (ONNX tagging batches) on the
# heartbeat. That signal is trusted until this long after it last arrived, so a
# Node that dies mid-batch can't leave the machine pinned awake indefinitely —
# it just has to outlast the 30s heartbeat interval comfortably.
_NODE_BUSY_TTL_S = 90.0
_node_busy_until: float = 0.0


def _work_in_flight() -> bool:
    """Whether anything is running or waiting to run, anywhere.

    Downloads are checked separately from the registry because they never
    enter it — they're not GPU-bound and must not queue behind training — and
    a multi-GB transfer is exactly the thing that shouldn't be interrupted.
    """
    if job_registry.has_running() or job_registry.queued_jobs():
        return True
    if download_manager.has_active:
        return True
    return time.monotonic() < _node_busy_until


async def _power_ticker():
    """Hold the machine awake while work is in flight, release it when idle."""
    while True:
        await asyncio.sleep(_POWER_TICK_S)
        try:
            enabled = read_keep_awake(sidecar_config.config_path)
            # Must stay on this thread — the Windows flag is per-thread and
            # would lapse the moment a worker thread exited (see power.py).
            power.set_keep_awake(enabled and _work_in_flight())
        except Exception as err:  # noqa: BLE001 — a power tick must never die
            print(f"[power] Tick failed: {err}", flush=True)


async def _idle_watchdog():
    """Exit the process when Node has gone away and there's no work left."""
    # Set once we've released the caption model during an unclaimed-results
    # hold, so we don't retry the unload every tick; cleared when a client
    # comes back.
    released_model_while_holding = False

    while True:
        await asyncio.sleep(_WATCHDOG_INTERVAL_S)

        # Retire long-dead caption batches on the same tick — this is what
        # eventually lets the unclaimed-results hold below expire.
        caption_manager.prune_terminal()

        # Not managed by a heartbeating Node — leave it alone.
        if not _heartbeat_seen:
            continue
        # Never shut down mid-job; let running/queued work finish first.
        # Exiting on a live download in particular is exactly the mid-transfer
        # death this sidecar exists to prevent.
        if _work_in_flight():
            continue

        idle_for = time.monotonic() - _last_activity_at
        if idle_for < _IDLE_SHUTDOWN_GRACE_S:
            released_model_while_holding = False
            continue

        # A completed batch whose client died still holds the only copy of its
        # captions (unlike training runs, caption batches aren't persisted).
        # Exiting here would destroy exactly the results the reattach flow
        # exists to hand back, so hold the process open until either a client
        # collects them or the retention TTL retires the batch.
        if caption_manager.has_unclaimed_results:
            # Holding the results doesn't mean holding the model — nothing can
            # ask for inference while the client is gone, so give the VRAM back
            # rather than pinning several GB for the retention window.
            if not released_model_while_holding:
                released_model_while_holding = True
                try:
                    await unload_caption_provider()
                except Exception as err:
                    print(
                        "[sidecar] Could not release the caption model while "
                        f"holding unclaimed results: {err}",
                        flush=True,
                    )
            continue

        print(
            f"[sidecar] No client for {idle_for:.0f}s and nothing to do — "
            "shutting down.",
            flush=True,
        )
        if _server is not None:
            _server.should_exit = True
        else:
            # No server handle (only if imported under an external uvicorn) —
            # exit hard as a last resort.
            os._exit(0)
        return


def _register_providers(jm: JobManager, config: SidecarConfig):
    """Register available training providers based on config."""
    global aitk_server
    backends = config.backends

    # ai-toolkit — driven via its bundled UI server's HTTP API.
    # The server is spawned lazily on first training request (via
    # AiToolkitServer.ensure_running) — we just register the provider here.
    aitk_path = backends.get("ai-toolkit")
    if aitk_path:
        log_path = config.training_dir / "aitk-server.log"
        aitk_server = AiToolkitServer(
            Path(aitk_path), port=config.aitk_port, log_path=log_path
        )
        provider = AiToolkitUiProvider(aitk_path, aitk_server)
        jm.register_provider("ai-toolkit", provider)
        print(
            f"[sidecar] Registered ai-toolkit provider at {aitk_path} "
            f"(server logs -> {log_path})"
        )

    # Kohya (sd-scripts) — subprocess-driven, stderr-scraped (sd-scripts has no
    # UI/API of its own). Supports SDXL (+ Illustrious/NoobAI finetunes),
    # Anima and Flux.1; add more architectures to
    # KohyaProvider.SUPPORTED_MODELS.
    kohya_path = backends.get("kohya")
    if kohya_path:
        provider = KohyaProvider(kohya_path)
        jm.register_provider("kohya", provider)
        print(f"[sidecar] Registered kohya provider at {kohya_path}")

    # Musubi Tuner — sd-scripts lineage, so it shares the Kohya provider's
    # subprocess/log machinery, but pre-caches latents and TE outputs in
    # separate phases before the training spawn. Supports Z-Image Base,
    # Krea 2, Qwen-Image and Flux.2 Klein Base; add more architectures to
    # MusubiProvider.SUPPORTED_MODELS.
    musubi_path = backends.get("musubi")
    if musubi_path:
        provider = MusubiProvider(musubi_path)
        jm.register_provider("musubi", provider)
        print(f"[sidecar] Registered musubi provider at {musubi_path}")

    # Fizgig — experimental Krea 2-only backend. Not sd-scripts lineage, but
    # it deliberately speaks the same log/dataset/checkpoint grammar, so it
    # shares the subprocess machinery; launched as plain python (no
    # accelerate). See providers/fizgig.py for what's actually different
    # (epoch-only pacing, int8/NF4 base training, Turbo-LoRA previews).
    fizgig_path = backends.get("fizgig")
    if fizgig_path:
        provider = FizgigProvider(fizgig_path)
        jm.register_provider("fizgig", provider)
        print(f"[sidecar] Registered fizgig provider at {fizgig_path}")

    # Registered before the mock provider so the "any real backend?" check
    # below is a snapshot of what config.json actually gave us.
    real_backends_registered = bool(jm.providers)

    # Mock provider is always registered — it needs no external tooling and
    # lets the UI be exercised end-to-end (including GPU-busy blocking)
    # without a real training backend installed.
    jm.register_provider("mock", MockProvider())
    print("[sidecar] Registered mock provider")

    if not real_backends_registered:
        print(
            "[sidecar] Warning: No real training backends configured — only "
            "the mock provider is available. Add paths to config.json under "
            "'trainingBackends'.",
            file=sys.stderr,
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle for the FastAPI app."""
    global job_manager, caption_manager, download_manager, sidecar_config

    sidecar_config = load_config()
    jobs_dir = sidecar_config.training_dir / "jobs"
    # Providers copy each sample into its run's job folder as they claim it;
    # point the archiver at the same dir JobManager writes job configs to.
    configure_sample_archive(jobs_dir)
    job_manager = JobManager(
        jobs_dir=jobs_dir,
        ws_manager=ws_manager,
        registry=job_registry,
    )
    caption_manager = CaptionBatchManager(
        ws_manager=caption_ws_manager, registry=job_registry
    )
    download_manager = DownloadManager(
        downloads_dir=sidecar_config.training_dir / "downloads",
        ws_manager=download_ws_manager,
        hf_token_provider=lambda: read_hf_token(sidecar_config.config_path),
    )
    _register_providers(job_manager, sidecar_config)

    # psutil's CPU reading is "since the last call", so burn one here — long
    # before anything asks for stats — rather than serving a 0% first sample.
    prime_system_stats()

    # Write PID file so Node.js can find us after a restart
    pid_path = sidecar_config.training_dir / "sidecar.pid"
    pid_path.write_text(str(os.getpid()), encoding="utf-8")

    # Start the queue worker(s) — one per `sidecarWorkers` entry in
    # config.json, each pinned to its assigned GPU.
    #
    # Caveat: VLM captioning runs in-process inside this sidecar, so its
    # CUDA context is shared with whichever GPU torch picked at process
    # startup (usually GPU 0). Caption jobs assigned to a non-zero worker
    # slot will still execute on the sidecar's GPU, not on the worker's
    # `gpu_id`. Isolating captioning would require spawning it as a
    # subprocess with its own `CUDA_VISIBLE_DEVICES` — deferred.
    for i, wc in enumerate(sidecar_config.workers):
        worker_tasks.append(
            asyncio.create_task(
                run_worker(job_registry, worker_id=i, gpu_id=wc.gpu_id)
            )
        )
        print(f"[sidecar] Worker {i} pinned to GPU {wc.gpu_id}")

    # Downloads survive this process dying: their records are on disk and their
    # partial files resume from the bytes already fetched. Anything the last
    # run left unfinished goes straight back on the queue.
    download_manager.load_records()
    resumed = download_manager.resume_interrupted()
    if resumed:
        print(
            f"[sidecar] Resuming {len(resumed)} interrupted download(s): "
            f"{', '.join(resumed)}"
        )

    # Watchdog that exits the process once Node stops heartbeating and there's
    # nothing left to do (see _idle_watchdog).
    watchdog_task = asyncio.create_task(_idle_watchdog())

    # Stops the host idle-sleeping through long runs (see _power_ticker).
    power_task = asyncio.create_task(_power_ticker())

    # Signal to the Node.js process manager that we're ready
    print(f"SIDECAR_READY port={sidecar_config.port}", flush=True)

    yield

    # Cleanup on shutdown
    watchdog_task.cancel()
    try:
        await watchdog_task
    except asyncio.CancelledError:
        pass

    power_task.cancel()
    try:
        await power_task
    except asyncio.CancelledError:
        pass
    # Hand the machine back its right to sleep. The Windows flag would lapse
    # with the thread anyway, but a helper process on macOS/Linux outlives a
    # crash-exit unless it's told to stop.
    power.set_keep_awake(False)

    for task in worker_tasks:
        task.cancel()
    for task in worker_tasks:
        try:
            await task
        except asyncio.CancelledError:
            pass
    worker_tasks.clear()

    if pid_path.exists():
        pid_path.unlink()
    if aitk_server is not None:
        await aitk_server.stop()


app = FastAPI(title="Training Sidecar", version="0.1.0", lifespan=lifespan)

# Allow connections from the Next.js dev server, on whatever loopback port it
# ended up on — see _LOOPBACK_ORIGIN_RE above.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=_LOOPBACK_ORIGIN_RE.pattern,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _stamp_activity(request, call_next):
    """Any request counts as a client being present (keeps the sidecar alive).

    Also rejects mutating (POST/DELETE) requests whose Origin header is
    present but not a loopback origin (see `_is_allowed_origin`) — CORS'
    preflight doesn't cover "simple" cross-origin POSTs, so this is the only
    thing stopping an arbitrary web page from hitting this localhost port. A
    request with no Origin (curl, the sidecar's own tooling, tests) is left
    alone; GET is left alone regardless of Origin since it's read-only.
    """
    global _last_activity_at
    if request.method in ("POST", "DELETE"):
        origin = request.headers.get("origin")
        if origin is not None and not _is_allowed_origin(origin):
            return JSONResponse({"error": "Origin not allowed"}, status_code=403)
    _last_activity_at = time.monotonic()
    return await call_next(request)


# --- Health ---


@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        active_job=job_manager.active_job_id,
        keep_awake=power.is_keep_awake_active(),
    )


@app.get("/system/stats", response_model=SystemStats)
async def system_stats():
    """Host CPU / memory / GPU load.

    Machine-wide, not per-job: the GPU figures include anything else using the
    card, and with the queue sharing one GPU between training and captioning
    they can't be attributed to a single run. Callers should label it as such.
    """
    return await collect_system_stats()


@app.post("/heartbeat")
async def heartbeat(payload: Optional[HeartbeatRequest] = None):
    """Node's keepalive. Arms the idle watchdog and refreshes the activity
    timestamp — when these stop arriving, the sidecar knows Node has gone.

    The optional `busy` flag carries work only Node can see (ONNX tagging runs
    in the Next process), which the power ticker counts as work in flight. It
    expires on a TTL rather than needing a matching "not busy" call, so a Node
    that dies mid-batch can't pin the machine awake.
    """
    global _heartbeat_seen, _last_activity_at, _node_busy_until
    _heartbeat_seen = True
    _last_activity_at = time.monotonic()
    if payload is not None and payload.busy:
        _node_busy_until = _last_activity_at + _NODE_BUSY_TTL_S
    else:
        _node_busy_until = 0.0
    return {"ok": True}


# --- Provider info ---


@app.get("/providers")
async def list_providers():
    """List registered providers and their supported models."""
    result = {}
    for name, provider in job_manager.providers.items():
        result[name] = {
            "models": provider.get_supported_models(),
        }
    return result


@app.get("/providers/{provider_name}/validate")
async def validate_provider(provider_name: str):
    """Validate that a provider's environment is correctly set up."""
    provider = job_manager.providers.get(provider_name)
    if provider is None:
        return JSONResponse(
            {"valid": False, "error": f"Unknown provider: {provider_name}"},
            status_code=404,
        )
    valid, error = await provider.validate_environment()
    return {"valid": valid, "error": error}


# --- Job management ---


@app.post("/jobs/start")
async def start_job(request: StartJobRequest):
    try:
        response = await job_manager.start_job(request)
        return response
    except RequestValidationError as e:
        return JSONResponse(
            {"error": str(e), "errors": e.errors}, status_code=400
        )
    except RuntimeError as e:
        return JSONResponse({"error": str(e)}, status_code=409)


@app.post("/jobs/cancel")
async def cancel_job(job_id: Optional[str] = None):
    """Cancel a training job. If `job_id` is omitted, cancels the focus job
    (running training job if any, else oldest queued)."""
    success = await job_manager.cancel_job(job_id)
    if not success:
        return JSONResponse({"error": "No active job to cancel"}, status_code=404)
    return {"status": "cancelled"}


@app.get("/jobs/status")
async def job_status():
    state = job_manager.get_status()
    if state is None:
        return {"active": False}
    return {"active": True, **state}


@app.get("/jobs")
async def list_jobs():
    """Every tracked training job — queued, running and terminal.

    The source of truth for the client's run history and its activity panel,
    both of which are projections of this list. `/jobs/status` answers "what's
    the one job worth showing"; this answers "every run there has ever been",
    which is also what a client needs to resynchronise after its progress
    WebSocket dropped and reconnected.

    Dismissed runs are included — they've only left the activity panel, and run
    history still shows them. Clients filter on the `dismissed` flag.
    """
    return {"jobs": job_manager.list_status()}


@app.post("/jobs/clear")
async def clear_job(job_id: Optional[str] = None):
    """Dismiss terminal training jobs from the activity panel.

    Despite the name (kept for client compatibility), this does not delete
    anything: it flags the runs so their cards leave the panel and a refresh
    doesn't bring them back. The records stay on disk and in run history.
    Deleting a run is `DELETE /jobs/<job_id>`.

    If `job_id` is omitted, dismisses every terminal training job.
    """
    dismissed = job_manager.dismiss_completed(job_id)
    return {"status": "dismissed", "count": dismissed}


@app.delete("/jobs/{job_id}")
async def delete_job(job_id: str):
    """Delete a terminal training run from the sidecar's records for good.

    The destructive counterpart to `/jobs/clear`, driven only by an explicit
    delete in the run-history view. The Node route that calls this also removes
    the run's folder (generated config + archived samples); this drops the
    sidecar's own memory and state file so a later `/jobs` listing can't
    resurrect it.
    """
    deleted = job_manager.delete_job(job_id)
    return {"status": "deleted" if deleted else "not_found", "job_id": job_id}


# --- WebSocket for real-time progress ---


@app.websocket("/ws/progress")
async def ws_progress(websocket: WebSocket):
    origin = websocket.headers.get("origin")
    if origin is not None and not _is_allowed_origin(origin):
        await websocket.close(code=4403)
        return
    await ws_manager.connect(websocket)
    try:
        # Send current state immediately on connect
        state = job_manager.get_status()
        if state and "progress" in state:
            await websocket.send_json(state["progress"])

        # Keep connection alive — the server pushes updates via broadcast
        while True:
            # Wait for client messages (ping/pong or close)
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect(websocket)


# --- Captioning (VLM) ---


@app.post("/caption", response_model=CaptionResponse)
async def caption_single(request: CaptionRequest):
    """Caption a single image, waiting for the result.

    Runs through the job registry queue so it serialises with training runs
    and caption batches instead of contending for the GPU. The request still
    409s if anything else is running or queued — a single caption behind a
    multi-hour training job would just be an HTTP timeout in disguise.
    """
    if job_registry.has_running() or job_registry.queued_jobs():
        return JSONResponse(
            {"error": "Cannot caption while another GPU job is running"},
            status_code=409,
        )

    job_id = f"caption-single-{uuid.uuid4().hex[:8]}"
    result: asyncio.Future[str] = asyncio.get_running_loop().create_future()

    async def runner() -> None:
        try:
            provider = get_caption_provider(request.runtime)
            caption = await provider.caption_image(
                image_path=request.image_path,
                model_path=request.model_path,
                prompt=request.prompt,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
                video_options=request.video,
            )
        except Exception as err:  # noqa: BLE001 — surfaced via the future
            job_registry.finish(job_id, LifecycleStatus.FAILED)
            if not result.done():
                result.set_exception(err)
            return
        job_registry.finish(job_id, LifecycleStatus.COMPLETED)
        if not result.done():
            result.set_result(caption)

    try:
        job_registry.create(
            job_id,
            JobKind.CAPTION_SINGLE,
            metadata={"image_path": request.image_path},
        )
    except ValueError as err:
        return JSONResponse({"error": str(err)}, status_code=409)
    job_registry.enqueue(job_id, runner)

    try:
        caption = await result
        return CaptionResponse(image_path=request.image_path, caption=caption)
    except Exception as err:
        return JSONResponse({"error": str(err)}, status_code=500)
    finally:
        # Single captions aren't part of any history view — drop the record
        # so they don't accumulate in the registry.
        job_registry.remove(job_id)


@app.post("/caption/batch", response_model=CaptionBatchResponse)
async def caption_batch(request: CaptionBatchRequest):
    """Enqueue a batch caption run — progress streams via /ws/caption.

    Always enqueues; the worker picks it up when no other GPU-bound job is
    running. The 409 path only fires on duplicate batch IDs.
    """
    try:
        await caption_manager.start_batch(request)
        return CaptionBatchResponse(
            batch_id=request.batch_id,
            status="queued",
            total=len(request.image_paths),
        )
    except RuntimeError as err:
        return JSONResponse({"error": str(err)}, status_code=409)


@app.post("/caption/batch/{batch_id}/cancel")
async def cancel_caption_batch(batch_id: str):
    """Cancel an in-progress caption batch."""
    success = await caption_manager.cancel_batch(batch_id)
    if not success:
        return JSONResponse(
            {"error": f"Batch {batch_id} not running"}, status_code=404
        )
    return {"status": "cancelling"}


@app.get("/caption/batches")
async def list_caption_batches(project: Optional[str] = None):
    """List batches (optionally filtered by project), without results.

    Terminal batches stay listed until cleared, so a client that lost its
    connection mid-run can discover the batch finished and collect results.
    """
    return {"batches": caption_manager.list_batches(project)}


@app.get("/caption/batch/{batch_id}")
async def get_caption_batch(batch_id: str):
    """Full snapshot of one batch including accumulated per-image results.
    Reconnecting clients replay these before streaming live progress."""
    snapshot = caption_manager.get_snapshot(batch_id)
    if snapshot is None:
        return JSONResponse(
            {"error": f"Batch {batch_id} not found"}, status_code=404
        )
    return snapshot


@app.post("/caption/batch/{batch_id}/clear")
async def clear_caption_batch(batch_id: str):
    """Drop a terminal batch (and its stored results) from the manager.
    Called by the client after it has flushed the results.

    404 and 409 mean different things to the caller: 404 is "nothing left to
    clear, stop polling", 409 is "still active, ask again".
    """
    result = caption_manager.clear_batch(batch_id)
    if result == "not-found":
        return JSONResponse(
            {"error": f"Batch {batch_id} not found"}, status_code=404
        )
    if result == "active":
        return JSONResponse(
            {"error": f"Batch {batch_id} is still active"},
            status_code=409,
        )
    return {"status": "cleared"}


# --- Model downloads ---


@app.post("/downloads/start", response_model=StartDownloadResponse)
async def start_download(request: StartDownloadRequest):
    """Queue a model download. Returns as soon as it's accepted — progress
    streams over /ws/downloads and survives the client that started it."""
    try:
        state = await download_manager.start(request)
    except RuntimeError as err:
        return JSONResponse({"error": str(err)}, status_code=409)
    return StartDownloadResponse(job_id=state.job_id, status=state.status)


@app.post("/downloads/{job_id}/cancel")
async def cancel_download(job_id: str):
    """Stop a queued or running download. Partial files stay on disk so a
    later retry resumes instead of starting over."""
    if not await download_manager.cancel(job_id):
        return JSONResponse(
            {"error": f"Download {job_id} is not active"}, status_code=404
        )
    return {"status": "cancelling"}


@app.get("/downloads")
async def list_downloads():
    """Every tracked download — queued, running and terminal.

    The source of truth for the client's download cards, and what a client
    reads to resynchronise after a refresh or a dropped WebSocket.
    """
    return {"downloads": download_manager.list_jobs()}


@app.post("/downloads/{job_id}/clear")
async def clear_download(job_id: str):
    """Drop a terminal download's record. Files on disk are untouched —
    deleting those is the Node side's DELETE /api/model-manager/download."""
    if not download_manager.clear(job_id):
        return JSONResponse(
            {"error": f"Download {job_id} is unknown or still active"},
            status_code=409,
        )
    return {"status": "cleared"}


@app.websocket("/ws/downloads")
async def ws_downloads(websocket: WebSocket):
    """Progress stream for model downloads."""
    origin = websocket.headers.get("origin")
    if origin is not None and not _is_allowed_origin(origin):
        await websocket.close(code=4403)
        return
    await download_ws_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        download_ws_manager.disconnect(websocket)


@app.post("/caption/unload")
async def unload_caption_model():
    """Release all cached VLMs from memory/GPU."""
    await unload_caption_provider()
    return {"status": "unloaded"}


@app.websocket("/ws/caption")
async def ws_caption(websocket: WebSocket):
    """WebSocket for streaming caption batch progress."""
    origin = websocket.headers.get("origin")
    if origin is not None and not _is_allowed_origin(origin):
        await websocket.close(code=4403)
        return
    await caption_ws_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        caption_ws_manager.disconnect(websocket)


# --- Entry point ---


def main():
    global _server

    parser = argparse.ArgumentParser(description="Training sidecar server")
    parser.add_argument(
        "--app-root",
        type=Path,
        default=None,
        help="Path to the img-tagger app root (parent of config.json)",
    )
    args = parser.parse_args()

    config = load_config(args.app_root)

    # The sidecar outlives the Node process that spawned it (detached spawn +
    # heartbeat), and on Windows a print() to the dead parent's pipe raises
    # OSError(EINVAL). Make the streams unbreakable before uvicorn's logging
    # config captures references to them.
    safe_stdio.install(config.training_dir / "sidecar-orphan.log")

    import uvicorn

    # Construct the Server explicitly (rather than uvicorn.run) so the idle
    # watchdog can request a graceful exit via `_server.should_exit`.
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host=config.host,
            port=config.port,
            log_level="info",
            # Disable WebSocket ping timeout on localhost. Long-running
            # inference (several minutes for VLM captioning on CPU) exceeds the
            # default 20s ping interval / 20s timeout, and uvicorn drops the
            # connection even though the server is still processing. Localhost
            # IPC doesn't need liveness checks.
            ws_ping_interval=None,
            ws_ping_timeout=None,
        )
    )
    _server = server
    server.run()


if __name__ == "__main__":
    main()
