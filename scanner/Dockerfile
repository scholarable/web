FROM clamav/clamav:1.4.6_base-debian13-slim
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pikepdf && rm -rf /var/lib/apt/lists/*
WORKDIR /scanner
COPY server.py test_scanner.py clamd.conf ./
COPY signatures/ /var/lib/clamav/
RUN chmod -R a+rX /var/lib/clamav
# Startup mounts tmpfs if the runtime omits it, then drops to nobody before serving.
EXPOSE 8080
ENTRYPOINT []
CMD ["python3", "server.py"]
# Vendor image health probe targets its original entrypoint/socket, not ours.
HEALTHCHECK NONE
