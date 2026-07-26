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

	// Peer health checker
	go func() {
		for {
			time.Sleep(2 * time.Second)
			swarm.CleanupStalePeers(6 * time.Second)
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
