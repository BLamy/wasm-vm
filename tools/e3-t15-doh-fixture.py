#!/usr/bin/env python3
import http.server
import ipaddress
import json
import struct
import sys
import threading
import time


mode = "fail"
counts = {}
lock = threading.Lock()


def parse_question(message):
    if len(message) < 12:
        raise ValueError("short DNS header")
    offset = 12
    labels = []
    while True:
        if offset >= len(message):
            raise ValueError("short DNS name")
        size = message[offset]
        offset += 1
        if size == 0:
            break
        if size & 0xC0 or offset + size > len(message):
            raise ValueError("invalid DNS name")
        labels.append(message[offset:offset + size].decode("ascii").lower())
        offset += size
    if offset + 4 > len(message):
        raise ValueError("short DNS question")
    qtype, qclass = struct.unpack("!HH", message[offset:offset + 4])
    return ".".join(labels), qtype, qclass, message[12:offset + 4]


def dns_response(query):
    name, qtype, qclass, question = parse_question(query)
    txid = query[:2]
    if name.endswith(".invalid") or name == "nxdomain.test":
        return name, txid + struct.pack("!HHHHH", 0x8183, 1, 0, 0, 0) + question

    addresses = []
    ttl = 60
    if qtype == 1 and qclass == 1:
        if name == "large.test":
            addresses = [f"192.0.2.{index}" for index in range(1, 41)]
        elif name in {
            "dl-cdn.alpinelinux.org",
            "cache.test",
            "recovery.test",
            "fail.test",
        }:
            addresses = ["192.0.2.42"]

    header = txid + struct.pack("!HHHHH", 0x8180, 1, len(addresses), 0, 0)
    answers = bytearray()
    for address in addresses:
        answers += b"\xc0\x0c"
        answers += struct.pack("!HHIH", 1, 1, ttl, 4)
        answers += ipaddress.IPv4Address(address).packed
    return name, header + question + answers


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def common_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")

    def send_bytes(self, status, content_type, body):
        self.send_response(status)
        self.common_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_bytes(204, "text/plain", b"")

    def do_GET(self):
        global mode
        if self.path == "/mode/fail":
            mode = "fail"
            self.send_bytes(200, "text/plain", b"fail\n")
        elif self.path == "/mode/success":
            mode = "success"
            self.send_bytes(200, "text/plain", b"success\n")
        elif self.path == "/mode/hang":
            mode = "hang"
            self.send_bytes(200, "text/plain", b"hang\n")
        elif self.path == "/counts":
            with lock:
                body = json.dumps({"mode": mode, "counts": counts}, sort_keys=True).encode()
            self.send_bytes(200, "application/json", body)
        elif self.path == "/reset":
            with lock:
                counts.clear()
            self.send_bytes(200, "text/plain", b"reset\n")
        else:
            self.send_bytes(404, "text/plain", b"not found\n")

    def do_POST(self):
        if self.path != "/dns-query":
            self.send_bytes(404, "text/plain", b"not found\n")
            return
        length = int(self.headers.get("Content-Length", "0"))
        query = self.rfile.read(length)
        try:
            name, response = dns_response(query)
        except Exception as error:
            self.send_bytes(400, "text/plain", f"{error}\n".encode())
            return
        with lock:
            counts[name] = counts.get(name, 0) + 1
        if mode == "hang":
            time.sleep(10)
            try:
                self.send_bytes(200, "application/dns-message", b"late\n")
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        if mode != "success":
            # A syntactically successful HTTP exchange with an invalid DNS body exercises the same
            # resolver failure/SERVFAIL path without polluting the demo's zero-console-error gate.
            self.send_bytes(200, "application/dns-message", b"unavailable\n")
            return
        self.send_bytes(200, "application/dns-message", response)

    def log_message(self, fmt, *args):
        sys.stdout.write("%s - %s\n" % (self.log_date_time_string(), fmt % args))
        sys.stdout.flush()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8053
server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
print(f"DoH fixture listening on http://127.0.0.1:{port}/dns-query (mode={mode})", flush=True)
server.serve_forever()
