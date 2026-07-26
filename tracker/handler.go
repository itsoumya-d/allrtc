// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com | +91 7031648617

package main

import (
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

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
			_ = conn.WriteJSON(OutgoingMessage{Type: "pong"})

		case "signal":
			targetPeer := swarm.GetPeer(msg.To)
			if targetPeer != nil && targetPeer.Conn != nil {
				if wsConn, ok := targetPeer.Conn.(*websocket.Conn); ok {
					_ = wsConn.WriteJSON(OutgoingMessage{
						Type:    "signal",
						From:    msg.From,
						Payload: msg.Payload,
					})
				}
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
