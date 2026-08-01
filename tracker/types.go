// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1619@gmail.com

package main

import "sync"

type Role string

const (
	RolePublisher Role = "publisher"
	RoleSeed      Role = "seed"
	RoleRelay     Role = "relay"
	RoleLeaf      Role = "leaf"
)

type Peer struct {
	ID       string   `json:"id"`
	Role     Role     `json:"role"`
	ParentID string   `json:"parentId"`
	BackupID string   `json:"backupId"`
	ChildIDs []string `json:"childIds"`
	Depth    int      `json:"depth"`
	CanRelay bool     `json:"canRelay"`
	IPAddr   string   `json:"ipAddr"` // Client IP for geographic proximity routing
	LastPing int64    `json:"lastPing"`
	Conn     any      `json:"-"`

	// writeMu serialises writes to Conn. gorilla/websocket allows at most one
	// concurrent writer per connection; the swarm writes to a peer from several
	// goroutines (its own read loop, other peers' read loops, the cleanup timer).
	writeMu sync.Mutex
}

type IncomingMessage struct {
	Type       string   `json:"type"`
	PeerID     string   `json:"peerId"`
	Role       Role     `json:"role,omitempty"`
	CanRelay   bool     `json:"canRelay"`
	To         string   `json:"to,omitempty"`
	From       string   `json:"from,omitempty"`
	Payload    any      `json:"payload,omitempty"`
	Hashes     []string `json:"hashes,omitempty"`
	SessionKey string   `json:"sessionKey,omitempty"`
	Seq        uint32   `json:"seq,omitempty"`
	ChunkData  string   `json:"chunkData,omitempty"`
}

type OutgoingMessage struct {
	Type            string   `json:"type"`
	To              string   `json:"to,omitempty"`
	ParentPeerID    string   `json:"parentPeerId,omitempty"`
	BackupPeerID    string   `json:"backupPeerId,omitempty"`
	ChildPeerID     string   `json:"childPeerId,omitempty"`
	NewParentPeerID string   `json:"newParentPeerId,omitempty"`
	Role            Role     `json:"role,omitempty"`
	From            string   `json:"from,omitempty"`
	Payload         any      `json:"payload,omitempty"`
	Hashes          []string `json:"hashes,omitempty"`
	SessionKey      string   `json:"sessionKey,omitempty"`
	Viewers         int      `json:"viewers,omitempty"`
	Depth           int      `json:"depth,omitempty"`
	Publisher       bool     `json:"publisher,omitempty"`
	Seq             uint32   `json:"seq,omitempty"`
	ChunkData       string   `json:"chunkData,omitempty"`
}
