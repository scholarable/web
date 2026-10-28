"""Run inside the real scanner image with current ClamAV signatures mounted."""
import io
import subprocess
import http.client
import json
import threading
from unittest.mock import patch
from PIL import Image
import time
import os
import pikepdf
from server import scan, Handler, ScannerHTTPServer, prepare_memory_temp, MAX_BYTES, MAX_EXPANDED


def pdf_bytes(change=None, encryption=None):
    with pikepdf.Pdf.new() as pdf:
        pdf.add_blank_page()
        if change:
            change(pdf)
        output = io.BytesIO()
        pdf.save(output, encryption=encryption)
        return output.getvalue()


with patch('builtins.open', return_value=io.StringIO('disk /tmp ext4 rw 0 0\n')), patch('os.geteuid', return_value=65534):
    try:
        prepare_memory_temp()
    except RuntimeError:
        pass
    else:
        raise AssertionError('Disk-backed scanner temporary directory accepted')
prepare_memory_temp()
assert os.geteuid() == os.getegid() == 65534

daemon = subprocess.Popen(['clamd', '--config-file=/scanner/clamd.conf'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(120):
    if os.path.exists('/tmp/clamd.sock'):
        break
    assert daemon.poll() is None, 'ClamAV daemon exited'
    time.sleep(0.5)
else:
    raise AssertionError('ClamAV startup timed out')


def jpeg_page(pdf):
    encoded = io.BytesIO()
    Image.new('RGB', (10, 10), 'white').save(encoded, format='JPEG')
    image = pikepdf.Stream(pdf, encoded.getvalue())
    image['/Type'] = pikepdf.Name.XObject
    image['/Subtype'] = pikepdf.Name.Image
    image['/Width'] = 10
    image['/Height'] = 10
    image['/ColorSpace'] = pikepdf.Name.DeviceRGB
    image['/BitsPerComponent'] = 8
    image['/Filter'] = pikepdf.Name.DCTDecode
    pdf.pages[0].Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(Im=image))
    pdf.pages[0].Contents = pikepdf.Stream(pdf, b'q 10 0 0 10 0 0 cm /Im Do Q')


clean = pdf_bytes()
assert scan(pdf_bytes(jpeg_page)), 'Ordinary JPEG PDF rejected'
assert scan(clean), 'Real clean scan failed (check signature freshness and startup time)'
large = pdf_bytes(lambda pdf: pdf.docinfo.__setitem__('/Title', 'A' * (MAX_BYTES - 4096)))
assert MAX_BYTES - 4096 < len(large) <= MAX_BYTES
assert scan(large), 'A valid PDF near the 5 MiB limit failed the bounded scan'
assert not scan(b'%PDF-1.7\nbroken'), 'Malformed PDF accepted'
assert not scan(b'x' * (MAX_BYTES + 1)), 'Oversized file accepted'
assert not scan(pdf_bytes(encryption=pikepdf.Encryption(owner='owner', user='password'))), 'Encrypted PDF accepted'
assert not scan(pdf_bytes(lambda pdf: pdf.Root.__setitem__('/OpenAction', pikepdf.Dictionary(S=pikepdf.Name.JavaScript, JS='app.alert(1)')))), 'Active PDF accepted'
assert not scan(pdf_bytes(lambda pdf: pdf.attachments.__setitem__('test.txt', b'attachment'))), 'Attachment accepted'
# AV must reject a known test signature independently of PDF parsing.
eicar = b'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
result = subprocess.run(['clamscan', '--no-summary', '-'], input=eicar, capture_output=True, timeout=60)
assert result.returncode == 1, 'Real ClamAV failed EICAR detection'
assert not scan(pdf_bytes(lambda pdf: setattr(pdf.pages[0], 'Contents', pikepdf.Stream(pdf, eicar)))), 'Malware PDF accepted'
assert not scan(pdf_bytes(lambda pdf: setattr(pdf.pages[0], 'Contents', pikepdf.Stream(pdf, b' ' * (MAX_EXPANDED + 1))))), 'Expansion limit bypassed'
assert not scan(pdf_bytes(lambda pdf: setattr(pdf.pages[0], 'Contents', pikepdf.Stream(pdf, b'BI /W 1 /H 1 /CS /RGB /BPC 8 ID abc EI')))), 'Unbounded inline image accepted'
assert set(os.listdir('/tmp')) <= {'clamd.sock'}, 'Temporary scan bytes retained'
with patch('socket.getfqdn', side_effect=UnicodeError('cloud hostname exceeds DNS label limit')):
    server = ScannerHTTPServer(('127.0.0.1', 0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=15)
connection.request('GET', '/health')
response = connection.getresponse()
assert response.status == 200 and response.read() == b''
connection.close()
connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=15)
connection.request('POST', '/scan', clean, {'Content-Type': 'application/pdf'})
response = connection.getresponse()
assert response.status == 200
assert json.loads(response.read()) == {'clean': True, 'readable': True, 'format': 'pdf'}
connection.close()
connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=15)
connection.request('POST', '/scan', clean, {'Content-Type': 'text/plain'})
response = connection.getresponse()
assert response.status == 422 and json.loads(response.read())['clean'] is False
connection.close()
connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=15)
connection.request('POST', '/scan', clean, {'Content-Type': 'application/pdf', 'Transfer-Encoding': 'chunked'})
response = connection.getresponse()
assert response.status == 422 and json.loads(response.read())['clean'] is False
connection.close()
server.shutdown()
server.server_close()
print('Real ClamAV + PDF parser: clean, malformed, oversized, encrypted, active, attachment, malware, JPEG, expansion and HTTP contract checks passed')

daemon.terminate()
daemon.wait(timeout=10)
try:
    assert not scan(clean), 'Stopped scanner accepted a PDF'
except (OSError, TimeoutError):
    pass  # HTTP handler turns scanner unavailability into a failed verdict.
