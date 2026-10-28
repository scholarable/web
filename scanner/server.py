"""Private, serialized PDF scanner. Deploy only behind the Worker service binding."""
import io
import ctypes
import json
import os
import resource
import subprocess
import sys
import socket
import struct
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import TCPServer

MAX_BYTES = 5 * 1024 * 1024
MAX_EXPANDED = 32 * 1024 * 1024
# Deliberately accept only static PDFs. Interactive forms/links and unsupported
# codecs must be flattened by the student before uploading.
FORBIDDEN = {'/A', '/AA', '/OpenAction', '/AcroForm', '/JS', '/JavaScript',
             '/EmbeddedFiles', '/EF', '/XFA', '/RichMediaContent', '/RichMediaSettings',
             '/URI', '/Launch', '/SubmitForm', '/ImportData', '/GoToR', '/GoToE'}
FORBIDDEN_TYPES = {'/Action', '/EmbeddedFile', '/Filespec', '/RichMedia',
                   '/Movie', '/Sound', '/Screen', '/3D', '/PS'}
FILTERS = {'/FlateDecode', '/ASCIIHexDecode', '/ASCII85Decode', '/LZWDecode', '/RunLengthDecode'}


def parse_pdf(raw):
    import pikepdf
    with pikepdf.Pdf.open(io.BytesIO(raw), attempt_recovery=False) as pdf:
        if pdf.is_encrypted or not 0 < len(pdf.pages) <= 200 or len(pdf.objects) > 10000:
            return False
        seen = set()
        expanded = 0
        nodes = 0

        def inspect(obj, depth=0):
            nonlocal expanded, nodes
            nodes += 1
            if nodes > 100000 or depth > 100:
                raise ValueError('PDF complexity limit')
            if not isinstance(obj, (pikepdf.Dictionary, pikepdf.Array, pikepdf.Stream)):
                return
            if obj.is_indirect:
                if obj.objgen in seen:
                    return
                seen.add(obj.objgen)
            if isinstance(obj, (pikepdf.Dictionary, pikepdf.Stream)):
                if FORBIDDEN.intersection(obj.keys()) or str(obj.get('/Type', '')) in FORBIDDEN_TYPES or str(obj.get('/Subtype', '')) in FORBIDDEN_TYPES:
                    raise ValueError('Active content')
                if isinstance(obj, pikepdf.Stream):
                    if '/F' in obj:
                        raise ValueError('External stream')
                    filters = obj.get('/Filter', pikepdf.Array())
                    if not isinstance(filters, pikepdf.Array):
                        filters = [filters]
                    codecs = {str(item) for item in filters}
                    if codecs - FILTERS:
                        if codecs - FILTERS != {'/DCTDecode'} or str(obj.get('/Subtype', '')) != '/Image':
                            raise ValueError('Unsupported stream codec')
                        width, height = int(obj.get('/Width', 0)), int(obj.get('/Height', 0))
                        if width <= 0 or height <= 0 or width * height * 4 > MAX_EXPANDED - expanded:
                            raise ValueError('Image expansion limit')
                        with pikepdf.PdfImage(obj).as_pil_image() as image:
                            image.load()
                            expanded += len(image.tobytes())
                    else:
                        expanded += len(obj.read_bytes())
                    if expanded > MAX_EXPANDED:
                        raise ValueError('PDF expansion limit')
                    if str(obj.get('/Subtype', '')) == '/Form':
                        check_content(obj)
                for _, value in obj.items():
                    inspect(value, depth + 1)
            else:
                for value in obj:
                    inspect(value, depth + 1)

        def check_content(obj):
            for instruction in pikepdf.parse_content_stream(obj):
                if isinstance(instruction, pikepdf.ContentStreamInlineImage):
                    raise ValueError('Inline images require flattening')

        inspect(pdf.trailer)
        for obj in pdf.objects:
            inspect(obj)
        for page in pdf.pages:
            # Structural checking alone does not parse page drawing instructions.
            check_content(page)
        return not pdf.check()


