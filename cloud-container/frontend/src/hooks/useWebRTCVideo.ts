/** Drives the exact offer/answer flow docs/08-webrtc-signalling.md's own
 * verification exercised by hand with curl + a Playwright page: create a
 * recvonly RTCPeerConnection, wait for ICE gathering to finish (this
 * project's signalling is one-shot request/response over MQTT, not
 * trickle ICE - see relay.py - so late candidates have nowhere to go),
 * POST the offer to /robots/{id}/webrtc/offer, and apply the returned
 * answer. `ontrack` attaches the robot's live feed to the caller's
 * <video> element via videoRef.
 *
 * iceServers (STUN + TURN, from runtime config) are load-bearing here, not
 * optional polish - see docs/09-frontend.md: without a TURN relay
 * candidate, Chrome's own local ICE candidates are mDNS-obfuscated
 * ".local" hostnames the robot's GStreamer/libnice stack can't resolve,
 * and the connection never progresses past "negotiating" even though
 * signalling itself succeeded.
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { relayWebRTCOffer } from '../api/client'
import { getRuntimeConfig } from '../config'

export type WebRTCVideoState = 'idle' | 'negotiating' | 'connected' | 'failed'

interface UseWebRTCVideoResult {
  videoRef: RefObject<HTMLVideoElement>
  state: WebRTCVideoState
  error: string | null
}

export function useWebRTCVideo(token: string | null, robotId: string | null, enabled: boolean): UseWebRTCVideoResult {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<WebRTCVideoState>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token || !robotId || !enabled) {
      setState('idle')
      return
    }

    let cancelled = false
    let pc: RTCPeerConnection | null = null
    setState('negotiating')
    setError(null)

    async function negotiate() {
      const { turnUrl, turnUsername, turnCredential } = await getRuntimeConfig()
      if (cancelled) return

      pc = new RTCPeerConnection({
        iceServers: [
          { urls: turnUrl, username: turnUsername, credential: turnCredential },
          { urls: 'stun:stun.l.google.com:19302' },
        ],
      })

      // Receive-only: the browser watches the robot's camera, it never
      // sends media of its own - see docs/00-overview.md's "Video path".
      pc.addTransceiver('video', { direction: 'recvonly' })

      pc.ontrack = (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0]
        }
      }

      pc.onconnectionstatechange = () => {
        if (!pc || cancelled) return
        if (pc.connectionState === 'connected') setState('connected')
        else if (pc.connectionState === 'failed') setState('failed')
      }

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await waitForIceGatheringComplete(pc)
      if (cancelled || !pc.localDescription) return

      try {
        const { sdp } = await relayWebRTCOffer(token as string, robotId as string, pc.localDescription.sdp)
        if (cancelled || !pc) return
        await pc.setRemoteDescription({ type: 'answer', sdp })
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setState('failed')
        }
      }
    }

    negotiate().catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : String(err))
        setState('failed')
      }
    })

    return () => {
      cancelled = true
      pc?.close()
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [token, robotId, enabled])

  return { videoRef, state, error }
}

function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    function check() {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check)
        resolve()
      }
    }
    pc.addEventListener('icegatheringstatechange', check)
  })
}
