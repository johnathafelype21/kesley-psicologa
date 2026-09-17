import http.server
import socketserver
import os
import sys

PORT = 3000
DIRECTORY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        clean_path = self.path.split('?')[0].rstrip('/')
        if clean_path in ("", "/", "/index", "/index.html", "/landing", "/landing/index"):
            self.send_response(302)
            self.send_header("Location", "/landing/index.html")
            self.end_headers()
            return
        elif clean_path in ("/agendamento", "/landing/agendamento"):
            self.send_response(302)
            self.send_header("Location", "/landing/agendamento.html")
            self.end_headers()
            return
        elif clean_path in ("/como-funciona", "/landing/como-funciona"):
            self.send_response(302)
            self.send_header("Location", "/landing/como-funciona.html")
            self.end_headers()
            return
        return super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

class ReusableServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

if __name__ == "__main__":
    sys.stdout.reconfigure(line_buffering=True)
    with ReusableServer(("", PORT), CustomHandler) as httpd:
        print(f"Servidor ativo em http://localhost:{PORT}", flush=True)
        httpd.serve_forever()
