package main

import "encoding/hex"

// BroadcastChunkManifest relays at most 256 consecutive SHA-256 hashes. The
// sequence is the first chunk in the batch. This is not a cryptographic signature.
func (s *SwarmTree) BroadcastChunkManifest(senderID string, msg IncomingMessage) {
	if msg.Seq == nil || len(msg.Hashes) == 0 || len(msg.Hashes) > 256 || uint64(*msg.Seq)+uint64(len(msg.Hashes))-1 > 0xffffffff {
		return
	}
	for _, hash := range msg.Hashes {
		decoded, err := hex.DecodeString(hash)
		if err != nil || len(decoded) != 32 || hex.EncodeToString(decoded) != hash {
			return
		}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	sender := s.peers[senderID]
	if sender == nil || sender.Role != RolePublisher || senderID != s.publisherID {
		return
	}
	out := OutgoingMessage{Type: "chunk_manifest", Seq: msg.Seq, Hashes: msg.Hashes}
	for _, peer := range s.peers {
		if peer.ID != senderID && peer.Conn != nil {
			s.sendJSON(peer, out)
		}
	}
}
