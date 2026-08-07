package main

import (
	"testing"
)

func BenchmarkIPPrefix(b *testing.B) {
	ip := "192.168.100.200"
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		ipPrefix(ip)
	}
}

func TestIPPrefix(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"192.168.100.200", "192.168"},
		{"10.0.0.1", "10.0"},
		{"127.0.0.1", "127.0"},
		{"192.168", "192.168"},
		{"192", ""},
		{"", ""},
		{"2001:db8::1", ""},
		{"1.2", "1.2"},
		{"1.2.", "1.2"},
		{"1.2.3", "1.2"},
	}

	for _, tt := range tests {
		got := ipPrefix(tt.in)
		if got != tt.want {
			t.Errorf("ipPrefix(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}
