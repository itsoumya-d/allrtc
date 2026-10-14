package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func sequence(value uint32) *uint32 { return &value }

type manifestRecorder struct{ messages []OutgoingMessage }

func (r *manifestRecorder) WriteJSON(value interface{}) error {
	r.messages = append(r.messages, value.(OutgoingMessage))
	return nil
}

func manifestSwarm() (*SwarmTree, *manifestRecorder) {
	s := NewSwarmTree()
	r := &manifestRecorder{}
	s.peers["pub"] = &Peer{ID: "pub", Role: RolePublisher}
	s.peers["viewer"] = &Peer{ID: "viewer", Role: RoleLeaf, Conn: r}
	s.publisherID = "pub"
	return s, r
}

func TestManifestPreservesSequenceZeroAndBatch(t *testing.T) {
	s, r := manifestSwarm()
	hashes := []string{strings.Repeat("a", 64), strings.Repeat("b", 64)}
	s.BroadcastChunkManifest("pub", IncomingMessage{Seq: sequence(0), Hashes: hashes})
	if len(r.messages) != 1 { t.Fatal("expected one manifest") }
	encoded, err := json.Marshal(r.messages[0])
	if err != nil { t.Fatal(err) }
	var payload map[string]interface{}
	if err := json.Unmarshal(encoded, &payload); err != nil { t.Fatal(err) }
	if payload["seq"] != float64(0) || payload["type"] != "chunk_manifest" { t.Fatalf("bad wire message: %s", encoded) }
	if len(payload["hashes"].([]interface{})) != 2 { t.Fatalf("lost batch: %s", encoded) }
	if _, ok := payload["sessionKey"]; ok { t.Fatal("must not imply a signing key") }
}

func TestManifestRejectsInvalidBatches(t *testing.T) {
	valid := strings.Repeat("a", 64)
	cases := []IncomingMessage{
		{}, {Seq: sequence(0), Hashes: []string{"bad"}}, {Seq: sequence(0), Hashes: []string{strings.Repeat("A", 64)}},
		{Seq: sequence(0xffffffff), Hashes: []string{valid, valid}}, {Seq: sequence(0), Hashes: make([]string, 257)},
	}
	for i, input := range cases {
		s, r := manifestSwarm()
		s.BroadcastChunkManifest("pub", input)
		if len(r.messages) != 0 { t.Fatalf("invalid batch %d was relayed", i) }
	}
}

func TestManifestUsesConnectionSenderNotClaimedPeerID(t *testing.T) {
	for _, sender := range []string{"", "missing", "viewer"} {
		s, r := manifestSwarm()
		s.BroadcastChunkManifest(sender, IncomingMessage{PeerID: "pub", Seq: sequence(0), Hashes: []string{strings.Repeat("a", 64)}})
		if len(r.messages) != 0 { t.Fatalf("sender %q relayed a manifest", sender) }
	}
}

func TestManifestWebSocketContract(t *testing.T) {
	s := NewSwarmTree()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { handleWebSocket(s, w, r) }))
	defer server.Close()
	dial := func() *websocket.Conn {
		conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
		if err != nil { t.Fatal(err) }
		t.Cleanup(func() { conn.Close() })
		conn.SetReadDeadline(time.Now().Add(5*time.Second))
		return conn
	}
	pub := dial()
	if err := pub.WriteJSON(IncomingMessage{Type: "join", PeerID: "pub", Role: RolePublisher, CanRelay: true}); err != nil { t.Fatal(err) }
	// The ping/pong on the same connection acknowledges publisher registration.
	if err := pub.WriteJSON(IncomingMessage{Type: "ping"}); err != nil { t.Fatal(err) }
	var acknowledgement OutgoingMessage
	if err := pub.ReadJSON(&acknowledgement); err != nil { t.Fatal(err) }
	viewer := dial()
	if err := viewer.WriteJSON(IncomingMessage{Type: "join", PeerID: "viewer", Role: RoleLeaf}); err != nil { t.Fatal(err) }
	if err := viewer.ReadJSON(&acknowledgement); err != nil { t.Fatal(err) }
	hash := strings.Repeat("a", 64)
	if err := pub.WriteJSON(IncomingMessage{Type: "chunk_manifest", Seq: sequence(0), Hashes: []string{hash}}); err != nil { t.Fatal(err) }
	var received map[string]interface{}
	if err := viewer.ReadJSON(&received); err != nil { t.Fatal(err) }
	if received["type"] != "chunk_manifest" || received["seq"] != float64(0) { t.Fatalf("bad manifest: %#v", received) }
	if received["hashes"].([]interface{})[0] != hash { t.Fatal("hash changed in transit") }
}

func TestManifestRequiresExplicitSequence(t *testing.T) {
 for _, raw := range []string{
  `{"type":"chunk_manifest","hashes":["` + strings.Repeat("a", 64) + `"]}`,
  `{"type":"chunk_manifest","seq":null,"hashes":["` + strings.Repeat("a", 64) + `"]}`,
 } {
  var input IncomingMessage
  if err := json.Unmarshal([]byte(raw), &input); err != nil { t.Fatal(err) }
  s, r := manifestSwarm()
  s.BroadcastChunkManifest("pub", input)
  if len(r.messages) != 0 { t.Fatalf("missing sequence relayed: %s", raw) }
 }
}

func TestSequenceSerializationDoesNotChangeOtherMessages(t *testing.T) {
 for _, kind := range []string{"pong", "signal", "assigned", "new_child", "stats"} {
  data, err := json.Marshal(OutgoingMessage{Type: kind})
  if err != nil { t.Fatal(err) }
  var fields map[string]interface{}
  if err := json.Unmarshal(data, &fields); err != nil { t.Fatal(err) }
  if _, present := fields["seq"]; present { t.Fatalf("unexpected sequence: %s", data) }
 }
 for _, kind := range []string{"chunk_manifest", "ws_chunk_relay"} {
  data, err := json.Marshal(OutgoingMessage{Type: kind, Seq: sequence(0)})
  if err != nil { t.Fatal(err) }
  var fields map[string]interface{}
  if err := json.Unmarshal(data, &fields); err != nil { t.Fatal(err) }
  if fields["seq"] != float64(0) { t.Fatalf("lost sequence zero: %s", data) }
 }
}
