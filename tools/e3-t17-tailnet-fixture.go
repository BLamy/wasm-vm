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
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"tailscale.com/tsnet"
)

const (
	tcpPort  = 18000
	udpPort  = 19000
	bulkPort = 18001
	maxBulk  = 1 << 30
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

	bulkAddress := net.JoinHostPort(ip4.String(), fmt.Sprint(bulkPort))
	bulkListener, err := server.Listen("tcp", bulkAddress)
	if err != nil {
		log.Fatal(err)
	}
	defer bulkListener.Close()
	go serveBulk(bulkListener)

	udpAddress := net.JoinHostPort(ip4.String(), fmt.Sprint(udpPort))
	packetConn, err := server.ListenPacket("udp4", udpAddress)
	if err != nil {
		log.Fatal(err)
	}
	defer packetConn.Close()
	go echoDatagrams(packetConn)

	fmt.Printf("READY peer=%s tcp=%d udp=%d bulk=%d\n", ip4, tcpPort, udpPort, bulkPort)
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	_ = httpServer.Close()
}

func serveBulk(listener net.Listener) {
	for {
		connection, err := listener.Accept()
		if err != nil {
			return
		}
		go handleBulk(connection)
	}
}

func handleBulk(connection net.Conn) {
	defer connection.Close()
	reader := bufio.NewReader(connection)
	line, err := reader.ReadString('\n')
	if err != nil {
		return
	}
	fields := strings.Fields(line)
	if len(fields) == 1 && fields[0] == "HALFCLOSE" {
		hash := sha256.New()
		written, err := io.Copy(hash, reader)
		if err == nil {
			_, _ = fmt.Fprintf(connection, "HALFCLOSE %d %x\n", written, hash.Sum(nil))
		}
		return
	}
	if len(fields) != 2 || (fields[0] != "UPLOAD" && fields[0] != "DOWNLOAD") {
		_, _ = io.WriteString(connection, "ERROR invalid command\n")
		return
	}
	size, err := strconv.ParseInt(fields[1], 10, 64)
	if err != nil || size < 0 || size > maxBulk {
		_, _ = io.WriteString(connection, "ERROR invalid size\n")
		return
	}
	if fields[0] == "DOWNLOAD" {
		block := make([]byte, 64*1024)
		for index := range block {
			block[index] = byte(index)
		}
		remaining := size
		for remaining > 0 {
			chunk := int64(len(block))
			if remaining < chunk {
				chunk = remaining
			}
			if _, err := connection.Write(block[:chunk]); err != nil {
				return
			}
			remaining -= chunk
		}
		fmt.Printf("BULK download=%d from=%s\n", size, connection.RemoteAddr())
		return
	}
	hash := sha256.New()
	written, err := io.CopyN(hash, reader, size)
	if err != nil {
		return
	}
	fmt.Printf("BULK upload=%d sha256=%x from=%s\n", written, hash.Sum(nil), connection.RemoteAddr())
	_, _ = fmt.Fprintf(connection, "OK %d %x\n", written, hash.Sum(nil))
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
