"""Gunicorn config for MySewa API (binds localhost only; nginx proxies).

Usage (from server/):
  ../env/bin/gunicorn -c ../deploy/gunicorn.conf.py mysewa_backend.wsgi:application
"""
import multiprocessing
from pathlib import Path

_LOG_DIR = Path(__file__).resolve().parent / "logs"
_LOG_DIR.mkdir(parents=True, exist_ok=True)

# Use 8001 so it does not collide with other Django apps on the same VPS (e.g. www on 8000).
bind = "127.0.0.1:8001"
workers = min(3, multiprocessing.cpu_count() * 2 + 1)
worker_class = "sync"
timeout = 120
keepalive = 5
accesslog = str(_LOG_DIR / "gunicorn-access.log")
errorlog = str(_LOG_DIR / "gunicorn-error.log")
capture_output = True
