"""Serve the exact GitHub Pages static export locally, including its base path."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

class Preview(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(Path(__file__).resolve().parents[1]/'frontend/out'),**kw)
    def do_GET(self):
        if self.path=='/':
            self.send_response(302);self.send_header('Location','/Dragon-Legend-RAG/');self.end_headers();return
        if self.path.startswith('/Dragon-Legend-RAG/'):
            self.path=self.path[len('/Dragon-Legend-RAG'):]
        super().do_GET()

if __name__=='__main__':ThreadingHTTPServer(('127.0.0.1',3011),Preview).serve_forever()
