// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1619@gmail.com

package main

import (
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// maxMessageBytes caps a single inbound WebSocket message. Without it,
// conn.ReadJSON will buffer an arbitrarily large frame into memory — a 32 MB
// frame from one unauthenticated client is accepted today. 1 MiB is well above
// a base64-encoded video micro-chunk.
const maxMessageBytes = 1 << 20

// NOTE: CheckOrigin always returns true, so any website can open a WebSocket to
// this tracker on a visitor's behalf, and the protocol has no authentication at
// all. Restrict this to your own origins (and add a join token) before exposing
// the tracker publicly.
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
	// Increase buffer sizes for chunk relay
	ReadBufferSize:  1024 * 256,
	WriteBufferSize: 1024 * 256,
}

func handleWebSocket(swarm *SwarmTree, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}

	conn.SetReadLimit(maxMessageBytes)

	// Extract client IP for geographic proximity routing
	clientIP := r.Header.Get("X-Forwarded-For")
	if clientIP == "" {
		clientIP = r.Header.Get("X-Real-IP")
	}
	if clientIP == "" {
		clientIP = r.RemoteAddr
	}
	// Strip port from IP:port
	if idx := strings.LastIndex(clientIP, ":"); idx > 0 {
		clientIP = clientIP[:idx]
	}

	var peerID string

	defer func() {
		if peerID != "" {
			swarm.RemovePeer(peerID)
			log.Printf("[Tracker] Peer %s disconnected", peerID)
		}
		conn.Close()
	}()

	for {
		var msg IncomingMessage
		err := conn.ReadJSON(&msg)
		if err != nil {
			break
		}

		switch msg.Type {
		case "join":
			// An empty peer id can never be removed on disconnect (the deferred
			// cleanup below is guarded by peerID != ""), so it leaks a swarm slot
			// permanently. Reject it instead of registering it.
			if msg.PeerID == "" {
				log.Println("[Tracker] Rejecting join with empty peerId")
				continue
			}
			peerID = msg.PeerID
			peer := &Peer{
				ID:       peerID,
				Role:     msg.Role,
				CanRelay: msg.CanRelay,
				IPAddr:   clientIP,
				LastPing: time.Now().Unix(),
				Conn:     conn,
			}
			err := swarm.AddPeer(peer)
			if err != nil {
				log.Println("[Tracker] Join error:", err)
			} else {
				log.Printf("[Tracker] Peer %s joined (role=%s, canRelay=%v)", peerID, peer.Role, peer.CanRelay)
			}

		case "leave":
			if msg.PeerID == peerID {
				return
			}

		case "ping":
			swarm.UpdatePing(peerID)
			// Route the pong through the peer's serialised writer when the peer
			// is registered; a bare conn.WriteJSON here races with swarm writes
			// to the same connection from other goroutines.
			if p := swarm.GetPeer(peerID); p != nil {
				swarm.SendTo(p, OutgoingMessage{Type: "pong"})
			} else {
				_ = conn.WriteJSON(OutgoingMessage{Type: "pong"})
			}

		case "signal":
			targetPeer := swarm.GetPeer(msg.To)
			if targetPeer != nil && targetPeer.Conn != nil {
				// `to` must be echoed back. The SDK's PeerManager only accepts a
				// signal when msg.to equals its own peer id, so a relayed signal
				// without it is silently dropped and no offer/answer/ICE exchange
				// can ever complete.
				swarm.SendTo(targetPeer, OutgoingMessage{
					Type:    "signal",
					To:      msg.To,
					From:    msg.From,
					Payload: msg.Payload,
				})
			}

		case "chunk_manifest":
			swarm.BroadcastChunkManifest(msg)

		// WebSocket Chunk Relay: When WebRTC DataChannel is blocked by firewall,
		// the publisher sends video chunks through the tracker's WebSocket.
		// The tracker relays them to the target peer's WebSocket.
		// To any ISP/DPI, this is JUST regular HTTPS WebSocket traffic on port 443.
		case "ws_chunk_relay":
			swarm.RelayChunkViaWs(peerID, msg)
		}
	}
}
