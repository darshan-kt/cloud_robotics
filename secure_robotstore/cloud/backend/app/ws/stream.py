"""The two live feeds the frontend's Remote Data page renders.

    /ws/string_api  -> string readings
    /ws/int_api     -> integer readings

Both are genuinely event-driven: a client is handed a Hub queue and awaits
it, so a reading reaches the browser as soon as the device publishes it.
(The real system's /ws/status polls on a 2-second timer instead, which is
a deliberate choice for a fleet dashboard — documented in
cloud-container/backend/app/ws/status.py. Two data kinds and one device is
small enough to do the event-driven version properly.)

On connect, a client gets a `backfill` frame from the Redis ring buffer
before any live frames, so a browser opened mid-stream draws a populated
window immediately instead of an empty box that fills one row per second.

INTERN TASK (security): these sockets accept ANY connection. There is no
token check, no origin check, no per-connection rate limit. The real
system's WebSockets take `Depends(get_current_operator_ws)` and reject an
unauthenticated upgrade. That dependency is the exercise.
"""
import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.db import redis as redis_db
from app.mqtt.topics import INT_KIND, STRING_KIND

router = APIRouter()
logger = logging.getLogger("backend.ws")

# Sent when no reading has arrived within this window, so the browser can
# tell "the link is fine, the device is quiet" apart from "the socket died".
# The device publishes every 1s, so 10s of silence is genuinely wrong.
_IDLE_PING_SECONDS = 10.0


async def _stream(websocket: WebSocket, kind: str) -> None:
    app = websocket.app
    hub = app.state.hub
    redis_client = app.state.redis_client
    history_size = app.state.settings.history_size

    await websocket.accept()

    # Subscribe BEFORE reading the backfill. The other order has a race: a
    # reading that lands between the backfill read and the subscribe would
    # be in neither, and the window would silently skip a row.
    queue = hub.subscribe(kind)
    logger.info(f"client connected to {kind} stream")

    try:
        history = await redis_db.get_history(redis_client, kind, history_size)
        await websocket.send_json({"type": "backfill", "kind": kind, "readings": history})

        while True:
            try:
                reading = await asyncio.wait_for(queue.get(), timeout=_IDLE_PING_SECONDS)
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "idle", "kind": kind})
                continue
            await websocket.send_json({"type": "reading", "kind": kind, "reading": reading})
    except WebSocketDisconnect:
        logger.info(f"client disconnected from {kind} stream")
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"{kind} stream closed: {exc}")
    finally:
        # Without this the Hub keeps a queue per dead client forever, and the
        # producer keeps filling them. Always unsubscribe in `finally`.
        hub.unsubscribe(kind, queue)


@router.websocket("/ws/string_api")
async def string_stream(websocket: WebSocket) -> None:
    await _stream(websocket, STRING_KIND)


@router.websocket("/ws/int_api")
async def int_stream(websocket: WebSocket) -> None:
    await _stream(websocket, INT_KIND)
