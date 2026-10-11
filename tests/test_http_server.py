"""Connection bursts from the browser must not drop dashboard assets."""

import socket
import sys
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Handler, ThreadingHTTPServer


class HttpServerTest(unittest.TestCase):
    def test_browser_asset_connections_can_queue_before_accept(self):
        http = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        connections = []
        thread = None
        try:
            # Hold the accept loop while a browser's parallel asset requests arrive.
            # This exercises the listening socket, rather than checking a constant.
            for _ in range(16):
                connections.append(socket.create_connection(http.server_address, timeout=1))

            thread = threading.Thread(target=http.serve_forever, daemon=True)
            thread.start()
            host = f'127.0.0.1:{http.server_address[1]}'
            for connection in connections:
                connection.sendall(f'GET /js/main.js HTTP/1.0\r\nHost: {host}\r\n\r\n'.encode())
                with connection.makefile('rb') as response:
                    self.assertIn(b'200 OK', response.readline())
                    response.read()
        finally:
            for connection in connections:
                connection.close()
            if thread:
                http.shutdown()
                thread.join()
            http.server_close()
