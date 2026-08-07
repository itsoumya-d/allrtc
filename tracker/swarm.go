// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1619@gmail.com

package main

import (
	"fmt"
	"log"
	"math"
	"strings"
	"sync"
	"time"
)

// MaxChildrenPerPeer = 8: Higher fan-out means fewer relay layers.
// Branching 8 × 5 layers = 32,768 viewers at only 300ms latency.
const MaxChildrenPerPeer = 8

type SwarmTree struct {
	mu          sync.RWMutex
	peers       map[string]*Peer
	publisherID string
}

func NewSwarmTree() *SwarmTree {
	return &SwarmTree{
		peers: make(map[string]*Peer),
	}
}

func (s *SwarmTree) AddPeer(p *Peer) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.peers[p.ID] = p
	if p.Role == RolePublisher {
		s.publisherID = p.ID
		p.Depth = 0
		return nil
	}

	// Primary parent assignment.
	// The new peer is already present in s.peers here and its Depth is still 0,
	// so it ties with the publisher at the root of the search. It must be
	// excluded explicitly, otherwise it wins the "fewest children" tie-break
	// and is handed back as its own parent.
	parent := s.findBestParentFor(p)
	if parent == nil {
		return fmt.Errorf("no available parent found")
	}

	p.ParentID = parent.ID
	p.Depth = parent.Depth + 1
	if p.Depth == 1 {
		p.Role = RoleSeed
	} else {
		p.Role = RoleLeaf
	}

	parent.ChildIDs = append(parent.ChildIDs, p.ID)
	if parent.Role == RoleLeaf && len(parent.ChildIDs) > 0 {
		parent.Role = RoleRelay
	}

	// Secondary Backup parent assignment for Dual-Parent Redundancy (Zero-Freeze).
	// Must avoid both the primary parent and the new peer itself.
	backupParent := s.findBestParentFor(p, parent.ID)
	if backupParent != nil {
		p.BackupID = backupParent.ID
	}

	s.notifyPeerAssigned(p, parent, backupParent)
	s.notifyNewChild(parent, p)
	if backupParent != nil {
		s.notifyNewChild(backupParent, p)
	}

	return nil
}

func (s *SwarmTree) RemovePeer(peerID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	p, exists := s.peers[peerID]
	if !exists {
		return
	}

	// Remove from primary parent's children
	if p.ParentID != "" {
		if parent, ok := s.peers[p.ParentID]; ok {
			s.removeChild(parent, peerID)
		}
	}

	// Remove from backup parent's children
	if p.BackupID != "" {
		if backup, ok := s.peers[p.BackupID]; ok {
			s.removeChild(backup, peerID)
		}
	}

	childrenToReparent := p.ChildIDs
	delete(s.peers, peerID)

	if p.ID == s.publisherID {
		s.publisherID = ""
	}

	s.mu.Unlock()
	// Re-parent children without stopping playback (backup parent carries stream in parallel)
	for _, childID := range childrenToReparent {
		s.reparent(childID)
	}
	s.mu.Lock()
}

func (s *SwarmTree) removeChild(parent *Peer, childID string) {
	for i, id := range parent.ChildIDs {
		if id == childID {
			parent.ChildIDs = append(parent.ChildIDs[:i], parent.ChildIDs[i+1:]...)
			break
		}
	}
	if len(parent.ChildIDs) == 0 && parent.Role == RoleRelay {
		parent.Role = RoleLeaf
	}
}

func (s *SwarmTree) reparent(childID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	child, exists := s.peers[childID]
	if !exists {
		return
	}

	child.ParentID = ""

	parent := s.findBestParentFor(child)
	if parent == nil {
		log.Printf("[Swarm] Could not reparent %s", childID)
		return
	}

	child.ParentID = parent.ID
	child.Depth = parent.Depth + 1
	if child.Depth == 1 {
		child.Role = RoleSeed
	} else if len(child.ChildIDs) > 0 {
		child.Role = RoleRelay
	} else {
		child.Role = RoleLeaf
	}

	parent.ChildIDs = append(parent.ChildIDs, child.ID)
	if parent.Role == RoleLeaf {
		parent.Role = RoleRelay
	}

	backupParent := s.findBestParentFor(child, parent.ID)
	if backupParent != nil {
		child.BackupID = backupParent.ID
	}

	s.notifyParentChanged(child, parent, backupParent)
	s.notifyNewChild(parent, child)
}