def scan(raw):
    if not raw or len(raw) > MAX_BYTES or not raw.startswith(b'%PDF-'):
        return False
    # Reject stale/missing signatures. DB is mounted read-only; updates happen
    # outside this service and never receive uploaded bytes.
    database = '/var/lib/clamav'
    signatures = [os.path.join(database, name) for name in os.listdir(database)
                  if name in ('daily.cvd', 'daily.cld')]
    if not signatures or max(os.stat(path).st_mtime for path in signatures) < time.time() - 48 * 3600:
        return False
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(8)
        connection.connect('/tmp/clamd.sock')
        connection.sendall(b'zINSTREAM\0')
        for offset in range(0, len(raw), 65536):
            chunk = raw[offset:offset + 65536]
            connection.sendall(struct.pack('!I', len(chunk)) + chunk)
        connection.sendall(struct.pack('!I', 0))
        reply = b''
        while not reply.endswith(b'\0'):
            part = connection.recv(1024)
            if not part or len(reply) + len(part) > 1024:
                return False
            reply += part
        if reply != b'stream: OK\0':
            return False
    parsed = subprocess.run([sys.executable, __file__, '--parse'], input=raw,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=4)
    return parsed.returncode == 0


def prepare_memory_temp():
    def mounted():
        with open('/proc/mounts') as mounts:
            declared = any(line.split()[1:3] == ['/tmp', 'tmpfs'] for line in mounts)
        info = ctypes.create_string_buffer(256)
        libc = ctypes.CDLL(None)
        libc.statfs.argtypes = [ctypes.c_char_p, ctypes.c_void_p]
        libc.statfs.restype = ctypes.c_int
        return declared and libc.statfs(b'/tmp', info) == 0 and ctypes.c_long.from_buffer(info).value == 0x01021994
    if os.geteuid() == 0:
        os.makedirs('/tmp', exist_ok=True)
    if not mounted():
        if os.geteuid() != 0:
            raise RuntimeError('Memory-backed scanner temporary directory unavailable')
        os.makedirs('/tmp', exist_ok=True)
        subprocess.run(['mount', '-t', 'tmpfs', '-o',
                        'size=64m,noexec,nosuid,nodev,mode=1777', 'tmpfs', '/tmp'],
                       check=True, stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not mounted():
        raise RuntimeError('Scanner temporary directory is not tmpfs')
    if os.geteuid() == 0:
        os.chmod('/tmp', 0o1777)
        os.setgroups([])
        os.setgid(65534)
        os.setuid(65534)
    if os.geteuid() != 65534 or os.getegid() != 65534:
        raise RuntimeError('Scanner must run unprivileged')
    if not os.access('/tmp', os.W_OK | os.X_OK):
        raise RuntimeError('Memory-backed scanner directory is not writable')


class ScannerHTTPServer(HTTPServer):
    def server_bind(self):
        # No DNS lookup: cloud instance hostnames can exceed a DNS label's limit.
        TCPServer.server_bind(self)
        self.server_name = 'scanner'
        self.server_port = self.server_address[1]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        ready = False
        try:
            if self.path == '/health':
                signatures = [os.path.join('/var/lib/clamav', name) for name in ('daily.cvd', 'daily.cld')
                              if os.path.isfile(os.path.join('/var/lib/clamav', name))]
                fresh = signatures and max(os.stat(path).st_mtime for path in signatures) >= time.time() - 48 * 3600
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
                    connection.settimeout(0.5)
                    connection.connect('/tmp/clamd.sock')
                    connection.sendall(b'zPING\0')
                    ready = bool(fresh) and connection.recv(16) == b'PONG\0'
        except Exception:
            pass
        self.send_response(200 if ready else 503)
        self.send_header('Content-Length', '0')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.close_connection = True

    def log_message(self, *args):
        pass  # Never log request paths, bytes, parser errors or AV output.

    def do_POST(self):
        try:
            self.connection.settimeout(13)
            length = int(self.headers.get('Content-Length', '0'))
            if self.path != '/scan' or self.headers.get('Content-Type') != 'application/pdf' or not 0 < length <= MAX_BYTES or self.headers.get('Transfer-Encoding'):
                raise ValueError('Invalid request')
            raw = self.rfile.read(length)
            passed = len(raw) == length and scan(raw)
        except Exception:
            passed = False
        result = json.dumps({'clean': passed, 'readable': passed, 'format': 'pdf' if passed else None}).encode()
        self.send_response(200 if passed else 422)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(result)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(result)
        self.close_connection = True


if __name__ == '__main__':
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    if '--parse' in sys.argv:
        resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024,) * 2)
        resource.setrlimit(resource.RLIMIT_CPU, (3, 3))
        try:
            sys.exit(0 if parse_pdf(sys.stdin.buffer.read(MAX_BYTES + 1)) else 1)
        except Exception:
            sys.exit(1)
    prepare_memory_temp()
    # ponytail: one scan at a time; queue/load limits required before public use.
    daemon = subprocess.Popen(['clamd', '--config-file=/scanner/clamd.conf'],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ScannerHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
    finally:
        daemon.terminate()
        daemon.wait(timeout=10)
