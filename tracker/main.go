// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1619@gmail.com

package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "4001"
	}

	swarm := NewSwarmTree()

	// Peer health checker.
	//
	// staleTimeout must be a multiple of the client heartbeat interval.
	// The SDK (sdk/src/tracker-client.ts, startHeartbeat) pings every 15s, so the
	// previous 6s timeout evicted every peer at ~9s — before its first ping could
	// ever arrive — while leaving the WebSocket open, so the peer never re-joined.
	// 45s tolerates two missed heartbeats.
	const staleTimeout = 45 * time.Second
	go func() {
		for {
			time.Sleep(2 * time.Second)
			swarm.CleanupStalePeers(staleTimeout)
		}
	}()

	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		handleWebSocket(swarm, w, r)
	})

	http.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		v, d, p := swarm.GetStats()
		json.NewEncoder(w).Encode(OutgoingMessage{
			Type:      "stats",
			Viewers:   v,
			Depth:     d,
			Publisher: p,
		})
	})

	log.Printf("Tracker server starting on :%s", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatal(err)
	}
}