// findBestParentFor selects the optimal parent for forPeer using:
//  1. Geographic Proximity — peers in the same IP /16 subnet get priority
//     (same ISP / same city = ~5-20ms RTT instead of 50-100ms)
//  2. Shallowest depth — fewer hops = less cumulative latency
//  3. Fewest children — load balancing
//
// forPeer is always excluded from the candidate set: a peer can never be its
// own parent. Any additional ids in alsoAvoid are excluded too (used to keep
// the backup parent distinct from the primary).
func (s *SwarmTree) findBestParentFor(forPeer *Peer, alsoAvoid ...string) *Peer {
	var best *Peer
	var bestNearby *Peer
	minChildren := MaxChildrenPerPeer
	minDepth := math.MaxInt32
	nearbyMinChildren := MaxChildrenPerPeer
	nearbyMinDepth := math.MaxInt32

	skip := make(map[string]bool, len(alsoAvoid)+1)
	for _, id := range alsoAvoid {
		if id != "" {
			skip[id] = true
		}
	}

	// Use the joining peer's own IP prefix for geographic matching. The previous
	// implementation looked this up from the avoid-id, which is a different peer
	// (or absent), so proximity routing never actually matched.
	newPrefix := ""
	if forPeer != nil {
		newPrefix = ipPrefix(forPeer.IPAddr)
		skip[forPeer.ID] = true
	}

	for _, p := range s.peers {
		if skip[p.ID] {
			continue
		}
		// Mobile / Metered connections CANNOT be relay parents
		if !p.CanRelay && p.Role != RolePublisher {
			continue
		}
		if len(p.ChildIDs) >= MaxChildrenPerPeer {
			continue
		}

		// Check if same geographic region (IP /16 prefix match)
		if newPrefix != "" && ipPrefix(p.IPAddr) == newPrefix {
			if p.Depth < nearbyMinDepth || (p.Depth == nearbyMinDepth && len(p.ChildIDs) < nearbyMinChildren) {
				bestNearby = p
				nearbyMinDepth = p.Depth
				nearbyMinChildren = len(p.ChildIDs)
			}
		}

		// Global fallback
		if p.Depth < minDepth || (p.Depth == minDepth && len(p.ChildIDs) < minChildren) {
			best = p
			minDepth = p.Depth
			minChildren = len(p.ChildIDs)
		}
	}

	// Prefer nearby peer (same city/ISP) for lower RTT
	if bestNearby != nil {
		return bestNearby
	}
	return best
}

// ipPrefix extracts /16 subnet prefix from an IP address.
// Peers in the same /16 are usually in the same city or ISP,
// giving ~5-20ms RTT instead of 50-100ms cross-region.
// Optimization: uses IndexByte to avoid strings.Split allocations (0 vs 2 allocs)
// which significantly reduces GC pressure since this runs inside a O(N) loop.
func ipPrefix(ip string) string {
	idx1 := strings.IndexByte(ip, '.')
	if idx1 < 0 {
		return ""
	}
	idx2 := strings.IndexByte(ip[idx1+1:], '.')
	if idx2 < 0 {
		return ip
	}
	return ip[:idx1+1+idx2]
}

func (s *SwarmTree) UpdatePing(peerID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if p, ok := s.peers[peerID]; ok {
		p.LastPing = time.Now().Unix()
	}
}

func (s *SwarmTree) GetPeer(peerID string) *Peer {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.peers[peerID]
}

func (s *SwarmTree) GetStats() (viewers int, depth int, publisher bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	viewers = 0
	depth = 0
	publisher = s.publisherID != ""

	for _, p := range s.peers {
		if p.Role != RolePublisher {
			viewers++
		}
		if p.Depth > depth {
			depth = p.Depth
		}
	}
	return
}

