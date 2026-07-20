// Command e3-t17-tailnet-fixture registers an ephemeral tsnet peer and exposes deterministic
// TCP and UDP services used by E3-T17's browser Worker proof. Run it from a pinned Tailscale source
// module so the fixture and the browser artifact use the same protocol implementation:
//
//	go -C /path/to/tailscale run /path/to/wasm-vm/tools/e3-t17-tailnet-fixture.go
//
// E3_T17_CONTROL_URL and E3_T17_AUTH_KEY are required. The key is consumed by tsnet and is never
// printed. The single READY line contains only the peer address and service ports.
package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"tailscale.com/tsnet"
)

const (
	tcpPort = 18000
	udpPort = 19000
)

func main() {
	controlURL := os.Getenv("E3_T17_CONTROL_URL")
	authKey := os.Getenv("E3_T17_AUTH_KEY")
	if controlURL == "" || authKey == "" {
		log.Fatal("E3_T17_CONTROL_URL and E3_T17_AUTH_KEY are required")
	}
	dir, err := os.MkdirTemp("", "wasm-vm-e3-t17-tailnet-peer-")
	if err != nil {
		log.Fatal(err)
	}
	defer os.RemoveAll(dir)

	server := &tsnet.Server{
		Hostname:   "wasm-vm-tailnet-fixture",
		Dir:        filepath.Join(dir, "state"),
		AuthKey:    authKey,
		ControlURL: controlURL,
		Ephemeral:  true,
		UserLogf:   func(string, ...any) {},
	}
	authKey = ""
	upContext, cancelUp := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancelUp()
	if _, err := server.Up(upContext); err != nil {
		log.Fatal(err)
	}
	defer server.Close()
	ip4, _ := server.TailscaleIPs()
	if !ip4.IsValid() {
		log.Fatal("tsnet peer did not receive an IPv4 address")
	}

	tcpAddress := net.JoinHostPort(ip4.String(), fmt.Sprint(tcpPort))
	tcpListener, err := server.Listen("tcp", tcpAddress)
	if err != nil {
		log.Fatal(err)
	}
	defer tcpListener.Close()
	httpServer := &http.Server{Handler: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		fmt.Printf("TCP path=%s from=%s\n", request.URL.Path, request.RemoteAddr)
		writer.Header().Set("content-type", "application/octet-stream")
		_, _ = io.WriteString(writer, "wasm-vm-tailnet-fixture\n")
	})}
	go func() { _ = httpServer.Serve(tcpListener) }()

	udpAddress := net.JoinHostPort(ip4.String(), fmt.Sprint(udpPort))
	packetConn, err := server.ListenPacket("udp4", udpAddress)
	if err != nil {
		log.Fatal(err)
	}
	defer packetConn.Close()
	go echoDatagrams(packetConn)

	fmt.Printf("READY peer=%s tcp=%d udp=%d\n", ip4, tcpPort, udpPort)
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	_ = httpServer.Close()
}

func echoDatagrams(connection net.PacketConn) {
	buffer := make([]byte, 65_535)
	for {
		size, remote, err := connection.ReadFrom(buffer)
		if err != nil {
			return
		}
		fmt.Printf("UDP size=%d from=%s\n", size, remote)
		payload := bytes.Clone(buffer[:size])
		if written, err := connection.WriteTo(payload, remote); err != nil || written != len(payload) {
			return
		}
	}
}
