# The relay is cross-built on the host as a static linux/amd64 binary (deploy.sh). busybox's httpd
# answers the Containers runtime's HTTP readiness check on 8081 (wvrelay speaks only WebSocket
# and drops a plain HTTP request); wvrelay serves the guests on 8080. Both run unprivileged.
FROM busybox:1.37-musl
COPY wvrelay /usr/local/bin/wvrelay
RUN mkdir -p /www && echo ok > /www/index.html && echo ok > /www/ping
USER 65534:65534
EXPOSE 8080 8081
ENTRYPOINT ["/bin/sh", "-c", "httpd -f -p 8081 -h /www & exec /usr/local/bin/wvrelay 0.0.0.0:8080"]