func (s *SwarmTree) CleanupStalePeers(timeout time.Duration) {
	s.mu.Lock()
	var toRemove []string
	now := time.Now().Unix()
	timeoutSec := int64(timeout.Seconds())
	for id, p := range s.peers {
		if now-p.LastPing > timeoutSec {
			toRemove = append(toRemove, id)
		}
	}
	s.mu.Unlock()

	for _, id := range toRemove {
		log.Printf("[Swarm] Peer %s timed out, removing", id)
		s.RemovePeer(id)
	}
}

func (s *SwarmTree) notifyPeerAssigned(child, parent, backup *Peer) {
	if child.Conn != nil {
		backupID := ""
		if backup != nil {
			backupID = backup.ID
		}
		msg := OutgoingMessage{
			Type:         "assigned",
			ParentPeerID: parent.ID,
			BackupPeerID: backupID,
			Role:         child.Role,
		}
		s.sendJSON(child, msg)
	}
}

func (s *SwarmTree) notifyNewChild(parent, child *Peer) {
	if parent.Conn != nil {
		msg := OutgoingMessage{
			Type:        "new_child",
			ChildPeerID: child.ID,
		}
		s.sendJSON(parent, msg)
	}
}

func (s *SwarmTree) notifyParentChanged(child, parent, backup *Peer) {
	if child.Conn != nil {
		backupID := ""
		if backup != nil {
			backupID = backup.ID
		}
		msg := OutgoingMessage{
			Type:            "parent_changed",
			NewParentPeerID: parent.ID,
			BackupPeerID:    backupID,
		}
		s.sendJSON(child, msg)
	}
}

// writeTimeout bounds how long a single WebSocket write may block.
//
// sendJSON is reached from paths that hold s.mu (AddPeer, BroadcastChunkManifest,
// RelayChunkViaWs). Without a deadline, one client that completes the handshake
// and then stops reading fills its kernel send buffer, the write blocks forever,
// and every other peer is stalled behind the mutex — a single connection wedges
// the whole tracker. A deadline turns that into a bounded stall plus an error on
// the offending connection, which its read loop then cleans up.
const writeTimeout = 5 * time.Second

// SendTo writes a single message to one peer using the same serialised,
// deadline-bounded path as every other tracker write.
func (s *SwarmTree) SendTo(p *Peer, msg OutgoingMessage) {
	s.sendJSON(p, msg)
}

func (s *SwarmTree) sendJSON(p *Peer, msg OutgoingMessage) {
	if p == nil || p.Conn == nil {
		return
	}
	// gorilla/websocket permits only one concurrent writer per connection.
	p.writeMu.Lock()
	defer p.writeMu.Unlock()

	if dl, ok := p.Conn.(interface{ SetWriteDeadline(t time.Time) error }); ok {
		_ = dl.SetWriteDeadline(time.Now().Add(writeTimeout))
	}
	if conn, ok := p.Conn.(interface{ WriteJSON(v interface{}) error }); ok {
		_ = conn.WriteJSON(msg)
	}
}

func (s *SwarmTree) BroadcastChunkManifest(msg IncomingMessage) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	outMsg := OutgoingMessage{
		Type:       "chunk_manifest",
		Hashes:     msg.Hashes,
		SessionKey: msg.SessionKey,
	}
	for _, p := range s.peers {
		if p.ID != msg.PeerID && p.Conn != nil {
			s.sendJSON(p, outMsg)
		}
	}
}

// RelayChunkViaWs relays video chunks through WebSocket when WebRTC DataChannel
// is blocked by a firewall. The chunk travels:
//
//	Publisher -> Tracker (WebSocket) -> Viewer Children (WebSocket)
//
// To any ISP or DPI system, this traffic is indistinguishable from
// regular HTTPS WebSocket traffic on port 443.
func (s *SwarmTree) RelayChunkViaWs(senderID string, msg IncomingMessage) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	sender, exists := s.peers[senderID]
	if !exists {
		return
	}

	outMsg := OutgoingMessage{
		Type:      "ws_chunk_relay",
		Seq:       msg.Seq,
		ChunkData: msg.ChunkData,
	}

	// Relay to sender's children
	for _, childID := range sender.ChildIDs {
		if child, ok := s.peers[childID]; ok && child.Conn != nil {
			s.sendJSON(child, outMsg)
		}
	}
}
